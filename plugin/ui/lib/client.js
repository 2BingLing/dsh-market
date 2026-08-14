window.__ModuleLoader__.load({
	id: "@dsh-market/plugin",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region src/client/api.ts
		async function api(method, args) {
			const data = await (await fetch("/market/api", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					method,
					args: args ?? {}
				})
			})).json();
			if (!data.ok) throw new Error(data.error ?? "RPC failed");
			return data.result;
		}
		//#endregion
		//#region src/client/store.ts
		/**
		* 面板开关单一 store：sidebar 入口按钮与 shell.overlay 面板跨 slot 共享。
		*/
		let panelOpen = false;
		const listeners = /* @__PURE__ */ new Set();
		function subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		}
		function getOpen() {
			return panelOpen;
		}
		function setOpen(v) {
			if (panelOpen === v) return;
			panelOpen = v;
			for (const l of listeners) l();
		}
		function toggle() {
			setOpen(!panelOpen);
		}
		//#endregion
		//#region \0dsh-css:E:\wm\tool\lader\plugin\ui\src\client\styles.module.css.mjs
		const css = "._LI32q_trigger{height:100%;color:var(--dsw-alias-label-secondary,#5f6670);cursor:pointer;background:0 0;border:none;border-radius:6px;align-items:center;gap:8px;padding:0 10px;font-size:14px;display:flex}._LI32q_trigger:hover{color:var(--dsw-alias-label-primary,#252525);background:var(--dsw-alias-bg-layer-2,#edeef1)}._LI32q_trigger[data-active]{color:var(--dsw-alias-brand-primary,#2864a9)}._LI32q_triggerIcon{font-size:16px;line-height:1}._LI32q_triggerLabel{white-space:nowrap}._LI32q_backdrop{z-index:100;pointer-events:auto;background:#00000040;position:fixed;inset:0}._LI32q_panel{background:var(--dsw-alias-bg-overlay,#fff);border-right:1px solid var(--dsw-alias-border-l1,#e9eaed);pointer-events:auto;width:400px;max-width:92vw;color:var(--dsw-alias-label-primary,#252525);flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,Noto Sans SC,Microsoft YaHei,Helvetica Neue,Arial,sans-serif;font-size:13px;display:flex;position:fixed;top:0;bottom:0;left:0;box-shadow:8px 0 32px #0000001f}._LI32q_header{border-bottom:1px solid var(--dsw-alias-border-l1,#e9eaed);align-items:center;gap:8px;padding:12px 14px;display:flex}._LI32q_title{font-size:15px;font-weight:600}._LI32q_subtitle{color:var(--dsw-alias-label-secondary,#9299a3);flex:1;font-size:12px}._LI32q_tabs{border-bottom:1px solid var(--dsw-alias-border-l1,#e9eaed);gap:2px;padding:6px 10px 0;display:flex}._LI32q_tab{color:var(--dsw-alias-label-secondary,#5f6670);cursor:pointer;background:0 0;border:none;border-bottom:2px solid #0000;border-radius:6px 6px 0 0;padding:7px 14px;font-size:13px}._LI32q_tab:hover{color:var(--dsw-alias-label-primary,#252525);background:var(--dsw-alias-bg-layer-2,#f7f8fa)}._LI32q_tabOn{color:var(--dsw-alias-brand-primary,#2864a9);border-bottom-color:var(--dsw-alias-brand-primary,#2864a9);font-weight:600}._LI32q_body{flex:1;padding:12px 14px;overflow-y:auto}._LI32q_tabBody{flex-direction:column;gap:14px;display:flex}._LI32q_section{flex-direction:column;gap:8px;display:flex}._LI32q_sectionTitle{color:var(--dsw-alias-label-secondary,#5f6670);margin:4px 0 0;font-size:13px;font-weight:600}._LI32q_stageBadge{background:var(--dsw-alias-bg-layer-2,#eaf2fb);color:var(--dsw-alias-brand-primary,#2864a9);border-radius:999px;align-self:flex-start;padding:3px 10px;font-size:12px}._LI32q_stateHint{text-align:center;color:var(--dsw-alias-label-secondary,#9299a3);padding:24px 12px;font-size:12px}._LI32q_installedNote{color:var(--dsw-alias-label-secondary,#9299a3);font-size:11px}._LI32q_card{background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l1,#e9eaed);border-radius:10px;flex-direction:column;gap:6px;padding:10px 12px;transition:border-color .15s;display:flex}._LI32q_card:hover{border-color:var(--dsw-alias-border-l2,#d9dde3)}._LI32q_cardHead{align-items:baseline;gap:8px;display:flex}._LI32q_cardName{text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;overflow:hidden}._LI32q_cardMeta{color:var(--dsw-alias-label-secondary,#9299a3);white-space:nowrap;flex:1;font-size:11px}._LI32q_cardDesc{color:var(--dsw-alias-label-secondary,#5f6670);-webkit-line-clamp:2;-webkit-box-orient:vertical;margin:0;font-size:12px;line-height:1.5;display:-webkit-box;overflow:hidden}._LI32q_cardTags,._LI32q_cardReasons{flex-wrap:wrap;gap:4px;display:flex}._LI32q_reason{color:var(--dsw-alias-brand-primary,#2864a9);background:var(--dsw-alias-bg-layer-2,#eaf2fb);border-radius:999px;padding:1px 6px;font-size:11px}._LI32q_cardActions{justify-content:flex-end;align-items:center;gap:8px;display:flex}._LI32q_needConfig{color:var(--dsw-alias-state-warn-primary,#b7791f);font-size:11px}._LI32q_btnPrimary{background:var(--dsw-alias-brand-primary,#2864a9);color:#fff;cursor:pointer;border:none;border-radius:6px;padding:4px 14px;font-size:12px;font-weight:600}._LI32q_btnPrimary:hover{opacity:.9}._LI32q_btnPrimary:disabled{opacity:.5;cursor:not-allowed}._LI32q_btnGhost{border:1px solid var(--dsw-alias-border-l2,#d9dde3);color:var(--dsw-alias-label-secondary,#5f6670);cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px;font-size:12px}._LI32q_btnGhost:hover{color:var(--dsw-alias-label-primary,#252525);border-color:var(--dsw-alias-label-secondary,#9299a3)}._LI32q_btnDanger{border:1px solid var(--dsw-alias-state-error-primary,#c0392b);color:var(--dsw-alias-state-error-primary,#c0392b);cursor:pointer;background:0 0;border-radius:6px;padding:4px 10px;font-size:12px}._LI32q_tag{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border:1px solid var(--dsw-alias-border-l1,#e9eaed);color:var(--dsw-alias-label-secondary,#5f6670);cursor:pointer;user-select:none;border-radius:999px;padding:1px 8px;font-size:11px;display:inline-block}._LI32q_tag:hover{color:var(--dsw-alias-brand-primary,#2864a9);border-color:var(--dsw-alias-brand-primary,#2864a9)}._LI32q_tagOn{color:var(--dsw-alias-brand-primary,#2864a9);border-color:var(--dsw-alias-brand-primary,#2864a9);background:var(--dsw-alias-bg-layer-2,#eaf2fb)}._LI32q_input,._LI32q_select{border:1px solid var(--dsw-alias-border-l2,#d9dde3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#252525);border-radius:6px;outline:none;padding:5px 9px;font-size:12px}._LI32q_input:focus,._LI32q_select:focus{border-color:var(--dsw-alias-brand-primary,#2864a9)}._LI32q_searchRow{gap:8px;display:flex}._LI32q_searchInput{border:1px solid var(--dsw-alias-border-l2,#d9dde3);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#252525);border-radius:8px;outline:none;flex:1;padding:7px 11px;font-size:13px}._LI32q_searchInput:focus{border-color:var(--dsw-alias-brand-primary,#2864a9)}._LI32q_searchInput::placeholder{color:var(--dsw-alias-label-secondary,#9299a3)}._LI32q_filterRow{align-items:center;display:flex}._LI32q_tagCloud{flex-wrap:wrap;gap:5px;padding:2px 0;display:flex}._LI32q_results{flex-direction:column;gap:8px;display:flex}._LI32q_resultCount{color:var(--dsw-alias-label-secondary,#9299a3);font-size:11px}._LI32q_installedRow{border:1px solid var(--dsw-alias-border-l1,#e9eaed);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:8px;align-items:center;gap:8px;padding:8px 10px;display:flex}._LI32q_installedInfo{flex:1;min-width:0}._LI32q_installedName{text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600;overflow:hidden}._LI32q_installedMeta{color:var(--dsw-alias-label-secondary,#9299a3);font-size:11px}._LI32q_installedActions{flex-shrink:0;gap:6px;display:flex}._LI32q_unmatched{flex-wrap:wrap;gap:4px;display:flex}._LI32q_unmatchedChip{background:var(--dsw-alias-bg-layer-2,#f7f8fa);color:var(--dsw-alias-label-secondary,#9299a3);border-radius:999px;padding:1px 7px;font-size:11px}._LI32q_unmatchedMore{color:var(--dsw-alias-label-secondary,#9299a3);align-self:center;font-size:11px}._LI32q_ghCard{border:1px solid var(--dsw-alias-border-l1,#e9eaed);background:var(--dsw-alias-bg-layer-1,#fff);border-radius:10px;flex-direction:column;gap:8px;padding:10px 12px;display:flex}._LI32q_ghRow{align-items:center;gap:8px;display:flex}._LI32q_ghLogin{flex:1;font-weight:600}._LI32q_ghTip{color:var(--dsw-alias-label-secondary,#9299a3);margin:0;font-size:11px;line-height:1.5}._LI32q_deviceFlow{background:var(--dsw-alias-bg-layer-2,#eaf2fb);border-radius:8px;flex-direction:column;gap:6px;padding:8px;display:flex}._LI32q_deviceCode{letter-spacing:2px;color:var(--dsw-alias-brand-primary,#2864a9);font-size:18px;font-weight:700}._LI32q_deviceFlow a{color:var(--dsw-alias-brand-primary,#2864a9)}._LI32q_settingsRow{align-items:center;gap:8px;display:flex}._LI32q_settingsLabel{color:var(--dsw-alias-label-secondary,#5f6670);white-space:nowrap;font-size:12px}._LI32q_error{color:var(--dsw-alias-state-error-primary,#c0392b);margin:0;font-size:12px}._LI32q_warn{color:var(--dsw-alias-state-warn-primary,#b7791f);margin:0;font-size:12px}._LI32q_modalBackdrop{z-index:120;background:#0000004d;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}._LI32q_modal{background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1,#e9eaed);border-radius:12px;flex-direction:column;width:360px;max-width:90vw;display:flex;overflow:hidden;box-shadow:0 12px 40px #0003}._LI32q_modalHead{border-bottom:1px solid var(--dsw-alias-border-l1,#e9eaed);justify-content:space-between;align-items:center;padding:10px 14px;display:flex}._LI32q_modalTitle{font-size:14px;font-weight:600}._LI32q_modalDesc{color:var(--dsw-alias-label-secondary,#5f6670);margin:0;font-size:12px;line-height:1.6}._LI32q_advanced{margin-top:2px}._LI32q_advanced summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#9299a3);user-select:none;font-size:11px}._LI32q_advancedCmd{background:var(--dsw-alias-bg-layer-2,#f7f8fa);white-space:pre-wrap;word-break:break-all;border-radius:6px;margin-top:6px;padding:6px 8px;font-size:11px;display:block}._LI32q_modalBody{flex-direction:column;gap:10px;padding:14px;display:flex}._LI32q_cmdBox{background:var(--dsw-alias-bg-layer-2,#f7f8fa);border-radius:6px;padding:8px 10px;overflow-x:auto}._LI32q_cmdBox code{white-space:pre-wrap;word-break:break-all;font-size:11px}._LI32q_modalActions{justify-content:flex-end;gap:8px;margin-top:4px;display:flex}._LI32q_loading{text-align:center;color:var(--dsw-alias-label-secondary,#9299a3);padding:20px}._LI32q_modalSuccess{color:var(--dsw-alias-state-success-primary,#2f9e6e);font-weight:600}._LI32q_modalError{color:var(--dsw-alias-state-error-primary,#c0392b);word-break:break-all;font-weight:600}._LI32q_steps{flex-direction:column;gap:4px;display:flex}._LI32q_stepRow{align-items:center;gap:6px;font-size:12px;display:flex}._LI32q_stepLabel{flex:1}._LI32q_stepDetail{color:var(--dsw-alias-label-secondary,#9299a3);font-size:11px}";
		const tagId = "@dsh-market/plugin/styles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-market/plugin";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var styles_module_css_default = {
			"modalSuccess": "_LI32q_modalSuccess",
			"reason": "_LI32q_reason",
			"searchInput": "_LI32q_searchInput",
			"ghTip": "_LI32q_ghTip",
			"settingsLabel": "_LI32q_settingsLabel",
			"settingsRow": "_LI32q_settingsRow",
			"stepDetail": "_LI32q_stepDetail",
			"triggerIcon": "_LI32q_triggerIcon",
			"header": "_LI32q_header",
			"cardHead": "_LI32q_cardHead",
			"cardDesc": "_LI32q_cardDesc",
			"advancedCmd": "_LI32q_advancedCmd",
			"error": "_LI32q_error",
			"ghCard": "_LI32q_ghCard",
			"title": "_LI32q_title",
			"tabs": "_LI32q_tabs",
			"stageBadge": "_LI32q_stageBadge",
			"filterRow": "_LI32q_filterRow",
			"unmatchedMore": "_LI32q_unmatchedMore",
			"modal": "_LI32q_modal",
			"modalHead": "_LI32q_modalHead",
			"warn": "_LI32q_warn",
			"modalBody": "_LI32q_modalBody",
			"card": "_LI32q_card",
			"stepLabel": "_LI32q_stepLabel",
			"triggerLabel": "_LI32q_triggerLabel",
			"modalTitle": "_LI32q_modalTitle",
			"cardMeta": "_LI32q_cardMeta",
			"installedMeta": "_LI32q_installedMeta",
			"cardReasons": "_LI32q_cardReasons",
			"loading": "_LI32q_loading",
			"btnDanger": "_LI32q_btnDanger",
			"tab": "_LI32q_tab",
			"btnPrimary": "_LI32q_btnPrimary",
			"resultCount": "_LI32q_resultCount",
			"select": "_LI32q_select",
			"deviceFlow": "_LI32q_deviceFlow",
			"needConfig": "_LI32q_needConfig",
			"installedName": "_LI32q_installedName",
			"section": "_LI32q_section",
			"stepRow": "_LI32q_stepRow",
			"installedRow": "_LI32q_installedRow",
			"installedInfo": "_LI32q_installedInfo",
			"stateHint": "_LI32q_stateHint",
			"body": "_LI32q_body",
			"btnGhost": "_LI32q_btnGhost",
			"unmatchedChip": "_LI32q_unmatchedChip",
			"results": "_LI32q_results",
			"input": "_LI32q_input",
			"cardName": "_LI32q_cardName",
			"cardTags": "_LI32q_cardTags",
			"trigger": "_LI32q_trigger",
			"tag": "_LI32q_tag",
			"modalActions": "_LI32q_modalActions",
			"cardActions": "_LI32q_cardActions",
			"searchRow": "_LI32q_searchRow",
			"sectionTitle": "_LI32q_sectionTitle",
			"subtitle": "_LI32q_subtitle",
			"tagCloud": "_LI32q_tagCloud",
			"installedActions": "_LI32q_installedActions",
			"tabOn": "_LI32q_tabOn",
			"deviceCode": "_LI32q_deviceCode",
			"unmatched": "_LI32q_unmatched",
			"panel": "_LI32q_panel",
			"ghRow": "_LI32q_ghRow",
			"advanced": "_LI32q_advanced",
			"cmdBox": "_LI32q_cmdBox",
			"modalError": "_LI32q_modalError",
			"steps": "_LI32q_steps",
			"tabBody": "_LI32q_tabBody",
			"installedNote": "_LI32q_installedNote",
			"ghLogin": "_LI32q_ghLogin",
			"modalBackdrop": "_LI32q_modalBackdrop",
			"modalDesc": "_LI32q_modalDesc",
			"backdrop": "_LI32q_backdrop",
			"tagOn": "_LI32q_tagOn"
		};
		//#endregion
		//#region src/client/panel.tsx
		/**
		* 插件市场面板（4-tab：推荐 / 搜索 / 已装 / 设置）
		* 数据全部来自 Host RPC（api.ts）。纯 React.createElement（无 JSX）。
		*/
		/** GitHub 设备流 client_id（dsh-market GitHub App，公开值非机密） */
		const GH_CLIENT_ID = "Iv23liYFieChYuBJklZp";
		const GH_TOKEN_KEY = "dsh-market:gh_token";
		const GH_LOGIN_KEY = "dsh-market:gh_login";
		/** 跨 tab 搜索词（标签点击 → 搜索 tab） */
		let searchSeed = "";
		function setSearchSeed(t) {
			searchSeed = t;
		}
		function fmtStars(n) {
			return n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
		}
		function El(tag, props, ...children) {
			return (0, react.createElement)(tag, props ?? {}, ...children);
		}
		function PluginCard(props) {
			const { plugin, reasons, onInstall, onTagClick } = props;
			const tags = (plugin.tags ?? []).filter((t) => /[\u4e00-\u9fff]/.test(t)).slice(0, 4);
			return El("div", {
				className: styles_module_css_default.card,
				"data-type": plugin.type
			}, El("div", { className: styles_module_css_default.cardHead }, El("span", {
				className: styles_module_css_default.cardName,
				title: plugin.fullName
			}, plugin.name), El("span", { className: styles_module_css_default.cardMeta }, plugin.type === "skill" ? "SKILL" : "插件", " · ", fmtStars(plugin.stars), "★ · ", plugin.scoreTotal, "分")), plugin.descriptionZh ? El("p", { className: styles_module_css_default.cardDesc }, plugin.descriptionZh) : null, El("div", { className: styles_module_css_default.cardTags }, ...tags.map((t) => El("span", {
				key: t,
				className: styles_module_css_default.tag,
				onClick: () => onTagClick(t)
			}, t))), reasons && reasons.length > 0 ? El("div", { className: styles_module_css_default.cardReasons }, ...reasons.map((r, i) => El("span", {
				key: i,
				className: styles_module_css_default.reason
			}, r))) : null, El("div", { className: styles_module_css_default.cardActions }, plugin.needsConfig ? El("span", { className: styles_module_css_default.needConfig }, "需配置") : null, El("button", {
				className: styles_module_css_default.btnPrimary,
				onClick: () => onInstall(plugin)
			}, "安装")));
		}
		function InstallModal(props) {
			const { plugin, onDone, onClose } = props;
			const [phase, setPhase] = (0, react.useState)("confirm");
			const [error, setError] = (0, react.useState)("");
			const [childSessionId, setChildSessionId] = (0, react.useState)(null);
			const startAi = async () => {
				setPhase("running");
				try {
					const r = await api("ai:install", { pluginId: plugin.id });
					setChildSessionId(r.childSessionId);
					setPhase("handedOff");
				} catch (e) {
					setError(e.message);
					setPhase("error");
				}
			};
			const cmd = plugin.installCommands && plugin.installCommands.length > 0 ? plugin.installCommands[0] : plugin.installMethod === "skills-add" ? `git clone https://github.com/${plugin.fullName}.git` : `dsh plugin --profile web add ${plugin.name}`;
			return El("div", {
				className: styles_module_css_default.modalBackdrop,
				onClick: onClose
			}, El("div", {
				className: styles_module_css_default.modal,
				onClick: (e) => e.stopPropagation()
			}, El("div", { className: styles_module_css_default.modalHead }, El("span", { className: styles_module_css_default.modalTitle }, `安装 ${plugin.name}`), El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: onClose
			}, "✕")), phase === "confirm" ? El("div", { className: styles_module_css_default.modalBody }, El("p", { className: styles_module_css_default.modalDesc }, `将交由 AI 助手阅读 ${plugin.fullName} 的文档后自动安装，需要配置（API Key / Token）时会先向你确认。`), plugin.needsConfig ? El("p", { className: styles_module_css_default.warn }, "⚠️ 该插件需要额外配置（API Key / Token），AI 会向你询问。") : null, plugin.type === "skill" ? El("p", { className: styles_module_css_default.ghTip }, "目标：技能目录（~/.agents/skills）") : El("p", { className: styles_module_css_default.ghTip }, "目标：web profile（装完需重启 harness 生效）"), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: onClose
			}, "取消"), El("button", {
				className: styles_module_css_default.btnPrimary,
				onClick: () => void startAi()
			}, "确认，交给 AI 安装")), El("details", { className: styles_module_css_default.advanced }, El("summary", null, "高级：查看/复制手动命令"), El("code", { className: styles_module_css_default.advancedCmd }, cmd))) : phase === "running" ? El("div", { className: styles_module_css_default.modalBody }, El("div", { className: styles_module_css_default.loading }, "正在唤起 AI 助手…")) : phase === "handedOff" ? El("div", { className: styles_module_css_default.modalBody }, El("div", { className: styles_module_css_default.modalSuccess }, "✅ 已交给 AI 助手安装"), El("p", { className: styles_module_css_default.modalDesc }, childSessionId ? `AI 助手已开始工作（子会话 ${childSessionId.slice(0, 8)}…），请到会话中查看进度；需要配置时 AI 会向你确认。` : "AI 助手已开始工作，请到会话中查看进度；需要配置时 AI 会向你确认。"), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: styles_module_css_default.btnPrimary,
				onClick: () => {
					onDone();
					onClose();
				}
			}, "知道了"))) : El("div", { className: styles_module_css_default.modalBody }, El("div", { className: styles_module_css_default.modalError }, `❌ 启动失败：${error}`), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: () => setPhase("confirm")
			}, "重试"), El("button", {
				className: styles_module_css_default.btnPrimary,
				onClick: onClose
			}, "关闭")))));
		}
		function RecommendTab(props) {
			const { profile, recs, loading, installedIds, onInstall, onTagClick } = props;
			if (loading) return El("div", { className: styles_module_css_default.stateHint }, "加载推荐中…");
			if (recs.length === 0) return El("div", { className: styles_module_css_default.stateHint }, "暂无推荐，先去搜索或完成问卷吧");
			const stage = !profile ? "新手" : profile.modeOverride !== "auto" ? profile.modeOverride : profile.confidence >= .4 ? "老手" : "新手";
			const groups = [
				{
					title: "🎯 适合当前场景",
					items: recs.filter((r) => r.origin === "scene")
				},
				{
					title: "🤔 猜你喜欢",
					items: recs.filter((r) => r.origin === "guess")
				},
				{
					title: "⭐ 精选",
					items: recs.filter((r) => r.origin === "curated")
				},
				{
					title: "🆕 最近更新",
					items: recs.filter((r) => r.origin === "trending")
				}
			].filter((g) => g.items.length > 0);
			return El("div", { className: styles_module_css_default.tabBody }, profile ? El("div", { className: styles_module_css_default.stageBadge }, `阶段：${stage} · 画像置信度 ${Math.round((profile.confidence ?? 0) * 100)}%`) : null, ...groups.map((g) => El("div", {
				key: g.title,
				className: styles_module_css_default.section
			}, El("h3", { className: styles_module_css_default.sectionTitle }, g.title), ...g.items.map((r) => El(PluginCard, {
				key: r.plugin.id,
				plugin: r.plugin,
				reasons: r.reasons,
				origin: r.origin,
				onInstall,
				onTagClick
			})))), installedIds.size > 0 ? El("div", { className: styles_module_css_default.installedNote }, `已排除 ${installedIds.size} 个已安装插件`) : null);
		}
		function SearchTab(props) {
			const { plugins, onInstall, onTagClick } = props;
			const [query, setQuery] = (0, react.useState)("");
			const [tags, setTags] = (0, react.useState)([]);
			const [type, setType] = (0, react.useState)("all");
			const [results, setResults] = (0, react.useState)([]);
			const [searching, setSearching] = (0, react.useState)(false);
			const debounceRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (searchSeed) {
					setQuery(searchSeed);
					setSearchSeed("");
				}
			}, []);
			const hot = (0, react.useMemo)(() => {
				const counts = /* @__PURE__ */ new Map();
				for (const p of plugins) for (const t of p.tags) {
					if (!/[\u4e00-\u9fff]/.test(t)) continue;
					if ([
						"效率工具",
						"开发辅助",
						"AI 增强",
						"AI增强"
					].includes(t)) continue;
					counts.set(t, (counts.get(t) ?? 0) + 1);
				}
				return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([t]) => t);
			}, [plugins]);
			(0, react.useEffect)(() => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => {
					runSearch();
				}, 300);
				return () => {
					if (debounceRef.current) clearTimeout(debounceRef.current);
				};
			}, [
				query,
				tags,
				type
			]);
			const runSearch = async () => {
				setSearching(true);
				try {
					const opts = { limit: 50 };
					if (tags.length) opts.tags = tags;
					if (type !== "all") opts.type = type;
					const r = await api("search", {
						query,
						options: opts
					});
					setResults(r);
				} catch {
					setResults([]);
				} finally {
					setSearching(false);
				}
			};
			const toggleTag = (t) => {
				setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
			};
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.searchRow }, El("input", {
				className: styles_module_css_default.searchInput,
				placeholder: "搜索插件：名称 / 功能 / 用途…",
				value: query,
				onChange: (e) => setQuery(e.target.value)
			})), El("div", { className: styles_module_css_default.filterRow }, El("select", {
				className: styles_module_css_default.select,
				value: type,
				onChange: (e) => setType(e.target.value)
			}, El("option", { value: "all" }, "全部类型"), El("option", { value: "cordis-plugin" }, "cordis 插件"), El("option", { value: "skill" }, "skill"))), El("div", { className: styles_module_css_default.tagCloud }, ...hot.map((t) => El("span", {
				key: t,
				className: `${styles_module_css_default.tag} ${tags.includes(t) ? styles_module_css_default.tagOn : ""}`,
				onClick: () => toggleTag(t)
			}, t))), searching && results.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "搜索中…") : results.length === 0 && query === "" && tags.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "输入关键词或选择标签开始搜索") : results.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "没有匹配的插件") : El("div", { className: styles_module_css_default.results }, El("div", { className: styles_module_css_default.resultCount }, `共 ${results.length} 个结果`), ...results.slice(0, 30).map((r) => El(PluginCard, {
				key: r.plugin.id,
				plugin: r.plugin,
				reasons: r.tagHits > 0 ? [`标签命中 ${r.tagHits} 项`] : void 0,
				onInstall,
				onTagClick
			}))));
		}
		function InstalledTab(props) {
			const { installed, loading, onChanged } = props;
			const [confirming, setConfirming] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const uninstall = async (item) => {
				if (!item.pluginId) return;
				setBusy(true);
				try {
					await api("uninstall", { pluginId: item.pluginId });
					onChanged();
				} catch (e) {
					alert(`卸载失败：${e.message}`);
				} finally {
					setBusy(false);
					setConfirming(null);
				}
			};
			if (loading) return El("div", { className: styles_module_css_default.stateHint }, "扫描已装插件…");
			const matched = installed.filter((i) => i.pluginId);
			const unmatched = installed.filter((i) => !i.pluginId);
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, `已装插件（${installed.length}）`), matched.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "未检测到市场收录的已装插件") : null, ...matched.map((i) => El("div", {
				key: i.localName,
				className: styles_module_css_default.installedRow
			}, El("div", { className: styles_module_css_default.installedInfo }, El("div", { className: styles_module_css_default.installedName }, i.plugin?.name ?? i.localName), El("div", { className: styles_module_css_default.installedMeta }, `${i.version ?? "未知版本"} · ${i.source === "skills" ? "skill" : "profile"}`)), confirming === i.localName ? El("div", { className: styles_module_css_default.installedActions }, El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: () => setConfirming(null)
			}, "取消"), El("button", {
				className: styles_module_css_default.btnDanger,
				disabled: busy,
				onClick: () => void uninstall(i)
			}, "确认卸载")) : El("div", { className: styles_module_css_default.installedActions }, El("button", {
				className: styles_module_css_default.btnGhost,
				disabled: !i.pluginId,
				onClick: () => setConfirming(i.localName)
			}, "卸载"))))), unmatched.length > 0 ? El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, `其他已装（${unmatched.length}，未收录市场）`), El("div", { className: styles_module_css_default.unmatched }, ...unmatched.slice(0, 30).map((i) => El("span", {
				key: i.localName,
				className: styles_module_css_default.unmatchedChip
			}, i.localName)), unmatched.length > 30 ? El("span", { className: styles_module_css_default.unmatchedMore }, `+${unmatched.length - 30}`) : null)) : null);
		}
		function SettingsTab(props) {
			const { profile, onChanged } = props;
			const [ghLogin, setGhLogin] = (0, react.useState)(() => localStorage.getItem(GH_LOGIN_KEY));
			const [ghBusy, setGhBusy] = (0, react.useState)(false);
			const [ghError, setGhError] = (0, react.useState)("");
			const [deviceInfo, setDeviceInfo] = (0, react.useState)(null);
			const [patInput, setPatInput] = (0, react.useState)("");
			const [mode, setMode] = (0, react.useState)(profile?.modeOverride ?? "auto");
			const [profileName, setProfileName] = (0, react.useState)("web");
			(0, react.useEffect)(() => {
				setMode(profile?.modeOverride ?? "auto");
			}, [profile]);
			const saveSettings = async (patch) => {
				try {
					await api("settings:update", { patch });
					onChanged();
				} catch (e) {
					alert(`保存失败：${e.message}`);
				}
			};
			const startDeviceFlow = async () => {
				setGhBusy(true);
				setGhError("");
				setDeviceInfo(null);
				try {
					const d = await api("gh:deviceCode", { body: {
						client_id: GH_CLIENT_ID,
						scope: "read:user"
					} });
					if (!d.device_code) {
						setGhError(`设备流不可用：${d.error_description ?? d.error ?? "未知错误"}`);
						setGhBusy(false);
						return;
					}
					setDeviceInfo({
						verification_uri: d.verification_uri ?? "",
						user_code: d.user_code ?? ""
					});
					const interval = window.setInterval(async () => {
						try {
							const t = await api("gh:token", { body: {
								client_id: GH_CLIENT_ID,
								device_code: d.device_code,
								grant_type: "urn:ietf:params:oauth:grant-type:device_code"
							} });
							if (t.access_token) {
								window.clearInterval(interval);
								await finishBind(t.access_token);
							} else if (t.error === "authorization_pending") {} else if (t.error === "slow_down") {} else {
								window.clearInterval(interval);
								setGhError(t.error_description ?? t.error ?? "授权失败");
								setGhBusy(false);
							}
						} catch (e) {
							window.clearInterval(interval);
							setGhError(e.message);
							setGhBusy(false);
						}
					}, (d.interval ?? 5) * 1e3);
				} catch (e) {
					setGhError(e.message);
					setGhBusy(false);
				}
			};
			const finishBind = async (token) => {
				try {
					const user = await api("gh:user", { token });
					localStorage.setItem(GH_TOKEN_KEY, token);
					localStorage.setItem(GH_LOGIN_KEY, user.login);
					setGhLogin(user.login);
					setGhBusy(false);
					setDeviceInfo(null);
					await api("profile:update", { starredFullNames: await api("gh:starred", { token }) });
					onChanged();
				} catch (e) {
					setGhError(`绑定失败：${e.message}`);
					setGhBusy(false);
				}
			};
			const bindWithPat = async () => {
				if (!patInput.trim()) return;
				setGhBusy(true);
				setGhError("");
				try {
					await finishBind(patInput.trim());
					setPatInput("");
				} catch (e) {
					setGhError(e.message);
					setGhBusy(false);
				}
			};
			const unbind = () => {
				localStorage.removeItem(GH_TOKEN_KEY);
				localStorage.removeItem(GH_LOGIN_KEY);
				setGhLogin(null);
				onChanged();
			};
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, "GitHub 绑定（加星 → 推荐画像）"), ghLogin ? El("div", { className: styles_module_css_default.ghCard }, El("div", { className: styles_module_css_default.ghRow }, El("span", { className: styles_module_css_default.ghLogin }, `已绑定 @${ghLogin}`), El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: unbind
			}, "解除绑定")), El("p", { className: styles_module_css_default.ghTip }, "已读取你的公开加星用于个性化推荐（token 仅存本机浏览器）")) : El("div", { className: styles_module_css_default.ghCard }, El("div", { className: styles_module_css_default.ghRow }, El("button", {
				className: styles_module_css_default.btnPrimary,
				disabled: ghBusy,
				onClick: () => void startDeviceFlow()
			}, "通过 GitHub 授权绑定"), El("button", {
				className: styles_module_css_default.btnGhost,
				disabled: ghBusy,
				onClick: () => void bindWithPat()
			}, "使用 Token")), deviceInfo ? El("div", { className: styles_module_css_default.deviceFlow }, El("p", null, "在 GitHub 输入授权码："), El("code", { className: styles_module_css_default.deviceCode }, deviceInfo.user_code), El("p", null, El("a", {
				href: deviceInfo.verification_uri,
				target: "_blank",
				rel: "noopener noreferrer"
			}, "前往 GitHub 授权 ↗"))) : null, El("div", { className: styles_module_css_default.settingsRow }, El("input", {
				className: styles_module_css_default.input,
				placeholder: "或粘贴 Personal Access Token（read:user）",
				value: patInput,
				onChange: (e) => setPatInput(e.target.value)
			})), ghError ? El("p", { className: styles_module_css_default.error }, ghError) : null)), El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, "推荐模式"), El("div", { className: styles_module_css_default.settingsRow }, El("select", {
				className: styles_module_css_default.select,
				value: mode,
				onChange: (e) => {
					setMode(e.target.value);
					saveSettings({ modeOverride: e.target.value });
				}
			}, El("option", { value: "auto" }, "自动（按画像置信度）"), El("option", { value: "novice" }, "新手（高分精选 + 引导）"), El("option", { value: "veteran" }, "老手（新颖 + 领域精准）")))), El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, "安装设置"), El("div", { className: styles_module_css_default.settingsRow }, El("label", { className: styles_module_css_default.settingsLabel }, "目标 profile"), El("input", {
				className: styles_module_css_default.input,
				value: profileName,
				onChange: (e) => {
					setProfileName(e.target.value);
					saveSettings({ profile: e.target.value });
				}
			})), El("p", { className: styles_module_css_default.ghTip }, `已装 skill 目录：从本机 skills 目录 自动检测`)), El("div", { className: styles_module_css_default.section }, El("h3", { className: styles_module_css_default.sectionTitle }, "数据"), El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: onChanged
			}, "刷新市场数据")));
		}
		function MarketPanel(props) {
			const { onClose } = props;
			const open = (0, react.useSyncExternalStore)(subscribe, getOpen, getOpen);
			const [tab, setTab] = (0, react.useState)("recommend");
			const [plugins, setPlugins] = (0, react.useState)([]);
			const [profile, setProfile] = (0, react.useState)(null);
			const [installed, setInstalled] = (0, react.useState)([]);
			const [recs, setRecs] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [installTarget, setInstallTarget] = (0, react.useState)(null);
			const [refreshKey, setRefreshKey] = (0, react.useState)(0);
			const loadAll = async () => {
				setLoading(true);
				try {
					const [pl, prof, inst] = await Promise.all([
						api("plugins"),
						api("profile:read"),
						api("installed")
					]);
					setPlugins(pl);
					setProfile(prof);
					setInstalled(inst);
					const sceneTags = [];
					const counts = /* @__PURE__ */ new Map();
					for (const i of inst) {
						if (!i.plugin) continue;
						for (const t of i.plugin.tags) {
							if (!/[\u4e00-\u9fff]/.test(t)) continue;
							if ([
								"效率工具",
								"开发辅助",
								"AI 增强",
								"AI增强"
							].includes(t)) continue;
							counts.set(t, (counts.get(t) ?? 0) + 1);
						}
					}
					for (const [t, c] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) sceneTags.push(t);
					const r = await api("recommend", { options: {
						limit: 24,
						excludeIds: inst.filter((i) => i.pluginId).map((i) => i.pluginId),
						sceneTags
					} });
					setRecs(r);
				} catch (e) {
					console.error("market load failed:", e);
				} finally {
					setLoading(false);
				}
			};
			(0, react.useEffect)(() => {
				if (open) loadAll();
			}, [open, refreshKey]);
			if (!open) return null;
			const installedIds = new Set(installed.filter((i) => i.pluginId).map((i) => i.pluginId));
			const onTagClick = (t) => {
				setSearchSeed(t);
				setTab("search");
			};
			const onInstalledChanged = () => setRefreshKey((k) => k + 1);
			return El("div", {
				className: styles_module_css_default.backdrop,
				onClick: onClose
			}, El("div", {
				className: styles_module_css_default.panel,
				onClick: (e) => e.stopPropagation()
			}, El("div", { className: styles_module_css_default.header }, El("span", { className: styles_module_css_default.title }, "🧩 插件市场"), El("span", { className: styles_module_css_default.subtitle }, `${plugins.length} 个插件`), El("button", {
				className: styles_module_css_default.btnGhost,
				onClick: onClose
			}, "✕")), El("div", { className: styles_module_css_default.tabs }, ...[
				{
					id: "recommend",
					label: "推荐"
				},
				{
					id: "search",
					label: "搜索"
				},
				{
					id: "installed",
					label: "已装"
				},
				{
					id: "settings",
					label: "设置"
				}
			].map((t) => El("button", {
				key: t.id,
				className: `${styles_module_css_default.tab} ${tab === t.id ? styles_module_css_default.tabOn : ""}`,
				onClick: () => setTab(t.id)
			}, t.label))), El("div", { className: styles_module_css_default.body }, tab === "recommend" ? El(RecommendTab, {
				plugins,
				profile,
				recs,
				loading,
				installedIds,
				onInstall: setInstallTarget,
				onTagClick
			}) : tab === "search" ? El(SearchTab, {
				plugins,
				onInstall: setInstallTarget,
				onTagClick
			}) : tab === "installed" ? El(InstalledTab, {
				installed,
				loading,
				onChanged: onInstalledChanged
			}) : El(SettingsTab, {
				profile,
				onChanged: onInstalledChanged
			})), installTarget ? El(InstallModal, {
				plugin: installTarget,
				onDone: onInstalledChanged,
				onClose: () => setInstallTarget(null)
			}) : null));
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* @dsh-market/plugin client half：
		*  - sidebar.footer.action 注册「插件市场」入口按钮
		*  - shell.overlay 注册市场面板（4-tab：推荐/搜索/已装/设置）
		* 面板开关状态统一走 store.ts（跨 slot 共享）。
		*/
		/** 入口按钮：侧边栏底部「设置」旁的图标按钮 */
		function MarketTrigger(props) {
			const open = (0, react.useSyncExternalStore)(subscribe, getOpen, getOpen);
			return (0, react.createElement)("button", {
				className: styles_module_css_default.trigger,
				onClick: toggle,
				title: "插件市场",
				"aria-label": "插件市场",
				"data-active": open || void 0
			}, (0, react.createElement)("span", {
				className: styles_module_css_default.triggerIcon,
				"aria-hidden": true
			}, "🧩"), props.wide ? (0, react.createElement)("span", { className: styles_module_css_default.triggerLabel }, "插件市场") : null);
		}
		const inject = ["slots"];
		function apply(ctx) {
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "dsh-market",
				order: 5,
				label: "插件市场"
			}, (props) => (0, react.createElement)(MarketTrigger, { wide: props.wide })));
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({
				name: "shell.overlay",
				id: "dsh-market-panel",
				order: 10
			}, () => (0, react.createElement)(MarketPanel, { onClose: () => setOpen(false) })));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map