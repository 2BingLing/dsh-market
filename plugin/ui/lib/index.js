import { createRequire } from "node:module";
import { join } from "node:path";
import { aggregateTags, applyUpdate, canonicalCommands, checkSelfUpdate, checkUpdates, deriveSmokeCommands, detectPnpmMajor, fetchCurrentUser, fetchMarketData, fetchPacksData, fetchStarred, hotTags, installPlugin, learnRecipe, listRecipes, metricSummary, parseBlockedBuilds, parseInstallVerdict, readProfile, readSettings, recommend, recordInstallMetric, resolveConfig, routeInstall, scanInstalled, search, uninstallPlugin, updateProfile, verifyAfterInstall, writeBuildApprovals, writeMinimumReleaseAge, writeProfile, writeSettings } from "@dsh-market/core";
import { execFile } from "node:child_process";
//#region src/index.ts
/** 命令执行器：正式包运行在 harness 进程（无 shell 沙箱），可直接管道捕获。
*  平台适配（issue #78）：Win32 用 cmd.exe，POSIX（macOS/Linux）用 /bin/sh -c。 */
const name = "dsh-market";
const inject = ["webServer"];
/** 读取插件包与核心库版本（设置页「关于」显示） */
const require = createRequire(import.meta.url);
function readVersions() {
	const out = {};
	for (const pkg of [
		"@dsh-market/plugin",
		"@dsh-market/core",
		"@dsh-market/schema"
	]) try {
		out[pkg] = require(`${pkg}/package.json`).version;
	} catch {
		out[pkg] = "unknown";
	}
	return out;
}
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
/** 精简整合包字段（条目 + 解析率 + 评分） */
function litePack(p) {
	return {
		id: p.id,
		name: p.name,
		author: p.author,
		descriptionZh: p.descriptionZh,
		tags: p.tags,
		stars: p.stars,
		pushedAt: p.pushedAt,
		curated: p.curated,
		scoreTotal: p.score?.total ?? 0,
		entryStats: p.entryStats ?? {
			total: 0,
			ok: 0,
			failed: 0,
			inMarket: 0
		},
		entries: (p.entries ?? []).map((e) => ({
			id: e.id,
			type: e.type,
			version: e.version,
			resolved: e.resolved ?? null
		}))
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
				remoteUrl: cfg.remoteUrl,
				versions: readVersions()
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
			case "packs": return (await fetchPacksData(cfg)).map(litePack);
			case "pack:get": return (await fetchPacksData(cfg)).find((p) => p.id === args.packId) ?? null;
			case "installed": return (await market()).plugins && scanInstalled(cfg, await market()).map((i) => ({
				...i,
				plugin: i.plugin ? lite(i.plugin) : null
			}));
			case "update:check": {
				const data = await market();
				const installed = scanInstalled(cfg, data);
				return checkUpdates(cfg, installed, { force: Boolean(args.force) });
			}
			case "update:self": {
				const current = readVersions()["@dsh-market/plugin"];
				if (!current) throw new Error("无法读取当前插件版本");
				const check = await checkSelfUpdate(current, { force: Boolean(args.force) });
				if (!args.apply) return check;
				const manualCommand = `dsh plugin --profile ${readSettings(cfg).profile} add @dsh-market/plugin@latest`;
				return {
					...check,
					applied: false,
					needsManual: true,
					manualCommand,
					reason: `更新插件市场自身需要在停止 harness 后执行（运行中就地覆盖会被文件占用拦截）：\n${manualCommand}\n然后重启 harness。`
				};
			}
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
				const profile = args.targetProfile ?? readSettings(cfg).profile;
				const smoke = deriveSmokeCommands(cfg, plugin, profile);
				const r = await installPlugin(cfg, plugin, {
					dryRun: Boolean(args.dryRun),
					force: Boolean(args.force),
					targetProfile: profile,
					runner: realRunner(),
					smoke
				});
				if (r.ok && !r.alreadyInstalled && !args.dryRun && !r.smokeFailed) learnRecipe(cfg, plugin, profile, {
					commands: canonicalCommands(cfg, plugin, profile),
					smoke,
					learnedFrom: "parsed"
				});
				recordInstallMetric(cfg, {
					ts: (/* @__PURE__ */ new Date()).toISOString(),
					pluginId: plugin.id,
					type: "install",
					mode: "direct",
					ok: r.ok,
					alreadyInstalled: r.alreadyInstalled,
					smokeFailed: r.smokeFailed,
					recipeLearned: Boolean(r.ok && !r.alreadyInstalled && !args.dryRun && !r.smokeFailed)
				});
				if (r.ok && !r.alreadyInstalled && !args.dryRun) r.activation = verifyAfterInstall(cfg, plugin, { profile });
				if (!r.ok) {
					const blocked = parseBlockedBuilds(r.error ?? "");
					if (blocked.length > 0) r.blockedBuilds = blocked;
				}
				return r;
			}
			case "verify": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				return verifyAfterInstall(cfg, plugin, { profile: args.targetProfile ?? readSettings(cfg).profile });
			}
			case "update:apply": {
				const data = await market();
				const plugin = data.plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const item = scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId) ?? {
					pluginId: args.pluginId,
					localName: args.localName ?? plugin.name,
					version: null,
					source: "profile",
					plugin
				};
				return applyUpdate(cfg, plugin, item, {
					runner: realRunner(),
					profile: args.targetProfile ?? readSettings(cfg).profile
				});
			}
			case "update:relax": {
				const profile = args.profile ?? readSettings(cfg).profile;
				return writeMinimumReleaseAge(join(cfg.profilesDir, profile), 0);
			}
			case "builds:approve": {
				const profile = args.profile ?? readSettings(cfg).profile;
				const profileDir = join(cfg.profilesDir, profile);
				const major = await detectPnpmMajor({
					runner: realRunner(),
					cwd: profileDir
				});
				return writeBuildApprovals(profileDir, args.packages ?? [], { pnpmMajor: major });
			}
			case "uninstall": {
				const data = await market();
				const plugin = data.plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const item = scanInstalled(cfg, data).find((i) => i.pluginId === args.pluginId);
				return uninstallPlugin(cfg, plugin, {
					targetProfile: args.targetProfile ?? readSettings(cfg).profile,
					runner: realRunner(),
					localName: item?.localName
				});
			}
			case "ai:install": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const profile = args.targetProfile ?? readSettings(cfg).profile;
				const t0 = await routeInstall(cfg, plugin, {
					profile,
					runner: realRunner(),
					force: Boolean(args.force)
				});
				if (!t0.needAi) {
					recordInstallMetric(cfg, {
						ts: (/* @__PURE__ */ new Date()).toISOString(),
						pluginId: plugin.id,
						type: "ai",
						mode: t0.mode,
						ok: t0.ok,
						alreadyInstalled: t0.alreadyInstalled,
						smokeFailed: t0.result?.smokeFailed ?? false,
						error: t0.result?.error ?? null
					});
					return {
						started: false,
						childSessionId: null,
						mode: t0.mode,
						ok: t0.ok,
						alreadyInstalled: t0.alreadyInstalled ?? false,
						smokeFailed: t0.result?.smokeFailed ?? false,
						error: t0.result?.error ?? null
					};
				}
				const agents = ctx.get("agents");
				const subagents = ctx.get("subagents");
				if (!subagents) throw new Error("子代理服务不可用");
				const agent = agents?.list?.()?.[0];
				if (!agent) throw new Error("当前会话代理不可用");
				const provider = subagents.list().includes("spawn") ? "spawn" : subagents.list()[0];
				const prompt = buildInstallPrompt(plugin, profile, t0.reason);
				const run = await Promise.race([subagents.start(provider, {
					label: `安装 ${plugin.name}`,
					prompt: [{
						type: "text",
						text: prompt
					}],
					parent: agent,
					signal: AbortSignal.timeout(6e5)
				}), new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("子代理启动超时")), 1e4))]);
				const sessionId = run.sessionId ?? run.id ?? null;
				recordInstallMetric(cfg, {
					ts: (/* @__PURE__ */ new Date()).toISOString(),
					pluginId: plugin.id,
					type: "ai",
					mode: "t1",
					ok: false,
					phase: "start",
					error: t0.reason ?? null
				});
				if (sessionId) {
					const sq = ctx.get("sessionQuery");
					if (sq?.readSession) watchInstallVerdict({
						cfg,
						plugin,
						profile,
						sessionId,
						readSession: sq.readSession
					});
				}
				return {
					started: true,
					childSessionId: sessionId,
					mode: "t1",
					reason: t0.reason ?? null
				};
			}
			case "recipe:list": return listRecipes(cfg);
			case "recipe:save": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const commands = args.commands;
				if (!commands || commands.length === 0) throw new Error("缺少 commands");
				learnRecipe(cfg, plugin, args.targetProfile ?? readSettings(cfg).profile, {
					commands,
					smoke: args.smoke,
					config: args.config,
					learnedFrom: args.learnedFrom ?? "t1"
				});
				return { ok: true };
			}
			case "metrics:summary": return metricSummary(cfg);
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
/** 生成 AI 安装任务的子代理提示词（路由协议 T1：极简安装执行器）。
*  协议而非散文：固定步骤 + 禁止清单 + 严格 JSON 输出，最小 token 完成安装。 */
function buildInstallPrompt(plugin, targetProfile, reason) {
	const cmdLine = plugin.install.commands && plugin.install.commands.length > 0 ? plugin.install.commands.join("\n    ") : "(无)";
	return [
		`你是「极简安装执行器」，安装 DSH 插件「${plugin.name}」（${plugin.fullName}）。只做安装，不做别的。`,
		``,
		`【插件信息】`,
		`- 类型：${plugin.type === "skill" ? "skill（技能）" : "cordis 插件"}（${plugin.type}）`,
		`- 简介：${plugin.descriptionZh ?? "(无中文简介)"}`,
		`- 需要配置：${plugin.install.needsConfig ? "是（API Key / Token 等）" : "否"}`,
		`- 目标 profile：${targetProfile}`,
		`- 参考命令（collector 已从 README 解析，优先直接使用）：`,
		`    ${cmdLine}`,
		...reason ? [`- 前序尝试（T0 已失败，仅作线索，不要重复踩坑）：${reason}`] : [],
		``,
		`【协议（必须遵守）】`,
		`1. 先执行参考命令（可做最少修正：包管理器 / 平台差异）。不要先读 README。`,
		`2. 命令缺失或明显错误时：只读仓库 README 的安装段落（grep install/安装/代码块，前 200 行），禁止全文阅读。`,
		`3. 执行后必须验证：${plugin.type === "skill" ? "技能目录存在且含 SKILL.md" : `profile「${targetProfile}」的 package.json 的 dependencies 含包名`}；exit 0 且验证通过才算成功。`,
		`4. 失败时：重试 1 次 → 用错误文本 grep README → 仍失败则如实放弃并报告，不要无限尝试。`,
		`5. 需要配置（API Key/Token/环境变量）时：只填 config_needed，不猜测、不伪造、不自行写入；先停下向用户确认。`,
		`6. 全程禁止：思考过程、解释、总结散文、阅读文档其余部分、搜索网络（除非 README 明确引用必要的安装文档）。`,
		``,
		`【输出】严格 JSON，无其他文本：`,
		`{"ok":true|false,"commands":["实际执行的命令"],"smoke":["执行并验证的命令"],"fail":"失败与已尝试方案（失败时）","config_needed":null|{"what":"需要什么配置","hint":"在哪获取"},"recipe":{"commands":["可用安装命令"],"smoke":["验证命令"]}}`
	].join("\n");
}
/** T1 子代理验收（后台，不阻塞 RPC）：轮询子会话输出 → 解析 JSON verdict →
*  ok 且带命令 → 学配方（learnedFrom=t1，含 config_needed）；记录完成度量（sessionChars 为 token 粗略代理）。
*  终止条件：拿到 verdict（成功或失败）→ 停止；否则轮询到 10 分钟上限。 */
async function watchInstallVerdict(opts) {
	const { cfg, plugin, profile, sessionId, readSession } = opts;
	const deadline = Date.now() + 6e5;
	let chars = 0;
	const tick = async () => {
		let done = false;
		try {
			const text = collectSessionText((await readSession(sessionId))?.events ?? []);
			chars = Math.max(chars, text.length);
			const verdict = parseInstallVerdict(text);
			if (verdict && verdict.ok && verdict.commands && verdict.commands.length > 0) {
				const recipe = verdict.recipe ?? {
					commands: verdict.commands,
					smoke: verdict.smoke
				};
				learnRecipe(cfg, plugin, profile, {
					commands: recipe.commands ?? verdict.commands,
					smoke: recipe.smoke,
					...verdict.configNeeded?.what ? { config: {
						type: "env",
						prompt: verdict.configNeeded.what
					} } : {},
					learnedFrom: "t1"
				});
				recordInstallMetric(cfg, {
					ts: (/* @__PURE__ */ new Date()).toISOString(),
					pluginId: plugin.id,
					type: "ai",
					mode: "t1",
					ok: true,
					phase: "done",
					recipeLearned: true,
					sessionChars: chars
				});
				done = true;
			} else if (verdict && verdict.ok === false) {
				recordInstallMetric(cfg, {
					ts: (/* @__PURE__ */ new Date()).toISOString(),
					pluginId: plugin.id,
					type: "ai",
					mode: "t1",
					ok: false,
					phase: "done",
					sessionChars: chars,
					error: verdict.fail
				});
				done = true;
			}
		} catch {}
		if (!done && Date.now() < deadline) setTimeout(() => void tick(), 5e3);
	};
	setTimeout(() => void tick(), 5e3);
}
/** 从会话事件里收集全部文本（user/assistant/tool 的 content[i].text 与 data.text/text 字段） */
function collectSessionText(events) {
	const parts = [];
	for (const e of events) {
		const content = e?.data?.content;
		if (Array.isArray(content)) {
			for (const c of content) if (c && typeof c === "object" && c.type === "text" && typeof c.text === "string") parts.push(c.text);
		} else if (typeof e?.data?.text === "string") parts.push(e.data.text);
		else if (typeof e?.text === "string") parts.push(e.text);
	}
	return parts.join("\n");
}
const isWin = process.platform === "win32";
function realRunner() {
	return { run(command, opts) {
		return new Promise((resolve, reject) => {
			const file = isWin ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
			execFile(file, isWin ? [
				"/d",
				"/s",
				"/c",
				command
			] : ["-c", command], {
				cwd: opts.cwd,
				timeout: opts.timeoutMs ?? 12e4,
				windowsHide: isWin,
				env: opts.env ? {
					...process.env,
					...opts.env
				} : void 0
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
