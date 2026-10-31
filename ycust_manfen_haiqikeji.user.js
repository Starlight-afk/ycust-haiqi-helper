// ==UserScript==
// @name         💯【满分助手·海旗版】银川科技学院 ycust.haiqikeji.com 适配
// @namespace    askAuto.haiqikeji
// @version      3.0.1
// @author       shushoujiu / 本地适配
// @description  由「超星满分助手」移植到海旗在线学习平台（ycust.haiqikeji.com）：章节视频自动播放/静音/倍速/防回拽/自动切换，测验与作业题干识别 + 多题库检索答案 + 自动填答，可视化参数配置。
// @match        *://ycust.haiqikeji.com/*
// @match        *://*.haiqikeji.com/*
// @require      https://registry.npmmirror.com/vue/3.3.4/files/dist/vue.global.prod.js
// @require      https://registry.npmmirror.com/vue-demi/0.14.0/files/lib/index.iife.js
// @require      https://registry.npmmirror.com/pinia/2.1.6/files/dist/pinia.iife.prod.js
// @connect      api.tikuhai.com
// @connect      tk.enncy.cn
// @connect      api.muketool.com
// @connect      cx.icodef.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_info
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @run-at       document-idle
// @noframes
// ==/UserScript==

(async function(Vue, Pinia) {
	"use strict";
	var SCRIPT_VERSION = "3.0.0";
	var vue = Vue;
	var pinia = Pinia;
	if (!vue || !pinia) {
		console.error("[满分助手] Vue / Pinia 未能加载，请检查脚本管理器 @require 是否成功（本脚本已改用国内镜像）。");
		return;
	}
	var pageWindow = (() => {
		try {
			return typeof unsafeWindow !== "undefined" && unsafeWindow ? unsafeWindow : window;
		} catch (e) {
			return window;
		}
	})();

	/* ============================================================
	 *  0. 脚本管理器 API 兜底层
	 *     原生 GM_* 在 Tampermonkey / Violentmonkey 下存在，
	 *     但在“直接 <script> 注入”等场景不存在，这里统一兜底，
	 *     避免脚本一开头就 ReferenceError 直接白屏。
	 * ============================================================ */
	var storage = {
		get(key, fallback) {
			try {
				if (typeof GM_getValue !== "undefined") {
					var value = GM_getValue(key);
					return value === void 0 ? fallback : value;
				}
			} catch (e) {}
			try {
				var raw = pageWindow.localStorage.getItem("manfen:" + key);
				return raw == null ? fallback : JSON.parse(raw);
			} catch (e) {
				return fallback;
			}
		},
		set(key, value) {
			try {
				if (typeof GM_setValue !== "undefined") {
					GM_setValue(key, value);
					return;
				}
			} catch (e) {}
			try {
				pageWindow.localStorage.setItem("manfen:" + key, JSON.stringify(value));
			} catch (e) {}
		}
	};
	var _GM_getValue = storage.get;
	var _GM_setValue = storage.set;
	var _GM_info = (() => {
		try {
			return typeof GM_info !== "undefined" ? GM_info : { script: { version: SCRIPT_VERSION } };
		} catch (e) {
			return { script: { version: SCRIPT_VERSION } };
		}
	})();
	var _GM_xmlhttpRequest = (() => {
		if (typeof GM_xmlhttpRequest !== "undefined") return GM_xmlhttpRequest;
		// 没有 GM_xmlhttpRequest 时退化为 fetch：受同源策略限制，题库基本拿不到答案，仅避免脚本崩溃
		return function(options) {
			var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
			var timer = setTimeout(() => {
				controller && controller.abort();
			}, options.timeout || 1e4);
			fetch(options.url, {
				method: options.method || "GET",
				headers: options.headers || {},
				body: options.method && options.method.toUpperCase() !== "GET" ? options.data : void 0,
				signal: controller ? controller.signal : void 0
			}).then((res) => res.text().then((text) => {
				options.onload && options.onload({
					status: res.status,
					responseText: text,
					finalUrl: res.url
				});
			})).catch((err) => {
				options.onerror && options.onerror(err);
			}).finally(() => {
				clearTimeout(timer);
			});
		};
	})();

	/* ============================================================
	 *  1. 配置
	 * ============================================================ */
	var defaultConfig$1 = {
		debugger: false,
		interval: 3,
		answerInterval: 3,
		thtoken: "",
		yztoken: "",
		ennyctoken: "",
		autoAnswer: true,
		autoVideo: true,
		autoJump: true,
		autoSubmit: false,
		minAccuracy: .8,
		autoExam: true,
		playbackRate: 1,
		muted: true,
		forceRate: true,
		antiRewind: true,
		notice: "本脚本仅供学习交流使用，严禁用于商业用途，否则后果自负！"
	};
	var getConfig = () => {
		var saved = _GM_getValue("config");
		var merged = Object.assign({}, defaultConfig$1);
		if (saved && typeof saved === "object") Object.keys(saved).forEach((key) => {
			if (saved[key] !== void 0 && saved[key] !== null && saved[key] !== "") merged[key] = saved[key];
		});
		return merged;
	};
	var userConfig = [
		{
			name: "base",
			label: "基础配置",
			config: [
				{
					name: "interval",
					label: "通用间隔(秒)",
					type: "number",
					value: defaultConfig$1.interval,
					desc: "主循环间隔，用于脚本运行节奏"
				},
				{
					name: "answerInterval",
					label: "答题间隔(秒)",
					type: "number",
					value: defaultConfig$1.answerInterval,
					desc: "每道题之间的间隔，避免请求过快"
				},
				{
					name: "thtoken",
					label: "题库海秘钥",
					type: "input",
					value: defaultConfig$1.thtoken,
					desc: "非必填，购买后可获得，填写完请保存再刷新页面"
				},
				{
					name: "yztoken",
					label: "一之题库秘钥",
					type: "input",
					value: defaultConfig$1.yztoken,
					desc: "非必填，购买后可获得，填写完请保存再刷新页面"
				},
				{
					name: "ennyctoken",
					label: "言溪题库秘钥",
					type: "input",
					value: defaultConfig$1.ennyctoken,
					desc: "非必填，言溪题库 token，填写完请保存再刷新页面"
				}
			]
		},
		{
			name: "video",
			label: "视频配置",
			config: [
				{
					name: "autoVideo",
					label: "自动视频",
					type: "switch",
					value: defaultConfig$1.autoVideo,
					desc: "开启后，自动播放并静音当前视频"
				},
				{
					name: "playbackRate",
					label: "播放倍速",
					type: "number",
					value: defaultConfig$1.playbackRate,
					desc: "1 为原速；平台会把倍速压回上限，超过 1.5 需开启强制倍速"
				},
				{
					name: "muted",
					label: "自动静音",
					type: "switch",
					value: defaultConfig$1.muted,
					desc: "开启后，视频自动静音播放"
				},
				{
					name: "forceRate",
					label: "强制倍速",
					type: "switch",
					value: defaultConfig$1.forceRate,
					desc: "覆盖平台对 playbackRate 的写回限制"
				},
				{
					name: "antiRewind",
					label: "防回拽",
					type: "switch",
					value: defaultConfig$1.antiRewind,
					desc: "拦截平台把 currentTime 往回写的看门狗（仅倍速>1 时启用）"
				},
				{
					name: "autoJump",
					label: "自动切换",
					type: "switch",
					value: defaultConfig$1.autoJump,
					desc: "开启后，视频结束自动切换下一节"
				}
			]
		},
		{
			name: "chapter",
			label: "答题配置",
			config: [
				{
					name: "autoAnswer",
					label: "自动答题",
					type: "switch",
					value: defaultConfig$1.autoAnswer,
					desc: "开启后，自动识别题目并检索答案"
				},
				{
					name: "autoSubmit",
					label: "自动提交",
					type: "switch",
					value: defaultConfig$1.autoSubmit,
					desc: "慎用：匹配率达标时会自动提交答卷"
				},
				{
					name: "minAccuracy",
					label: "最低匹配率",
					type: "input",
					value: defaultConfig$1.minAccuracy,
					desc: "不满足最低匹配率则不会自动提交答案"
				}
			]
		},
		{
			name: "exam",
			label: "考试配置",
			config: [{
				name: "autoExam",
				label: "考试自动切换",
				type: "switch",
				value: defaultConfig$1.autoExam,
				desc: "开启后，考试页面会自动切到下一题"
			}]
		}
	];
	var useformStore = pinia.defineStore({
		id: "formstore",
		state: () => ({
			forminput: getConfig(),
			dialogV: false,
			activeName: "base"
		}),
		actions: { saveConfig(forminput) {
			_GM_setValue("config", forminput);
		} }
	});
	var log = (data, type = "info") => {
		var _a;
		const style = `color: ${{
			info: "orange",
			success: "green",
			error: "red"
		}[type]}; font-weight: bold;`;
		if (Array.isArray(data) || "object" == typeof data ? console.log(`%c${JSON.stringify(data, null, 2)}`, style) : console.log(`%c${data}`, style), defaultConfig$1.debugger) {
			const caller = (((_a = new Error().stack) == null ? void 0 : _a.split("\n")) || [])[2].trim();
			console.log(`${caller}`);
		}
	};
	var sleep = (time) => new Promise((resolve) => {
		setTimeout(() => {
			resolve();
		}, 1e3 * time);
	});
	var useAskStore = pinia.defineStore({
		id: "ask",
		state: () => ({
			dialogVisible: true,
			count: 0,
			questionList: [],
			task: {
				name: "暂未加载",
				work: {
					questionList: [],
					inx: 0
				},
				video: [],
				log: [],
				status: ""
			}
		}),
		actions: {
			reset() {
				this.task.name = "暂未加载", this.task.work = {
					questionList: [],
					inx: 0
				}, this.task.video = [], this.task.status = "", this.count = 0;
			},
			select(index) {
				this.task.work.questionList[index].selected = true, this.task.work.inx = index;
				try {
					this.task.work.questionList[index].dom.scrollIntoView({ block: "center" });
				} catch (e) {
					log(e, "error");
				}
			},
			get(index) {
				return this.task.work.questionList[index];
			},
			insert(question) {
				this.task.work.questionList.push(question);
			},
			update(index, question) {
				this.task.work.questionList[index] = question;
			},
			log(msg, level = "info") {
				this.task.log.length > 20 && this.task.log.shift(), this.task.log.push({
					time: new Date().toLocaleTimeString(),
					msg,
					type: level
				});
			},
			msg(msg) {
				this.task.status = msg;
			}
		}
	});
	var POSITION_KEY = "manfen:panel-position";
	var DRAG_THRESHOLD = 5;
	function readPosition() {
		try {
			const saved = _GM_getValue(POSITION_KEY);
			if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) return saved;
		} catch {}
		return null;
	}
	function useFloatingPanel(panel, launcher, visible) {
		const saved = readPosition();
		const position = (0, vue.ref)(saved ? {
			left: `${saved.left}px`,
			top: `${saved.top}px`
		} : {
			right: "20px",
			top: "72px"
		});
		const dragging = (0, vue.ref)(false);
		let origin;
		let observer;
		let ownerWindow;
		let suppressLauncherClick = false;
		const activeElement = () => visible.value ? panel.value : launcher.value;
		function place(left, top) {
			const element = activeElement();
			if (!element?.getClientRects().length || !ownerWindow) return;
			const rect = element.getBoundingClientRect();
			const maxX = Math.max(12, ownerWindow.innerWidth - rect.width - 12);
			const maxY = Math.max(12, ownerWindow.innerHeight - rect.height - 12);
			position.value = {
				left: `${Math.max(12, Math.min(left, maxX))}px`,
				top: `${Math.max(12, Math.min(top, maxY))}px`
			};
		}
		function clamp() {
			const rect = activeElement()?.getBoundingClientRect();
			if (rect) place(rect.left, rect.top);
		}
		function observeElements() {
			observer.disconnect();
			observer.observe(panel.value);
			if (launcher.value) observer.observe(launcher.value);
		}
		function startDrag(event) {
			if (event.button !== 0 || event.isPrimary === false || origin) return;
			const isLauncher = event.currentTarget === launcher.value;
			if (!isLauncher && event.target.closest("button, a, input")) return;
			const rect = activeElement().getBoundingClientRect();
			origin = {
				pointerId: event.pointerId,
				isLauncher,
				x: event.clientX,
				y: event.clientY,
				left: rect.left,
				top: rect.top
			};
			suppressLauncherClick = false;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		function moveDrag(event) {
			if (!origin || event.pointerId !== origin.pointerId) return;
			const dx = event.clientX - origin.x;
			const dy = event.clientY - origin.y;
			if (!dragging.value && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
			dragging.value = true;
			if (origin.isLauncher) suppressLauncherClick = true;
			place(origin.left + dx, origin.top + dy);
		}
		function endDrag(event) {
			if (!origin || event.pointerId !== origin.pointerId) return;
			origin = void 0;
			const moved = dragging.value;
			dragging.value = false;
			if (!moved) return;
			try {
				_GM_setValue(POSITION_KEY, {
					left: parseFloat(position.value.left),
					top: parseFloat(position.value.top)
				});
			} catch (error) {
				console.warn("满分助手：悬浮窗位置保存失败", error);
			}
		}
		function consumeDragClick(event) {
			const ignore = suppressLauncherClick && event.detail !== 0;
			suppressLauncherClick = false;
			return ignore;
		}
		(0, vue.onMounted)(() => {
			ownerWindow = panel.value.ownerDocument.defaultView;
			ownerWindow.addEventListener("resize", clamp);
			observer = new ownerWindow.ResizeObserver(clamp);
			observeElements();
			const panelWidth = parseFloat(ownerWindow.getComputedStyle(panel.value).width) || 356;
			place(saved?.left ?? ownerWindow.innerWidth - panelWidth - 20, saved?.top ?? 72);
		});
		(0, vue.watch)(visible, async () => {
			await (0, vue.nextTick)();
			if (!observer || !panel.value) return;
			observeElements();
			clamp();
		});
		(0, vue.onBeforeUnmount)(() => {
			observer?.disconnect();
			ownerWindow?.removeEventListener("resize", clamp);
			observer = void 0;
		});
		return {
			position,
			dragging,
			startDrag,
			moveDrag,
			endDrag,
			consumeDragClick
		};
	}
	var _hoisted_1$3 = ["width", "height"];
	var _hoisted_2$3 = ["d"];
	var _sfc_main$3 = {
		__name: "Icon",
		props: {
			name: String,
			size: {
				type: Number,
				default: 18
			}
		},
		setup(__props) {
			const paths = {
				settings: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3l-1 3-3 1-2 3 2 2-1 4 3 2 3-1 3 3 3-1 1-3 3-1 1-3-2-2 1-4-3-2-3 1-2-2Z",
				close: "m6 6 12 12M6 18 18 6",
				minus: "M5 12h14",
				arrow: "m10 7 5 5-5 5",
				check: "m5 12 4 4L19 6",
				book: "M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4ZM12 6v15",
				clock: "M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
				play: "m9 6 10 6-10 6ZM4 5v14",
				grip: "M8 6h.01M16 6h.01M8 12h.01M16 12h.01M8 18h.01M16 18h.01"
			};
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("svg", {
					width: __props.size,
					height: __props.size,
					viewBox: "0 0 24 24",
					fill: "none",
					stroke: "currentColor",
					"stroke-width": "1.7",
					"stroke-linecap": "round",
					"stroke-linejoin": "round",
					"aria-hidden": "true"
				}, [(0, vue.createElementVNode)("path", { d: paths[__props.name] || paths.book }, null, 8, _hoisted_2$3)], 8, _hoisted_1$3);
			};
		}
	};
	var _hoisted_1$2 = (0, vue.createElementVNode)("div", { class: "mf-section-intro" }, [(0, vue.createElementVNode)("h2", null, "授权码与设置"), (0, vue.createElementVNode)("p", null, "题库授权码在下方填写，修改后自动保存。")], -1);
	var _hoisted_2$2 = {
		class: "mf-segments",
		"aria-label": "配置分类"
	};
	var _hoisted_3$2 = ["aria-pressed", "onClick"];
	var _hoisted_4$2 = { class: "mf-field-label" };
	var _hoisted_5$2 = ["for"];
	var _hoisted_6$2 = ["id"];
	var _hoisted_7$2 = [
		"id",
		"onUpdate:modelValue",
		"aria-describedby"
	];
	var _hoisted_8$2 = [
		"id",
		"onUpdate:modelValue",
		"aria-describedby",
		"aria-invalid"
	];
	var _hoisted_9$2 = [
		"id",
		"onUpdate:modelValue",
		"type",
		"placeholder",
		"aria-describedby"
	];
	var _hoisted_10$2 = {
		key: 3,
		class: "mf-error",
		role: "alert"
	};
	var _sfc_main$2 = {
		__name: "SettingsPanel",
		setup(__props) {
			const formStore = useformStore();
			const { forminput, activeName } = (0, pinia.storeToRefs)(formStore);
			const draft = (0, vue.reactive)({ ...forminput.value });
			const errors = (0, vue.ref)({});
			const hasSaved = (0, vue.ref)(false);
			const saveFailed = (0, vue.ref)(false);
			const hasErrors = (0, vue.computed)(() => Object.keys(errors.value).length > 0);
			const saveStatus = (0, vue.computed)(() => {
				if (saveFailed.value) return "自动保存失败，请继续编辑重试";
				if (hasErrors.value) return "标红项未保存，其他有效修改会自动保存";
				return hasSaved.value ? "已自动保存，刷新页面生效" : "修改后自动保存，刷新页面生效";
			});
			const isToken = (field) => field.name.endsWith("token");
			const displayGroups = userConfig.map((group) => ({
				...group,
				label: group.name === "base" ? "授权码 / 基础" : group.label.replace("配置", ""),
				config: group.name === "base" ? [...group.config.filter(isToken), ...group.config.filter((field) => !isToken(field))] : group.config
			}));
			const fieldLabel = (field) => isToken(field) ? field.label.replace("秘钥", "授权码（秘钥）") : field.label;
			function autoSave() {
				const nextErrors = {};
				for (const [key, label] of [["interval", "间隔时间"], ["answerInterval", "答题间隔"]]) {
					const value = draft[key];
					if (value === "" || value == null) nextErrors[key] = `${label}不能为空`;
					else if (typeof value !== "number" || !Number.isFinite(value)) nextErrors[key] = `${label}必须为数字`;
					else if (value < 1) nextErrors[key] = `${label}必须大于等于1`;
				}
				errors.value = nextErrors;
				const nextConfig = {
					...forminput.value,
					...draft
				};
				for (const key of Object.keys(nextErrors)) nextConfig[key] = forminput.value[key];
				if (!Object.keys(nextConfig).some((key) => !Object.is(nextConfig[key], forminput.value[key]))) {
					saveFailed.value = false;
					return;
				}
				try {
					formStore.saveConfig(nextConfig);
					Object.assign(forminput.value, nextConfig);
					hasSaved.value = true;
					saveFailed.value = false;
				} catch {
					saveFailed.value = true;
				}
			}
			(0, vue.watch)(draft, autoSave, { flush: "sync" });
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("form", {
					class: "mf-settings",
					onSubmit: _cache[0] || (_cache[0] = (0, vue.withModifiers)(() => {}, ["prevent"])),
					novalidate: ""
				}, [
					_hoisted_1$2,
					(0, vue.createElementVNode)("nav", _hoisted_2$2, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(displayGroups), (group) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: group.name,
							type: "button",
							class: (0, vue.normalizeClass)({ "is-active": (0, vue.unref)(activeName) === group.name }),
							"aria-pressed": (0, vue.unref)(activeName) === group.name,
							onClick: ($event) => activeName.value = group.name
						}, (0, vue.toDisplayString)(group.label), 11, _hoisted_3$2);
					}), 128))]),
					((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(displayGroups), (group) => {
						return (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("div", {
							key: group.name,
							class: (0, vue.normalizeClass)(["mf-fields", { "mf-fields-base": group.name === "base" }])
						}, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(group.config, (field) => {
							return (0, vue.openBlock)(), (0, vue.createElementBlock)("div", {
								key: field.name,
								class: (0, vue.normalizeClass)(["mf-field", {
									"mf-field-switch": field.type === "switch",
									"mf-field-token": isToken(field)
								}])
							}, [
								(0, vue.createElementVNode)("div", _hoisted_4$2, [(0, vue.createElementVNode)("label", { for: `mf-${field.name}` }, (0, vue.toDisplayString)(fieldLabel(field)), 9, _hoisted_5$2), (0, vue.createElementVNode)("p", { id: `mf-${field.name}-help` }, (0, vue.toDisplayString)(isToken(field) ? "选填 · 填写你获得的对应题库授权码" : field.desc), 9, _hoisted_6$2)]),
								field.type === "switch" ? (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 0,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-switch",
									type: "checkbox",
									role: "switch",
									"aria-describedby": `mf-${field.name}-help`
								}, null, 8, _hoisted_7$2)), [[vue.vModelCheckbox, draft[field.name]]]) : field.type === "number" ? (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 1,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-input",
									type: "number",
									min: "1",
									step: "1",
									"aria-describedby": `mf-${field.name}-help`,
									"aria-invalid": !!errors.value[field.name]
								}, null, 8, _hoisted_8$2)), [[
									vue.vModelText,
									draft[field.name],
									void 0,
									{ number: true }
								]]) : (0, vue.withDirectives)(((0, vue.openBlock)(), (0, vue.createElementBlock)("input", {
									key: 2,
									id: `mf-${field.name}`,
									"onUpdate:modelValue": ($event) => draft[field.name] = $event,
									class: "mf-input",
									type: isToken(field) ? "password" : "text",
									placeholder: isToken(field) ? `粘贴${field.label.replace("秘钥", "")}授权码` : "",
									autocomplete: "off",
									"aria-describedby": `mf-${field.name}-help`
								}, null, 8, _hoisted_9$2)), [[vue.vModelDynamic, draft[field.name]]]),
								errors.value[field.name] ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("p", _hoisted_10$2, (0, vue.toDisplayString)(errors.value[field.name]), 1)) : (0, vue.createCommentVNode)("", true)
							], 2);
						}), 128))], 2)), [[vue.vShow, (0, vue.unref)(activeName) === group.name]]);
					}), 128)),
					(0, vue.createElementVNode)("footer", {
						class: (0, vue.normalizeClass)(["mf-autosave", {
							"is-error": hasErrors.value || saveFailed.value,
							"is-saved": hasSaved.value && !hasErrors.value && !saveFailed.value
						}]),
						role: "status"
					}, [(0, vue.createVNode)(_sfc_main$3, {
						name: hasSaved.value && !hasErrors.value && !saveFailed.value ? "check" : "clock",
						size: 14
					}, null, 8, ["name"]), (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)(saveStatus.value), 1)], 2)
				], 32);
			};
		}
	};
	var _hoisted_1$1 = { class: "mf-task" };
	var _hoisted_2$1 = { class: "mf-task-summary" };
	var _hoisted_3$1 = { class: "mf-task-icon" };
	var _hoisted_4$1 = (0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "当前任务", -1);
	var _hoisted_5$1 = (0, vue.createElementVNode)("i", null, null, -1);
	var _hoisted_6$1 = { class: "mf-progress-row" };
	var _hoisted_7$1 = ["aria-valuenow"];
	var _hoisted_8$1 = { class: "mf-question" };
	var _hoisted_9$1 = { class: "mf-question-heading" };
	var _hoisted_10$1 = { class: "mf-eyebrow" };
	var _hoisted_11$1 = { class: "mf-answer" };
	var _hoisted_12$1 = (0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "参考答案", -1);
	var _hoisted_13$1 = { key: 0 };
	var _hoisted_14$1 = {
		key: 1,
		class: "mf-loading"
	};
	var _hoisted_15$1 = (0, vue.createElementVNode)("span", null, null, -1);
	var _hoisted_16$1 = {
		key: 0,
		class: "mf-question-section",
		"aria-label": "题号导航"
	};
	var _hoisted_17$1 = (0, vue.createElementVNode)("div", { class: "mf-section-heading" }, [(0, vue.createElementVNode)("h3", null, "题号导航"), (0, vue.createElementVNode)("span", null, "点击定位到题目")], -1);
	var _hoisted_18$1 = { class: "mf-question-grid" };
	var _hoisted_19$1 = [
		"aria-label",
		"aria-current",
		"onClick"
	];
	var _hoisted_20 = {
		key: 1,
		class: "mf-sources"
	};
	var _hoisted_21 = { class: "mf-section-heading" };
	var _hoisted_22 = (0, vue.createElementVNode)("h3", null, "题库返回", -1);
	var _hoisted_23 = ["open"];
	var _hoisted_24$1 = ["innerHTML"];
	var _hoisted_25$1 = {
		key: 0,
		class: "mf-source-usage"
	};
	var _hoisted_26$1 = { class: "mf-help" };
	var _hoisted_27$1 = {
		key: 1,
		class: "mf-empty"
	};
	var _hoisted_28$1 = { class: "mf-empty-icon" };
	var _sfc_main$1 = {
		__name: "TaskPanel",
		emits: ["open-settings"],
		setup(__props, { emit }) {
			const store = useAskStore();
			const current = (0, vue.computed)(() => store.task.work.questionList[store.task.work.inx]);
			const answered = (0, vue.computed)(() => store.task.work.questionList.filter((item) => item.status === "primary").length);
			const completed = (0, vue.computed)(() => store.task.work.questionList.filter((item) => item.status).length);
			const percent = (0, vue.computed)(() => store.count ? Math.min(100, Math.round(completed.value / store.count * 100)) : 0);
			const answerText = (answer) => Array.isArray(answer) ? answer.join("\n") : String(answer || "");
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_1$1, [(0, vue.createElementVNode)("div", _hoisted_2$1, [
					(0, vue.createElementVNode)("span", _hoisted_3$1, [(0, vue.createVNode)(_sfc_main$3, {
						name: (0, vue.unref)(store).task.video.status ? "play" : "book",
						size: 20
					}, null, 8, ["name"])]),
					(0, vue.createElementVNode)("div", null, [_hoisted_4$1, (0, vue.createElementVNode)("h2", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.name === "暂未加载" ? "等待任务加载" : (0, vue.unref)(store).task.name), 1)]),
					(0, vue.createElementVNode)("span", { class: (0, vue.normalizeClass)(["mf-badge", { "is-waiting": (0, vue.unref)(store).task.name === "暂未加载" }]) }, [_hoisted_5$1, (0, vue.createTextVNode)((0, vue.toDisplayString)((0, vue.unref)(store).task.name === "暂未加载" ? "等待中" : "进行中"), 1)], 2)
				]), current.value ? ((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, { key: 0 }, [
					(0, vue.createElementVNode)("div", _hoisted_6$1, [(0, vue.createElementVNode)("span", null, "已处理 " + (0, vue.toDisplayString)(completed.value) + " / " + (0, vue.toDisplayString)((0, vue.unref)(store).count) + " 题", 1), (0, vue.createElementVNode)("span", null, "已匹配 " + (0, vue.toDisplayString)(answered.value) + " 题", 1)]),
					(0, vue.createElementVNode)("div", {
						class: "mf-progress",
						role: "progressbar",
						"aria-label": "题目处理进度",
						"aria-valuenow": percent.value,
						"aria-valuemin": "0",
						"aria-valuemax": "100"
					}, [(0, vue.createElementVNode)("span", { style: (0, vue.normalizeStyle)({ width: `${percent.value}%` }) }, null, 4)], 8, _hoisted_7$1),
					(0, vue.createElementVNode)("article", _hoisted_8$1, [
						(0, vue.createElementVNode)("div", _hoisted_9$1, [(0, vue.createElementVNode)("span", _hoisted_10$1, "第 " + (0, vue.toDisplayString)((0, vue.unref)(store).task.work.inx + 1) + " 题", 1), (0, vue.createElementVNode)("span", { class: (0, vue.normalizeClass)(["mf-answer-status", current.value.status]) }, (0, vue.toDisplayString)(current.value.status === "primary" ? "已匹配答案" : current.value.status === "danger" ? "暂无答案" : "正在检索"), 3)]),
						(0, vue.createElementVNode)("h3", null, (0, vue.toDisplayString)(current.value.question), 1),
						(0, vue.createElementVNode)("div", _hoisted_11$1, [_hoisted_12$1, current.value.answer ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("pre", _hoisted_13$1, (0, vue.toDisplayString)(answerText(current.value.answer)), 1)) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_14$1, [_hoisted_15$1, (0, vue.createTextVNode)("正在检索题库，请稍候…")]))])
					]),
					(0, vue.unref)(store).task.name !== "考试" ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_16$1, [_hoisted_17$1, (0, vue.createElementVNode)("div", _hoisted_18$1, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(store).task.work.questionList, (question, index) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: index,
							type: "button",
							class: (0, vue.normalizeClass)([question.status, { "is-current": (0, vue.unref)(store).task.work.inx === index }]),
							"aria-label": `查看第 ${index + 1} 题`,
							"aria-current": (0, vue.unref)(store).task.work.inx === index ? "true" : void 0,
							onClick: ($event) => (0, vue.unref)(store).select(index)
						}, (0, vue.toDisplayString)(index + 1), 11, _hoisted_19$1);
					}), 128))])])) : (0, vue.createCommentVNode)("", true),
					current.value.allAnswer ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_20, [
						(0, vue.createElementVNode)("div", _hoisted_21, [_hoisted_22, (0, vue.createElementVNode)("button", {
							type: "button",
							class: "mf-auth-link",
							onClick: _cache[0] || (_cache[0] = ($event) => emit("open-settings"))
						}, [(0, vue.createTextVNode)(" 填写授权码"), (0, vue.createVNode)(_sfc_main$3, {
							name: "arrow",
							size: 12
						})])]),
						((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(current.value.allAnswer, (source, index) => {
							return (0, vue.openBlock)(), (0, vue.createElementBlock)("details", {
								key: index,
								open: index === 0
							}, [
								(0, vue.createElementVNode)("summary", null, [
									(0, vue.createTextVNode)((0, vue.toDisplayString)(source.form), 1),
									(0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)(source.answer?.length ? "查看结果" : "暂无答案"), 1),
									(0, vue.createVNode)(_sfc_main$3, {
										name: "arrow",
										size: 14
									})
								]),
								(0, vue.createElementVNode)("div", {
									class: "mf-source-answer",
									innerHTML: answerText(source.answer) || "暂无答案"
								}, null, 8, _hoisted_24$1),
								source.num != null ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_25$1, [(0, vue.createElementVNode)("span", null, "已用 " + (0, vue.toDisplayString)(source.usenum), 1), (0, vue.createElementVNode)("span", null, "剩余 " + (0, vue.toDisplayString)(source.num), 1)])) : (0, vue.createCommentVNode)("", true)
							], 8, _hoisted_23);
						}), 128)),
						(0, vue.createElementVNode)("p", _hoisted_26$1, (0, vue.toDisplayString)(current.value.allAnswer.length) + " 个题库来源 · 授权码自动保存，刷新页面生效。 ", 1)
					])) : (0, vue.createCommentVNode)("", true)
				], 64)) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_27$1, [
					(0, vue.createElementVNode)("div", _hoisted_28$1, [(0, vue.createVNode)(_sfc_main$3, {
						name: (0, vue.unref)(store).task.video.status ? "play" : "clock",
						size: 30
					}, null, 8, ["name"])]),
					(0, vue.createElementVNode)("h3", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.video.status ? "正在完成视频任务" : "准备就绪，等待任务"), 1),
					(0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)((0, vue.unref)(store).task.video.status ? "视频运行状态可在日志中查看。" : "进入章节、作业或考试页面后，任务进度会显示在这里。"), 1)
				]))]);
			};
		}
	};
	var _hoisted_1 = ["onKeydown"];
	var _hoisted_2 = { class: "mf-brand" };
	var _hoisted_3 = { class: "mf-brand-text" };
	var _hoisted_4 = (0, vue.createElementVNode)("h1", null, [(0, vue.createTextVNode)("满分助手"), (0, vue.createElementVNode)("span", null, "haiqikeji")], -1);
	var _hoisted_5 = { class: "mf-window-actions" };
	var _hoisted_6 = ["aria-label", "title"];
	var _hoisted_7 = {
		key: 0,
		class: "mf-tabs",
		"aria-label": "助手内容"
	};
	var _hoisted_8 = ["aria-pressed", "onClick"];
	var _hoisted_9 = {
		key: 0,
		class: "mf-tab-count"
	};
	var _hoisted_10 = { class: "mf-body" };
	var _hoisted_11 = {
		key: 1,
		class: "mf-logs",
		"aria-label": "运行日志"
	};
	var _hoisted_12 = { class: "mf-section-heading" };
	var _hoisted_13 = (0, vue.createElementVNode)("h2", null, "运行记录", -1);
	var _hoisted_14 = {
		key: 0,
		class: "mf-empty"
	};
	var _hoisted_15 = (0, vue.createElementVNode)("h3", null, "还没有运行记录", -1);
	var _hoisted_16 = (0, vue.createElementVNode)("p", null, "任务开始后，日志会出现在这里。", -1);
	var _hoisted_17 = { key: 1 };
	var _hoisted_18 = (0, vue.createElementVNode)("span", { class: "mf-log-dot" }, null, -1);
	var _hoisted_19 = {
		key: 2,
		class: "mf-notice"
	};
	var _hoisted_24 = [
		(0, vue.createElementVNode)("span", { class: "mf-eyebrow" }, "使用公告", -1),
		(0, vue.createElementVNode)("h2", null, "本脚本仅用于学习交流，请24h内删除", -1),
		(0, vue.createElementVNode)("p", null, "禁止用于各种非法用途，否则后果自负。", -1),
		(0, vue.createElementVNode)("p", null, " 本脚本题库接口均来源于网络以及用户反馈添加，不对题库准确率以及可用性负责，请自行判断、评估是否使用。 ", -1)
	];
	var _hoisted_25 = { class: "mf-panel-footer" };
	var _hoisted_26 = { class: "mf-footer-status" };
	var _hoisted_27 = (0, vue.createElementVNode)("i", null, null, -1);
	var _hoisted_28 = (0, vue.createElementVNode)("span", { class: "mf-version" }, "v3.0.1", -1);
	var _hoisted_29 = ["aria-label", "title"];
	var _hoisted_30 = { class: "mf-launcher-icon" };
	var _sfc_main = {
		__name: "App",
		props: { taskMode: Boolean },
		setup(__props) {
			const props = __props;
			const askStore = useAskStore();
			const { task, dialogVisible } = (0, pinia.storeToRefs)(askStore);
			const { dialogV, activeName } = (0, pinia.storeToRefs)(useformStore());
			const activeTab = (0, vue.ref)("task");
			const panel = (0, vue.ref)(null);
			const launcher = (0, vue.ref)(null);
			const visible = (0, vue.computed)(() => dialogV.value || props.taskMode && dialogVisible.value);
			const { position, dragging, startDrag, moveDrag, endDrag, consumeDragClick } = useFloatingPanel(panel, launcher, visible);
			const tabs = [
				{
					id: "task",
					label: "运行状态"
				},
				{
					id: "logs",
					label: "运行日志"
				},
				{
					id: "notice",
					label: "公告"
				}
			];
			function closePanel() {
				dialogV.value = false;
				dialogVisible.value = false;
			}
			function openPanel(event) {
				if (consumeDragClick(event)) {
					event.preventDefault();
					event.stopPropagation();
					return;
				}
				props.taskMode ? dialogVisible.value = true : openSettings();
			}
			function openSettings() {
				activeName.value = "base";
				dialogV.value = true;
			}
			function toggleSettings() {
				dialogV.value ? dialogV.value = false : openSettings();
			}
			return (_ctx, _cache) => {
				return (0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, null, [(0, vue.withDirectives)((0, vue.createElementVNode)("section", {
					ref_key: "panel",
					ref: panel,
					class: (0, vue.normalizeClass)(["mf-panel", { "is-dragging": (0, vue.unref)(dragging) }]),
					style: (0, vue.normalizeStyle)((0, vue.unref)(position)),
					"aria-label": "满分助手",
					onKeydown: (0, vue.withKeys)((0, vue.withModifiers)(closePanel, ["stop"]), ["esc"])
				}, [
					(0, vue.createElementVNode)("header", {
						class: "mf-header",
						onPointerdown: _cache[0] || (_cache[0] = (...args) => (0, vue.unref)(startDrag) && (0, vue.unref)(startDrag)(...args)),
						onPointermove: _cache[1] || (_cache[1] = (...args) => (0, vue.unref)(moveDrag) && (0, vue.unref)(moveDrag)(...args)),
						onPointerup: _cache[2] || (_cache[2] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
						onPointercancel: _cache[3] || (_cache[3] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
						onLostpointercapture: _cache[4] || (_cache[4] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args))
					}, [
						(0, vue.createElementVNode)("span", _hoisted_2, [(0, vue.createVNode)(_sfc_main$3, {
							name: "check",
							size: 22
						})]),
						(0, vue.createElementVNode)("div", _hoisted_3, [_hoisted_4, (0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)((0, vue.unref)(dialogV) ? "授权码与学习偏好" : "学习进度，一目了然"), 1)]),
						(0, vue.createElementVNode)("div", _hoisted_5, [__props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
							key: 0,
							type: "button",
							class: (0, vue.normalizeClass)(["mf-settings-button", { "is-active": (0, vue.unref)(dialogV) }]),
							"aria-label": (0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码",
							title: (0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码",
							onClick: toggleSettings
						}, [(0, vue.createVNode)(_sfc_main$3, {
							name: (0, vue.unref)(dialogV) ? "book" : "settings",
							size: 14
						}, null, 8, ["name"]), (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)((0, vue.unref)(dialogV) ? "返回任务" : "设置 / 授权码"), 1)], 10, _hoisted_6)) : (0, vue.createCommentVNode)("", true), (0, vue.createElementVNode)("button", {
							type: "button",
							class: "mf-icon-button",
							"aria-label": "收起面板",
							title: "收起面板",
							onClick: closePanel
						}, [(0, vue.createVNode)(_sfc_main$3, { name: "minus" })])])
					], 32),
					!(0, vue.unref)(dialogV) && __props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("nav", _hoisted_7, [((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)(tabs, (tab) => {
						return (0, vue.createElementVNode)("button", {
							key: tab.id,
							type: "button",
							class: (0, vue.normalizeClass)({ "is-active": activeTab.value === tab.id }),
							"aria-pressed": activeTab.value === tab.id,
							onClick: ($event) => activeTab.value = tab.id
						}, [(0, vue.createTextVNode)((0, vue.toDisplayString)(tab.label), 1), tab.id === "logs" && (0, vue.unref)(task).log.length ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("span", _hoisted_9, (0, vue.toDisplayString)((0, vue.unref)(task).log.length), 1)) : (0, vue.createCommentVNode)("", true)], 10, _hoisted_8);
					}), 64))])) : (0, vue.createCommentVNode)("", true),
					(0, vue.createElementVNode)("div", _hoisted_10, [(0, vue.unref)(dialogV) ? ((0, vue.openBlock)(), (0, vue.createBlock)(_sfc_main$2, { key: 0 })) : __props.taskMode ? ((0, vue.openBlock)(), (0, vue.createElementBlock)(vue.Fragment, { key: 1 }, [activeTab.value === "task" ? ((0, vue.openBlock)(), (0, vue.createBlock)(_sfc_main$1, {
						key: 0,
						onOpenSettings: openSettings
					})) : activeTab.value === "logs" ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_11, [(0, vue.createElementVNode)("div", _hoisted_12, [_hoisted_13, (0, vue.createElementVNode)("span", null, (0, vue.toDisplayString)((0, vue.unref)(task).log.length) + " 条", 1)]), !(0, vue.unref)(task).log.length ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("div", _hoisted_14, [
						(0, vue.createVNode)(_sfc_main$3, {
							name: "clock",
							size: 28
						}),
						_hoisted_15,
						_hoisted_16
					])) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("ol", _hoisted_17, [((0, vue.openBlock)(true), (0, vue.createElementBlock)(vue.Fragment, null, (0, vue.renderList)((0, vue.unref)(task).log, (entry, index) => {
						return (0, vue.openBlock)(), (0, vue.createElementBlock)("li", {
							key: index,
							class: (0, vue.normalizeClass)(entry.type)
						}, [_hoisted_18, (0, vue.createElementVNode)("div", null, [(0, vue.createElementVNode)("time", null, (0, vue.toDisplayString)(entry.time), 1), (0, vue.createElementVNode)("p", null, (0, vue.toDisplayString)(entry.msg), 1)])], 2);
					}), 128))]))])) : ((0, vue.openBlock)(), (0, vue.createElementBlock)("section", _hoisted_19, _hoisted_24))], 64)) : (0, vue.createCommentVNode)("", true)]),
					(0, vue.createElementVNode)("footer", _hoisted_25, [(0, vue.createElementVNode)("span", _hoisted_26, [_hoisted_27, (0, vue.createTextVNode)((0, vue.toDisplayString)(__props.taskMode && (0, vue.unref)(task).status ? (0, vue.unref)(task).status : "面板外可正常点击与滚动"), 1)]), _hoisted_28])
				], 46, _hoisted_1), [[vue.vShow, visible.value]]), !visible.value ? ((0, vue.openBlock)(), (0, vue.createElementBlock)("button", {
					key: 0,
					ref_key: "launcher",
					ref: launcher,
					class: (0, vue.normalizeClass)(["mf-launcher", { "is-dragging": (0, vue.unref)(dragging) }]),
					style: (0, vue.normalizeStyle)((0, vue.unref)(position)),
					type: "button",
					"aria-label": __props.taskMode ? "展开满分助手" : "设置 / 授权码",
					title: __props.taskMode ? "拖动调整位置，点击展开" : "拖动调整位置，点击打开设置",
					onPointerdown: _cache[5] || (_cache[5] = (...args) => (0, vue.unref)(startDrag) && (0, vue.unref)(startDrag)(...args)),
					onPointermove: _cache[6] || (_cache[6] = (...args) => (0, vue.unref)(moveDrag) && (0, vue.unref)(moveDrag)(...args)),
					onPointerup: _cache[7] || (_cache[7] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onPointercancel: _cache[8] || (_cache[8] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onLostpointercapture: _cache[9] || (_cache[9] = (...args) => (0, vue.unref)(endDrag) && (0, vue.unref)(endDrag)(...args)),
					onClick: openPanel
				}, [
					(0, vue.createElementVNode)("span", _hoisted_30, [(0, vue.createVNode)(_sfc_main$3, {
						name: "check",
						size: 22
					})]),
					(0, vue.createElementVNode)("span", null, [(0, vue.createTextVNode)("满分助手"), (0, vue.createElementVNode)("small", null, (0, vue.toDisplayString)(__props.taskMode ? (0, vue.unref)(task).name !== "暂未加载" ? (0, vue.unref)(task).name : "点击展开" : "设置 / 授权码"), 1)]),
					(0, vue.createVNode)(_sfc_main$3, {
						name: "arrow",
						size: 16
					})
				], 46, _hoisted_29)) : (0, vue.createCommentVNode)("", true)], 64);
			};
		}
	};
	var panel_default = ":host{all:initial;--lightningcss-light:initial;--lightningcss-dark: ;color-scheme:light;--mf-accent:#16856c;--mf-accent-dark:#106850;--mf-ink:#213c35;--mf-muted:#738279;--mf-line:#e8eeeb;color:var(--mf-ink);text-align:left;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Microsoft YaHei,sans-serif;font-size:13px;font-weight:400;line-height:1.6}*,:before,:after{box-sizing:border-box}.mf-root{pointer-events:none}button,input{font:inherit}button{color:inherit;cursor:pointer}button,input,summary{-webkit-tap-highlight-color:transparent}button{background:0 0;border:0;margin:0}button:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}input:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}summary:focus-visible{outline-offset:3px;outline:3px solid #93d6c4}h1,h2,h3,p,pre{margin:0}svg{vertical-align:middle;flex-shrink:0}.mf-panel{width:min(356px,100vw - 24px);max-height:min(760px,100vh - 24px);pointer-events:auto;isolation:isolate;background:#fff;border:1px solid #d9e4def2;border-radius:16px;flex-direction:column;max-height:min(760px,100dvh - 24px);display:flex;position:fixed;overflow:hidden;box-shadow:0 16px 48px -14px #173e3230,0 3px 12px #173e320d}.mf-header{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;background:linear-gradient(115deg,#f7fbf8,#fff 80%);flex-shrink:0;align-items:center;gap:9px;padding:15px 14px;display:flex}.is-dragging .mf-header{cursor:grabbing}.mf-brand{color:#fff;background:var(--mf-accent);border-radius:10px;flex-shrink:0;place-items:center;width:34px;height:34px;display:grid;box-shadow:0 3px 8px #16856c26}.mf-brand-text{flex:1;min-width:0}.mf-brand-text h1{letter-spacing:.3px;white-space:nowrap;align-items:center;gap:6px;font-size:15px;font-weight:700;display:flex}.mf-brand-text h1 span{color:#648375;border:1px solid #d8e7df;border-radius:4px;padding:0 5px;font-size:10px;font-weight:500}.mf-brand-text p{color:#6f8176;letter-spacing:.3px;text-overflow:ellipsis;white-space:nowrap;margin-top:2px;font-size:11px;overflow:hidden}.mf-window-actions{flex-shrink:0;align-items:center;gap:4px;display:flex}.mf-settings-button{min-height:30px;color:var(--mf-accent-dark);white-space:nowrap;background:#eaf6ef;border:1px solid #cce5d9;border-radius:8px;justify-content:center;align-items:center;gap:4px;padding:5px 7px;font-size:11px;font-weight:600;line-height:18px;transition:background .15s,border-color .15s;display:inline-flex}.mf-settings-button:hover,.mf-settings-button.is-active{background:#dcefe4;border-color:#add7c3}.mf-settings-button>svg{width:15px;height:15px}.mf-icon-button{color:#6e8277;border-radius:8px;place-items:center;width:28px;height:30px;transition:background .15s,color .15s;display:grid}.mf-icon-button:hover,.mf-icon-button.is-active{color:var(--mf-accent);background:#eaf5ef}.mf-tabs{border-bottom:1px solid var(--mf-line);flex-shrink:0;gap:22px;padding:0 16px;display:flex}.mf-tabs>button{color:#728078;white-space:nowrap;border-bottom:2px solid #0000;align-items:center;gap:5px;padding:9px 0 10px;font-size:12px;display:flex}.mf-tabs>button.is-active{border-bottom-color:var(--mf-accent);color:var(--mf-accent);font-weight:600}.mf-tab-count{font-variant-numeric:tabular-nums;background:#eff3f0;border-radius:5px;padding:0 5px;font-size:10px;line-height:16px}.mf-body{overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#cbdcd2 transparent;min-height:0;overflow-y:auto}.mf-task,.mf-logs,.mf-notice,.mf-settings{padding:16px}.mf-task-summary{align-items:center;gap:9px;display:flex}.mf-task-icon{color:var(--mf-accent);background:#eff6f1;border:1px solid #e6efe9;border-radius:10px;flex-shrink:0;place-items:center;width:40px;height:40px;display:grid}.mf-eyebrow{color:#72847a;letter-spacing:.8px;font-size:10px}.mf-task-summary h2{margin-top:1px;font-size:15px;font-weight:600}.mf-badge{color:var(--mf-accent);white-space:nowrap;background:#eef7f1;border-radius:20px;align-items:center;gap:5px;margin-left:auto;padding:3px 8px;font-size:10px;display:inline-flex}.mf-badge i,.mf-footer-status i{background:#48a681;border-radius:50%;flex-shrink:0;width:5px;height:5px}.mf-badge.is-waiting{color:#927e4c;background:#f8f4e9}.mf-badge.is-waiting i{background:#b49c5f}.mf-progress-row{color:#728078;justify-content:space-between;margin-top:16px;font-size:10px;display:flex}.mf-progress-row span:last-child{color:#5f8c78}.mf-progress{background:#edf3ee;border-radius:5px;height:5px;margin-top:6px;overflow:hidden}.mf-progress>span{border-radius:inherit;background:#399b7a;height:100%;transition:width .25s;display:block}.mf-question{border:1px solid #e3ebe5;border-radius:10px;margin-top:15px;padding:12px}.mf-question-heading{justify-content:space-between;align-items:center;gap:12px;display:flex}.mf-answer-status{color:#728078;font-size:10px}.mf-answer-status.primary{color:var(--mf-accent)}.mf-answer-status.danger{color:#c26b57}.mf-question h3{overflow-wrap:anywhere;margin-top:8px;font-size:13px;font-weight:500;line-height:1.75}.mf-answer{background:#f4f8f4;border-radius:7px;margin-top:11px;padding:9px 10px}.mf-answer pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#39715b;margin-top:4px;font-family:inherit;font-size:12px}.mf-loading{color:#708274;align-items:center;gap:7px;margin-top:6px;font-size:11px;display:flex}.mf-loading>span{background:#91b69f;border-radius:50%;width:6px;height:6px}.mf-question-section,.mf-sources{margin-top:17px}.mf-section-heading{justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px;display:flex}.mf-section-heading h2,.mf-section-heading h3{font-size:12px;font-weight:600}.mf-section-heading>span{color:#748477;font-size:10px}.mf-auth-link{color:var(--mf-accent-dark);white-space:nowrap;background:#eef7f2;border-radius:5px;align-items:center;gap:4px;padding:3px 6px;font-size:11px;font-weight:500;line-height:18px;transition:background .15s;display:inline-flex}.mf-auth-link:hover{background:#dcefe4}.mf-question-grid{scrollbar-width:thin;grid-template-columns:repeat(8,minmax(0,1fr));gap:6px;max-height:120px;padding:2px;display:grid;overflow-y:auto}.mf-question-grid>button{color:#75867b;background:#f4f6f4;border:1px solid #e9ede8;border-radius:6px;height:28px;font-size:11px}.mf-question-grid>button.primary{color:#41816a;background:#edf6ef;border-color:#d9eadf}.mf-question-grid>button.danger{color:#bf8057;background:#fcf1ea;border-color:#f0e0d0}.mf-question-grid>button.is-current{background:var(--mf-accent);border-color:var(--mf-accent);color:#fff}.mf-question-grid>button:hover{box-shadow:0 0 0 2px #16856c24}.mf-sources details{border:1px solid var(--mf-line);border-radius:8px;margin-top:6px;padding:0 10px;overflow:hidden}.mf-sources summary{cursor:pointer;align-items:center;gap:5px;padding:8px 0;font-size:11px;list-style:none;display:flex}.mf-sources summary::-webkit-details-marker{display:none}.mf-sources summary>span{color:#768479;margin-left:auto;font-size:10px}.mf-sources details[open] summary>svg{transform:rotate(90deg)}.mf-source-answer{border-top:1px solid var(--mf-line);color:#68796d;overflow-wrap:anywhere;white-space:pre-wrap;padding:10px 0;font-size:11px;line-height:1.8}.mf-source-answer img{max-width:100%;height:auto}.mf-source-answer a{color:var(--mf-accent)}.mf-source-usage{color:#708175;gap:12px;padding-bottom:8px;font-size:10px;display:flex}.mf-help{color:#738376;margin-top:9px;font-size:10px;line-height:1.7}.mf-empty{text-align:center;color:#819487;padding:28px 12px 24px}.mf-empty-icon{color:#9bb4a3;background:#f7faf6;border:1px dashed #d4e4d8;border-radius:20px;place-items:center;width:60px;height:60px;margin:0 auto 14px;display:grid}.mf-empty h3{color:#587564;margin:12px 0 8px;font-size:13px;font-weight:500}.mf-empty p{color:#768777;max-width:235px;margin:auto;font-size:11px;line-height:1.9}.mf-panel-footer{border-top:1px solid var(--mf-line);background:#fbfcfa;flex-shrink:0;align-items:center;gap:15px;padding:9px 14px;display:flex}.mf-footer-status{color:#738578;overflow-wrap:anywhere;align-items:center;gap:6px;font-size:10px;display:flex}.mf-footer-status i{background:#99b4a0}.mf-version{color:#839287;white-space:nowrap;margin-left:auto;font-size:10px}.mf-logs ol{margin:0;padding:0;list-style:none}.mf-logs li{gap:9px;padding:0 0 16px;display:flex;position:relative}.mf-logs li:not(:last-child):before{content:\"\";background:#e8ede6;width:1px;position:absolute;top:13px;bottom:0;left:3px}.mf-log-dot{background:#b6c4b5;border-radius:50%;flex-shrink:0;width:7px;height:7px;margin-top:7px}.mf-logs .success .mf-log-dot{background:#61a17d}.mf-logs .error .mf-log-dot,.mf-logs .danger .mf-log-dot{background:#d59c84}.mf-logs time{color:#7b8b7b;font-variant-numeric:tabular-nums;font-size:10px}.mf-logs li p{color:#617363;overflow-wrap:anywhere;margin-top:3px;font-size:12px}.mf-notice h2{margin:10px 0 18px;font-size:15px;line-height:1.8}.mf-notice p{color:#71826d;margin:10px 0;font-size:12px;line-height:2}.mf-section-intro h2{font-size:15px;font-weight:600}.mf-section-intro p{color:#72826d;margin-top:4px;font-size:11px}.mf-segments{background:#f2f5ef;border-radius:9px;gap:4px;margin-top:16px;padding:4px;display:flex}.mf-segments button{color:#6f8168;border-radius:6px;flex:1;padding:6px 3px;font-size:11px}.mf-segments button.is-active{color:var(--mf-accent);background:#fff;box-shadow:0 1px 4px #233e2210}.mf-fields{padding-top:5px}.mf-field{padding-top:12px}.mf-fields-base{grid-template-columns:repeat(2,minmax(0,1fr));column-gap:12px;display:grid}.mf-fields-base .mf-field{min-width:0}.mf-fields-base .mf-field-token{grid-column:1/-1}.mf-field-token+.mf-field-token{margin-top:1px}.mf-field-label label{font-size:12px;font-weight:500;display:block}.mf-field-label p{color:#77866f;margin-top:3px;font-size:10px;line-height:1.6}.mf-input{color:#3b5136;background:#fff;border:1px solid #dfe7da;border-radius:7px;width:100%;min-width:0;height:34px;margin-top:7px;padding:6px 9px;font-size:12px;transition:border-color .15s}.mf-input::placeholder{color:#899680}.mf-input:focus{border-color:var(--mf-accent);outline:none;box-shadow:0 0 0 3px #16856c14}.mf-input[aria-invalid=true]{border-color:#c97660}.mf-field-switch{border-bottom:1px solid #eff2eb;justify-content:space-between;align-items:center;gap:16px;padding:13px 0;display:flex}.mf-switch{-webkit-appearance:none;appearance:none;cursor:pointer;background:#d9e1d5;border-radius:20px;flex-shrink:0;width:34px;height:20px;margin:0;transition:background .15s;position:relative}.mf-switch:after{content:\"\";background:#fff;border-radius:50%;width:14px;height:14px;transition:transform .15s;position:absolute;top:3px;left:3px;box-shadow:0 1px 3px #0002}.mf-switch:checked{background:var(--mf-accent)}.mf-switch:checked:after{transform:translate(14px)}.mf-error{color:#ba604d;margin-top:5px;font-size:11px}.mf-autosave{border-top:1px solid var(--mf-line);color:#6f8067;align-items:center;gap:7px;margin-top:18px;padding-top:14px;font-size:11px;display:flex}.mf-autosave.is-saved{color:var(--mf-accent)}.mf-autosave.is-error{color:#ba604d}.mf-launcher{cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;pointer-events:auto;text-align:left;background:#fff;border:1px solid #dce9df;border-radius:12px;align-items:center;gap:8px;width:max-content;max-width:calc(100vw - 24px);padding:9px 11px 9px 9px;font-size:12px;display:flex;position:fixed;box-shadow:0 5px 24px #153b2720}.mf-launcher.is-dragging{cursor:grabbing}.mf-launcher:hover{border-color:#b5d7c5;box-shadow:0 5px 26px #153b2730}.mf-launcher-icon{background:var(--mf-accent);color:#fff;border-radius:9px;place-items:center;width:32px;height:32px;display:grid}.mf-launcher small{color:#75876f;text-overflow:ellipsis;white-space:nowrap;margin-top:1px;font-size:10px;display:block;overflow:hidden}.mf-launcher>span:not(.mf-launcher-icon){min-width:0}.mf-launcher>svg{color:#81957a}@media (max-width:420px){.mf-task,.mf-settings,.mf-logs,.mf-notice{padding:14px}.mf-header{padding:14px 12px}.mf-tabs{gap:20px;padding:0 14px}.mf-question-grid{gap:5px}}@media (max-width:360px){.mf-header{gap:7px}.mf-brand-text h1 span{display:none}.mf-settings-button{padding-inline-start:6px;padding-inline-end:6px}}@media (prefers-reduced-motion:reduce){*,:before,:after{transition:none!important}}";
	/* ============================================================
	 *  4. 面板挂载（单实例）
	 *     原脚本用 postMessage 在多个 iframe 之间选举“谁来显示面板”，
	 *     那是为超星的多层 iframe 结构准备的。海旗是单页应用，
	 *     这里改为单实例挂载：页面变化时按需切换 task / settings 两种模式。
	 * ============================================================ */
	var SETTINGS_HOST = "manfen-settings-root";
	var TASK_HOST = "manfen-task-root";
	var piniaInstance = pinia.createPinia();
	var ui = {
		mode: null,
		host: null,
		app: null,
		form: null,
		ask: null
	};
	function unmountUi() {
		if (ui.app) {
			try {
				ui.app.unmount();
			} catch (e) {}
		}
		if (ui.host) {
			try {
				ui.host.remove();
			} catch (e) {}
		}
		ui.app = null;
		ui.host = null;
		ui.mode = null;
	}
	function mountUi(taskMode) {
		unmountUi();
		var host = document.createElement("div");
		host.id = taskMode ? TASK_HOST : SETTINGS_HOST;
		host.style.cssText = "position:fixed!important;left:0!important;top:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;z-index:2147483000!important;";
		var shadow = host.attachShadow({ mode: "open" });
		var style = document.createElement("style");
		style.textContent = panel_default;
		var root = document.createElement("div");
		root.className = "mf-root";
		shadow.append(style, root);
		document.body.append(host);
		var app = vue.createApp(_sfc_main, { taskMode }).use(piniaInstance);
		app.mount(root);
		ui.mode = taskMode ? "task" : "settings";
		ui.host = host;
		ui.app = app;
		ui.form = useformStore(piniaInstance);
		ui.ask = useAskStore(piniaInstance);
		return ui;
	}
	function ensureUi(mode) {
		var want = mode === "task" ? "task" : "settings";
		if (ui.mode === want && ui.host && ui.host.isConnected) return ui;
		return mountUi(want === "task");
	}
	function allowCopy() {
		(() => {
			document.body.oncopy = null, document.body.oncut = null, document.body.onpaste = null, document.body.onselectstart = null, document.body.ondragstart = null;
			const style = document.createElement("style");
			style.innerHTML = "\n       * {\n           -webkit-user-select: auto !important;\n           -moz-user-select: auto !important;\n           -o-user-select: auto !important;\n           user-select: auto !important;\n       }\n   ", document.head.appendChild(style);
		})();
	}
	var __defProp = Object.defineProperty;
	var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, {
		enumerable: true,
		configurable: true,
		writable: true,
		value
	}) : obj[key] = value;
	var __publicField = (obj, key, value) => {
		__defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
		return value;
	};
	var questionType = {
		"单选题": "0",
		"多选题": "1",
		"填空题": "2",
		"判断题": "3",
		"简答题": "4",
		"名词解释": "5",
		"论述题": "6",
		"计算题": "7"
	};
	var removeHtml = (html) => null == html ? "" : html.replace(/<((?!img|sub|sup|br)[^>]+)>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").replace(/<br\s*\/?>/g, "\n").replace(/<img.*?src="(.*?)".*?>/g, "<img src=\"$1\"/>").trim();
	var cl = (str) => str.replace(/^【.*?】\s*/, "").replace(/\s*（\d+\.\d+分）$/, "");
	/* ============================================================
	 *  5. 题库接口层（跨域请求）
	 *     原脚本混用 http:// 接口、jQuery、UE 编辑器、超星 cookie，
	 *     这里改成：全部 https + 统一 GM_xmlhttpRequest + 容错解析。
	 * ============================================================ */
	var BANK = {
		tikuhai: "https://api.tikuhai.com/search",
		yizhi: "http://cx.icodef.com/wyn-nb?v=4",
		yanxi: "https://tk.enncy.cn/query",
		muketool: "https://api.muketool.com/cx/v2/query"
	};
	var ServerApi = class {
		constructor() {
			__publicField(this, "timeout", 12e3);
		}
		request(url, method, data, headers) {
			var payload = method === "POST" ? JSON.stringify(data == null ? {} : data) : void 0;
			return new Promise((resolve, reject) => {
				_GM_xmlhttpRequest({
					method,
					url,
					data: payload,
					headers: headers || {},
					timeout: this.timeout,
					onload: (res) => {
						resolve(res);
					},
					ontimeout: () => {
						reject(new Error("请求超时"));
					},
					onerror: (err) => {
						reject(err instanceof Error ? err : new Error("网络错误"));
					}
				});
			});
		}
		static json(res) {
			try {
				return JSON.parse(res.responseText);
			} catch (e) {
				return null;
			}
		}
		// 题库海
		async tikuhai(question) {
			try {
				var res = await this.request(BANK.tikuhai, "POST", {
					key: getConfig().thtoken || "",
					question: question.question,
					options: question.options,
					type: question.type
				}, {
					"Content-Type": "application/json",
					v: SCRIPT_VERSION
				});
				var data = ServerApi.json(res);
				if (!data || typeof data !== "object") return { form: "题库海", answer: "" };
				var body = data.data && typeof data.data === "object" ? data.data : {};
				if (data.code === -1) return { form: "题库海", answer: data.msg || "" };
				return {
					form: "题库海",
					answer: body.answer || data.msg || "",
					num: body.num || "",
					usenum: body.usenum || ""
				};
			} catch (e) {
				return { form: "题库海", answer: "" };
			}
		}
		// 一之题库（该接口目前多数已下线，无 token 时直接跳过，避免无谓请求）
		async yizhi(question) {
			var token = getConfig().yztoken;
			if (!token) return { form: "一之题库", answer: "" };
			try {
				var res = await this.request(BANK.yizhi, "POST", { question: question.question }, {
					"Content-Type": "application/json",
					Authorization: token
				});
				var data = ServerApi.json(res);
				if (!data || data.code !== 1 || typeof data.data !== "string") return { form: "一之题库", answer: "" };
				var text = data.data.replace(/javascript:void\(0\);/g, "").trim().replace(/\n/g, "");
				var blocked = ["叛逆", "公众号", "李恒雅", "一之"].some((word) => text.indexOf(word) !== -1);
				return { form: "一之题库", answer: blocked ? "" : text.split("#") };
			} catch (e) {
				return { form: "一之题库", answer: "" };
			}
		}
		// 言溪题库
		async yanxi(question) {
			var token = getConfig().ennyctoken;
			if (!token) return { form: "言溪题库", answer: "" };
			try {
				var res = await this.request(BANK.yanxi, "POST", {
					token,
					title: question.question
				}, { "Content-Type": "application/json" });
				var data = ServerApi.json(res);
				if (!data || data.code !== 1) return { form: "言溪题库", answer: "" };
				return { form: "言溪题库", answer: data.data && data.data.answer || "" };
			} catch (e) {
				return { form: "言溪题库", answer: "" };
			}
		}
		// 木可题库
		async muketool(question) {
			try {
				var res = await this.request(BANK.muketool, "POST", {
					question: question.question,
					type: parseInt(question.type, 10) || 0
				}, { "Content-Type": "application/json" });
				var data = ServerApi.json(res);
				if (!data || data.code !== 1 || typeof data.data !== "string") return { form: "木可题库", answer: "" };
				return { form: "木可题库", answer: data.data.split("#") };
			} catch (e) {
				return { form: "木可题库", answer: "" };
			}
		}
	};
	var server = new ServerApi();
	async function getAnswers(question) {
		var results = await Promise.allSettled([
			server.tikuhai(question),
			server.yizhi(question),
			server.yanxi(question),
			server.muketool(question)
		]);
		return results.filter((item) => item.status === "fulfilled").map((item) => item.value).filter((item) => {
			if (!item || !item.answer) return false;
			return Array.isArray(item.answer) ? item.answer.length > 0 : String(item.answer).trim().length > 0;
		});
	}
	/* ============================================================
	 *  6. 站点适配层：所有 DOM 选择器集中在这里
	 *     海旗是 Vue + Element UI 的 SPA，同一站内不同页面结构差异较大，
	 *     因此选择器写成“候选列表 + 可见性过滤 + 结构启发式兜底”，
	 *     某个选择器失效时还有后续兜底，不会整段功能瘫痪。
	 * ============================================================ */
	var SITE = {
		video: [
			"video.vjs-tech",
			".vjs-tech",
			"video",
			".prism-player video",
			".dplayer-video-wrap video",
			"#player-con video"
		],
		// 章节列表：只用“课程目录”语义的选择器，
		// 不要用 .el-menu-item 这类通用类名，否则可能误点顶部导航直接跳走
		chapter: [
			".video-item",
			".chapter-item",
			"[class*='chapter'] li",
			"[class*='catalog'] li",
			"[class*='directory'] li"
		],
		chapterActive: ["active", "is-active", "current", "selected", "on"],
		nextButton: ["button", ".el-button", "a.btn", "[class*='next']"],
		dialog: [
			".el-dialog__wrapper",
			".el-message-box__wrapper",
			".el-overlay",
			".modal",
			".layui-layer"
		],
		question: [
			"[class*='subject-item']",
			"[class*='question-item']",
			"[class*='questionLi']",
			"[class*='timu']",
			"[class*='exam-question']",
			"[class*='topic-item']",
			"[class*='q-item']"
		],
		stem: [
			"[class*='question-title']",
			"[class*='subject-title']",
			"[class*='timu-title']",
			"[class*='stem']",
			"[class*='q-title']",
			".title"
		],
		option: [
			".option-item",
			".answer-item",
			".el-radio",
			".el-checkbox",
			"li"
		],
		textbox: [
			"textarea",
			".el-textarea__inner",
			"input[type='text']",
			"[contenteditable='true']"
		],
		submitText: /提交|交卷|保存并提交/,
		nextText: /下一题|下一步|下一页|继续|下一节|下一章/
	};

	/* ---------------- 6.1 基础 DOM 工具 ---------------- */
	function isVisible(el) {
		if (!el || !el.isConnected) return false;
		if (el.offsetParent !== null) return true;
		try {
			var view = el.ownerDocument.defaultView || pageWindow;
			var style = view.getComputedStyle(el);
			if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
			var rect = el.getBoundingClientRect();
			if (rect.width > 0 && rect.height > 0) return true;
			return style.position === "fixed";
		} catch (e) {
			return false;
		}
	}
	function textOf(el) {
		return el && (el.innerText || el.textContent) || "";
	}
	function firstMatch(root, selectors, filter) {
		for (var i = 0; i < selectors.length; i++) {
			var list = root.querySelectorAll(selectors[i]);
			for (var j = 0; j < list.length; j++) {
				if (!filter || filter(list[j])) return list[j];
			}
		}
		return null;
	}
	function commonAncestor(nodes) {
		if (!nodes.length) return null;
		var node = nodes[0];
		while (node && node !== document.body) {
			if (nodes.every((n) => node.contains(n))) return node;
			node = node.parentElement;
		}
		return null;
	}
	function innermost(list) {
		return list.filter((el, index) => !list.some((other, otherIndex) => otherIndex !== index && el.contains(other)));
	}
	var nodeIdCache = new WeakMap();
	var nodeIdSeq = 0;
	function nodeKey(node) {
		if (!nodeIdCache.has(node)) nodeIdCache.set(node, ++nodeIdSeq);
		return nodeIdCache.get(node);
	}
	function clickEl(el) {
		if (!el) return;
		[
			"pointerdown",
			"mousedown",
			"pointerup",
			"mouseup",
			"click"
		].forEach((type) => {
			var event;
			try {
				event = new pageWindow.MouseEvent(type, {
					bubbles: true,
					cancelable: true,
					view: pageWindow
				});
			} catch (e) {
				event = new pageWindow.Event(type, {
					bubbles: true,
					cancelable: true
				});
			}
			el.dispatchEvent(event);
		});
	}
	function dispatch(el, type) {
		try {
			el.dispatchEvent(new pageWindow.Event(type, { bubbles: true }));
		} catch (e) {}
	}
	function setNativeValue(el, value) {
		var proto = el.tagName === "TEXTAREA" ? pageWindow.HTMLTextAreaElement.prototype : pageWindow.HTMLInputElement.prototype;
		var desc = Object.getOwnPropertyDescriptor(proto, "value");
		if (desc && desc.set) desc.set.call(el, value);
		else el.value = value;
		dispatch(el, "input");
		dispatch(el, "change");
	}
	function setNativeChecked(input, checked) {
		var desc = Object.getOwnPropertyDescriptor(pageWindow.HTMLInputElement.prototype, "checked");
		if (desc && desc.set) desc.set.call(input, checked);
		else input.checked = checked;
	}
	function findButtonByText(pattern, selectors) {
		var list = document.querySelectorAll(selectors.join(","));
		for (var i = 0; i < list.length; i++) {
			var el = list[i];
			if (el.disabled || !isVisible(el)) continue;
			if (pattern.test(textOf(el).trim())) return el;
		}
		return null;
	}

	/* ---------------- 6.2 视频 / 章节 ---------------- */
	var rateDesc = Object.getOwnPropertyDescriptor(pageWindow.HTMLMediaElement.prototype, "playbackRate");
	var ctDesc = Object.getOwnPropertyDescriptor(pageWindow.HTMLMediaElement.prototype, "currentTime");
	var antiRewind = {
		on: false,
		patched: false,
		blocked: 0
	};
	var toastObserver = null;
	var NOISE_RE = /不允许快进|播放速度不能超过|请勿快进/;
	function findVideo() {
		return firstMatch(document, SITE.video, (el) => el.tagName === "VIDEO" && isVisible(el));
	}
	function lockRate(video, rate) {
		if (!rateDesc || !rateDesc.set || !Number.isFinite(rate)) return;
		if (!video.__mfLocked) {
			try {
				Object.defineProperty(video, "playbackRate", {
					configurable: true,
					get() {
						return rateDesc.get.call(video);
					},
					set(value) {
						try {
							rateDesc.set.call(video, video.__mfRate || value);
						} catch (e) {
							rateDesc.set.call(video, value);
						}
					}
				});
				video.__mfLocked = true;
			} catch (e) {
				log("倍速锁定失败：" + e.message, "error");
				return;
			}
		}
		video.__mfRate = rate;
		try {
			rateDesc.set.call(video, rate);
		} catch (e) {}
	}
	// 关闭“强制倍速”时要把实例上的访问器删掉，否则平台/播放器自己改倍速会被劫持
	function unlockRate(video) {
		if (!video || !video.__mfLocked) return;
		try {
			delete video.playbackRate;
		} catch (e) {}
		video.__mfLocked = false;
		video.__mfRate = void 0;
	}
	function installAntiRewind() {
		if (antiRewind.patched || !ctDesc || !ctDesc.set) return;
		try {
			Object.defineProperty(pageWindow.HTMLMediaElement.prototype, "currentTime", {
				configurable: true,
				get() {
					return ctDesc.get.call(this);
				},
				set(value) {
					if (antiRewind.on && Number(value) < ctDesc.get.call(this) - .05) {
						antiRewind.blocked++;
						return;
					}
					ctDesc.set.call(this, value);
				}
			});
			antiRewind.patched = true;
			log("防回拽已就位", "success");
		} catch (e) {
			log("防回拽安装失败：" + e.message, "error");
		}
	}
	function dropNoiseToast(node) {
		if (!node || node.nodeType !== 1) return;
		var list = node.matches && node.matches(".el-message,.el-message-box") ? [node] : Array.prototype.slice.call(node.querySelectorAll(".el-message,.el-message-box"));
		list.forEach((el) => {
			if (NOISE_RE.test(textOf(el))) el.remove();
		});
	}
	function installToastMute() {
		if (toastObserver) return;
		document.querySelectorAll(".el-message,.el-message-box").forEach(dropNoiseToast);
		toastObserver = new MutationObserver((mutations) => {
			mutations.forEach((mutation) => {
				mutation.addedNodes.forEach((node) => {
					dropNoiseToast(node);
					setTimeout(() => {
						dropNoiseToast(node);
					}, 80);
				});
			});
		});
		toastObserver.observe(document.body, {
			childList: true,
			subtree: true
		});
	}
	function closeDialogs() {
		var REG = /^(确定|确认|继续|继续学习|知道了|好的|关闭|我知道了)$/;
		SITE.dialog.forEach((selector) => {
			document.querySelectorAll(selector).forEach((wrapper) => {
				if (!isVisible(wrapper)) return;
				var buttons = wrapper.querySelectorAll("button,.el-button,.btn-primary,[class*='btn']");
				for (var i = 0; i < buttons.length; i++) {
					if (REG.test(textOf(buttons[i]).trim())) {
						clickEl(buttons[i]);
						return;
					}
				}
			});
		});
	}
	function chapterItems() {
		for (var i = 0; i < SITE.chapter.length; i++) {
			var list = Array.prototype.slice.call(document.querySelectorAll(SITE.chapter[i])).filter(isVisible);
			if (list.length > 1) return list;
		}
		return [];
	}
	function isActiveItem(el) {
		if (SITE.chapterActive.some((name) => el.classList.contains(name))) return true;
		if (el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-current") === "true") return true;
		return SITE.chapterActive.some((name) => !!el.querySelector("." + name));
	}
	var runtime = {
		busy: false,
		url: "",
		quizSignature: "",
		lastAdvance: 0,
		timer: null
	};
	function advanceChapter(reason) {
		if (Date.now() - runtime.lastAdvance < 8e3) return false;
		var ask = ui.ask;
		var items = chapterItems();
		if (items.length) {
			var index = items.findIndex(isActiveItem);
			if (index === items.length - 1) {
				runtime.lastAdvance = Date.now();
				ask.msg("已是最后一节（" + reason + "）");
				ask.log("全部章节已处理完成", "success");
				return false;
			}
			var next = items[index + 1] || items[0];
			runtime.lastAdvance = Date.now();
			clickEl(next);
			ask.log("切换到下一节：" + textOf(next).trim().slice(0, 20), "success");
			return true;
		}
		var button = findButtonByText(SITE.nextText, SITE.nextButton);
		if (button) {
			runtime.lastAdvance = Date.now();
			clickEl(button);
			ask.log("点击下一节按钮（" + reason + "）", "success");
			return true;
		}
		ask.msg("未找到可切换的下一节");
		return false;
	}
	async function videoStep() {
		var ask = ui.ask;
		var config = getConfig();
		closeDialogs();
		var video = findVideo();
		if (!video) {
			ask.msg("未检测到视频，尝试切换章节");
			if (config.autoJump) advanceChapter("无视频");
			return;
		}
		ask.task.name = "视频";
		ask.task.video.status = 1;
		var rate = Number(config.playbackRate) || 1;
		if (config.antiRewind && rate > 1.05) {
			installAntiRewind();
			antiRewind.on = true;
			installToastMute();
		} else {
			antiRewind.on = false;
		}
		if (config.muted && !video.muted) video.muted = true;
		if (config.forceRate) {
			if (video.playbackRate !== rate) lockRate(video, rate);
		} else {
			unlockRate(video);
			if (video.playbackRate !== rate) {
				try {
					video.playbackRate = rate;
				} catch (e) {}
			}
		}
		if (video.paused && !video.ended) {
			try {
				await video.play();
			} catch (e) {
				ask.msg("浏览器拦截了自动播放，请先点击页面任意位置");
			}
		}
		ask.msg("刷课中 " + video.playbackRate.toFixed(2) + "x" + (antiRewind.on ? " · 已拦截回拽 " + antiRewind.blocked : ""));
		var finished = video.ended || video.duration > 0 && video.currentTime >= video.duration - .5;
		if (finished) {
			ask.log("视频播放完毕", "success");
			if (config.autoJump) advanceChapter("播放结束");
		}
	}

	/* ---------------- 6.3 题目解析 ---------------- */
	var TYPE_MAP = {
		"单选题": "0",
		"多选题": "1",
		"填空题": "2",
		"判断题": "3",
		"简答题": "4",
		"名词解释": "5",
		"论述题": "6",
		"计算题": "7"
	};
	var JUDGE = {
		"正确": "正确",
		"对的": "正确",
		"对": "正确",
		"是": "正确",
		"true": "正确",
		"t": "正确",
		"y": "正确",
		"√": "正确",
		"错误": "错误",
		"错的": "错误",
		"错": "错误",
		"否": "错误",
		"false": "错误",
		"f": "错误",
		"n": "错误",
		"×": "错误",
		"x": "错误"
	};
	function normalizeForMatch(text) {
		return String(text == null ? "" : text).replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").replace(/\s+/g, "").replace(/[，。；：、！？,.;:!?"'“”‘’（）()【】\[\]{}<>《》…—\-_·|\\\/~`@#$%^&*=+]/g, "").toLowerCase();
	}
	function stripOptionPrefix(text) {
		return String(text || "").replace(/^[\s]*[（(]?[A-Ha-h][)）.、．:：][\s]*/, "").replace(/\s+/g, " ").trim();
	}
	function cleanStem(text) {
		return String(text || "").replace(/【[^】]{0,12}题】/g, " ").replace(/^\s*\d+[.、．]\s*/, "").replace(/[（(]\s*\d+(?:\.\d+)?\s*分\s*[)）]\s*$/g, "").replace(/\s+/g, " ").trim();
	}
	function findBlocks() {
		// 1) 显式选择器
		for (var i = 0; i < SITE.question.length; i++) {
			var list = Array.prototype.slice.call(document.querySelectorAll(SITE.question[i])).filter(isVisible);
			if (!list.length) continue;
			var blocks = innermost(list).filter((el) => {
				var controls = el.querySelectorAll("input[type='radio'],input[type='checkbox']").length;
				return controls >= 2 || !!el.querySelector(SITE.textbox.join(","));
			});
			if (blocks.length) return blocks;
		}
		// 2) 兜底：把同一组单/多选的 input 归为一道题
		//    优先用 Element 的 .el-radio-group 容器，其次用原生 name，最后用题目容器 class
		var controls2 = Array.prototype.slice.call(document.querySelectorAll("input[type='radio'],input[type='checkbox']")).filter(isVisible);
		if (!controls2.length) return [];
		var groups = new Map();
		controls2.forEach((input) => {
			var group = input.closest(".el-radio-group,.el-checkbox-group,[role='radiogroup']");
			var container = input.closest("[class*='question'],[class*='subject'],[class*='timu'],[class*='topic']");
			var key = group ? "g:" + nodeKey(group) : input.name ? "n:" + input.name : container ? "c:" + nodeKey(container) : "";
			if (!key) return;
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(input);
		});
		var result = [];
		groups.forEach((inputs) => {
			if (inputs.length < 2) return;
			var block = commonAncestor(inputs);
			if (!block) return;
			// 向上扩，把题干一起纳入（父节点若没有引入新的一组 input 就继续上移）
			for (var step = 0; step < 4; step++) {
				var parent = block.parentElement;
				if (!parent || parent === document.body) break;
				if (parent.querySelectorAll("input[type='radio'],input[type='checkbox']").length !== inputs.length) break;
				block = parent;
			}
			if (!result.some((item) => item === block || item.contains(block) || block.contains(item))) result.push(block);
		});
		return result;
	}
	function parseOptions(block) {
		var inputs = Array.prototype.slice.call(block.querySelectorAll("input[type='radio'],input[type='checkbox']")).filter(isVisible);
		if (inputs.length >= 2) {
			return inputs.map((input) => {
				var holder = input.closest("label,.el-radio,.el-checkbox,.option-item,.answer-item,li") || input.parentElement || input;
				return {
					text: stripOptionPrefix(textOf(holder)),
					el: holder,
					input
				};
			}).filter((option) => option.el);
		}
		var nodes = [];
		SITE.option.forEach((selector) => {
			block.querySelectorAll(selector).forEach((node) => {
				if (!isVisible(node)) return;
				var text = stripOptionPrefix(textOf(node));
				if (!text || text.length > 400) return;
				nodes.push({
					text,
					el: node,
					input: null
				});
			});
		});
		if (!nodes.length) return [];
		return innermost(nodes.map((n) => n.el)).map((el) => ({
			text: stripOptionPrefix(textOf(el)),
			el,
			input: null
		}));
	}
	function extractStem(block, optionTexts) {
		var lines = String(textOf(block) || "").split("\n").map((line) => line.trim()).filter(Boolean);
		var cut = lines.length;
		for (var i = 0; i < lines.length; i++) {
			if (/^[（(]?[A-Ha-h][)）.、．]/.test(lines[i]) || optionTexts.indexOf(stripOptionPrefix(lines[i])) !== -1) {
				cut = i;
				break;
			}
		}
		return lines.slice(0, cut).join(" ");
	}
	function detectType(block, stem) {
		var text = stem + " " + String(textOf(block)).slice(0, 200);
		for (var name in TYPE_MAP) {
			if (text.indexOf(name) !== -1) return TYPE_MAP[name];
		}
		var checkboxes = block.querySelectorAll("input[type='checkbox'],.el-checkbox").length;
		var radios = block.querySelectorAll("input[type='radio'],.el-radio").length;
		if (checkboxes >= 2) return "1";
		if (radios >= 1) return "0";
		return "4";
	}
	function parseQuestion(block, index) {
		var optionNodes = parseOptions(block);
		var optionTexts = optionNodes.map((option) => option.text);
		var stemEl = firstMatch(block, SITE.stem, isVisible) || firstMatch(block, SITE.stem);
		var stem = cleanStem(stemEl ? textOf(stemEl) : extractStem(block, optionTexts));
		return {
			question: stem || "第 " + (index + 1) + " 题",
			options: optionTexts,
			// markRaw：DOM 节点不要被 Vue 的 reactive 包成 Proxy，否则 click/checked 会出怪问题
			optionNodes: vue.markRaw(optionNodes),
			type: detectType(block, stem),
			dom: vue.markRaw(block)
		};
	}
	function pickOptionIndexes(answer, question) {
		var options = question.optionNodes || [];
		var judge = question.type === "3";
		var picked = [];
		var list = Array.isArray(answer) ? answer : [answer];
		list.forEach((raw) => {
			var text = String(raw == null ? "" : raw).replace(/^(正确答案|参考答案|答案)\s*[:：]?\s*/g, "").trim();
			if (!text) return;
			// a) 纯字母（A / AB / A,B / A、B）
			var letters = text.toUpperCase().replace(/[^A-H]/g, "");
			var bare = text.replace(/[\s,，、;；\/|#＆&]/g, "");
			if (letters && letters.length === bare.length && letters.length <= options.length) {
				letters.split("").forEach((letter) => {
					var index = letter.charCodeAt(0) - 65;
					if (index >= 0 && index < options.length && picked.indexOf(index) === -1) picked.push(index);
				});
				return;
			}
			// b) “A. 选项内容” 这种带前缀的答案
			var lead = text.match(/^([A-H](?:[\s,，、;；]*[A-H])*)[\s.、．)）:：]/i);
			if (lead) {
				lead[1].toUpperCase().replace(/[^A-H]/g, "").split("").forEach((letter) => {
					var index = letter.charCodeAt(0) - 65;
					if (index >= 0 && index < options.length && picked.indexOf(index) === -1) picked.push(index);
				});
				return;
			}
			// c) 文本匹配
			var target = normalizeForMatch(text);
			if (!target) return;
			if (judge && JUDGE[target]) target = JUDGE[target];
			var found = -1;
			options.forEach((option, index) => {
				if (found !== -1) return;
				var optionText = normalizeForMatch(option.text);
				if (judge && JUDGE[optionText]) optionText = JUDGE[optionText];
				if (!optionText) return;
				if (optionText === target || target.length > 3 && (optionText.indexOf(target) !== -1 || target.indexOf(optionText) !== -1)) found = index;
			});
			if (found !== -1 && picked.indexOf(found) === -1) picked.push(found);
		});
		return picked;
	}
	function selectOption(option) {
		var input = option.input;
		if (input && input.checked) return true;
		clickEl(option.el);
		if (input && !input.checked) {
			setNativeChecked(input, true);
			dispatch(input, "input");
			dispatch(input, "change");
		}
		return !input || input.checked;
	}
	function applyAnswer(question, picked, rawAnswer) {
		var options = question.optionNodes || [];
		if (picked.length) {
			var applied = [];
			picked.forEach((index) => {
				var option = options[index];
				if (!option) return;
				if (selectOption(option)) applied.push(option.text || String(index + 1));
			});
			return applied.length ? applied : false;
		}
		if (["0", "1", "3"].indexOf(question.type) !== -1) return false;
		var boxes = Array.prototype.slice.call(question.dom.querySelectorAll(SITE.textbox.join(","))).filter(isVisible);
		if (!boxes.length || !rawAnswer) return false;
		var parts = Array.isArray(rawAnswer) ? rawAnswer : String(rawAnswer).split(/\n|；|;|第\s*\d+\s*空[:：]/);
		parts = parts.map((part) => cleanStem(String(part || ""))).filter(Boolean);
		if (!parts.length) return false;
		boxes.forEach((box, index) => {
			var value = parts[index] != null ? parts[index] : parts[0];
			if (box.isContentEditable && !box.value) {
				box.textContent = value;
				dispatch(box, "input");
			} else setNativeValue(box, value);
		});
		return parts;
	}
	function fillFromSources(sources, question) {
		for (var i = 0; i < sources.length; i++) {
			var answer = sources[i].answer;
			if (!answer) continue;
			if (typeof answer === "string" && (/付费题库|暂无答案/.test(answer) || answer.trim() === "略")) continue;
			var picked = ["0", "1", "3"].indexOf(question.type) !== -1 ? pickOptionIndexes(answer, question) : [];
			var applied = applyAnswer(question, picked, answer);
			if (applied) return applied;
		}
		return false;
	}

	/* ---------------- 6.4 答题流程 ---------------- */
	async function quizStep() {
		var ask = ui.ask;
		var config = getConfig();
		var blocks = findBlocks();
		if (!blocks.length) {
			ask.msg("当前页面未识别到题目");
			return;
		}
		var signature = blocks.map((block) => String(textOf(block)).slice(0, 40)).join("|");
		if (signature === runtime.quizSignature) return;
		runtime.quizSignature = signature;
		ask.reset();
		ask.count = blocks.length;
		ask.task.name = /考试|exam|test/i.test(location.pathname) ? "考试" : "章节测验";
		ask.log("识别到 " + blocks.length + " 道题目，开始检索答案", "success");
		var matched = 0;
		for (var i = 0; i < blocks.length; i++) {
			await sleep(Math.max(1, Number(config.answerInterval) || 3));
			var question = parseQuestion(blocks[i], i);
			ask.insert(question);
			var item = ask.get(i);
			item.status = "primary";
			ask.task.work.inx = i;
			ask.msg("正在检索第 " + (i + 1) + " / " + blocks.length + " 题");
			var sources = await getAnswers(question);
			item.allAnswer = sources;
			var applied = fillFromSources(sources, question);
			if (applied) {
				item.status = "primary";
				item.answer = applied;
				matched++;
				ask.log("第 " + (i + 1) + " 题已自动填写", "success");
			} else {
				item.status = "danger";
				item.answer = "暂无答案";
				ask.log("第 " + (i + 1) + " 题未匹配到答案", "error");
			}
		}
		var ratio = blocks.length ? matched / blocks.length : 0;
		ask.task.status = "已处理 " + matched + " / " + blocks.length + " 题";
		if (!config.autoSubmit) {
			ask.log("答题结束（匹配 " + matched + " / " + blocks.length + "），未开启自动提交", "success");
		} else if (ratio < Number(config.minAccuracy || .8)) {
			ask.log("匹配率不足（" + matched + " / " + blocks.length + "），未自动提交", "error");
		} else {
			var submit = findButtonByText(SITE.submitText, SITE.nextButton);
			if (submit) {
				clickEl(submit);
				ask.log("已自动提交答卷", "success");
			} else ask.log("未找到提交按钮，请手动提交", "error");
		}
		if (config.autoExam || !/考试/.test(ask.task.name)) {
			var next = findButtonByText(SITE.nextText, SITE.nextButton);
			if (next) {
				clickEl(next);
				ask.log("切换到下一题", "success");
			}
		}
	}

	/* ---------------- 6.5 主循环 ---------------- */
	function detectMode() {
		if (findVideo()) return "study";
		if (chapterItems().length > 1) return "study";
		if (document.querySelector("input[type='radio'],input[type='checkbox']") && findBlocks().length) return "quiz";
		return "idle";
	}
	async function step() {
		if (runtime.busy) return;
		runtime.busy = true;
		try {
			if (runtime.url !== location.href) {
				runtime.url = location.href;
				runtime.quizSignature = "";
				runtime.lastAdvance = 0;
			}
			var mode = detectMode();
			ensureUi(mode === "idle" ? "settings" : "task");
			var config = getConfig();
			if (mode === "study") {
				if (config.autoVideo) await videoStep();
			} else if (mode === "quiz") {
				if (config.autoAnswer) await quizStep();
			} else if (ui.ask) ui.ask.msg("当前页面暂无任务");
		} catch (e) {
			log(e, "error");
			if (ui.ask) ui.ask.log("运行异常：" + (e && e.message ? e.message : e), "error");
		} finally {
			runtime.busy = false;
		}
	}
	function loop() {
		step().finally(() => {
			var delay = Math.max(1, Number(getConfig().interval) || 3) * 1e3;
			runtime.timer = setTimeout(loop, delay);
		});
	}

	/* ---------------- 6.6 启动 ---------------- */
	var marker = "data-manfen-initialized";
	function boot() {
		if (document.documentElement.hasAttribute(marker)) return;
		document.documentElement.setAttribute(marker, SCRIPT_VERSION);
		allowCopy();
		// 首屏就按当前页面决定面板形态，避免先挂设置面板再重挂一次造成闪烁
		ensureUi(detectMode() === "idle" ? "settings" : "task");
		if (ui.ask) {
			ui.ask.log("脚本已加载：" + location.host, "success");
			ui.ask.msg("等待任务");
		}
		loop();
	}
	if (document.body) boot();
	else document.addEventListener("DOMContentLoaded", boot, { once: true });
})(typeof Vue !== "undefined" ? Vue : window.Vue, typeof Pinia !== "undefined" ? Pinia : window.Pinia);
