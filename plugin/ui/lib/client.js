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
		//#region src/client/logo.tsx
		/**
		* DSH Market 插件端 Logo（方向 A：纯黑剪影 + 眼睛镂空点，适配侧边栏）
		* - 单色剪影：fill 用 currentColor（由使用处设置颜色）
		* - 眼睛点：fill 用背景色（eyeColor，默认侧边栏背景 token），形成镂空感
		* - 深色/浅色底自适应：使用处控制 color 与 eyeColor
		*/
		function MarketLogo(props) {
			const { size = 22, color = "currentColor", eyeColor = "var(--dsw-specific-sidebar-fill, #EDEDF0)" } = props;
			return (0, react.createElement)("svg", {
				width: size,
				height: size,
				viewBox: "14 8 98 102",
				"aria-label": "DSH Market",
				style: { display: "block" }
			}, (0, react.createElement)("g", { transform: "translate(60 62) scale(1.35) translate(-60 -62)" }, (0, react.createElement)("path", {
				d: "M51 42 C52 36 56 32 61 32 C60 37 60 40 60 42 Z",
				fill: color
			}), (0, react.createElement)("path", {
				d: "M83 62 C87 57 93 55 97 56 C94 59 91 61 88 62 C91 65 91 69 88 70 C90 66 87 63 83 62 Z",
				fill: color
			}), (0, react.createElement)("g", { fill: color }, (0, react.createElement)("path", { d: "M38 42 h44 a6 6 0 0 1 6 6 v8 h-14 a8 8 0 1 0 -16 0 h-20 a6 6 0 0 1 -6 -6 v-2 a6 6 0 0 1 6 -6 z" }), (0, react.createElement)("rect", {
				x: "38",
				y: "60",
				width: "8",
				height: "14",
				rx: "4"
			}), (0, react.createElement)("rect", {
				x: "50",
				y: "66",
				width: "8",
				height: "18",
				rx: "4"
			}), (0, react.createElement)("rect", {
				x: "62",
				y: "60",
				width: "8",
				height: "14",
				rx: "4"
			})), (0, react.createElement)("circle", {
				cx: "60",
				cy: "46",
				r: "2.8",
				fill: eyeColor
			})));
		}
		//#endregion
		//#region \0dsh-css:E:\wm\tool\lader\plugin\ui\src\client\styles.module.css.mjs
		const css = "*{box-sizing:border-box}:root{--mkt-text:#252525;--mkt-text2:#5f6670;--mkt-text3:#8a919f;--mkt-brand:#4d6bfe;--mkt-brand-strong:#2e4bd8;--mkt-brand-tint:#eaf2fb;--mkt-brand-soft:#c9d4f5;--mkt-border:#e5e7eb;--mkt-border-strong:#d4d7dc;--mkt-divider:#eef0f2;--mkt-selected:#f3f4f6;--mkt-hover:#edeef1;--mkt-bg:#f6f8fb;--mkt-inverse:#252525;--mkt-surface-a:#fff;--mkt-surface-b:#fff;--mkt-surface-c:#fff;--mkt-chip-warn-bg:#fef7e7;--mkt-chip-warn-text:#a97f1f;--mkt-chip-gold-bg:#fef3e2;--mkt-chip-gold-border:#f0d9a8;--mkt-chip-gold-text:#b45309;--mkt-chip-green-bg:#e8f6ee;--mkt-chip-green-border:#bfe3cd;--mkt-chip-green-text:#15803d;--mkt-chip-red-bg:#fdeaea;--mkt-chip-red-border:#f5c6c6;--mkt-chip-red-text:#b91c1c;--mkt-text-ok:#22c55e;--mkt-text-danger:#ef4444;--mkt-rate-ok:#1e7a46;--mkt-rate-warn:#b26a00;--mkt-rate-danger:#b33a3a;--mkt-purple:#7c3aed;--mkt-purple-bg:#f3efff}[data-slot=\"sidebar.footer.action\"]{flex-wrap:wrap;row-gap:4px;width:100%;display:flex!important}._LI32q_trigger{width:100%;min-height:34px;color:var(--dsw-alias-label-primary,var(--mkt-text));cursor:pointer;box-sizing:border-box;background:0 0;border:none;border-radius:8px;flex:0 0 100%;justify-content:flex-start;align-items:center;gap:8px;padding:0 12px;font-size:13px;display:flex}._LI32q_trigger:hover{color:var(--dsw-alias-label-primary,var(--mkt-text));background:var(--dsw-alias-interactive-bg-hover,var(--mkt-hover))}._LI32q_trigger[data-active]{color:var(--mkt-brand);background:var(--mkt-hover)}@media (prefers-color-scheme:dark){._LI32q_trigger{color:#e8eaed}._LI32q_trigger:hover{color:#fff;background:#ffffff1a}}._LI32q_triggerIcon{justify-content:center;align-items:center;line-height:1;display:inline-flex}._LI32q_triggerIcon svg{flex:none;width:16px;height:16px}._LI32q_triggerLabel{white-space:nowrap}._LI32q_backdrop{z-index:100;pointer-events:auto;background:0 0;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}._LI32q_panel{pointer-events:auto;width:560px;max-width:94vw;height:720px;max-height:92vh;color:var(--mkt-text);-webkit-font-smoothing:antialiased;background:#fff;border:1px solid #e5e7eb;border-radius:14px;flex-direction:column;font-family:-apple-system,BlinkMacSystemFont,PingFang SC,Noto Sans SC,Microsoft YaHei,Helvetica Neue,Arial,sans-serif;font-size:13px;display:flex;position:relative;overflow:hidden;box-shadow:0 8px 40px #00000024,0 2px 8px #00000014}._LI32q_header{border-bottom:1px solid #eef0f2;flex:none;align-items:center;gap:10px;padding:14px 16px 12px;display:flex}._LI32q_titleIcon{align-items:center;display:flex}._LI32q_titleIcon>svg{color:#4d6bfe;width:24px;height:24px}._LI32q_title{font-size:15px;font-weight:600}._LI32q_subtitle{color:var(--mkt-brand-strong);background:#eaf2fb;border-radius:10px;padding:2px 8px;font-size:11.5px;font-weight:500}._LI32q_headerClose{cursor:pointer;color:#8a919f;background:0 0;border:none;border-radius:7px;justify-content:center;align-items:center;width:28px;height:28px;margin-left:auto;transition:background-color .14s;display:flex}._LI32q_headerClose:hover{color:var(--mkt-text);background:#f3f4f6}._LI32q_headerClose svg{width:16px;height:16px}._LI32q_tabs{border-bottom:1px solid #eef0f2;flex:none;gap:2px;padding:0 12px;display:flex}._LI32q_tab{color:var(--mkt-text2);cursor:pointer;white-space:nowrap;background:0 0;border:none;margin:0 8px;padding:10px 4px;font-size:13px;position:relative}._LI32q_tab:hover{color:var(--mkt-text)}._LI32q_tabOn{color:var(--mkt-text);font-weight:600}._LI32q_tabOn:after{content:\"\";background:#4d6bfe;border-radius:2px;height:2px;position:absolute;bottom:-1px;left:0;right:0}._LI32q_body{scrollbar-width:thin;scrollbar-color:var(--mkt-border-strong) transparent;flex:1;min-height:0;padding:16px 16px 20px;overflow-y:auto}._LI32q_body::-webkit-scrollbar{width:6px}._LI32q_body::-webkit-scrollbar-thumb{background:var(--mkt-border-strong);border-radius:3px}._LI32q_body::-webkit-scrollbar-track{background:0 0}._LI32q_tabBody,._LI32q_section{flex-direction:column;display:flex}._LI32q_sectionHead{align-items:center;gap:7px;margin:20px 0 10px;display:flex}._LI32q_section:first-child>._LI32q_sectionHead{margin-top:2px}._LI32q_sectionIcon{color:#8a919f;flex:none;align-items:center;display:flex}._LI32q_sectionIcon>svg{width:14px;height:14px}._LI32q_sectionTitle{color:var(--mkt-text);margin:0;font-size:14px;font-weight:600}._LI32q_sectionNote{color:#8a919f;margin-left:auto;font-size:12px}._LI32q_btn{color:var(--mkt-text);cursor:pointer;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:6px 14px;font-family:inherit;font-size:12.5px;font-weight:500;transition:background-color .14s,border-color .14s,box-shadow .14s;box-shadow:0 1px 3px #0000000f}._LI32q_btn:hover{border-color:var(--mkt-border-strong);background:#f3f4f6}._LI32q_btn:disabled{opacity:.5;cursor:not-allowed}._LI32q_btnPrimary{color:#fff;background:#4d6bfe;border-color:#4d6bfe;box-shadow:0 1px 3px #4d6bfe59}._LI32q_btnPrimary:hover{background:var(--mkt-brand-strong);border-color:var(--mkt-brand-strong)}._LI32q_btnPrimary:disabled{opacity:.5;cursor:not-allowed}._LI32q_btnGhost{box-shadow:none;color:var(--mkt-text2);border-color:#0000}._LI32q_btnGhost:hover{color:var(--mkt-text);background:#f3f4f6}._LI32q_btnSm{padding:4px 11px;font-size:12px}._LI32q_btnDanger{color:var(--mkt-text-danger);border-color:#f3c8c8}._LI32q_btnDanger:hover{background:#fdeeee;border-color:#f3c8c8}._LI32q_card{cursor:default;background:#fff;border:1px solid #e5e7eb;border-radius:11px;flex-direction:column;min-width:0;padding:14px;transition:box-shadow .15s,transform .15s,border-color .15s;display:flex;overflow:hidden;box-shadow:0 1px 3px #0000000f}._LI32q_card:hover{border-color:var(--mkt-border-strong);transform:translateY(-1px);box-shadow:0 2px 8px #0000001a}._LI32q_cardHead{align-items:center;gap:8px;display:flex}._LI32q_cardName{color:var(--mkt-text);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;overflow:hidden}._LI32q_cardBadge{color:var(--mkt-brand-strong);background:#eaf2fb;border-radius:10px;flex:none;padding:1px 7px;font-size:11.5px;font-weight:500}._LI32q_cardStars{color:var(--mkt-text2);flex:none;align-items:center;gap:4px;margin-left:auto;font-size:12px;display:flex}._LI32q_cardStars>svg{color:#f59e0b;width:13px;height:13px}._LI32q_cardDesc{color:var(--mkt-text2);-webkit-line-clamp:3;-webkit-box-orient:vertical;margin:8px 0 9px;font-size:13px;line-height:1.55;display:-webkit-box;overflow:hidden}._LI32q_cardTags,._LI32q_cardReasons{flex-wrap:wrap;gap:6px;margin-bottom:10px;display:flex}._LI32q_reason{color:var(--mkt-chip-green-text);background:#eef8f3;border-radius:8px;padding:2px 6px;font-size:11px}._LI32q_reasonAi{color:var(--mkt-brand-strong);background:#eaf2fb;border-radius:8px;padding:2px 6px;font-size:11px}._LI32q_cardActions{align-items:center;gap:6px;display:flex}._LI32q_spacer{margin-left:auto}._LI32q_needConfig{color:var(--mkt-chip-warn-text);font-size:11px}._LI32q_cardActionHint{color:#8a919f;text-align:right;margin-top:6px;font-size:11px}._LI32q_iconBtn{border:1px solid var(--mkt-border-strong);cursor:pointer;color:#8a919f;background:#fff;border-radius:7px;flex:none;justify-content:center;align-items:center;width:28px;height:28px;padding:0;transition:color .14s,border-color .14s,background-color .14s;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_iconBtn:hover{color:#4d6bfe;border-color:var(--mkt-brand-soft)}._LI32q_iconBtn:disabled{opacity:.5;cursor:not-allowed}._LI32q_iconBtn svg{width:15px;height:15px}._LI32q_iconBtnOn{color:#4d6bfe;border-color:var(--mkt-brand-soft)}._LI32q_favBtn{color:var(--mkt-text2);border:1px solid var(--mkt-border-strong);cursor:pointer;white-space:nowrap;background:#fff;border-radius:7px;justify-content:center;align-items:center;gap:4px;padding:4px 9px;font-family:inherit;font-size:12px;transition:color .14s,border-color .14s,background-color .14s;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_favBtn:hover{color:#4d6bfe;border-color:var(--mkt-brand-soft)}._LI32q_favBtnOn{color:#4d6bfe;border-color:var(--mkt-brand-soft);background:#eaf2fb}._LI32q_repoBtn{color:var(--mkt-text2);border:1px solid var(--mkt-border-strong);cursor:pointer;background:#fff;border-radius:7px;align-items:center;gap:5px;padding:4px 9px;font-family:inherit;font-size:12px;transition:color .14s,border-color .14s;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_repoBtn svg{width:13px;height:13px}._LI32q_repoBtn:hover{color:#4d6bfe;border-color:var(--mkt-brand-soft)}._LI32q_tag{color:#4a5460;cursor:pointer;user-select:none;background:#f3f4f6;border:none;border-radius:8px;padding:2px 6px;font-size:11px;transition:background-color .12s,color .12s}._LI32q_tag:hover{color:var(--mkt-brand-strong);background:#eaf2fb}._LI32q_tagOn{color:var(--mkt-brand-strong);background:#eaf2fb;font-weight:500}._LI32q_recommendToolbar{border:1px solid var(--mkt-brand-tint);background:#eaf2fb;border-radius:11px;align-items:center;gap:8px;margin-bottom:4px;padding:9px 12px;display:flex}._LI32q_recommendToolbarIcon{color:#4d6bfe;flex:none;align-items:center;display:flex}._LI32q_recommendToolbarIcon>svg{width:14px;height:14px}._LI32q_recommendHint{color:var(--mkt-text2);flex:1;font-size:12px;line-height:1.5}._LI32q_modeSwitchRow{margin-bottom:4px;display:flex}._LI32q_quizCard{background:#fff;border:1px solid #e5e7eb;border-radius:11px;flex-direction:column;margin-bottom:4px;padding:15px;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_quizHead{align-items:center;gap:8px;margin-bottom:4px;display:flex}._LI32q_quizHeadIcon{color:#4d6bfe;align-items:center;display:flex}._LI32q_quizHeadIcon>svg{width:16px;height:16px}._LI32q_quizTitle{flex:1;font-size:14px;font-weight:600}._LI32q_quizDesc{color:var(--mkt-text2);margin:0 0 12px;font-size:12px}._LI32q_quizTags{flex-wrap:wrap;gap:6px;margin-bottom:14px;display:flex}._LI32q_quizChip{color:var(--mkt-text2);cursor:pointer;user-select:none;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:5px 11px;font-size:12px;transition:all .14s}._LI32q_quizChip:hover{border-color:var(--mkt-brand-soft);color:#4d6bfe}._LI32q_quizChipOn{border-color:var(--mkt-brand-soft);color:var(--mkt-brand-strong);background:#eaf2fb;font-weight:500}._LI32q_quizActions{align-items:center;gap:8px;display:flex}._LI32q_quizCount{color:#8a919f;font-size:12px}._LI32q_quizCta{align-items:center;margin-left:auto;display:flex}._LI32q_quizCta ._LI32q_btnPrimary{padding:9px 14px;font-size:13px;font-weight:600}._LI32q_sceneList{flex-direction:column;gap:0;display:flex}._LI32q_sceneRow{border:1px solid #e5e7eb;border-radius:11px;align-items:center;gap:10px;margin-bottom:9px;padding:12px 13px;transition:box-shadow .15s,transform .15s;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_sceneRow:hover{transform:translateY(-1px);box-shadow:0 2px 8px #0000001a}._LI32q_sceneInfo{flex:1;min-width:0}._LI32q_sceneName{margin-bottom:3px;font-size:13.5px;font-weight:600}._LI32q_sceneDesc{color:var(--mkt-text2);font-size:12px;line-height:1.5}._LI32q_sceneHint{color:#8a919f;font-size:12px}._LI32q_sceneEmpty{color:#8a919f;border:1px solid #e5e7eb;border-radius:11px;margin:0;padding:12px 13px;font-size:12px}._LI32q_stateHint{text-align:center;color:#8a919f;padding:24px 12px;font-size:12px}._LI32q_installedNote{color:#8a919f;margin-top:8px;font-size:11px}._LI32q_grid2{grid-template-columns:1fr 1fr;align-items:start;gap:12px;display:grid}._LI32q_grid2>*{min-width:0;max-width:100%}@media (width<=480px){._LI32q_grid2{grid-template-columns:1fr}}._LI32q_searchWrap{margin-bottom:14px;position:relative}._LI32q_searchWrapIcon{color:#8a919f;pointer-events:none;align-items:center;width:15px;height:15px;display:flex;position:absolute;top:50%;left:11px;transform:translateY(-50%)}._LI32q_searchWrapIcon>svg{width:15px;height:15px}._LI32q_searchInput{border:1px solid var(--mkt-border-strong);width:100%;height:38px;color:var(--mkt-text);background:#fff;border-radius:10px;outline:none;padding:0 34px;font-family:inherit;font-size:13px;transition:border-color .16s,box-shadow .16s}._LI32q_searchInput::placeholder{color:var(--mkt-text2)}._LI32q_searchInput:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe24}._LI32q_searchClear{cursor:pointer;color:#8a919f;background:0 0;border:none;border-radius:5px;justify-content:center;align-items:center;width:20px;height:20px;padding:0;display:flex;position:absolute;top:50%;right:9px;transform:translateY(-50%)}._LI32q_searchClear:hover{background:#f3f4f6}._LI32q_searchClear svg{width:13px;height:13px}._LI32q_filterRow{flex-wrap:wrap;gap:6px;margin-bottom:14px;display:flex}._LI32q_filterChip{color:var(--mkt-text2);cursor:pointer;user-select:none;background:#fff;border:1px solid #e5e7eb;border-radius:13px;padding:4px 11px;font-size:12px;transition:all .14s}._LI32q_filterChip:hover{color:#4d6bfe;border-color:var(--mkt-brand-soft)}._LI32q_filterChipOn{border-color:var(--mkt-brand-soft);color:var(--mkt-brand-strong);background:#eaf2fb;font-weight:500}._LI32q_semanticToggle{background:#fff;border:1px solid #e5e7eb;border-radius:11px;align-items:center;gap:9px;margin-bottom:14px;padding:9px 12px;display:flex}._LI32q_semanticInfo{flex:1}._LI32q_semanticTitle{align-items:center;gap:6px;font-size:13px;font-weight:600;display:flex}._LI32q_semanticPill{color:#8a919f;border:1px solid #e5e7eb;border-radius:9px;padding:0 6px;font-size:10px;font-weight:500}._LI32q_semanticDesc{color:#8a919f;margin-top:2px;font-size:12px}._LI32q_semanticSwitch{background:var(--mkt-border-strong);cursor:not-allowed;opacity:.7;border-radius:10px;flex:none;width:34px;height:20px;position:relative}._LI32q_semanticSwitch:after{content:\"\";background:#fff;border-radius:50%;width:16px;height:16px;position:absolute;top:2px;left:2px;box-shadow:0 1px 2px #0003}._LI32q_hotTagsTitle{color:#8a919f;margin-bottom:8px;font-size:12px}._LI32q_tagCloud{flex-wrap:wrap;gap:6px;padding:0;display:flex}._LI32q_hotTag{color:var(--mkt-text2);cursor:pointer;user-select:none;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:5px 11px;font-size:12px;transition:all .14s}._LI32q_hotTag:hover{border-color:var(--mkt-brand-soft);color:#4d6bfe}._LI32q_hotTagOn{border-color:var(--mkt-brand-soft);color:var(--mkt-brand-strong);background:#eaf2fb;font-weight:500}._LI32q_tagMoreRow{margin:2px 0 4px}._LI32q_results{grid-template-columns:1fr 1fr;align-items:start;gap:12px;display:grid}._LI32q_results>*{min-width:0;max-width:100%}@media (width<=480px){._LI32q_results{grid-template-columns:1fr}}._LI32q_resultCount{color:var(--mkt-text2);margin:2px 0 10px;font-size:12px}._LI32q_resultCount b{color:var(--mkt-text)}._LI32q_loadMoreRow{text-align:center;margin:14px 0 6px}._LI32q_loadMore{color:var(--mkt-text);cursor:pointer;background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:6px 14px;font-family:inherit;font-size:12.5px;font-weight:500;transition:background-color .14s,border-color .14s;box-shadow:0 1px 3px #0000000f}._LI32q_loadMore:hover{border-color:var(--mkt-border-strong);background:#f3f4f6}._LI32q_semanticResult{color:#8a919f;flex-wrap:wrap;align-items:center;gap:5px;font-size:12px;display:flex}._LI32q_emptyState{text-align:center;padding:56px 20px}._LI32q_emptyIcon{color:var(--mkt-border-strong);justify-content:center;margin-bottom:12px;display:flex}._LI32q_emptyIcon>svg{width:44px;height:44px}._LI32q_emptyTitle{color:var(--mkt-text);margin-bottom:5px;font-size:14px;font-weight:600}._LI32q_emptyDesc{color:#8a919f;margin-bottom:16px;font-size:12px}._LI32q_installedRow{border:1px solid #e5e7eb;border-radius:11px;align-items:flex-start;gap:11px;margin-bottom:9px;padding:13px;transition:box-shadow .15s,transform .15s;display:flex;box-shadow:0 1px 3px #0000000f}._LI32q_installedRow:hover{transform:translateY(-1px);box-shadow:0 2px 8px #0000001a}._LI32q_installedInfo{flex:1;min-width:0}._LI32q_installedHead{align-items:center;gap:8px;display:flex}._LI32q_installedName{color:var(--mkt-text);text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;overflow:hidden}._LI32q_installedMeta{color:#8a919f;margin-top:3px;font-size:12px}._LI32q_installedActions{flex-direction:column;flex:none;gap:6px;display:flex}._LI32q_unmatched{flex-wrap:wrap;gap:5px;margin-top:8px;display:flex}._LI32q_unmatchedChip{background:var(--mkt-chip-warn-bg);color:var(--mkt-chip-warn-text);border:1px dashed #e3c997;border-radius:10px;padding:3px 8px;font-size:11.5px}._LI32q_unmatchedMore{color:#8a919f;align-self:center;font-size:11px}._LI32q_updateChip{background:var(--mkt-chip-gold-bg);border:1px solid var(--mkt-chip-gold-border);color:var(--mkt-chip-gold-text);border-radius:10px;margin-top:5px;padding:1px 8px;font-size:11.5px;font-weight:500;display:inline-block}._LI32q_latestChip{background:var(--mkt-chip-green-bg);border:1px solid var(--mkt-chip-green-border);color:var(--mkt-chip-green-text);border-radius:10px;margin-top:5px;padding:1px 8px;font-size:11.5px;font-weight:500;display:inline-block}._LI32q_updateHint{color:#8a919f;margin-top:5px;font-size:11.5px}._LI32q_activationChip{color:#4d6bfe;background:#eef2ff;border:1px solid #d6defa;border-radius:10px;margin-top:5px;padding:1px 8px;font-size:11.5px;font-weight:500;display:inline-block}._LI32q_activationLive{background:var(--mkt-chip-green-bg);border:1px solid var(--mkt-chip-green-border);color:var(--mkt-chip-green-text)}._LI32q_activationBroken{background:var(--mkt-chip-red-bg);border:1px solid var(--mkt-chip-red-border);color:var(--mkt-chip-red-text)}._LI32q_activationInert{border:1px solid var(--mkt-border-strong);color:#6b7280;background:#f3f4f6}._LI32q_selfUpdateBar{background:var(--mkt-chip-gold-bg);border:1px solid var(--mkt-chip-gold-border);color:var(--mkt-chip-gold-text);border-radius:10px;align-items:center;gap:8px;margin:0 14px 10px;padding:8px 12px;font-size:12px;display:flex}._LI32q_selfUpdateText{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}._LI32q_settingCard{background:#fff;border:1px solid #e5e7eb;border-radius:11px;margin-bottom:12px;padding:15px;box-shadow:0 1px 3px #0000000f}._LI32q_settingHead{align-items:center;gap:8px;margin-bottom:10px;display:flex}._LI32q_settingIc{color:#4d6bfe;background:#f3f4f6;border-radius:8px;flex:none;justify-content:center;align-items:center;width:26px;height:26px;display:flex}._LI32q_settingIc>svg{width:15px;height:15px}._LI32q_settingTitle{font-size:14px;font-weight:600}._LI32q_versionRow{border-top:1px solid #eef0f2;align-items:center;gap:8px;margin-top:10px;padding-top:10px;display:flex}._LI32q_versionLabel{color:var(--mkt-text2);flex:none;font-size:12px}._LI32q_versionCode{color:var(--mkt-text);background:#f3f4f6;border:1px solid #e5e7eb;border-radius:6px;padding:2px 8px;font-family:ui-monospace,Menlo,monospace;font-size:12px}._LI32q_settingStatus{border-radius:9px;margin-left:auto;padding:2px 8px;font-size:11.5px}._LI32q_statusOk{color:var(--mkt-text-ok);background:#eef8f3}._LI32q_statusOff{color:#8a919f;background:#f3f4f6}._LI32q_statusWarn{background:var(--mkt-chip-warn-bg);color:var(--mkt-chip-warn-text)}._LI32q_settingsRow{align-items:center;gap:8px;display:flex}._LI32q_settingsLabel{color:var(--mkt-text2);white-space:nowrap;font-size:12px}._LI32q_ghTip{color:var(--mkt-text2);margin:0;font-size:12px;line-height:1.7}._LI32q_ghLink{color:#4d6bfe;align-items:center;gap:2px;text-decoration:none;display:inline-flex}._LI32q_ghLink:hover{text-decoration:underline}._LI32q_ghLogin{flex:1;font-size:13px;font-weight:600}._LI32q_ghRow{align-items:center;gap:8px;display:flex}._LI32q_deviceFlow{color:var(--mkt-text2);background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;flex-direction:column;gap:6px;padding:9px 11px;font-size:12px;display:flex}._LI32q_deviceCode{letter-spacing:2px;color:#4d6bfe;background:#fff;border-radius:6px;align-self:flex-start;padding:4px 8px;font-family:ui-monospace,Menlo,monospace;font-size:18px;font-weight:700}._LI32q_ghPollState{color:var(--mkt-text2);margin:0;font-size:12px}._LI32q_deviceFlow a{color:#4d6bfe}._LI32q_deviceFlowTip{color:#8a919f;margin:0;font-size:11.5px;line-height:1.6}._LI32q_ghDone{color:var(--mkt-text-ok);align-items:center;font-weight:500;display:inline-flex}._LI32q_field{margin-bottom:11px}._LI32q_fieldRow{gap:8px;display:flex}._LI32q_fieldRow>._LI32q_field{flex:1;margin-bottom:0}._LI32q_fieldLabel{color:var(--mkt-text2);margin-bottom:5px;font-size:12px;display:block}._LI32q_input,._LI32q_select{border:1px solid var(--mkt-border-strong);width:100%;height:34px;color:var(--mkt-text);background:#fff;border-radius:9px;outline:none;padding:0 10px;font-family:inherit;font-size:13px;transition:border-color .16s,box-shadow .16s}._LI32q_input:focus,._LI32q_select:focus{border-color:#4d6bfe;box-shadow:0 0 0 3px #4d6bfe24}._LI32q_input::placeholder{color:var(--mkt-text2)}._LI32q_error{color:var(--mkt-text-danger);margin:0;font-size:12px}._LI32q_warn{color:var(--mkt-chip-warn-text);align-items:center;margin:0;font-size:12px;display:flex}._LI32q_dividerLine{background:#eef0f2;height:1px;margin:13px 0}._LI32q_inlineIcon{vertical-align:-2px;flex:none;margin-right:4px;display:inline-block}._LI32q_modalBackdrop{z-index:120;background:#14161c6b;justify-content:center;align-items:center;display:flex;position:fixed;inset:0}._LI32q_modal{background:#fff;border-radius:14px;flex-direction:column;width:420px;max-width:92vw;padding:20px 22px;display:flex;overflow:hidden;box-shadow:0 12px 50px #0000003d}._LI32q_modalHead{justify-content:space-between;align-items:center;margin-bottom:12px;display:flex}._LI32q_modalTitle{font-size:15px;font-weight:600}._LI32q_modalClose{cursor:pointer;color:#8a919f;background:0 0;border:none;border-radius:7px;justify-content:center;align-items:center;width:28px;height:28px;padding:0;transition:background-color .14s;display:flex}._LI32q_modalClose:hover{color:var(--mkt-text);background:#f3f4f6}._LI32q_modalClose svg{width:16px;height:16px}._LI32q_modalBody{flex-direction:column;gap:10px;display:flex}._LI32q_modalDesc{color:var(--mkt-text2);margin:0;font-size:12.5px;line-height:1.6}._LI32q_modalActions{justify-content:flex-end;gap:8px;margin-top:8px;display:flex}._LI32q_modalSuccess{text-align:center;flex-direction:column;justify-content:center;align-items:center;gap:10px;display:flex}._LI32q_modalSuccessIcon{width:44px;height:44px;color:var(--mkt-text-ok);background:#eef8f3;border-radius:50%;justify-content:center;align-items:center;margin:0 auto;display:flex}._LI32q_modalSuccessIcon>svg{width:22px;height:22px}._LI32q_modalSuccessTitle{color:var(--mkt-text);font-size:14px;font-weight:600}._LI32q_modalError{color:var(--mkt-text-danger);word-break:break-all;align-items:center;font-size:13px;font-weight:600;display:flex}._LI32q_loading{text-align:center;color:#8a919f;padding:20px;font-size:12px}._LI32q_advanced{margin-top:2px}._LI32q_advanced summary{cursor:pointer;color:#8a919f;user-select:none;font-size:11px}._LI32q_advancedTip{color:#8a919f;margin:6px 0 0;font-size:11px;line-height:1.5}._LI32q_advancedCmd{color:var(--mkt-text2);white-space:pre-wrap;word-break:break-all;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:8px;margin-top:6px;padding:9px 11px;font-family:ui-monospace,Menlo,monospace;font-size:12px;line-height:1.6;display:block}._LI32q_steps{align-items:center;margin-bottom:18px;display:flex}._LI32q_step{color:#8a919f;flex:1;align-items:center;gap:7px;font-size:12px;display:flex;position:relative}._LI32q_stepDot{border:1.5px solid var(--mkt-border-strong);color:#8a919f;background:#fff;border-radius:50%;flex:none;justify-content:center;align-items:center;width:20px;height:20px;font-size:11.5px;transition:all .2s;display:flex}._LI32q_stepActive{color:var(--mkt-text)}._LI32q_stepActive ._LI32q_stepDot{color:#4d6bfe;border-color:#4d6bfe}._LI32q_stepDone{color:var(--mkt-text)}._LI32q_stepDone ._LI32q_stepDot{color:#fff;background:#4d6bfe;border-color:#4d6bfe}._LI32q_stepBar{background:var(--mkt-border-strong);border-radius:1px;flex:1;height:1.5px;margin:0 6px}._LI32q_stepBarDone{background:#4d6bfe}._LI32q_toast{background:var(--mkt-inverse);color:#fff;z-index:200;pointer-events:none;border-radius:8px;padding:8px 16px;font-size:12.5px;animation:.22s _LI32q_toastIn;position:fixed;bottom:24px;left:50%;transform:translate(-50%);box-shadow:0 4px 16px #0003}@keyframes _LI32q_toastIn{0%{opacity:0;transform:translate(-50%)translateY(10px)}to{opacity:1;transform:translate(-50%)translateY(0)}}@media (prefers-color-scheme:dark){:root{--mkt-text:#e8eaed;--mkt-text2:#b3bac4;--mkt-text3:#a6aeba;--mkt-brand:#6d8bff;--mkt-brand-strong:#8aa5ff;--mkt-brand-tint:#6d8bff1a;--mkt-brand-soft:#6d8bff3d;--mkt-border:#2a2e36;--mkt-border-strong:#3a3f49;--mkt-divider:#262a31;--mkt-selected:#2e323a;--mkt-hover:#2a2e35;--mkt-bg:#171a1f;--mkt-inverse:#31353d;--mkt-surface-a:#1b1e24;--mkt-surface-b:#21252c;--mkt-surface-c:#262a32;--mkt-chip-warn-bg:#b4530929;--mkt-chip-warn-text:#fbbf24;--mkt-chip-gold-bg:#d9770629;--mkt-chip-gold-border:#d9770659;--mkt-chip-gold-text:#fbbf24;--mkt-chip-green-bg:#22c55e21;--mkt-chip-green-border:#22c55e4d;--mkt-chip-green-text:#4ade80;--mkt-chip-red-bg:#ef444421;--mkt-chip-red-border:#ef44444d;--mkt-chip-red-text:#f87171;--mkt-text-ok:#4ade80;--mkt-text-danger:#f87171;--mkt-rate-ok:#4ade80;--mkt-rate-warn:#fbbf24;--mkt-rate-danger:#f87171;--mkt-purple:#a78bfa;--mkt-purple-bg:#7c3aed29}._LI32q_panel{color-scheme:dark;box-shadow:0 8px 32px #00000080}}:root[style*=\"color-scheme: dark\"]{--mkt-text:#e8eaed;--mkt-text2:#9aa1a8;--mkt-text3:#8b93a1;--mkt-brand:#6d8bff;--mkt-brand-strong:#8aa5ff;--mkt-brand-tint:#6d8bff1a;--mkt-brand-soft:#6d8bff3d;--mkt-border:#2a2e36;--mkt-border-strong:#3a3f49;--mkt-divider:#262a31;--mkt-selected:#2e323a;--mkt-hover:#2a2e35;--mkt-bg:#171a1f;--mkt-inverse:#31353d;--mkt-surface-a:#1b1e24;--mkt-surface-b:#21252c;--mkt-surface-c:#262a32;--mkt-chip-warn-bg:#b4530929;--mkt-chip-warn-text:#fbbf24;--mkt-chip-gold-bg:#d9770629;--mkt-chip-gold-border:#d9770659;--mkt-chip-gold-text:#fbbf24;--mkt-chip-green-bg:#22c55e21;--mkt-chip-green-border:#22c55e4d;--mkt-chip-green-text:#4ade80;--mkt-chip-red-bg:#ef444421;--mkt-chip-red-border:#ef44444d;--mkt-chip-red-text:#f87171;--mkt-text-ok:#4ade80;--mkt-text-danger:#f87171;--mkt-rate-ok:#4ade80;--mkt-rate-warn:#fbbf24;--mkt-rate-danger:#f87171;--mkt-purple:#a78bfa;--mkt-purple-bg:#7c3aed29}:root[style*=\"color-scheme: dark\"] ._LI32q_panel{color-scheme:dark;box-shadow:0 8px 32px #00000080}:root[style*=\"color-scheme: dark\"] ._LI32q_trigger{color:#e8eaed}:root[style*=\"color-scheme: dark\"] ._LI32q_trigger:hover{color:#fff;background:#ffffff1a}:root[style*=\"color-scheme: dark\"] ._LI32q_trigger[data-active]{color:var(--mkt-brand);background:var(--mkt-hover)}._LI32q_panel{background:var(--mkt-surface-a)}._LI32q_card,._LI32q_settingCard,._LI32q_quizCard,._LI32q_modal{background:var(--mkt-surface-b)}._LI32q_btn,._LI32q_iconBtn,._LI32q_favBtn,._LI32q_repoBtn,._LI32q_quizChip,._LI32q_searchInput,._LI32q_filterChip,._LI32q_semanticToggle,._LI32q_semanticSwitch,._LI32q_hotTag,._LI32q_loadMore,._LI32q_deviceCode,._LI32q_select,._LI32q_stepDot{background:var(--mkt-surface-c)}";
		const tagId = "@dsh-market/plugin/styles.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@dsh-market/plugin";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var styles_module_css_default = {
			"ghTip": "_LI32q_ghTip",
			"filterChipOn": "_LI32q_filterChipOn",
			"inlineIcon": "_LI32q_inlineIcon",
			"modalBackdrop": "_LI32q_modalBackdrop",
			"modalSuccessIcon": "_LI32q_modalSuccessIcon",
			"ghLogin": "_LI32q_ghLogin",
			"stepDone": "_LI32q_stepDone",
			"recommendHint": "_LI32q_recommendHint",
			"triggerLabel": "_LI32q_triggerLabel",
			"searchWrap": "_LI32q_searchWrap",
			"unmatched": "_LI32q_unmatched",
			"stepBar": "_LI32q_stepBar",
			"field": "_LI32q_field",
			"cardDesc": "_LI32q_cardDesc",
			"reasonAi": "_LI32q_reasonAi",
			"tag": "_LI32q_tag",
			"iconBtn": "_LI32q_iconBtn",
			"semanticSwitch": "_LI32q_semanticSwitch",
			"settingCard": "_LI32q_settingCard",
			"panel": "_LI32q_panel",
			"stepDot": "_LI32q_stepDot",
			"btnSm": "_LI32q_btnSm",
			"installedNote": "_LI32q_installedNote",
			"resultCount": "_LI32q_resultCount",
			"emptyIcon": "_LI32q_emptyIcon",
			"unmatchedMore": "_LI32q_unmatchedMore",
			"quizCount": "_LI32q_quizCount",
			"btnGhost": "_LI32q_btnGhost",
			"activationInert": "_LI32q_activationInert",
			"statusWarn": "_LI32q_statusWarn",
			"tagMoreRow": "_LI32q_tagMoreRow",
			"modal": "_LI32q_modal",
			"searchWrapIcon": "_LI32q_searchWrapIcon",
			"sceneDesc": "_LI32q_sceneDesc",
			"tabOn": "_LI32q_tabOn",
			"semanticDesc": "_LI32q_semanticDesc",
			"body": "_LI32q_body",
			"deviceFlow": "_LI32q_deviceFlow",
			"searchClear": "_LI32q_searchClear",
			"modalSuccessTitle": "_LI32q_modalSuccessTitle",
			"fieldRow": "_LI32q_fieldRow",
			"tabBody": "_LI32q_tabBody",
			"select": "_LI32q_select",
			"cardBadge": "_LI32q_cardBadge",
			"updateChip": "_LI32q_updateChip",
			"activationBroken": "_LI32q_activationBroken",
			"settingStatus": "_LI32q_settingStatus",
			"modalHead": "_LI32q_modalHead",
			"hotTag": "_LI32q_hotTag",
			"triggerIcon": "_LI32q_triggerIcon",
			"semanticInfo": "_LI32q_semanticInfo",
			"loadMore": "_LI32q_loadMore",
			"btnPrimary": "_LI32q_btnPrimary",
			"tab": "_LI32q_tab",
			"iconBtnOn": "_LI32q_iconBtnOn",
			"stepActive": "_LI32q_stepActive",
			"cardHead": "_LI32q_cardHead",
			"sectionHead": "_LI32q_sectionHead",
			"installedMeta": "_LI32q_installedMeta",
			"modalClose": "_LI32q_modalClose",
			"ghPollState": "_LI32q_ghPollState",
			"warn": "_LI32q_warn",
			"subtitle": "_LI32q_subtitle",
			"settingTitle": "_LI32q_settingTitle",
			"advanced": "_LI32q_advanced",
			"quizCta": "_LI32q_quizCta",
			"toast": "_LI32q_toast",
			"recommendToolbar": "_LI32q_recommendToolbar",
			"quizCard": "_LI32q_quizCard",
			"sceneEmpty": "_LI32q_sceneEmpty",
			"loadMoreRow": "_LI32q_loadMoreRow",
			"versionCode": "_LI32q_versionCode",
			"settingsRow": "_LI32q_settingsRow",
			"modalSuccess": "_LI32q_modalSuccess",
			"backdrop": "_LI32q_backdrop",
			"quizActions": "_LI32q_quizActions",
			"header": "_LI32q_header",
			"sceneRow": "_LI32q_sceneRow",
			"versionRow": "_LI32q_versionRow",
			"quizChipOn": "_LI32q_quizChipOn",
			"selfUpdateText": "_LI32q_selfUpdateText",
			"stateHint": "_LI32q_stateHint",
			"statusOk": "_LI32q_statusOk",
			"hotTagOn": "_LI32q_hotTagOn",
			"emptyTitle": "_LI32q_emptyTitle",
			"cardActions": "_LI32q_cardActions",
			"semanticPill": "_LI32q_semanticPill",
			"activationChip": "_LI32q_activationChip",
			"modalError": "_LI32q_modalError",
			"emptyState": "_LI32q_emptyState",
			"steps": "_LI32q_steps",
			"sceneName": "_LI32q_sceneName",
			"semanticTitle": "_LI32q_semanticTitle",
			"settingHead": "_LI32q_settingHead",
			"cardReasons": "_LI32q_cardReasons",
			"reason": "_LI32q_reason",
			"title": "_LI32q_title",
			"spacer": "_LI32q_spacer",
			"tagCloud": "_LI32q_tagCloud",
			"installedRow": "_LI32q_installedRow",
			"selfUpdateBar": "_LI32q_selfUpdateBar",
			"settingIc": "_LI32q_settingIc",
			"searchInput": "_LI32q_searchInput",
			"ghLink": "_LI32q_ghLink",
			"favBtn": "_LI32q_favBtn",
			"titleIcon": "_LI32q_titleIcon",
			"quizDesc": "_LI32q_quizDesc",
			"dividerLine": "_LI32q_dividerLine",
			"modalDesc": "_LI32q_modalDesc",
			"filterRow": "_LI32q_filterRow",
			"activationLive": "_LI32q_activationLive",
			"headerClose": "_LI32q_headerClose",
			"loading": "_LI32q_loading",
			"sectionTitle": "_LI32q_sectionTitle",
			"semanticToggle": "_LI32q_semanticToggle",
			"sectionIcon": "_LI32q_sectionIcon",
			"results": "_LI32q_results",
			"unmatchedChip": "_LI32q_unmatchedChip",
			"cardName": "_LI32q_cardName",
			"sceneHint": "_LI32q_sceneHint",
			"installedHead": "_LI32q_installedHead",
			"error": "_LI32q_error",
			"installedActions": "_LI32q_installedActions",
			"deviceCode": "_LI32q_deviceCode",
			"quizTitle": "_LI32q_quizTitle",
			"advancedCmd": "_LI32q_advancedCmd",
			"modalBody": "_LI32q_modalBody",
			"tagOn": "_LI32q_tagOn",
			"step": "_LI32q_step",
			"tabs": "_LI32q_tabs",
			"card": "_LI32q_card",
			"favBtnOn": "_LI32q_favBtnOn",
			"grid2": "_LI32q_grid2",
			"filterChip": "_LI32q_filterChip",
			"installedName": "_LI32q_installedName",
			"quizHeadIcon": "_LI32q_quizHeadIcon",
			"emptyDesc": "_LI32q_emptyDesc",
			"modalTitle": "_LI32q_modalTitle",
			"sceneList": "_LI32q_sceneList",
			"statusOff": "_LI32q_statusOff",
			"cardTags": "_LI32q_cardTags",
			"cardActionHint": "_LI32q_cardActionHint",
			"modalActions": "_LI32q_modalActions",
			"stepBarDone": "_LI32q_stepBarDone",
			"quizTags": "_LI32q_quizTags",
			"quizHead": "_LI32q_quizHead",
			"latestChip": "_LI32q_latestChip",
			"settingsLabel": "_LI32q_settingsLabel",
			"input": "_LI32q_input",
			"hotTagsTitle": "_LI32q_hotTagsTitle",
			"toastIn": "_LI32q_toastIn",
			"ghRow": "_LI32q_ghRow",
			"btnDanger": "_LI32q_btnDanger",
			"ghDone": "_LI32q_ghDone",
			"deviceFlowTip": "_LI32q_deviceFlowTip",
			"advancedTip": "_LI32q_advancedTip",
			"repoBtn": "_LI32q_repoBtn",
			"recommendToolbarIcon": "_LI32q_recommendToolbarIcon",
			"sceneInfo": "_LI32q_sceneInfo",
			"section": "_LI32q_section",
			"updateHint": "_LI32q_updateHint",
			"trigger": "_LI32q_trigger",
			"btn": "_LI32q_btn",
			"quizChip": "_LI32q_quizChip",
			"semanticResult": "_LI32q_semanticResult",
			"sectionNote": "_LI32q_sectionNote",
			"versionLabel": "_LI32q_versionLabel",
			"cardStars": "_LI32q_cardStars",
			"needConfig": "_LI32q_needConfig",
			"modeSwitchRow": "_LI32q_modeSwitchRow",
			"installedInfo": "_LI32q_installedInfo",
			"fieldLabel": "_LI32q_fieldLabel"
		};
		//#endregion
		//#region src/client/panel.tsx
		/**
		* 插件市场面板（5-tab：推荐 / 搜索 / 收藏 / 已装 / 设置）
		* 数据全部来自 Host RPC（api.ts）。纯 React.createElement（无 JSX）。
		*/
		/** GitHub 设备流 client_id（dsh-market GitHub App，公开值非机密） */
		const GH_CLIENT_ID = "Iv23liYFieChYuBJklZp";
		const GH_TOKEN_KEY = "dsh-market:gh_token";
		const GH_LOGIN_KEY = "dsh-market:gh_login";
		const GH_METHOD_KEY = "dsh-market:gh_method";
		const FAVORITES_KEY = "dsh-market:favorites";
		/** 收藏列表（localStorage） */
		function readFavorites() {
			try {
				const raw = localStorage.getItem(FAVORITES_KEY);
				return raw ? JSON.parse(raw) : [];
			} catch {
				return [];
			}
		}
		function writeFavorites(list) {
			localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
		}
		function isFavorite(id) {
			return readFavorites().includes(id);
		}
		function toggleFavorite(id) {
			const list = readFavorites();
			const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
			writeFavorites(next);
			return next.includes(id);
		}
		/** 当前 GitHub token（浏览器 localStorage；设备流或 PAT） */
		function ghToken() {
			return localStorage.getItem(GH_TOKEN_KEY);
		}
		/** 绑定方式：device（GitHub App，不能 star）/ pat */
		function ghMethod() {
			return localStorage.getItem(GH_METHOD_KEY) ?? null;
		}
		/** 跨 tab 搜索词（标签点击 → 搜索 tab） */
		let searchSeed = "";
		function setSearchSeed(t) {
			searchSeed = t;
		}
		/** 聚合热门中文标签（问卷/搜索快捷入口共用） */
		function aggregateHotTags(plugins, n = 14) {
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
			return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);
		}
		let quizTriggered = false;
		function markQuizSubmitted() {
			quizTriggered = false;
		}
		function markQuizTriggered() {
			quizTriggered = true;
		}
		function fmtStars(n) {
			return n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
		}
		function El(tag, props, ...children) {
			return (0, react.createElement)(tag, props ?? {}, ...children);
		}
		/** P0-1 装后四态 → 中文短标签 */
		function activationText(a) {
			if (!a) return "";
			const label = {
				live: "已生效",
				restart: "重启后生效",
				inert: "未成为插件层",
				broken: "校验失败"
			}[a.state] ?? a.state;
			return a.reasons && a.reasons.length ? `${label}（${a.reasons[0]}）` : label;
		}
		/** P0-2 从安装/更新失败输出解析被拦构建包名 */
		function parseBlockedFromOutput(output, item) {
			const pkgs = (output.match(/Ignored build scripts\s*:\s*([^\n]*)/i)?.[1] ?? "").split(",").map((s) => s.trim().replace(/\.$/, "").replace(/@\d[\w.\-+]*$/, "")).filter(Boolean);
			if (pkgs.length === 0 && item.plugin) {
				const fallback = item.plugin.name.replace(/\.$/, "").trim();
				if (fallback) pkgs.push(fallback);
			}
			return [...new Set(pkgs)];
		}
		let toastTimer = null;
		function toast(msg, duration = 2200) {
			if (typeof document === "undefined") return;
			document.querySelectorAll("[data-dshm-toast]").forEach((n) => n.remove());
			if (toastTimer) clearTimeout(toastTimer);
			const el = document.createElement("div");
			el.setAttribute("data-dshm-toast", "");
			el.className = styles_module_css_default.toast;
			el.textContent = msg;
			document.body.appendChild(el);
			toastTimer = setTimeout(() => el.remove(), duration);
		}
		/** 通用线性图标：dangerouslySetInnerHTML 承载 path/circle 内容 */
		function Icon(props) {
			return El("svg", {
				viewBox: "0 0 24 24",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				width: props.size ?? 14,
				height: props.size ?? 14,
				className: props.className,
				dangerouslySetInnerHTML: { __html: props.d }
			});
		}
		/** 图标 path 集（与 design-ref/ui-redesign/direction-B-克制增强.html 一致） */
		const ICON_SCENE = "<path d=\"M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8\"/>";
		const ICON_HEART = "<path d=\"M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z\"/>";
		const ICON_AWARD = "<path d=\"M6 3h12l3 6-9 12L3 9l3-6z\"/><path d=\"M3 9h18M9 21l3-3 3 3\"/>";
		const ICON_CLOCK = "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M12 7v5l3 2\"/>";
		const ICON_LINK = "<path d=\"M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6v6\"/><path d=\"M10 14 20 4\"/>";
		const ICON_STAR = "<path d=\"M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z\"/>";
		const ICON_STAR_OUTLINE = "<path d=\"M12 3l2.4 5.6 6.1.5-4.6 4 1.4 6-5.3-3.3L6.7 19l1.4-6-4.6-4 6.1-.5z\"/>";
		const ICON_CLOSE = "<path d=\"M18 6 6 18M6 6l12 12\"/>";
		const ICON_CHECK = "<path d=\"M20 6 9 17l-5-5\"/>";
		const ICON_WARN = "<path d=\"M12 3l10 18H2z\"/><path d=\"M12 10v4M12 17h.01\"/>";
		const ICON_EXTERNAL = "<path d=\"M7 17 17 7M7 7h10v10\"/>";
		const ICON_HELP = "<circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M9 10a3 3 0 0 1 6 0c0 2-3 2.5-3 4\"/><path d=\"M12 17h.01\"/>";
		const ICON_MODE = "<path d=\"M12 3a9 9 0 1 0 9 9\"/><path d=\"M12 3a9 9 0 0 1 9 9\"/><path d=\"M12 12 21 3\"/>";
		const ICON_SEARCH = "<circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"m21 21-4.3-4.3\"/>";
		const ICON_GITHUB = "<path d=\"M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-5.7 0-1.3-.5-2.4-1.3-3.2.1-.3.6-1.6-.1-3.3 0 0-1-.3-3.4 1.2a11.6 11.6 0 0 0-6.2 0C6.5 2.5 5.5 2.8 5.5 2.8 4.8 4.5 5.3 5.8 5.4 6.1 4.6 6.9 4.1 8 4.1 9.3c0 4.3 2.7 5.4 5.5 5.7-.6.6-.6 1.2-.5 2V21\"/><path d=\"M9 9v4M9 9H7.5M9 20h3\"/>";
		const ICON_PACKAGE = "<path d=\"M22 7.5 12 2 2 7.5v9L12 22l10-5.5v-9z\"/><path d=\"M2 7.5 12 13l10-5.5M12 22v-9\"/>";
		function PluginCard(props) {
			const { plugin, reasons, onInstall, onTagClick } = props;
			const tags = (plugin.tags ?? []).filter((t) => /[\u4e00-\u9fff]/.test(t)).slice(0, 4);
			const [fav, setFav] = (0, react.useState)(() => isFavorite(plugin.id));
			const [starring, setStarring] = (0, react.useState)(false);
			const [starErr, setStarErr] = (0, react.useState)("");
			const toggleFav = () => {
				const now = toggleFavorite(plugin.id);
				setFav(now);
				toast(now ? `已收藏「${plugin.name}」` : `已取消收藏「${plugin.name}」`);
			};
			const toggleStar = async () => {
				const token = ghToken();
				if (!token) {
					toast("未绑定 GitHub，请到「设置」绑定后可加星");
					return;
				}
				if (ghMethod() === "device") {
					setStarErr("设备流授权不支持加星，请在设置里改用 PAT（个人令牌）绑定");
					return;
				}
				setStarring(true);
				setStarErr("");
				try {
					const [owner, repo] = plugin.fullName.split("/");
					await api("gh:star", {
						token,
						owner,
						repo,
						action: "star"
					});
					setStarErr("");
					toast(`已加星「${plugin.name}」`);
				} catch (e) {
					setStarErr(e.message.includes("403") || e.message.includes("404") ? "当前授权方式不支持加星，请改用 PAT（个人令牌）绑定" : `加星失败：${e.message}`);
				} finally {
					setStarring(false);
				}
			};
			return El("div", {
				className: styles_module_css_default.card,
				"data-type": plugin.type
			}, El("div", { className: styles_module_css_default.cardHead }, El("span", {
				className: styles_module_css_default.cardName,
				title: plugin.fullName
			}, plugin.name), El("span", { className: styles_module_css_default.cardBadge }, plugin.type === "skill" ? "技能" : "插件"), El("span", { className: styles_module_css_default.cardStars }, El(Icon, {
				d: ICON_STAR,
				size: 13
			}), fmtStars(plugin.stars))), plugin.descriptionZh ? El("div", { className: styles_module_css_default.cardDesc }, plugin.descriptionZh) : null, El("div", { className: styles_module_css_default.cardTags }, ...tags.map((t) => El("span", {
				key: t,
				className: styles_module_css_default.tag,
				onClick: () => onTagClick(t)
			}, t)), reasons && reasons.length > 0 ? reasons.map((r, i) => El("span", {
				key: `r${i}`,
				className: r.startsWith("AI：") ? styles_module_css_default.reasonAi : styles_module_css_default.reason
			}, r)) : null), El("div", { className: styles_module_css_default.cardActions }, El("button", {
				className: styles_module_css_default.repoBtn,
				title: `打开 GitHub 仓库：${plugin.fullName}`,
				onClick: () => window.open(`https://github.com/${plugin.fullName}`, "_blank", "noopener noreferrer")
			}, El(Icon, {
				d: ICON_LINK,
				size: 13
			}), "仓库"), El("span", { className: styles_module_css_default.spacer }), El("button", {
				className: `${styles_module_css_default.favBtn} ${fav ? styles_module_css_default.favBtnOn : ""}`,
				title: fav ? "取消收藏" : "收藏（稍后安装）",
				onClick: toggleFav
			}, El(Icon, {
				d: fav ? ICON_STAR : ICON_STAR_OUTLINE,
				size: 12
			}), "收藏"), El("button", {
				className: `${styles_module_css_default.iconBtn} ${starring ? styles_module_css_default.iconBtnOn : ""}`,
				title: ghToken() ? "在 GitHub 加星这个仓库（PAT 绑定支持）" : "未绑定 GitHub，点击查看绑定方式",
				disabled: starring,
				onClick: () => void toggleStar()
			}, starring ? "…" : El(Icon, {
				d: ICON_STAR,
				size: 15
			})), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary} ${styles_module_css_default.btnSm}`,
				onClick: () => onInstall(plugin)
			}, "安装")), starErr ? El("div", { className: styles_module_css_default.cardActionHint }, starErr) : null);
		}
		function InstallModal(props) {
			const { plugin, onDone, onClose } = props;
			const [phase, setPhase] = (0, react.useState)("confirm");
			const [error, setError] = (0, react.useState)("");
			const [childSessionId, setChildSessionId] = (0, react.useState)(null);
			const [t0, setT0] = (0, react.useState)(null);
			const startAi = async () => {
				setPhase("running");
				try {
					const r = await api("ai:install", { pluginId: plugin.id });
					setChildSessionId(r.childSessionId);
					if (!r.started) setT0(r);
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
			}, El("div", { className: styles_module_css_default.steps }, El("div", { className: `${styles_module_css_default.step} ${styles_module_css_default.stepActive}` }, El("span", { className: styles_module_css_default.stepDot }, "1"), "确认", El("span", { className: phase === "confirm" ? styles_module_css_default.stepBar : `${styles_module_css_default.stepBar} ${styles_module_css_default.stepBarDone}` })), El("div", { className: phase === "confirm" ? styles_module_css_default.step : `${styles_module_css_default.step} ${phase === "handedOff" ? styles_module_css_default.stepDone : styles_module_css_default.stepActive}` }, El("span", { className: styles_module_css_default.stepDot }, phase === "handedOff" ? El(Icon, {
				d: ICON_CHECK,
				size: 11
			}) : "2"), "运行中", El("span", { className: phase === "handedOff" ? `${styles_module_css_default.stepBar} ${styles_module_css_default.stepBarDone}` : styles_module_css_default.stepBar })), El("div", { className: phase === "handedOff" ? `${styles_module_css_default.step} ${styles_module_css_default.stepDone}` : styles_module_css_default.step }, El("span", { className: styles_module_css_default.stepDot }, phase === "handedOff" ? El(Icon, {
				d: ICON_CHECK,
				size: 11
			}) : "3"), "完成")), phase === "confirm" ? El("div", null, El("div", { className: styles_module_css_default.modalTitle }, `确认安装「${plugin.name}」`), El("div", { className: styles_module_css_default.modalDesc }, `将先尝试零 LLM 直装（配方缓存 / README 解析命令 + 冒烟验证）；需要时才交给话题子代理。需要配置（API Key / Token）时会先向你确认。`), plugin.needsConfig ? El("p", { className: styles_module_css_default.warn }, El(Icon, {
				d: ICON_WARN,
				size: 13,
				className: styles_module_css_default.inlineIcon
			}), "该插件需要额外配置（API Key / Token），AI 会向你询问。") : null, El("p", { className: styles_module_css_default.ghTip }, plugin.type === "skill" ? "目标：装到技能目录（~/.agents/skills），装完即可用。" : "目标：装进 web profile，装完需重启 harness 生效。"), El("details", { className: styles_module_css_default.advanced }, El("summary", null, "高级：查看/复制手动命令"), El("code", { className: styles_module_css_default.advancedCmd }, cmd), El("p", { className: styles_module_css_default.advancedTip }, "提示：手动命令仅供参考，不一定正确，请以该项目 README 为准。")), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: styles_module_css_default.btn,
				onClick: onClose
			}, "取消"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				onClick: () => void startAi()
			}, "确认安装"))) : phase === "running" ? El("div", null, El("div", { className: styles_module_css_default.modalTitle }, "正在安装"), El("div", { className: styles_module_css_default.loading }, "正在唤起 AI 助手…")) : phase === "handedOff" ? El("div", { className: styles_module_css_default.modalSuccess }, El("div", { className: styles_module_css_default.modalSuccessIcon }, El(Icon, {
				d: ICON_CHECK,
				size: 22
			})), El("div", { className: styles_module_css_default.modalSuccessTitle }, childSessionId ? "已交给 AI 助手安装" : "安装完成（零 Token 直装）"), El("p", { className: styles_module_css_default.modalDesc }, childSessionId ? `AI 助手已开始工作（子会话 ${childSessionId.slice(0, 8)}…），请到会话中查看进度；需要配置时 AI 会向你确认。` : t0?.alreadyInstalled ? `「${plugin.name}」已在目标位置检测到安装，已跳过。` : t0?.ok && !t0.smokeFailed ? `已通过${t0.mode === "recipe" ? "配方" : "解析命令"}直装完成，冒烟验证通过，无需 AI 介入。` : `直装未通过验证（${t0?.error ?? "冒烟失败"}），已转交 AI 助手处理。`), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				onClick: () => {
					onDone();
					onClose();
				}
			}, "知道了"))) : El("div", null, El("div", { className: styles_module_css_default.modalError }, El(Icon, {
				d: ICON_CLOSE,
				size: 14,
				className: styles_module_css_default.inlineIcon
			}), `启动失败：${error}`), El("div", { className: styles_module_css_default.modalActions }, El("button", {
				className: styles_module_css_default.btn,
				onClick: () => setPhase("confirm")
			}, "重试"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				onClick: onClose
			}, "关闭")))));
		}
		function SceneRow(props) {
			const { plugin, onInstall } = props;
			const [fav, setFav] = (0, react.useState)(() => isFavorite(plugin.id));
			const toggleFav = () => {
				const now = toggleFavorite(plugin.id);
				setFav(now);
				toast(now ? `已收藏「${plugin.name}」` : `已取消收藏「${plugin.name}」`);
			};
			return El("div", { className: styles_module_css_default.sceneRow }, El("div", { className: styles_module_css_default.sceneInfo }, El("div", { className: styles_module_css_default.sceneName }, plugin.name), El("div", { className: styles_module_css_default.sceneDesc }, plugin.descriptionZh)), El("button", {
				className: `${styles_module_css_default.favBtn} ${fav ? styles_module_css_default.favBtnOn : ""}`,
				title: fav ? "取消收藏" : "收藏（稍后安装）",
				onClick: toggleFav
			}, El(Icon, {
				d: fav ? ICON_STAR : ICON_STAR_OUTLINE,
				size: 12
			}), "收藏"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary} ${styles_module_css_default.btnSm}`,
				onClick: () => onInstall(plugin)
			}, "获取"));
		}
		function RecommendTab(props) {
			const { plugins, profile, recs, loading, installedIds, onInstall, onTagClick, onSwitchMode, onQuizSubmit, sceneState, onFetchScene } = props;
			const [quizOpen, setQuizOpen] = (0, react.useState)(true);
			const [picked, setPicked] = (0, react.useState)([]);
			if (loading && recs.length === 0) return El("div", { className: styles_module_css_default.stateHint }, "加载推荐中…");
			if (recs.length === 0 && !loading) return El("div", { className: styles_module_css_default.stateHint }, "暂无推荐，先去搜索或完成问卷吧");
			const isNovice = !profile || profile.modeOverride === "novice" || profile.modeOverride === "auto" && profile.confidence < .4;
			const groups = [
				{
					title: "猜你喜欢",
					icon: ICON_HEART,
					items: recs.filter((r) => r.origin === "guess")
				},
				{
					title: "精选",
					icon: ICON_AWARD,
					items: recs.filter((r) => r.origin === "curated")
				},
				{
					title: "最近更新",
					icon: ICON_CLOCK,
					items: recs.filter((r) => r.origin === "trending")
				}
			].filter((g) => g.items.length > 0);
			const quizTags = aggregateHotTags(plugins, 20);
			const togglePick = (t) => {
				setPicked((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : prev.length >= 6 ? prev : [...prev, t]);
			};
			const submitQuiz = () => {
				if (picked.length === 0) return;
				onQuizSubmit(picked).then(() => {
					markQuizSubmitted();
					setQuizOpen(false);
					toast("已根据偏好重新生成推荐");
				});
			};
			const skipQuiz = () => {
				setQuizOpen(false);
				toast("已跳过，推荐将按默认偏好生成");
			};
			const quizSubmitted = !profile || profile.sources.quiz.length > 0;
			const showQuiz = isNovice && quizOpen && (quizSubmitted ? quizTriggered : true);
			return El("div", { className: styles_module_css_default.tabBody }, showQuiz ? El("div", { className: styles_module_css_default.quizCard }, El("div", { className: styles_module_css_default.quizHead }, El("span", { className: styles_module_css_default.quizHeadIcon }, El(Icon, {
				d: ICON_HELP,
				size: 16
			})), El("span", { className: styles_module_css_default.quizTitle }, "先了解你的偏好"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnGhost} ${styles_module_css_default.btnSm}`,
				onClick: skipQuiz
			}, "跳过")), El("div", { className: styles_module_css_default.quizDesc }, "告诉我你想用插件做什么，给我更准的推荐（可多选，可跳过）。"), El("div", { className: styles_module_css_default.quizTags }, ...quizTags.map((t) => El("span", {
				key: t,
				className: `${styles_module_css_default.quizChip} ${picked.includes(t) ? styles_module_css_default.quizChipOn : ""}`,
				onClick: () => togglePick(t)
			}, t))), El("div", { className: styles_module_css_default.quizActions }, El("span", { className: styles_module_css_default.quizCount }, `已选 ${picked.length} / 6`), El("div", { className: styles_module_css_default.quizCta }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				disabled: picked.length === 0,
				onClick: submitQuiz
			}, "为我推荐")))) : null, El("div", { className: styles_module_css_default.recommendToolbar }, El("span", { className: styles_module_css_default.recommendToolbarIcon }, El(Icon, {
				d: ICON_MODE,
				size: 14
			})), El("span", { className: styles_module_css_default.recommendHint }, isNovice ? [
				"当前为",
				El("b", { key: "b1" }, "新手模式"),
				"，推荐更稳妥通用。可切换到",
				El("b", { key: "b2" }, "个性化模式"),
				"获取贴合你工作流的建议。"
			] : [
				"当前为",
				El("b", { key: "b1" }, "个性化模式"),
				"，推荐将贴合你的工作流与偏好持续调整。"
			])), El("div", { className: styles_module_css_default.modeSwitchRow }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				onClick: () => void onSwitchMode()
			}, isNovice ? "切换到 · 个性化模式" : "切换到 · 新手模式")), El("div", { className: styles_module_css_default.section }, El("div", { className: styles_module_css_default.sectionHead }, El(Icon, {
				d: ICON_SCENE,
				size: 14,
				className: styles_module_css_default.sectionIcon
			}), El("h3", { className: styles_module_css_default.sectionTitle }, "适合当前场景"), El("span", { className: styles_module_css_default.sectionNote }, sceneState.loading ? "读取会话上下文…" : sceneState.recs.length > 0 ? `基于「${sceneState.sceneTags.slice(0, 3).join(" / ")}」` : "基于你的工作区"), sceneState.loading ? null : El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				onClick: () => void onFetchScene()
			}, sceneState.recs.length > 0 ? "刷新" : "获取场景推荐")), sceneState.loading ? El("div", { className: styles_module_css_default.stateHint }, "读取中…") : sceneState.recs.length > 0 ? El("div", { className: styles_module_css_default.sceneList }, ...sceneState.recs.slice(0, 4).map((r) => El(SceneRow, {
				key: r.plugin.id,
				plugin: r.plugin,
				onInstall
			}))) : El("p", { className: styles_module_css_default.sceneEmpty }, "根据你当前正在做的事推荐插件（点击获取，基于会话内容）")), ...groups.map((g) => El("div", {
				key: g.title,
				className: styles_module_css_default.section
			}, El("div", { className: styles_module_css_default.sectionHead }, El(Icon, {
				d: g.icon,
				size: 14,
				className: styles_module_css_default.sectionIcon
			}), El("h3", { className: styles_module_css_default.sectionTitle }, g.title), g.title === "精选" ? El("span", { className: styles_module_css_default.sectionNote }, "编辑推荐") : null), El("div", { className: styles_module_css_default.grid2 }, ...g.items.map((r) => El(PluginCard, {
				key: r.plugin.id,
				plugin: r.plugin,
				reasons: r.reasons,
				origin: r.origin,
				onInstall,
				onTagClick
			}))))), installedIds.size > 0 ? El("div", { className: styles_module_css_default.installedNote }, `已排除 ${installedIds.size} 个已安装插件`) : null);
		}
		function SearchTab(props) {
			const { plugins, onInstall, onTagClick } = props;
			const [query, setQuery] = (0, react.useState)("");
			const [tags, setTags] = (0, react.useState)([]);
			const [type, setType] = (0, react.useState)("all");
			const [results, setResults] = (0, react.useState)([]);
			const [searching, setSearching] = (0, react.useState)(false);
			const [semanticOn, setSemanticOn] = (0, react.useState)(false);
			const [semanticNotice, setSemanticNotice] = (0, react.useState)("");
			const [semanticTags, setSemanticTags] = (0, react.useState)([]);
			const [hotExpanded, setHotExpanded] = (0, react.useState)(false);
			const [visible, setVisible] = (0, react.useState)(50);
			const debounceRef = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				if (searchSeed) {
					setQuery(searchSeed);
					setSearchSeed("");
				}
			}, []);
			const hotAll = (0, react.useMemo)(() => aggregateHotTags(plugins, 40), [plugins]);
			const hot = hotExpanded ? hotAll : hotAll.slice(0, 8);
			(0, react.useEffect)(() => {
				if (debounceRef.current) clearTimeout(debounceRef.current);
				debounceRef.current = setTimeout(() => {
					runSearch();
				}, semanticOn && query.trim().length >= 2 ? 700 : 300);
				return () => {
					if (debounceRef.current) clearTimeout(debounceRef.current);
				};
			}, [
				query,
				tags,
				type,
				semanticOn
			]);
			const runSearch = async () => {
				setSearching(true);
				setVisible(50);
				try {
					if (semanticOn && query.trim().length >= 2) {
						const r = await api("search:semantic", { query });
						setSemanticTags(r.tags);
						if (r.results.length > 0) {
							setResults(r.results);
							return;
						}
					}
					setSemanticTags([]);
					const opts = { limit: 0 };
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
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.searchWrap }, El("span", { className: styles_module_css_default.searchWrapIcon }, El(Icon, {
				d: ICON_SEARCH,
				size: 15
			})), El("input", {
				className: styles_module_css_default.searchInput,
				placeholder: "搜索插件名称、标签或描述…",
				value: query,
				onChange: (e) => setQuery(e.target.value)
			}), query.length > 0 ? El("button", {
				className: styles_module_css_default.searchClear,
				"aria-label": "清除",
				onClick: () => setQuery("")
			}, El(Icon, {
				d: ICON_CLOSE,
				size: 13
			})) : null), El("div", { className: styles_module_css_default.filterRow }, ...[
				["all", "全部"],
				["cordis-plugin", "cordis 插件"],
				["skill", "skill"]
			].map(([v, label]) => El("span", {
				key: v,
				className: `${styles_module_css_default.filterChip} ${type === v ? styles_module_css_default.filterChipOn : ""}`,
				onClick: () => setType(v)
			}, label))), El("div", { className: styles_module_css_default.semanticToggle }, El("div", { className: styles_module_css_default.semanticInfo }, El("div", { className: styles_module_css_default.semanticTitle }, "AI 语义搜索", El("span", { className: styles_module_css_default.semanticPill }, "待开发")), El("div", { className: styles_module_css_default.semanticDesc }, "用自然语言理解意图，帮你找到「最贴近需求」的插件。")), El("div", {
				className: styles_module_css_default.semanticSwitch,
				title: "功能待开发，暂不可用"
			})), El("div", { className: styles_module_css_default.hotTagsTitle }, "热门标签"), El("div", { className: styles_module_css_default.tagCloud }, ...hot.map((t) => El("span", {
				key: t,
				className: `${styles_module_css_default.hotTag} ${tags.includes(t) ? styles_module_css_default.hotTagOn : ""}`,
				onClick: () => toggleTag(t)
			}, t))), hotAll.length > 8 ? El("div", { className: styles_module_css_default.tagMoreRow }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnGhost} ${styles_module_css_default.btnSm}`,
				onClick: () => setHotExpanded((v) => !v)
			}, hotExpanded ? "收起标签" : "展开全部标签")) : null, semanticNotice ? El("p", { className: styles_module_css_default.sceneEmpty }, semanticNotice) : null, semanticTags.length > 0 ? El("div", { className: styles_module_css_default.semanticResult }, `AI 理解为你想要：`, ...semanticTags.map((t) => El("span", {
				key: t,
				className: `${styles_module_css_default.hotTag} ${tags.includes(t) ? styles_module_css_default.hotTagOn : ""}`,
				onClick: () => toggleTag(t)
			}, t))) : null, searching && results.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "搜索中…") : results.length === 0 && query === "" && tags.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "输入关键词或选择标签开始搜索") : results.length === 0 ? El("div", { className: styles_module_css_default.emptyState }, El("div", { className: styles_module_css_default.emptyIcon }, El(Icon, {
				d: ICON_SEARCH,
				size: 44
			})), El("div", { className: styles_module_css_default.emptyTitle }, "没有找到匹配的插件"), El("div", { className: styles_module_css_default.emptyDesc }, "换个关键词或标签试试。")) : El("div", null, El("div", { className: styles_module_css_default.resultCount }, "共 ", El("b", null, String(results.length)), " 个结果"), El("div", { className: styles_module_css_default.results }, ...results.slice(0, visible).map((r) => El(PluginCard, {
				key: r.plugin.id,
				plugin: r.plugin,
				reasons: r.aiReason ? [`AI：${r.aiReason}`] : r.tagHits > 0 ? [`标签命中 ${r.tagHits} 项`] : void 0,
				onInstall,
				onTagClick
			}))), visible < results.length ? El("div", { className: styles_module_css_default.loadMoreRow }, El("button", {
				className: styles_module_css_default.loadMore,
				onClick: () => setVisible((v) => v + 50)
			}, `加载更多（还有 ${results.length - visible} 个）`)) : null));
		}
		function InstalledTab(props) {
			const { installed, loading, onChanged } = props;
			const [confirming, setConfirming] = (0, react.useState)(null);
			const [busy, setBusy] = (0, react.useState)(false);
			const [showAllUnmatched, setShowAllUnmatched] = (0, react.useState)(false);
			const [updateMap, setUpdateMap] = (0, react.useState)({});
			const [checking, setChecking] = (0, react.useState)(false);
			const [checkError, setCheckError] = (0, react.useState)("");
			const [updating, setUpdating] = (0, react.useState)(null);
			const [verifMap, setVerifMap] = (0, react.useState)({});
			const [verifying, setVerifying] = (0, react.useState)(null);
			const [approving, setApproving] = (0, react.useState)(null);
			const uninstall = async (item) => {
				if (!item.pluginId) return;
				setBusy(true);
				try {
					const r = await api("uninstall", { pluginId: item.pluginId });
					if (!r.ok) {
						toast(`卸载失败：${r.error ?? "未知错误"}`, 3500);
						return;
					}
					onChanged();
					toast(item.source === "profile" ? "卸载完成，重启 harness 后生效" : "卸载完成");
				} catch (e) {
					toast(`卸载失败：${e.message}`, 3500);
				} finally {
					setBusy(false);
					setConfirming(null);
				}
			};
			/** 检查更新（force：绕过 core 内存缓存，重新查 npm / GitHub） */
			const checkNow = async () => {
				setChecking(true);
				setCheckError("");
				try {
					const list = await api("update:check", { force: true });
					const m = {};
					for (const r of list) m[r.localName] = r;
					setUpdateMap(m);
				} catch (e) {
					setCheckError(e.message);
				} finally {
					setChecking(false);
				}
			};
			/** P0-1 装后四态验证：对单个已装项手动触发（读 profile 真值） */
			const verifyOne = async (item) => {
				if (!item.pluginId || verifying) return;
				setVerifying(item.localName);
				try {
					const a = await api("verify", { pluginId: item.pluginId });
					setVerifMap((m) => ({
						...m,
						[item.localName]: a
					}));
					toast(`「${item.localName}」：${activationText(a)}`, 3200);
				} catch (e) {
					toast(`验证失败：${e.message}`, 3e3);
				} finally {
					setVerifying(null);
				}
			};
			/**
			* P0-3 更新执行（update:apply）：before/after 对比，假更新防误报；
			* P0-2 构建脚本被拦 → 自动放行并重试一次；P0-1 更新成功后展示装后四态。
			*/
			const updatePlugin = async (item) => {
				if (!item.pluginId || updating) return;
				setUpdating(item.localName);
				try {
					let r = await api("update:apply", { pluginId: item.pluginId });
					if (r.error && !r.applied && /Ignored build scripts|approve-builds/i.test(r.error)) {
						const blocked = parseBlockedFromOutput(r.error, item);
						setApproving(item.localName);
						const ar = await api("builds:approve", { packages: blocked });
						if (!ar.ok) {
							setApproving(null);
							toast(`构建脚本放行失败：${ar.error ?? "未知错误"}`, 3500);
							return;
						}
						toast(`已放行构建脚本（${blocked.join("、")}），自动重试…`, 3200);
						r = await api("update:apply", { pluginId: item.pluginId });
						setApproving(null);
					}
					if (r.error && !r.applied) {
						toast(`更新失败：${r.error}`, 4500);
						return;
					}
					if (r.blocked === "minimum-release-age") {
						const msg = r.reason ?? "新版本已发布但被 pnpm 发布年龄门槛（minimumReleaseAge）挡住";
						if (typeof window !== "undefined" && window.confirm(`${msg}。\n\n点击「确定」= 放宽门槛（minimumReleaseAge: 0）并自动重试；「取消」= 等门槛期过后再更。`)) {
							const rel = await api("update:relax", {});
							if (!rel.ok) {
								toast(`放宽门槛失败：${rel.error ?? "未知错误"}`, 3500);
								return;
							}
							toast("已放宽发布年龄门槛，自动重试…", 3200);
							r = await api("update:apply", { pluginId: item.pluginId });
							if (r.error && !r.applied) {
								toast(`更新失败：${r.error}`, 4500);
								return;
							}
						} else {
							toast("已取消；新版本将在发布年龄门槛期过后自动可更新", 3500);
							return;
						}
					}
					if (r.noChange && !r.applied) {
						toast(r.reason ?? "版本无变化", 3e3);
						return;
					}
					onChanged();
					setUpdateMap((m) => {
						const next = { ...m };
						delete next[item.localName];
						return next;
					});
					const act = r.activation;
					toast(`更新完成${act ? ` · ${activationText(act)}` : ""}`, 3500);
					if (act) setVerifMap((m) => ({
						...m,
						[item.localName]: act
					}));
				} catch (e) {
					toast(`更新失败：${e.message}`, 3500);
				} finally {
					setUpdating(null);
				}
			};
			/** 单行检测状态（未检测过返回 null） */
			const renderCheck = (item) => {
				const r = updateMap[item.localName];
				if (!r) return null;
				if (r.kind === "none") return El("div", { className: styles_module_css_default.updateHint }, `无法检测 · ${r.error ?? ""}`);
				if (r.hasUpdate) return El("div", { className: styles_module_css_default.updateChip }, r.kind === "npm" ? `可更新 ${r.current} → ${r.latest}` : "远端有新提交");
				return El("div", { className: styles_module_css_default.latestChip }, r.kind === "npm" ? `已是最新 ${r.latest}` : "已是最新");
			};
			if (loading) return El("div", { className: styles_module_css_default.stateHint }, "扫描已装插件…");
			const matched = installed.filter((i) => i.pluginId);
			const unmatched = installed.filter((i) => !i.pluginId);
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.section }, El("div", { className: styles_module_css_default.sectionHead }, El(Icon, {
				d: ICON_PACKAGE,
				size: 14,
				className: styles_module_css_default.sectionIcon
			}), El("h3", { className: styles_module_css_default.sectionTitle }, "已安装"), El("span", { className: styles_module_css_default.sectionNote }, `${installed.length} 个`), installed.length > 0 ? El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnGhost}`,
				disabled: checking,
				onClick: () => void checkNow()
			}, checking ? "检测中…" : "检查更新") : null), checkError ? El("div", { className: styles_module_css_default.updateHint }, `检测失败：${checkError}`) : null, matched.length === 0 ? El("div", { className: styles_module_css_default.stateHint }, "未检测到市场收录的已装插件") : null, ...matched.map((i, idx) => El("div", {
				key: `${i.localName}-${idx}`,
				className: styles_module_css_default.installedRow
			}, El("div", { className: styles_module_css_default.installedInfo }, El("div", { className: styles_module_css_default.installedHead }, El("span", { className: styles_module_css_default.installedName }, i.plugin?.name ?? i.localName), El("span", { className: styles_module_css_default.cardBadge }, i.source === "skills" ? "技能" : "插件")), El("div", { className: styles_module_css_default.installedMeta }, `${i.version ?? "未知版本"} · ${i.source === "skills" ? "skill" : "profile"}`), verifMap[i.localName] ? El("div", { className: `${styles_module_css_default.activationChip} ${verifMap[i.localName].state === "live" ? styles_module_css_default.activationLive : verifMap[i.localName].state === "broken" ? styles_module_css_default.activationBroken : verifMap[i.localName].state === "inert" ? styles_module_css_default.activationInert : ""}` }, activationText(verifMap[i.localName])) : null, checking ? El("div", { className: styles_module_css_default.updateHint }, "检测中…") : renderCheck(i)), confirming === i.localName ? El("div", { className: styles_module_css_default.installedActions }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				onClick: () => setConfirming(null)
			}, "取消"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnDanger}`,
				disabled: busy,
				onClick: () => void uninstall(i)
			}, "确认卸载")) : El("div", { className: styles_module_css_default.installedActions }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnGhost}`,
				disabled: updating !== null || busy || !i.pluginId || verifying !== null,
				onClick: () => void verifyOne(i)
			}, verifying === i.localName ? "验证中…" : "验证"), approving === i.localName ? El("span", { className: styles_module_css_default.updateHint }, "放行构建脚本…") : null, updateMap[i.localName]?.hasUpdate ? El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnPrimary}`,
				disabled: updating !== null || busy,
				onClick: () => void updatePlugin(i)
			}, updating === i.localName ? "更新中…" : "更新") : null, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				disabled: !i.pluginId,
				onClick: () => setConfirming(i.localName)
			}, "卸载"))))), unmatched.length > 0 ? El("div", { className: styles_module_css_default.section }, El("div", { className: styles_module_css_default.sectionHead }, El(Icon, {
				d: ICON_PACKAGE,
				size: 14,
				className: styles_module_css_default.sectionIcon
			}), El("h3", { className: styles_module_css_default.sectionTitle }, "其他已装"), El("span", { className: styles_module_css_default.sectionNote }, `${unmatched.length} 个 · 未收录市场`)), El("div", { className: styles_module_css_default.unmatched }, ...unmatched.slice(0, showAllUnmatched ? unmatched.length : 5).map((i, idx) => El("span", {
				key: `${i.localName}-${idx}`,
				className: styles_module_css_default.unmatchedChip
			}, i.localName)), unmatched.length > 5 ? El("button", {
				type: "button",
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnGhost} ${styles_module_css_default.btnSm}`,
				onClick: () => setShowAllUnmatched((v) => !v)
			}, showAllUnmatched ? "收起" : `查看详细（${unmatched.length} 个）`) : null)) : null);
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
			const [versions, setVersions] = (0, react.useState)({});
			(0, react.useEffect)(() => {
				setMode(profile?.modeOverride ?? "auto");
				api("config").then((c) => {
					if (c?.versions) setVersions(c.versions);
				}).catch(() => {});
			}, [profile]);
			const saveSettings = async (patch) => {
				try {
					await api("settings:update", { patch });
					onChanged();
				} catch (e) {
					alert(`保存失败：${e.message}`);
				}
			};
			const [ghPoll, setGhPoll] = (0, react.useState)("idle");
			const [pollDetail, setPollDetail] = (0, react.useState)("");
			const [pollCount, setPollCount] = (0, react.useState)(0);
			const pollIntervalRef = (0, react.useRef)(null);
			const clearPoll = () => {
				if (pollIntervalRef.current !== null) {
					window.clearInterval(pollIntervalRef.current);
					pollIntervalRef.current = null;
				}
			};
			(0, react.useEffect)(() => clearPoll, []);
			const startDeviceFlow = async () => {
				clearPoll();
				setGhBusy(true);
				setGhError("");
				setDeviceInfo(null);
				setGhPoll("waiting");
				try {
					const d = await api("gh:deviceCode", { body: {
						client_id: GH_CLIENT_ID,
						scope: "read:user"
					} });
					if (!d.device_code) {
						setGhError(`设备流不可用：${d.error_description ?? d.error ?? "未知错误"}`);
						setGhPoll("idle");
						setGhBusy(false);
						return;
					}
					setDeviceInfo({
						verification_uri: d.verification_uri ?? "",
						user_code: d.user_code ?? ""
					});
					setGhPoll("polling");
					setPollCount(0);
					setPollDetail("第 1 次轮询…");
					let localCount = 0;
					pollIntervalRef.current = window.setInterval(async () => {
						try {
							const t = await api("gh:token", { body: {
								client_id: GH_CLIENT_ID,
								device_code: d.device_code,
								grant_type: "urn:ietf:params:oauth:grant-type:device_code"
							} });
							localCount++;
							setPollCount(localCount);
							if (t.access_token) {
								clearPoll();
								setGhPoll("finishing");
								setPollDetail("拿到 token，正在同步加星…");
								await finishBind(t.access_token, "device");
								setGhPoll("done");
							} else if (t.error === "authorization_pending") setPollDetail(`第 ${localCount} 次：GitHub 尚未确认授权（继续等待…）`);
							else if (t.error === "slow_down") setPollDetail(`第 ${localCount} 次：GitHub 要求放慢轮询（继续等待…）`);
							else {
								clearPoll();
								setGhError(t.error_description ?? t.error ?? "授权失败");
								setGhPoll("idle");
								setGhBusy(false);
							}
						} catch (e) {
							clearPoll();
							setGhError(e.message);
							setGhPoll("idle");
							setGhBusy(false);
						}
					}, (d.interval ?? 5) * 1e3);
				} catch (e) {
					setGhError(e.message);
					setGhBusy(false);
				}
			};
			const finishBind = async (token, method) => {
				try {
					const user = await api("gh:user", { token });
					localStorage.setItem(GH_TOKEN_KEY, token);
					localStorage.setItem(GH_LOGIN_KEY, user.login);
					localStorage.setItem(GH_METHOD_KEY, method);
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
					await finishBind(patInput.trim(), "pat");
					setPatInput("");
				} catch (e) {
					setGhError(e.message);
					setGhBusy(false);
				}
			};
			const unbind = () => {
				localStorage.removeItem(GH_TOKEN_KEY);
				localStorage.removeItem(GH_LOGIN_KEY);
				localStorage.removeItem(GH_METHOD_KEY);
				setGhLogin(null);
				onChanged();
			};
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.settingCard }, El("div", { className: styles_module_css_default.settingHead }, El("span", { className: styles_module_css_default.settingIc }, El(Icon, {
				d: ICON_GITHUB,
				size: 15
			})), El("span", { className: styles_module_css_default.settingTitle }, "GitHub 账户"), El("span", { className: `${styles_module_css_default.settingStatus} ${ghLogin ? styles_module_css_default.statusOk : styles_module_css_default.statusOff}` }, ghLogin ? "已绑定" : "未绑定")), ghLogin ? El("div", null, El("p", { className: styles_module_css_default.ghTip }, `已绑定 @${ghLogin}，读取公开加星用于个性化推荐（token 仅存本机浏览器）。`), El("div", { className: styles_module_css_default.settingsRow }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				onClick: unbind
			}, "解除绑定"))) : El("div", null, El("div", { className: styles_module_css_default.fieldRow }, El("div", { className: styles_module_css_default.field }, El("label", { className: styles_module_css_default.fieldLabel }, "Token（Personal Access Token）"), El("input", {
				className: styles_module_css_default.input,
				type: "password",
				placeholder: "ghp_…",
				value: patInput,
				onChange: (e) => setPatInput(e.target.value)
			}))), El("div", { className: styles_module_css_default.settingsRow }, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				disabled: ghBusy,
				onClick: () => void bindWithPat()
			}, "Token 绑定（完整功能）"), El("button", {
				className: styles_module_css_default.btn,
				disabled: ghBusy,
				onClick: () => void startDeviceFlow()
			}, "快速授权（仅推荐）")), El("p", { className: styles_module_css_default.ghTip }, "Token 绑定 = 完整功能（读取加星推荐 + 一键加星）；快速授权只能读取公开加星做推荐。", " ", El("a", {
				href: "https://github.com/settings/tokens/new?scopes=public_repo,read:user&description=dsh-market",
				target: "_blank",
				rel: "noopener noreferrer",
				className: styles_module_css_default.ghLink
			}, "生成 Token（public_repo + read:user）", El(Icon, {
				d: ICON_EXTERNAL,
				size: 11,
				className: styles_module_css_default.inlineIcon
			}))), deviceInfo ? El("div", { className: styles_module_css_default.deviceFlow }, El("p", null, "在 GitHub 输入授权码："), El("code", { className: styles_module_css_default.deviceCode }, deviceInfo.user_code), El("p", null, El("a", {
				href: deviceInfo.verification_uri,
				target: "_blank",
				rel: "noopener noreferrer"
			}, "前往 GitHub 授权", El(Icon, {
				d: ICON_EXTERNAL,
				size: 11,
				className: styles_module_css_default.inlineIcon
			}))), El("p", { className: styles_module_css_default.deviceFlowTip }, "输入授权码后，请点击 GitHub 页面上的「Authorize / 授权」按钮完成确认，然后回到这里等待自动绑定。"), El("p", { className: styles_module_css_default.ghPollState }, ghPoll === "polling" ? pollDetail || "等待授权…（授权完成后自动绑定）" : ghPoll === "finishing" ? pollDetail || "授权成功，正在同步加星…" : ghPoll === "done" ? El("span", { className: styles_module_css_default.ghDone }, El(Icon, {
				d: ICON_CHECK,
				size: 13,
				className: styles_module_css_default.inlineIcon
			}), "绑定完成") : ""), ghPoll === "polling" && pollCount >= 36 ? El("p", { className: styles_module_css_default.deviceFlowTip }, "已等待较久：请确认 GitHub 页面已完成「Authorize」确认；若授权码已过期（15 分钟），点「重新获取授权码」。") : null, El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm}`,
				disabled: ghBusy,
				onClick: () => void startDeviceFlow()
			}, "重新获取授权码")) : null, ghError ? El("p", { className: styles_module_css_default.error }, ghError) : null)), El("div", { className: styles_module_css_default.settingCard }, El("div", { className: styles_module_css_default.settingHead }, El("span", { className: styles_module_css_default.settingIc }, El(Icon, {
				d: ICON_MODE,
				size: 15
			})), El("span", { className: styles_module_css_default.settingTitle }, "推荐偏好")), El("div", { className: styles_module_css_default.field }, El("label", { className: styles_module_css_default.fieldLabel }, "推荐模式"), El("select", {
				className: styles_module_css_default.select,
				value: mode,
				onChange: (e) => {
					setMode(e.target.value);
					saveSettings({ modeOverride: e.target.value });
				}
			}, El("option", { value: "auto" }, "自动（按画像判断）"), El("option", { value: "novice" }, "新手模式"), El("option", { value: "veteran" }, "个性化模式"))), El("div", { className: styles_module_css_default.field }, El("label", { className: styles_module_css_default.fieldLabel }, "目标 Profile"), El("input", {
				className: styles_module_css_default.input,
				value: profileName,
				onChange: (e) => {
					setProfileName(e.target.value);
					saveSettings({ profile: e.target.value });
				}
			})), El("p", { className: styles_module_css_default.ghTip }, `已装 skill 目录：从本机 skills 目录自动检测`), El("div", { className: styles_module_css_default.dividerLine }), El("button", {
				className: styles_module_css_default.btn,
				onClick: onChanged
			}, "刷新推荐数据")), El("div", { className: styles_module_css_default.settingCard }, El("div", { className: styles_module_css_default.settingHead }, El("span", { className: styles_module_css_default.settingIc }, El(Icon, {
				d: ICON_CLOCK,
				size: 15
			})), El("span", { className: styles_module_css_default.settingTitle }, "关于")), El("p", { className: styles_module_css_default.ghTip }, "数据缓存于本地（GitHub Actions 每日抓取）。"), versions["@dsh-market/plugin"] ? El("div", { className: styles_module_css_default.versionRow }, El("span", { className: styles_module_css_default.versionLabel }, "插件版本"), El("code", { className: styles_module_css_default.versionCode }, `${versions["@dsh-market/plugin"] ?? "?"}`, versions["@dsh-market/core"] ? ` · core ${versions["@dsh-market/core"]}` : "")) : null));
		}
		function PacksTab(props) {
			const { packs } = props;
			const [query, setQuery] = (0, react.useState)("");
			const [expanded, setExpanded] = (0, react.useState)(null);
			const ql = query.trim().toLowerCase();
			const visible = [...packs].sort((a, b) => b.scoreTotal - a.scoreTotal).filter((p) => !ql || p.name.toLowerCase().includes(ql) || (p.descriptionZh ?? "").toLowerCase().includes(ql) || p.author.toLowerCase().includes(ql) || p.tags.some((t) => t.toLowerCase().includes(ql)));
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.searchWrap }, El("span", { className: styles_module_css_default.searchWrapIcon }, El(Icon, {
				d: ICON_SEARCH,
				size: 15
			})), El("input", {
				className: styles_module_css_default.searchInput,
				placeholder: "搜索整合包：翻译 / 安全 / MCP / 环境…",
				value: query,
				onChange: (e) => setQuery(e.target.value)
			}), query.length > 0 ? El("button", {
				className: styles_module_css_default.searchClear,
				"aria-label": "清除",
				onClick: () => setQuery("")
			}, El(Icon, {
				d: ICON_CLOSE,
				size: 13
			})) : null), packs.length === 0 ? El("div", { className: styles_module_css_default.emptyState }, "整合包正式协议开发中，暂未开放收录——敬请期待。") : visible.length === 0 ? El("div", { className: styles_module_css_default.emptyState }, "没有匹配的整合包，换个关键词试试。") : El("div", {
				className: styles_module_css_default.list,
				style: {
					display: "flex",
					flexDirection: "column",
					gap: 10
				}
			}, ...visible.map((p) => {
				const { total, ok, inMarket } = p.entryStats;
				const rate = total > 0 ? Math.round(ok / total * 100) : 0;
				const open = expanded === p.id;
				return El("div", {
					key: p.id,
					className: styles_module_css_default.card
				}, El("div", { className: styles_module_css_default.cardTop }, El("span", {
					className: styles_module_css_default.cardStars,
					style: {
						background: "var(--mkt-purple-bg)",
						color: "var(--mkt-purple)",
						borderRadius: 6,
						padding: "2px 8px",
						fontSize: 10
					}
				}, "PACK"), El("span", { className: styles_module_css_default.cardStars }, `★ ${fmtStars(p.stars)}`)), El("div", { className: styles_module_css_default.cardName }, p.name), El("div", { className: styles_module_css_default.cardDesc }, p.descriptionZh ?? "（无简介）"), El("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 6,
					fontSize: 11,
					color: rate >= 80 ? "var(--mkt-rate-ok)" : rate >= 50 ? "var(--mkt-rate-warn)" : "var(--mkt-rate-danger)",
					padding: "4px 8px",
					borderRadius: 6,
					background: "var(--mkt-bg)",
					marginBottom: 8
				} }, `✓ ${ok}/${total} 条目可解析 · ${inMarket} 已在市场`, El("b", {}, `${rate}%`)), El("div", { className: styles_module_css_default.cardActions }, El("span", { style: {
					fontSize: 12,
					fontWeight: 600,
					color: "var(--mkt-purple)"
				} }, `${p.scoreTotal} 实用分`), El("button", {
					className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnGhost}`,
					onClick: () => setExpanded(open ? null : p.id)
				}, open ? "收起条目" : "查看条目")), open ? El("div", { style: {
					display: "flex",
					flexDirection: "column",
					gap: 4,
					marginTop: 8,
					paddingTop: 8,
					borderTop: "1px solid var(--mkt-border)"
				} }, ...p.entries.map((e, i) => El("div", {
					key: `${e.id}-${i}`,
					style: {
						display: "flex",
						alignItems: "center",
						gap: 8,
						fontSize: 11,
						color: e.resolved?.ok ? "inherit" : "#B33A3A",
						padding: "3px 0"
					}
				}, El("span", {}, e.resolved?.ok ? "✓" : "✗"), El("code", { style: { fontSize: 10.5 } }, e.id), El("span", { style: {
					fontSize: 10,
					color: "var(--mkt-text3)"
				} }, e.type), El("span", { style: {
					marginLeft: "auto",
					fontSize: 10,
					color: "var(--mkt-text3)"
				} }, e.resolved?.ok ? e.resolved.inMarket ? "已在市场" : "可安装" : e.resolved?.reason ?? "解析失败")))) : null);
			})));
		}
		function FavoritesTab(props) {
			const { plugins, onInstall, onTagClick, refreshTick, onGotoRecommend } = props;
			const favIds = (0, react.useMemo)(() => readFavorites(), [refreshTick]);
			const items = plugins.filter((p) => favIds.includes(p.id));
			return El("div", { className: styles_module_css_default.tabBody }, El("div", { className: styles_module_css_default.sectionHead }, El(Icon, {
				d: ICON_STAR_OUTLINE,
				size: 14,
				className: styles_module_css_default.sectionIcon
			}), El("h3", { className: styles_module_css_default.sectionTitle }, "我的收藏"), El("span", { className: styles_module_css_default.sectionNote }, `${items.length} 个`)), items.length === 0 ? El("div", { className: styles_module_css_default.emptyState }, El("div", { className: styles_module_css_default.emptyIcon }, El(Icon, {
				d: ICON_STAR_OUTLINE,
				size: 44
			})), El("div", { className: styles_module_css_default.emptyTitle }, "还没有收藏任何插件"), El("div", { className: styles_module_css_default.emptyDesc }, "在推荐或搜索页点击星标，把喜欢的插件收藏到这里。"), El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnPrimary}`,
				onClick: onGotoRecommend
			}, "去逛逛")) : El("div", { className: styles_module_css_default.grid2 }, ...items.map((p) => El(PluginCard, {
				key: p.id,
				plugin: p,
				onInstall,
				onTagClick
			}))));
		}
		function MarketPanel(props) {
			const { onClose } = props;
			const open = (0, react.useSyncExternalStore)(subscribe, getOpen, getOpen);
			const [tab, setTab] = (0, react.useState)("recommend");
			const [plugins, setPlugins] = (0, react.useState)([]);
			const [profile, setProfile] = (0, react.useState)(null);
			const [installed, setInstalled] = (0, react.useState)([]);
			const [packs, setPacks] = (0, react.useState)([]);
			const [recs, setRecs] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [installTarget, setInstallTarget] = (0, react.useState)(null);
			const [refreshKey, setRefreshKey] = (0, react.useState)(0);
			const [sceneState, setSceneState] = (0, react.useState)({
				loading: false,
				recs: [],
				sceneTags: []
			});
			const [selfUpdate, setSelfUpdate] = (0, react.useState)(null);
			const [selfUpdating, setSelfUpdating] = (0, react.useState)(false);
			const [selfDismissed, setSelfDismissed] = (0, react.useState)(false);
			const loadAll = async () => {
				setLoading(true);
				try {
					const [pl, prof, inst, pk] = await Promise.all([
						api("plugins"),
						api("profile:read"),
						api("installed"),
						api("packs").catch(() => [])
					]);
					setPlugins(pl);
					setProfile(prof);
					setInstalled(inst);
					setPacks(pk);
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
					const sceneTags = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t]) => t);
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
			(0, react.useEffect)(() => {
				if (!open || selfDismissed) return;
				api("update:self", { force: true }).then((r) => setSelfUpdate(r)).catch(() => {});
			}, [open, selfDismissed]);
			/** 插件自身更新：引导式（P0）——运行中不能就地覆盖自己，给出停 harness 后的命令并复制 */
			const applySelfUpdate = async () => {
				setSelfUpdating(true);
				try {
					const r = await api("update:self", { apply: true });
					if (r.needsManual) {
						const cmd = r.manualCommand ?? "dsh plugin --profile web add @dsh-market/plugin@latest";
						if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) navigator.clipboard.writeText(cmd).catch(() => {});
						toast(`已复制更新命令：${cmd}。请停止 harness 后运行，再重启 harness 生效。`, 5600);
						setSelfDismissed(true);
						return;
					}
					if (r.applied) {
						setSelfUpdate(null);
						setSelfDismissed(true);
						toast(`插件更新完成（${r.latest}），重启 harness 后生效`);
					} else toast(`更新失败：${r.applyOutput ?? "未知错误"}。若提示文件被占用，需先停止 harness 后重试`, 5e3);
				} catch (e) {
					toast(`更新失败：${e.message}。若提示文件被占用，需先停止 harness 后重试`, 5e3);
				} finally {
					setSelfUpdating(false);
				}
			};
			if (!open) return null;
			const installedIds = new Set(installed.filter((i) => i.pluginId).map((i) => i.pluginId));
			const onTagClick = (t) => {
				setSearchSeed(t);
				setTab("search");
			};
			const onInstalledChanged = () => setRefreshKey((k) => k + 1);
			const onFetchScene = async () => {
				setSceneState({
					loading: true,
					recs: [],
					sceneTags: []
				});
				try {
					const tags = (await api("scene:context")).sceneTags ?? [];
					if (tags.length === 0) {
						setSceneState({
							loading: false,
							recs: [],
							sceneTags: []
						});
						return;
					}
					const r = await api("recommend", { options: {
						limit: 24,
						excludeIds: installed.filter((i) => i.pluginId).map((i) => i.pluginId),
						sceneTags: tags
					} });
					setSceneState({
						loading: false,
						recs: r.filter((x) => x.origin === "scene"),
						sceneTags: tags
					});
				} catch (e) {
					console.error("fetch scene failed:", e);
					setSceneState({
						loading: false,
						recs: [],
						sceneTags: []
					});
				}
			};
			const onSwitchMode = async () => {
				const cur = profile?.modeOverride ?? "auto";
				const next = cur === "novice" || cur === "auto" && (profile?.confidence ?? 0) < .4 ? "auto" : "novice";
				try {
					await api("settings:update", { patch: { modeOverride: next } });
					if (next === "novice") markQuizTriggered();
					onInstalledChanged();
				} catch (e) {
					console.error("switch mode failed:", e);
				}
			};
			return El("div", {
				className: styles_module_css_default.backdrop,
				onClick: onClose
			}, El("div", {
				className: styles_module_css_default.panel,
				onClick: (e) => e.stopPropagation()
			}, El("div", { className: styles_module_css_default.header }, El("span", { className: styles_module_css_default.titleIcon }, El(MarketLogo, {
				size: 24,
				color: "var(--mkt-brand)",
				eyeColor: "#FFFFFF"
			})), El("span", { className: styles_module_css_default.title }, "插件市场"), El("span", { className: styles_module_css_default.subtitle }, `${plugins.length} 个插件`), El("button", {
				className: styles_module_css_default.headerClose,
				onClick: onClose,
				"aria-label": "关闭"
			}, El(Icon, {
				d: ICON_CLOSE,
				size: 14
			}))), selfUpdate?.hasUpdate ? El("div", { className: styles_module_css_default.selfUpdateBar }, El("span", { className: styles_module_css_default.selfUpdateText }, selfUpdating ? "正在更新插件…" : `插件有新版本 ${selfUpdate.current ?? "?"} → ${selfUpdate.latest ?? "?"}`), selfUpdating ? null : El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnPrimary}`,
				onClick: () => void applySelfUpdate()
			}, "获取命令"), selfUpdating ? null : El("button", {
				className: `${styles_module_css_default.btn} ${styles_module_css_default.btnSm} ${styles_module_css_default.btnGhost}`,
				onClick: () => setSelfDismissed(true)
			}, "忽略")) : null, El("div", { className: styles_module_css_default.tabs }, ...[
				{
					id: "recommend",
					label: "推荐"
				},
				{
					id: "search",
					label: "搜索"
				},
				{
					id: "packs",
					label: "整合包"
				},
				{
					id: "favorites",
					label: "收藏"
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
				onTagClick,
				onSwitchMode,
				onQuizSubmit: async (tags) => {
					await api("profile:update", { quizTags: tags });
					onInstalledChanged();
				},
				sceneState,
				onFetchScene
			}) : tab === "search" ? El(SearchTab, {
				plugins,
				onInstall: setInstallTarget,
				onTagClick
			}) : tab === "packs" ? El(PacksTab, {
				packs,
				onInstallPack: (pack) => {
					window.open(`https://github.com/${pack.id}`, "_blank");
				}
			}) : tab === "favorites" ? El(FavoritesTab, {
				plugins,
				onInstall: setInstallTarget,
				onTagClick,
				refreshTick: refreshKey,
				onGotoRecommend: () => setTab("recommend")
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
		/** 入口按钮：侧边栏底部「设置」旁的图标按钮（issue #101：独占一行 + 16px 图标对齐官方） */
		function MarketTrigger(props) {
			const open = (0, react.useSyncExternalStore)(subscribe, getOpen, getOpen);
			return (0, react.createElement)("button", {
				className: styles_module_css_default.trigger,
				onClick: toggle,
				title: "插件市场",
				"aria-label": "插件市场",
				"data-active": open || void 0
			}, (0, react.createElement)("span", { className: styles_module_css_default.triggerIcon }, (0, react.createElement)(MarketLogo, {
				size: 16,
				color: open ? "currentColor" : "currentColor"
			})), props.wide ? (0, react.createElement)("span", { className: styles_module_css_default.triggerLabel }, "插件市场") : null);
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