// ==UserScript==
// @name         银川科技学院 (海旗) 学习与测评助手 Pro
// @namespace    http://tampermonkey.net/
// @version      3.5
// @description  自动刷课、倍速静音、防弹窗、测评自动答题 (修复：域名/弹窗崩溃/循环并发/面板加载/倍速锁定/拦截回拽/章节列表切节/静音警告)
// @author       You
// @match        *://ycust.haiqikeji.com/*
// @match        *://*.haiqikeji.com/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function() {
    'use strict';

    // ================= 核心配置区 =================
    const CONFIG = {
        video: {
            playbackRate: 1.0,      // 默认原速；需要提速在面板里选
            muted: true,
            forceRate: true,        // 仅当倍速 > 1 时生效（实测平台会压回 1.5x）
            antiRewind: true,       // 仅当倍速 > 1 时生效（拦截平台回写 currentTime 的看门狗）
            sectionItemSelector: '.video-item',   // 真实页面的章节列表项
            activeClass: 'active',
            checkInterval: 2000,
            advanceCooldown: 4000,   // 切下一节后的冷却，避免并发重复点击
            selectors: ['video', '.vjs-tech', '.prism-player video', '#player-con video', '.dplayer-video-wrap video']
        },
        exam: {
            strategy: 'middle', // middle, first, last, random
            optionSelector: '.option-item, .subject-item .answer-item, .el-radio, .el-checkbox',
            inputSelector: 'input[type="radio"], input[type="checkbox"]',
            nextBtnSelector: '.next-btn, .submit-btn, .btn-next, .btn-submit, .el-button--primary, .el-button',
            startBtnSelector: '.start-btn, .agree-btn, .btn-start',
            nextText: /下一题|下一节|下一条|下一页|确定|确认|继续/,
            submitText: /提交|交卷/,
            allowAutoSubmit: false   // 默认不自动交卷，防止误提交
        }
    };

    let runningMode = 'stopped'; // stopped | video | exam
    let mainTimer = null;
    let loopBusy = false;
    let lastAdvanceTs = 0;
    let statusElRef = null;   // 面板状态文字，供主循环实时刷新

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // 元素是否可见（兼容 position: fixed 元素 offsetParent 为 null 的情况）
    function isVisible(el) {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        try {
            const cs = getComputedStyle(el);
            if (cs.position === 'fixed' && cs.display !== 'none' && cs.visibility !== 'hidden') return true;
        } catch (e) {}
        return false;
    }

    function getText(el) {
        return ((el && (el.innerText || el.textContent)) || '').trim();
    }

    // 模拟真实点击，防止被前端框架拦截
    function simulateClick(element) {
        if (!element) return;
        const events = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
        events.forEach(eventType => {
            let ev;
            try { ev = new MouseEvent(eventType, { view: window, bubbles: true, cancelable: true }); }
            catch (e) { ev = new Event(eventType, { bubbles: true, cancelable: true }); }
            element.dispatchEvent(ev);
        });
    }

    // ================= 一、视频刷课模块 =================
    function getActiveVideo() {
        for (const sel of CONFIG.video.selectors) {
            const videos = document.querySelectorAll(sel);
            for (let v of videos) {
                if (v.tagName === 'VIDEO' && isVisible(v)) return v;
            }
        }
        return null;
    }

    // 处理烦人的“继续学习”或“知道了”弹窗
    function handlePopups() {
        const popups = document.querySelectorAll('.el-dialog__wrapper, .modal, .layui-layer');
        for (let popup of popups) {
            if (popup.style.display === 'none') continue;
            const confirmBtn = popup.querySelector('.el-button--primary, .btn-primary, .layui-layer-btn0');
            if (!confirmBtn) continue;                 // 修复：没有按钮时直接跳过，避免空指针崩溃
            const txt = getText(confirmBtn);
            if (/确定|继续|知道了|好的|关闭/.test(txt)) {   // 修复：括号优先级错误
                simulateClick(confirmBtn);
                console.log('[助手] 已自动关闭弹窗：' + txt);
            }
        }
    }

    function advanceSection(reason) {
        if (Date.now() - lastAdvanceTs < CONFIG.video.advanceCooldown) return false;

        // 海旗真实页面没有「下一节」按钮：章节是左侧 .video-item 列表，点下一个列表项即可切换
        const items = [...document.querySelectorAll(CONFIG.video.sectionItemSelector)].filter(isVisible);
        if (items.length) {
            const activeIdx = items.findIndex(el => el.classList.contains(CONFIG.video.activeClass));
            if (activeIdx === items.length - 1) {
                console.log('[助手] 已是最后一节（' + reason + '），自动停止');
                runningMode = 'stopped';
                antiRewindOn = false;
                uninstallToastMute();
                if (statusElRef) {
                    statusElRef.textContent = '状态：✅ 全部章节已完成';
                    statusElRef.style.color = '#4CAF50';
                }
                return false;
            }
            const next = activeIdx >= 0 ? items[activeIdx + 1] : items[0];
            if (next && !next.classList.contains(CONFIG.video.activeClass)) {
                lastAdvanceTs = Date.now();
                simulateClick(next);
                console.log('[助手] 已切到下一节：' + getText(next).slice(0, 18) + '（' + reason + '）');
                return true;
            }
        }

        // 兜底：通用「下一节」按钮
        const btn = [...document.querySelectorAll('.next-btn, .next-section, .btn-next')]
            .find(b => !b.disabled && isVisible(b));
        if (btn) {
            lastAdvanceTs = Date.now();
            simulateClick(btn);
            console.log('[助手] 已进入下一节（' + reason + '）');
            return true;
        }
        return false;
    }

    // 平台会把倍速强行压回自己的上限（实测：脚本设 2.0，页面稳定停在 1.5）
    // 这里劫持 video 元素 playbackRate 的写入，把平台写回的值改写成目标倍速
    const rateDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
    const FAST_THRESHOLD = 1.05;   // 超过这个值才算"提速"，才需要抢控制权

    function isFastWanted() {
        return CONFIG.video.forceRate && CONFIG.video.playbackRate > FAST_THRESHOLD;
    }

    function unlockRate(video) {
        if (!video || !video.__rateLocked) return;
        try { delete video.playbackRate; } catch (e) {}
        video.__rateLocked = false;
        console.log('[助手] 已交还倍速控制权（原速模式）');
    }

    function lockRate(video) {
        if (!rateDesc || !rateDesc.set) return;
        // 默认原速时完全不插手，平台播放器自己的倍速按钮照常可用
        if (!isFastWanted()) { unlockRate(video); return; }
        if (video.__rateLocked) return;
        try {
            Object.defineProperty(video, 'playbackRate', {
                configurable: true,
                get() { return rateDesc.get.call(video); },
                set(v) {
                    const want = CONFIG.video.forceRate ? CONFIG.video.playbackRate : v;
                    try { rateDesc.set.call(video, want); }
                    catch (e) { try { rateDesc.set.call(video, v); } catch (e2) {} }
                }
            });
            video.__rateLocked = true;
            console.log('[助手] 已锁定倍速 ' + CONFIG.video.playbackRate + 'x（覆盖平台上限）');
        } catch (e) {
            console.warn('[助手] 倍速锁定失败：' + e.message);
        }
    }

    // 真正的拦路虎：平台有个「反倍速看门狗」，每 0.25~0.55 秒把 currentTime 往回写约 0.5 秒。
    // 实测：只锁 playbackRate 时，2x 只能跑出 0.73x；拦掉向后写入后，实测稳定 2.00x。
    const ctDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
    let antiRewindOn = false;   // 仅在刷课运行中生效，避免影响用户手动拖进度条
    let rewindBlocked = 0;
    let ctPatched = false;

    function installAntiRewind() {
        if (ctPatched || !ctDesc || !ctDesc.set) return;
        try {
            Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
                configurable: true,
                get() { return ctDesc.get.call(this); },
                set(v) {
                    // 只拦「往回跳」的写入；用户向前拖动仍然放行
                    if (antiRewindOn && Number(v) < ctDesc.get.call(this) - 0.05) {
                        rewindBlocked++;
                        return;
                    }
                    ctDesc.set.call(this, v);
                }
            });
            ctPatched = true;
            console.log('[助手] 防回拽已就位（拦截平台回写进度）');
        } catch (e) {
            console.warn('[助手] 防回拽安装失败：' + e.message);
        }
    }

    // 平台的看门狗每 0.25 秒判定一次"快进"，每次都弹一条 el-message 警告（实测铺满半屏）。
    // 这里把这些噪音移除；其它提示（如"视频加载失败"）照常保留。
    const NOISE_RE = /不允许快进|播放速度不能超过/;
    let toastObserver = null;

    function dropNoiseToast(node) {
        if (!node || node.nodeType !== 1) return;
        const list = node.matches && node.matches('.el-message') ? [node] : [...node.querySelectorAll('.el-message')];
        for (const el of list) {
            if (NOISE_RE.test(el.innerText || '')) el.remove();
        }
    }

    function installToastMute() {
        if (toastObserver) return;
        document.querySelectorAll('.el-message').forEach(el => {
            if (NOISE_RE.test(el.innerText || '')) el.remove();
        });
        toastObserver = new MutationObserver(muts => {
            for (const m of muts) {
                for (const n of m.addedNodes) {
                    dropNoiseToast(n);
                    // 文字可能是插入后再填的，稍后再查一次
                    setTimeout(() => dropNoiseToast(n), 60);
                }
            }
        });
        toastObserver.observe(document.body, { childList: true, subtree: true });
        console.log('[助手] 已静音平台的"快进/倍速"警告');
    }

    function uninstallToastMute() {
        if (toastObserver) { toastObserver.disconnect(); toastObserver = null; }
    }

    async function handleVideoLearning() {
        handlePopups(); // 优先处理弹窗

        const video = getActiveVideo();
        if (!video) {
            // 图文章节处理
            advanceSection('图文/无视频');
            return;
        }

        // 防回拽 + 静音警告：只在提速时才装。原速（默认）下平台不会拦你，装了反而挡住手动拖进度条
        if (CONFIG.video.antiRewind && isFastWanted()) {
            installAntiRewind();
            antiRewindOn = true;
            installToastMute();
        } else {
            antiRewindOn = false;
            uninstallToastMute();
        }

        // 自动静音与倍速
        if (CONFIG.video.muted && !video.muted) video.muted = true;
        lockRate(video);   // 原速时会自动交还控制权
        if (video.playbackRate !== CONFIG.video.playbackRate) {
            try { video.playbackRate = CONFIG.video.playbackRate; } catch(e){}
        }
        if (statusElRef) {
            statusElRef.textContent = antiRewindOn
                ? '状态：🎬 ' + video.playbackRate + 'x 刷课中｜拦截回拽 ' + rewindBlocked
                : '状态：🎬 原速刷课中';
        }

        // 自动播放
        if (video.paused && !video.ended) {
            try { await video.play(); }
            catch (e) { console.warn('[助手] 浏览器拦截了自动播放，请点击页面任意位置激活。'); }
        }

        // 播放结束，切下一节
        const finished = video.ended || (video.duration > 0 && video.currentTime >= video.duration - 0.5);
        if (finished) {
            console.log('[助手] 视频播放完毕，尝试切换下一节');
            advanceSection('播放结束');
        }
    }

    // ================= 二、在线测评答题模块 =================
    function autoSelectOption() {
        let options = [...document.querySelectorAll(CONFIG.exam.optionSelector)].filter(isVisible);
        if (options.length === 0) {
            // 只有原生 input 时，点击其外层 label
            const inputs = [...document.querySelectorAll(CONFIG.exam.inputSelector)];
            const picked = inputs.length ? inputs[Math.floor(inputs.length / 2)] : null;
            if (picked) { simulateClick(picked.closest('label') || picked); return true; }
            return false;
        }

        let idx = 0;
        switch (CONFIG.exam.strategy) {
            case 'first': idx = 0; break;
            case 'last': idx = options.length - 1; break;
            case 'random': idx = Math.floor(Math.random() * options.length); break;
            case 'middle':
            default: idx = Math.floor(options.length / 2); break;
        }

        const target = options[idx];
        if (!target) return false;
        simulateClick(target);
        console.log(`[助手] 已选择第 ${idx + 1} 个选项`);
        return true;
    }

    function findButton(selectorList, textRe) {
        return [...document.querySelectorAll(selectorList)]
            .find(b => !b.disabled && isVisible(b) && textRe.test(getText(b)));
    }

    async function handleExamPage() {
        // 1. 开始/同意
        const startBtn = findButton(CONFIG.exam.startBtnSelector, /开始|同意|进入|确认/);
        if (startBtn) {
            simulateClick(startBtn);
            await sleep(1000);
            return;
        }

        // 2. 选择选项
        if (autoSelectOption()) await sleep(800);

        // 3. 下一题
        const nextBtn = findButton(CONFIG.exam.nextBtnSelector, CONFIG.exam.nextText);
        if (nextBtn) {
            simulateClick(nextBtn);
            await sleep(1200);
            return;
        }

        // 4. 交卷（默认关闭，需面板勾选）
        const submitBtn = findButton(CONFIG.exam.nextBtnSelector, CONFIG.exam.submitText);
        if (submitBtn && CONFIG.exam.allowAutoSubmit) {
            simulateClick(submitBtn);
            console.log('[助手] 已自动交卷');
            await sleep(1500);
        } else if (submitBtn) {
            console.log('[助手] 检测到交卷按钮，已按设置保留，未自动提交');
        }
    }

    // ================= 三、主循环与 UI 控制台 =================
    function scheduleNext() {
        clearTimeout(mainTimer);
        mainTimer = setTimeout(mainLoop, runningMode === 'video' ? CONFIG.video.checkInterval : 1500);
    }

    async function mainLoop() {
        if (runningMode === 'stopped') { mainTimer = null; return; }
        if (loopBusy) { scheduleNext(); return; }   // 修复：上一轮未结束时不叠加执行

        loopBusy = true;
        try {
            if (runningMode === 'video') await handleVideoLearning();
            else if (runningMode === 'exam') await handleExamPage();
        } catch (e) {
            console.warn('[助手] 本轮执行异常：' + (e && e.message));
        } finally {
            loopBusy = false;
        }

        if (runningMode === 'stopped') { mainTimer = null; return; }
        scheduleNext();
    }

    function startLoop() {
        if (loopBusy || mainTimer !== null) return;
        mainLoop();
    }

    // 使用 Shadow DOM 创建防干扰的 UI
    function createPanel() {
        if (document.getElementById('ycust-helper-host')) return;
        const host = document.createElement('div');
        host.id = 'ycust-helper-host';
        host.style.cssText = 'position: fixed; top: 80px; right: 20px; z-index: 999999;';
        document.body.appendChild(host);

        const shadow = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style');
        style.textContent = `
            .panel { background: #fff; border: 1px solid #e0e0e0; border-radius: 10px; padding: 15px; box-shadow: 0 4px 16px rgba(0,0,0,0.15); font-family: system-ui, sans-serif; width: 240px; font-size: 13px; box-sizing: border-box; }
            .title { font-weight: bold; font-size: 14px; margin-bottom: 12px; color: #333; border-bottom: 1px solid #f0f0f0; padding-bottom: 8px; display: flex; justify-content: space-between; align-items: center; }
            .title span { font-size: 10px; color: #999; font-weight: normal; }
            .form-group { margin-bottom: 10px; }
            label { display: block; margin-bottom: 4px; color: #666; }
            select { width: 100%; padding: 5px; border: 1px solid #ddd; border-radius: 4px; outline: none; box-sizing: border-box; }
            .switch { display: flex; align-items: center; gap: 6px; color: #666; margin-bottom: 10px; }
            .btns { display: flex; gap: 8px; margin-bottom: 10px; }
            button { flex: 1; padding: 8px 0; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-weight: bold; transition: 0.2s; }
            .btn-video { background: #4CAF50; }
            .btn-video:hover { background: #45a049; }
            .btn-exam { background: #2196F3; }
            .btn-exam:hover { background: #1e88e5; }
            .btn-stop { background: #f44336; }
            .btn-stop:hover { background: #e53935; }
            .status { color: #888; font-size: 12px; text-align: center; }
        `;

        const panel = document.createElement('div');
        panel.className = 'panel';
        panel.innerHTML = `
            <div class="title">🎓 学习测评助手 <span>v3.5</span></div>
            <div class="form-group">
                <label>倍速设置</label>
                <select id="rate-select">
                    <option value="1.0" selected>1.0x (默认·原速)</option>
                    <option value="1.25">1.25x</option>
                    <option value="1.5">1.5x</option>
                    <option value="2.0">2.0x (需开启下方两个开关)</option>
                    <option value="3.0">3.0x (极速)</option>
                </select>
            </div>
            <div class="form-group">
                <label>答题策略</label>
                <select id="strategy-select">
                    <option value="middle" selected>中立 (选中间项)</option>
                    <option value="first">积极 (选第一项)</option>
                    <option value="last">消极 (选最后一项)</option>
                    <option value="random">随机选择</option>
                </select>
            </div>
            <label class="switch"><input type="checkbox" id="force-rate" checked> 强制倍速(仅 >1x 生效)</label>
            <label class="switch"><input type="checkbox" id="anti-rewind" checked> 防回拽(仅 >1x 生效)</label>
            <label class="switch"><input type="checkbox" id="allow-submit"> 允许自动交卷</label>
            <div class="btns">
                <button id="btn-video" class="btn-video">刷课</button>
                <button id="btn-exam" class="btn-exam">答题</button>
                <button id="btn-stop" class="btn-stop">停止</button>
            </div>
            <div id="status-text" class="status">状态：待机中</div>
        `;

        shadow.appendChild(style);
        shadow.appendChild(panel);

        const statusEl = shadow.getElementById('status-text');
        statusElRef = statusEl;
        const rateSelect = shadow.getElementById('rate-select');
        const stratSelect = shadow.getElementById('strategy-select');
        const allowSubmit = shadow.getElementById('allow-submit');
        const forceRate = shadow.getElementById('force-rate');
        const antiRewindEl = shadow.getElementById('anti-rewind');

        rateSelect.addEventListener('change', (e) => {
            CONFIG.video.playbackRate = parseFloat(e.target.value);
            // 已锁定的 video 需要重新写一次才会生效
            document.querySelectorAll('video').forEach(v => { try { v.playbackRate = CONFIG.video.playbackRate; } catch(e){} });
        });
        stratSelect.addEventListener('change', (e) => { CONFIG.exam.strategy = e.target.value; });
        allowSubmit.addEventListener('change', (e) => { CONFIG.exam.allowAutoSubmit = e.target.checked; });
        forceRate.addEventListener('change', (e) => {
            CONFIG.video.forceRate = e.target.checked;
            if (!e.target.checked) {
                document.querySelectorAll('video').forEach(v => {
                    if (v.__rateLocked) { delete v.playbackRate; delete v.__rateLocked; }
                });
            }
        });
        antiRewindEl.addEventListener('change', (e) => {
            CONFIG.video.antiRewind = e.target.checked;
            if (!e.target.checked) { antiRewindOn = false; uninstallToastMute(); } // 立刻放行，方便手动拖进度条
        });

        shadow.getElementById('btn-video').addEventListener('click', () => {
            runningMode = 'video';
            statusEl.textContent = '状态：🎬 视频刷课中...';
            statusEl.style.color = '#4CAF50';
            startLoop();
        });

        shadow.getElementById('btn-exam').addEventListener('click', () => {
            runningMode = 'exam';
            statusEl.textContent = '状态：📝 测评答题中...';
            statusEl.style.color = '#2196F3';
            startLoop();
        });

        shadow.getElementById('btn-stop').addEventListener('click', () => {
            runningMode = 'stopped';
            antiRewindOn = false;   // 停止后放行，避免影响正常播放/拖动
            uninstallToastMute();
            statusEl.textContent = '状态：已停止';
            statusEl.style.color = '#f44336';
            if (mainTimer) { clearTimeout(mainTimer); mainTimer = null; }
        });
    }

    // 初始化：兼容 load 事件已触发 / SPA 场景
    if (document.readyState === 'loading') {
        window.addEventListener('load', () => setTimeout(createPanel, 1000), { once: true });
        document.addEventListener('DOMContentLoaded', () => setTimeout(createPanel, 3000), { once: true });
    } else {
        setTimeout(createPanel, 1000);
    }

})();
