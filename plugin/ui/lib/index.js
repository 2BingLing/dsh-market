import { aggregateTags, fetchCurrentUser, fetchMarketData, fetchStarred, hotTags, installPlugin, readProfile, readSettings, recommend, resolveConfig, scanInstalled, search, uninstallPlugin, updateProfile, writeProfile, writeSettings } from "@dsh-market/core";
import { execFile } from "node:child_process";
//#region src/index.ts
/** 命令执行器：正式包运行在 harness 进程（无 shell 沙箱），可直接管道捕获 */
const name = "dsh-market";
const inject = ["webServer"];
/** 精简插件字段（与 cli.ts 的 lite 一致，避免 1.3MB 全量过 HTTP） */
function lite(p) {
	return {
		id: p.id,
		type: p.type,
		name: p.name,
		fullName: p.fullName,
		descriptionZh: p.descriptionZh,
		tags: p.tags,
		stars: p.stars,
		pushedAt: p.pushedAt,
		curated: p.curated,
		curatedReason: p.curatedReason,
		scoreTotal: p.score?.total ?? 0,
		needsConfig: p.install?.needsConfig ?? false,
		installMethod: p.install?.method,
		installCommands: p.install?.commands ?? [],
		installTarget: p.install?.target
	};
}
function apply(ctx) {
	const cfg = resolveConfig();
	let cached = null;
	/** 用 settings.json 的 modeOverride 覆盖画像（settings 是用户覆盖的单一来源） */
	function withSettingsMode(profile) {
		if (!profile) return null;
		const s = readSettings(cfg);
		return {
			...profile,
			modeOverride: s.modeOverride ?? profile.modeOverride
		};
	}
	async function market() {
		if (!cached) cached = await fetchMarketData(cfg);
		return cached.data;
	}
	async function dispatch(method, args = {}) {
		switch (method) {
			case "config": return {
				skillsDir: cfg.skillsDir,
				profilesDir: cfg.profilesDir,
				dataDir: cfg.dataDir,
				defaultProfile: cfg.defaultProfile,
				remoteUrl: cfg.remoteUrl
			};
			case "settings": return readSettings(cfg);
			case "settings:update":
				writeSettings(cfg, args.patch ?? {});
				return readSettings(cfg);
			case "data": {
				const r = args.refresh ? await fetchMarketData(cfg) : cached ?? await fetchMarketData(cfg);
				if (args.refresh) cached = r;
				return {
					source: r.source,
					generatedAt: r.data.generatedAt,
					count: r.data.plugins.length
				};
			}
			case "plugins": return (await market()).plugins.map(lite);
			case "plugin:get": return (await market()).plugins.find((p) => p.id === args.pluginId) ?? null;
			case "installed": return (await market()).plugins && scanInstalled(cfg, await market()).map((i) => ({
				...i,
				plugin: i.plugin ? lite(i.plugin) : null
			}));
			case "profile:read": return withSettingsMode(readProfile(cfg));
			case "profile:update": {
				const data = await market();
				const prev = readProfile(cfg);
				const profile = updateProfile(prev, data.plugins, {
					installed: args.installed,
					starredFullNames: args.starredFullNames,
					quizTags: args.quizTags
				});
				writeProfile(cfg, profile);
				return withSettingsMode(readProfile(cfg));
			}
			case "profile:reset":
				writeProfile(cfg, {
					tags: {},
					sources: {
						installed: [],
						starred: [],
						quiz: [],
						installedPluginIds: []
					},
					confidence: 0,
					modeOverride: "auto",
					updatedAt: (/* @__PURE__ */ new Date()).toISOString()
				});
				return readProfile(cfg);
			case "search": {
				const data = await market();
				return search(data.plugins, String(args.query ?? ""), args.options).map((r) => ({
					plugin: lite(r.plugin),
					relevance: r.relevance,
					tagHits: r.tagHits
				}));
			}
			case "tags:hot": return hotTags((await market()).plugins, args.n ?? 12);
			case "tags:all": return aggregateTags((await market()).plugins);
			case "scene:context": {
				const agent = ctx.get("agents")?.list?.()?.[0];
				const sessionId = agent?.sessionId ?? agent?.id;
				const sq = ctx.get("sessionQuery");
				if (!sessionId || !sq) return {
					sceneTags: [],
					sceneText: ""
				};
				let title = "";
				const msgs = [];
				const tools = [];
				try {
					title = (await sq.readTitle?.(sessionId))?.title ?? "";
					const evts = (await sq.readSession?.(sessionId))?.events ?? [];
					for (const e of evts.slice(-60)) if (e.type === "user/message") {
						const txt = (e.data?.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join(" ");
						if (txt) msgs.push(txt);
					} else if (e.type === "tool/call") {
						const n = e.data?.name;
						if (typeof n === "string") tools.push(n);
					}
				} catch {}
				const text = [
					title,
					...msgs.slice(-4),
					...tools.slice(-8)
				].join(" ");
				return {
					sceneTags: extractSceneTags(text, (await market()).plugins),
					sceneText: text.slice(0, 200)
				};
			}
			case "search:semantic": {
				const query = String(args.query ?? "").trim();
				if (!query) return {
					picks: [],
					results: []
				};
				const llm = ctx.get("llm");
				if (!llm) throw new Error("LLM 服务不可用");
				const data = await market();
				const candidates = search(data.plugins, query, { limit: 60 });
				if (candidates.length === 0) return {
					picks: [],
					results: []
				};
				const lines = candidates.map((c, i) => {
					const zhTags = c.plugin.tags.filter((t) => /[\u4e00-\u9fff]/.test(t)).slice(0, 4).join("/");
					return `${i}. ${c.plugin.name}｜${(c.plugin.descriptionZh ?? "").slice(0, 60)}｜${zhTags}`;
				});
				const prompt = [
					"你是 DSH 插件市场的选品助手。用户的需求描述：「" + query + "」",
					"候选插件（编号. 名称｜中文简介｜中文标签）：",
					...lines,
					"任务：从候选中选出最符合用户需求的插件（最多 20 个，按匹配度从高到低排序）。",
					"只输出 JSON：{\"picks\":[{\"i\":编号,\"reason\":\"为什么适合（20 字内）\"}]}，不要输出其他文字。"
				].join("\n");
				let text = "";
				try {
					const stream = llm.stream({
						provider: "opencode-go",
						model: "deepseek-v4-flash",
						messages: [{
							role: "user",
							content: [{
								type: "text",
								text: prompt
							}]
						}]
					});
					for await (const chunk of stream) {
						const t = chunk && (chunk.text ?? chunk.delta ?? null);
						if (typeof t === "string") text += t;
					}
				} catch (e) {
					console.error("semantic search llm failed:", e);
				}
				const picks = parsePicks(text);
				return {
					picks,
					results: (picks.length > 0 ? picks : candidates.slice(0, 20).map((c, i) => ({
						i,
						reason: ""
					}))).map((p) => {
						const c = candidates[p.i];
						if (!c) return null;
						return {
							plugin: lite(c.plugin),
							relevance: c.relevance,
							tagHits: c.tagHits,
							aiReason: p.reason
						};
					}).filter((x) => x !== null)
				};
			}
			case "recommend": {
				const data = await market();
				const profile = withSettingsMode(readProfile(cfg)) ?? updateProfile(null, data.plugins, {});
				return recommend(data.plugins, profile, args.options).map((r) => ({
					plugin: lite(r.plugin),
					score: r.score,
					relevance: r.relevance,
					reasons: r.reasons,
					origin: r.origin
				}));
			}
			case "install": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				return installPlugin(cfg, plugin, {
					dryRun: Boolean(args.dryRun),
					force: Boolean(args.force),
					targetProfile: args.targetProfile ?? readSettings(cfg).profile,
					runner: realRunner()
				});
			}
			case "uninstall": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				return uninstallPlugin(cfg, plugin, {
					targetProfile: args.targetProfile ?? readSettings(cfg).profile,
					runner: realRunner()
				});
			}
			case "ai:install": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const agents = ctx.get("agents");
				const subagents = ctx.get("subagents");
				if (!subagents) throw new Error("子代理服务不可用");
				const agent = agents?.list?.()?.[0];
				if (!agent) throw new Error("当前会话代理不可用");
				const provider = subagents.list().includes("spawn") ? "spawn" : subagents.list()[0];
				const prompt = buildInstallPrompt(plugin, readSettings(cfg).profile);
				const run = await Promise.race([subagents.start(provider, {
					label: `安装 ${plugin.name}`,
					prompt: [{
						type: "text",
						text: prompt
					}],
					parent: agent,
					signal: AbortSignal.timeout(6e5)
				}), new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("子代理启动超时")), 1e4))]);
				return {
					started: true,
					childSessionId: run.sessionId ?? run.id ?? null
				};
			}
			case "gh:deviceCode": return (await fetch("https://github.com/login/device/code", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"User-Agent": "dsh-market"
				},
				body: JSON.stringify(args.body ?? {}),
				signal: AbortSignal.timeout(15e3)
			})).json();
			case "gh:token": return (await fetch("https://github.com/login/oauth/access_token", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
					"User-Agent": "dsh-market"
				},
				body: JSON.stringify(args.body ?? {}),
				signal: AbortSignal.timeout(15e3)
			})).json();
			case "gh:user":
				if (!args.token) throw new Error("no token");
				return fetchCurrentUser(String(args.token));
			case "gh:starred": return fetchStarred({
				token: args.token,
				username: args.username
			});
			case "gh:star": {
				const { token, owner, repo, action } = args;
				if (!token) throw new Error("未绑定 GitHub");
				if (!owner || !repo) throw new Error("缺少 owner/repo");
				const method = action === "unstar" ? "DELETE" : "PUT";
				const r = await fetch(`https://api.github.com/user/starred/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
					method,
					headers: {
						Authorization: `Bearer ${token}`,
						"User-Agent": "dsh-market",
						"Content-Length": "0"
					},
					signal: AbortSignal.timeout(15e3)
				});
				if (!r.ok) {
					const body = await r.text().catch(() => "");
					throw new Error(`GitHub star ${r.status}: ${body.slice(0, 200)}`);
				}
				return { ok: true };
			}
			default: throw new Error(`未知方法: ${method}`);
		}
	}
	ctx.effect(() => ctx.webServer.register({
		kind: "prefix",
		path: "/market/api",
		handler: async (req, res) => {
			if (req.method !== "POST") {
				res.writeHead(405, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: false,
					error: "method not allowed"
				}));
				return;
			}
			try {
				const payload = await readJsonBody(req);
				const result = await dispatch(payload.method, payload.args);
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: true,
					result
				}));
			} catch (err) {
				res.writeHead(200, { "content-type": "application/json" });
				res.end(JSON.stringify({
					ok: false,
					error: err.message
				}));
			}
		}
	}), "dsh-market: /market/api routes");
}
/** 读取 JSON 请求体 */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > 4194304) {
				reject(/* @__PURE__ */ new Error("body too large"));
				req.destroy();
			}
		});
		req.on("end", () => {
			try {
				resolve(body ? JSON.parse(body) : {});
			} catch (err) {
				reject(err);
			}
		});
		req.on("error", reject);
	});
}
/** 从会话文本提取场景标签（零 token：子串匹配插件标签/插件名） */
function extractSceneTags(text, plugins) {
	const lower = text.toLowerCase();
	const hits = /* @__PURE__ */ new Map();
	for (const p of plugins) {
		const nameHit = p.name && lower.includes(p.name.toLowerCase());
		for (const t of p.tags) {
			if (t.length < 2) continue;
			if (lower.includes(t.toLowerCase())) hits.set(t, (hits.get(t) ?? 0) + (nameHit ? 2 : 1));
		}
	}
	return [...hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
}
/** 容错解析 LLM 输出的选品 JSON：{"picks":[{"i":编号,"reason":"..."}]} */
function parsePicks(text) {
	const m = text.match(/\{[\s\S]*\}/);
	if (!m) return [];
	try {
		const obj = JSON.parse(m[0]);
		if (!Array.isArray(obj.picks)) return [];
		return obj.picks.filter((p) => typeof p === "object" && p !== null).map((p) => ({
			i: Number(p.i),
			reason: typeof p.reason === "string" ? p.reason.slice(0, 30) : ""
		})).filter((p) => Number.isInteger(p.i) && p.i >= 0).slice(0, 20);
	} catch {
		return [];
	}
}
/** 生成 AI 安装任务的子代理提示词（Codex 式：读文档 → 确认 → 执行 → 验证） */
function buildInstallPrompt(plugin, targetProfile) {
	const cmdLine = plugin.install.commands && plugin.install.commands.length > 0 ? plugin.install.commands.join("\n    ") : "(无预解析命令，请阅读 README 确定)";
	return [
		`请安装 DSH 插件「${plugin.name}」（${plugin.fullName}）。`,
		``,
		`【插件信息】`,
		`- 类型：${plugin.type === "skill" ? "skill（技能）" : "cordis 插件"}（${plugin.type}）`,
		`- 简介：${plugin.descriptionZh ?? "(无中文简介)"}`,
		`- Stars：${plugin.stars}`,
		`- 需要配置：${plugin.install.needsConfig ? "是（API Key / Token 等）" : "否"}`,
		`- 参考安装命令（来自 README 解析，可能不精确）：`,
		`    ${cmdLine}`,
		``,
		`【安装要求】`,
		`1. 先阅读仓库 README（https://github.com/${plugin.fullName}，可用 web_search 或抓取 raw README）确认真实安装方式，不要照搬上面可能过时的命令。`,
		`2. ${plugin.type === "skill" ? `skill 型：按 README 指示安装到技能目录（通常 ~/.agents/skills，目录名建议 ${plugin.name} 或 ${plugin.name}-<版本>），常见方式是 git clone。` : `cordis 型：在目标 profile「${targetProfile}」执行 dsh plugin --profile ${targetProfile} add <真实包名或源>（npm 包名 / git 地址 / 本地目录均可）。`}`,
		`3. 需要配置（API Key/Token/环境变量）时，先向用户询问确认，不要猜测或伪造配置。`,
		`4. 安装前检查是否已装（skill 目录存在 / profile 依赖已含），已装则直接告知用户并停止。`,
		`5. 安装完成后做最小验证（目录/依赖存在；能读到 README 或 main 入口），然后简洁汇报：装了什么、装在哪里、是否需要重启 harness、需要什么配置。`,
		`6. 遇到问题（网络、权限、命令失败）先尝试修复或换用 README 的备用安装方式；确实无法完成时如实报告失败原因和已尝试的方案。`
	].join("\n");
}
function realRunner() {
	return { run(command, opts) {
		return new Promise((resolve, reject) => {
			execFile(process.env.ComSpec ?? "cmd.exe", [
				"/d",
				"/s",
				"/c",
				command
			], {
				cwd: opts.cwd,
				timeout: opts.timeoutMs ?? 12e4,
				windowsHide: true
			}, (err, stdout, stderr) => {
				if (err) {
					reject(new Error(stderr || stdout || err.message));
					return;
				}
				resolve({
					exitCode: 0,
					stdout,
					stderr
				});
			});
		});
	} };
}
//#endregion
export { apply, inject, name };
