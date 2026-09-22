import { createRequire } from "node:module";
import { join } from "node:path";
import { aggregateTags, appendOpLog, applyUpdate, canonicalCommands, checkSelfUpdate, checkUpdates, classifyFailure, deriveSmokeCommands, detectPnpmMajor, exportLogText, extractInstallPkgName, fetchCurrentUser, fetchMarketData, fetchPacksData, fetchStarred, guardInstallCommands, hotTags, installPlugin, learnRecipe, listRecipes, liteDshCompat, loadMarketData, metricSummary, parseBlockedBuilds, parseInstallVerdict, readOpLogTail, readProfile, readSettings, recommend, recordInstallMetric, resolveConfig, routeInstall, scanInstalled, search, uninstallPlugin, updateProfile, verifyAfterInstall, writeBuildApprovals, writeMinimumReleaseAge, writeProfile, writeSettings } from "@dsh-market/core";
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
		risky: p.install?.risky ?? false,
		riskyReasons: p.install?.riskyReasons ?? [],
		installMethod: p.install?.method,
		installCommands: p.install?.commands ?? [],
		installTarget: p.install?.target,
		dshCompat: liteDshCompat(p)
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
	/**
	* 取市场数据：缓存优先（stale-while-revalidate）。
	* 命中未过期缓存直接返回、不发网络请求——这是「打开面板要等 6-8 秒」的修复点：
	* 旧实现是远程优先，每个进程首次打开都要重下整份索引。
	* 过期缓存会先返回旧数据，同时后台刷新，完成后更新这里的快照，下次打开即最新。
	*/
	async function market() {
		if (!cached) cached = await loadMarketData(cfg, { revalidate: (fresh) => {
			cached = fresh;
		} });
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
			case "data":
				if (args.refresh || !cached) cached = args.refresh ? await fetchMarketData(cfg) : await loadMarketData(cfg, { revalidate: (fresh) => {
					cached = fresh;
				} });
				return {
					source: cached.source,
					stale: cached.stale ?? false,
					ageMs: cached.ageMs ?? 0,
					generatedAt: cached.data.generatedAt,
					count: cached.data.plugins.length
				};
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
					tagHits: r.tagHits,
					via: r.via
				}));
			}
			case "tags:hot": return hotTags((await market()).plugins, args.n ?? 12);
			case "tags:all": return aggregateTags((await market()).plugins);
			case "scene:context": {
				const agents = ctx.get("agents");
				const agent = (agents?.roots?.() ?? agents?.list?.() ?? [])[0];
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
					const t = await sq.readTitle?.(sessionId);
					title = typeof t === "string" ? t : t?.title ?? "";
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
					tags: [],
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
					const cls = classifyFailure(r.error ?? "");
					r.classified = cls;
					appendOpLog(cfg, {
						t: (/* @__PURE__ */ new Date()).toISOString(),
						op: "install",
						ok: false,
						code: cls.code,
						msg: cls.title,
						target: plugin.id,
						detail: r.error ?? ""
					});
				} else appendOpLog(cfg, {
					t: (/* @__PURE__ */ new Date()).toISOString(),
					op: "install",
					ok: true,
					target: plugin.id
				});
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
				const r = await applyUpdate(cfg, plugin, item, {
					runner: realRunner(),
					profile: args.targetProfile ?? readSettings(cfg).profile
				});
				if (!r.applied) {
					const cls = classifyFailure(r.error ?? r.reason ?? "");
					r.classified = cls;
					appendOpLog(cfg, {
						t: (/* @__PURE__ */ new Date()).toISOString(),
						op: "update",
						ok: false,
						code: cls.code,
						msg: cls.title,
						target: plugin.id,
						detail: r.error ?? r.reason ?? ""
					});
				} else appendOpLog(cfg, {
					t: (/* @__PURE__ */ new Date()).toISOString(),
					op: "update",
					ok: true,
					target: plugin.id
				});
				return r;
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
				const r = await uninstallPlugin(cfg, plugin, {
					targetProfile: args.targetProfile ?? readSettings(cfg).profile,
					runner: realRunner(),
					localName: item?.localName
				});
				if (!r.ok) {
					const cls = classifyFailure(r.error ?? "");
					r.classified = cls;
					appendOpLog(cfg, {
						t: (/* @__PURE__ */ new Date()).toISOString(),
						op: "uninstall",
						ok: false,
						code: cls.code,
						msg: cls.title,
						target: plugin.id,
						detail: r.error ?? ""
					});
				} else appendOpLog(cfg, {
					t: (/* @__PURE__ */ new Date()).toISOString(),
					op: "uninstall",
					ok: true,
					target: plugin.id
				});
				return r;
			}
			case "ai:install": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const profile = args.targetProfile ?? readSettings(cfg).profile;
				const security = Boolean(args.security);
				const installId = String(args.installId ?? "");
				const ac = new AbortController();
				if (installId) activeInstalls.set(installId, ac);
				try {
					return await runAiInstall({
						cfg,
						ctx,
						args,
						plugin,
						profile,
						security,
						signal: ac.signal
					});
				} finally {
					if (installId) activeInstalls.delete(installId);
				}
			}
			case "ai:install:cancel": {
				const id = String(args.installId ?? "");
				const ac = activeInstalls.get(id);
				if (!ac) return {
					ok: false,
					error: "没有进行中的安装或已完成"
				};
				ac.abort();
				return { ok: true };
			}
			case "ai:review": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const installId = String(args.installId ?? "");
				const ac = new AbortController();
				if (installId) activeInstalls.set(installId, ac);
				const agents = ctx.get("agents");
				const subagents = ctx.get("subagents");
				if (!subagents) throw new Error("子代理服务不可用");
				const agent = (agents?.roots?.() ?? agents?.list?.() ?? [])[0];
				if (!agent) throw new Error("当前会话代理不可用");
				const provider = subagents.list().includes("spawn") ? "spawn" : subagents.list()[0];
				const prompt = buildReviewPrompt(plugin);
				const run = await Promise.race([subagents.start(provider, {
					label: `安全审查 ${plugin.name}`,
					prompt: [{
						type: "text",
						text: prompt
					}],
					parent: agent,
					signal: AbortSignal.any([ac.signal, AbortSignal.timeout(36e4)])
				}), new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("子代理启动超时")), 1e4))]);
				const sessionId = run.sessionId ?? run.id ?? null;
				if (sessionId && installId) {
					reviewResults.set(installId, { done: false });
					const sq = ctx.get("sessionQuery");
					if (sq?.readSession) watchReviewVerdict({
						installId,
						sessionId,
						readSession: sq.readSession,
						signal: ac.signal
					});
				}
				return {
					started: true,
					childSessionId: sessionId
				};
			}
			case "ai:review:poll": {
				const id = String(args.installId ?? "");
				if (activeInstalls.get(id)?.signal.aborted) {
					activeInstalls.delete(id);
					reviewResults.delete(id);
					return {
						done: true,
						cancelled: true
					};
				}
				const entry = reviewResults.get(id);
				if (!entry || !entry.done) return { done: false };
				reviewResults.delete(id);
				activeInstalls.delete(id);
				return {
					done: true,
					verdict: entry.verdict ?? null
				};
			}
			case "ai:install:reviewed": {
				const plugin = (await market()).plugins.find((p) => p.id === args.pluginId);
				if (!plugin) throw new Error(`插件不存在: ${args.pluginId}`);
				const profile = args.targetProfile ?? readSettings(cfg).profile;
				const commands = args.commands ?? [];
				if (commands.length === 0) throw new Error("缺少 commands");
				const installId = String(args.installId ?? "");
				const ac = new AbortController();
				if (installId) activeInstalls.set(installId, ac);
				try {
					const g = guardInstallCommands(plugin, commands, { allowedDestPrefix: cfg.skillsDir });
					if (!g.ok) return {
						started: false,
						ok: false,
						blocked: g.blocked,
						manual: g.blocked.map((b) => b.command),
						error: "部分命令未通过直装白名单，请手动执行"
					};
					const pkgName = commands.map(extractInstallPkgName).find((n) => n !== null) ?? void 0;
					const smoke = deriveSmokeCommands(cfg, plugin, profile, pkgName);
					const r = await installPlugin(cfg, plugin, {
						commands,
						smoke,
						targetProfile: profile,
						runner: realRunner(),
						force: Boolean(args.force),
						signal: ac.signal
					});
					if (r.ok && !r.smokeFailed && !ac.signal.aborted) learnRecipe(cfg, plugin, profile, {
						commands,
						smoke,
						learnedFrom: "t1"
					});
					return {
						started: false,
						ok: r.ok,
						cancelled: ac.signal.aborted,
						smokeFailed: r.smokeFailed ?? false,
						error: r.error ?? null,
						classified: !r.ok && r.error ? classifyFailure(r.error) : void 0
					};
				} finally {
					if (installId) activeInstalls.delete(installId);
				}
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
			case "log:tail": return readOpLogTail(cfg, Number(args.n ?? 200));
			case "log:export": return exportLogText(cfg, readVersions());
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
				const msg = err.message ?? "unknown error";
				res.end(JSON.stringify({
					ok: false,
					error: msg,
					classified: classifyFailure(msg)
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
*  协议而非散文：固定步骤 + 禁止清单 + 严格 JSON 输出，最小 token 完成安装。
*  security=true（安全模式）：安装前先做供应链安全检查，发现风险先报告不安装。 */
function buildInstallPrompt(plugin, targetProfile, reason, opts) {
	const cmdLine = plugin.install.commands && plugin.install.commands.length > 0 ? plugin.install.commands.join("\n    ") : "(无)";
	const security = opts?.security === true;
	const securitySection = security ? [
		``,
		`【⛔ 安全模式：安装前必须先扫描（2026-09 新增；防御供应链投毒 + QVD-2026-57410 CVSS 9.8 式网络暴露攻击）】`,
		`在【协议】第 1 步执行命令**之前**，先完成以下安全检查：`,
		`1. 读插件仓库 README 全文关键段 + 安装用的脚本/清单（cordis.patch.yml / dsh.bundle / install.sh / package.json 等），逐个核对：`,
		`   a. 安装命令是否有危险模式：curl|sh、wget 后立即执行、下载二进制执行、base64 解码后执行、从不可信 URL 拉取代码；`,
		`   b. 是否收集/回传敏感信息：读取 API Key / Token / 环境变量（GITHUB_TOKEN、DEEPSEEK_API_KEY、OPENAI_API_KEY 等）并发送到外部地址；`,
		`   c. 是否篡改配置：patch 覆盖 harness 自身配置（sandbox/approval/权限）或把自身混入系统目录；`,
		`   d. 来源信号：仓库年龄与维护活跃、star 量级、是否近期新建（<30 天且低活跃的高危）；`,
		`   e. 网络暴露与信任围栏（QVD-2026-57410 实证：伪造 Host 头即可绕过 DSH 信任围栏，无需密钥直接命令执行——本地端口一旦出公网等于交出控制权）：`,
		`      - 安装脚本/文档是否把本地端口暴露到公网：绑定 0.0.0.0/:: 或 --host 0.0.0.0、EXPOSE、云服务器部署/域名反代/端口转发指引（ngrok、frp、cloudflared、localtunnel、花生壳、ssh -R 等）；`,
		`      - 自带 web 服务的插件是否弱化 Host/Origin 信任：allowedHosts 通配（true 或 "*"）、disableHostCheck、无条件信任 X-Forwarded-*，或诱导用户关闭 DSH 信任围栏/本机校验；`,
		`      - 远程访问的正确姿势是「服务留本机 + 隧道回连」（本地端口映射/远程终端），插件若提供远程使用指引，核对它是否遵守该原则；`,
		`2. 结论必须明确：`,
		`   - 无风险 → 继续按【协议】安装；`,
		`   - 发现可疑（危险命令 / 信息收集 / 配置篡改 / 网络暴露 / 来源存疑）→ **立即停止**：不执行任何命令，输出 {"ok":false,"security_blocked":true,"reason":"<具体风险描述>"} 并结束。`,
		`3. 需要配置时（协议第 5 条触发）：确认配置只写入本机（环境变量 / profile），不发送到任何外部地址。`,
		`4. 安装完成后把扫描要点与结论写入 recipe 的 "security" 字段（无风险也写 "no risk detected"）。`
	].join("\n") : [];
	return [
		`你是「极简安装执行器」，安装 DSH 插件「${plugin.name}」（${plugin.fullName}）。只做安装，不做别的。${security ? "本次为【安全模式】。" : ""}`,
		``,
		`【插件信息】`,
		`- 类型：${plugin.type === "skill" ? "skill（技能）" : "cordis 插件"}（${plugin.type}）`,
		`- 简介：${plugin.descriptionZh ?? "(无中文简介)"}`,
		`- 需要配置：${plugin.install.needsConfig ? "是（API Key / Token 等）" : plugin.install.usageNeedsConfig ? "安装无需；使用时需配置模型（可能产生费用）" : "否"}`,
		`- 目标 profile：${targetProfile}`,
		`- 参考命令（collector 已从 README 解析，优先直接使用）：`,
		`    ${cmdLine}`,
		...reason ? [`- 前序尝试（T0 已失败，仅作线索，不要重复踩坑）：${reason}`] : [],
		...securitySection,
		``,
		`【协议（必须遵守）】`,
		`1. 先执行参考命令（可做最少修正：包管理器 / 平台差异）。不要先读 README。${security ? "【安全模式下：先完成上方扫描，再执行本条】" : ""}`,
		`2. 命令缺失或明显错误时：只读仓库 README 的安装段落（grep install/安装/代码块，前 200 行），禁止全文阅读。`,
		`3. 执行后必须验证：${plugin.type === "skill" ? "技能目录存在且含 SKILL.md" : `profile「${targetProfile}」的 package.json 的 dependencies 含包名`}；exit 0 且验证通过才算成功。`,
		`4. 失败时：重试 1 次 → 用错误文本 grep README → 仍失败则如实放弃并报告，不要无限尝试。`,
		`5. 需要配置（API Key/Token/环境变量）时：只填 config_needed，不猜测、不伪造、不自行写入；先停下向用户确认。`,
		`6. 全程禁止：思考过程、解释、总结散文、阅读文档其余部分、搜索网络（除非 README 明确引用必要的安装文档）、用重定向包管理器全局目录/缓存目录等方式绕过沙箱写权限（目标目录写不进就如实报告失败，不要绕路）、原样重试被直装安全白名单拦截过的命令（前序尝试里注明"未通过直装白名单"的命令只能分析不能执行）。`,
		``,
		`【输出】严格 JSON，无其他文本：`,
		`{"ok":true|false,"commands":["实际执行的命令"],"smoke":["执行并验证的命令"],"fail":"失败与已尝试方案（失败时）","config_needed":null|{"what":"需要什么配置","hint":"在哪获取"},"recipe":{"commands":["可用安装命令"],"smoke":["验证命令"]}${security ? `,"security_blocked":false|true,"security_reason":"安全扫描结论或风险描述"` : ""}}`
	].join("\n");
}
/** #165 建议二（审查与安装分离）：安全模式专用的只读审查提示词。
*  与 buildInstallPrompt 的本质区别：子代理**只审查不执行**——没有"边审边装"的沙箱悖论，
*  审查更快更省 token；建议命令限白名单三形态，白名单外的放 manual 由用户手动执行。 */
function buildReviewPrompt(plugin) {
	const cmdLine = plugin.install.commands && plugin.install.commands.length > 0 ? plugin.install.commands.join("\n    ") : "(无)";
	return [
		`你是「极简安全审查员」，只读审查 DSH 插件「${plugin.name}」（${plugin.fullName}）。`,
		`**绝对禁止：执行任何命令、安装任何包、写入任何文件。** 你的全部产出只有一份 JSON 审查报告。`,
		``,
		`【插件信息】`,
		`- 类型：${plugin.type === "skill" ? "skill（技能）" : "cordis 插件"}（${plugin.type}）`,
		`- 简介：${plugin.descriptionZh ?? "(无中文简介)"}`,
		`- 需要配置：${plugin.install.needsConfig ? "是（API Key / Token 等）" : plugin.install.usageNeedsConfig ? "安装无需；使用时需配置模型（可能产生费用）" : "否"}`,
		`- collector 解析的参考命令：`,
		`    ${cmdLine}`,
		``,
		`【审查步骤】`,
		`1. 读仓库 README 关键段 + 安装用脚本/清单（cordis.patch.yml / dsh.bundle / install.sh / package.json 等），逐项核对：`,
		`   a. 危险命令：curl|sh 管道执行、下载执行、base64 解码执行、从不可信 URL 拉代码；`,
		`   b. 敏感信息收集回传：读取 API Key / Token / 环境变量并发送到外部地址；`,
		`   c. 配置篡改：覆盖 harness 自身 sandbox/approval/权限配置或混入系统目录；`,
		`   d. 网络暴露与信任围栏：0.0.0.0 绑定、云部署/反代隧道、弱化 Host 校验、诱导关闭信任围栏；`,
		`   e. 来源信号：仓库年龄/维护活跃/star 量级，<30 天且低活跃为高危。`,
		`2. 给出**建议的安全安装命令**——只允许三种白名单形态：`,
		`   ① dsh plugin [--profile <p>] add <pkg>；② git clone https://github.com/${plugin.fullName}（仅限插件自身仓库）；③ npm install|pnpm add <pkg>（非全局）。`,
		`   白名单外的命令一律放进 manual（用户手动执行），绝不放进 commands。`,
		``,
		`【输出】严格 JSON，无其他文本：`,
		`{"security_blocked":true|false,"reason":"一句话总体结论","risks":[{"level":"high|medium|low","point":"具体风险"}],"commands":["白名单内的建议安装命令"],"manual":["需用户手动执行的命令"],"config_needed":null|{"what":"...","hint":"..."}}`
	].join("\n");
}
/** T1 子代理验收（后台，不阻塞 RPC）：轮询子会话输出 → 解析 JSON verdict →
*  ok 且带命令 → 学配方（learnedFrom=t1，含 config_needed）；记录完成度量（sessionChars 为 token 粗略代理）。
*  终止条件：拿到 verdict（成功或失败）→ 停止；否则轮询到 10 分钟上限。
*  signal（#165 建议三）：用户取消 → 立即停止轮询，verdict 不落库、配方不学习。 */
async function watchInstallVerdict(opts) {
	const { cfg, plugin, profile, sessionId, readSession, signal } = opts;
	const deadline = Date.now() + 6e5;
	let chars = 0;
	const tick = async () => {
		if (signal?.aborted) return;
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
		if (!done && !signal?.aborted && Date.now() < deadline) setTimeout(() => void tick(), 5e3);
	};
	setTimeout(() => void tick(), 5e3);
}
/** 解析审查子代理的严格 JSON：容忍 ```json 围栏与前后杂文本；无 security_blocked 视为无效 */
function parseReviewVerdict(text) {
	const m = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
	if (!m) return null;
	try {
		const obj = JSON.parse(m[0]);
		if (typeof obj !== "object" || obj === null || typeof obj.security_blocked !== "boolean") return null;
		const risks = Array.isArray(obj.risks) ? obj.risks.filter((r) => r && typeof r.point === "string").map((r) => ({
			level: typeof r.level === "string" ? r.level : void 0,
			point: r.point
		})) : [];
		const strArr = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : void 0;
		const cfg = obj.config_needed;
		return {
			securityBlocked: obj.security_blocked,
			reason: typeof obj.reason === "string" ? obj.reason : void 0,
			risks,
			commands: strArr(obj.commands) ?? [],
			manual: strArr(obj.manual) ?? [],
			configNeeded: cfg && typeof cfg === "object" ? {
				what: typeof cfg.what === "string" ? cfg.what : void 0,
				hint: typeof cfg.hint === "string" ? cfg.hint : void 0
			} : null
		};
	} catch {
		return null;
	}
}
/** 审查结果暂存（installId → verdict）：watcher 后台写，前端 ai:review:poll 读，读完即删 */
const reviewResults = /* @__PURE__ */ new Map();
/** 审查子代理验收（后台）：轮询子会话 → 解析审查 verdict → 存入 reviewResults；6.5 分钟超时置空 verdict */
function watchReviewVerdict(opts) {
	const deadline = Date.now() + 39e4;
	const tick = async () => {
		if (opts.signal.aborted) return;
		try {
			const verdict = parseReviewVerdict(collectSessionText((await opts.readSession(opts.sessionId))?.events ?? []));
			if (verdict) {
				reviewResults.set(opts.installId, {
					done: true,
					verdict
				});
				return;
			}
		} catch {}
		if (Date.now() < deadline) setTimeout(() => void tick(), 5e3);
		else reviewResults.set(opts.installId, {
			done: true,
			verdict: null
		});
	};
	setTimeout(() => void tick(), 4e3);
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
				} : void 0,
				signal: opts.signal
			}, (err, stdout, stderr) => {
				if (err) {
					const reason = opts.signal?.aborted ? "安装已取消" : stderr || stdout || err.message;
					reject(new Error(reason));
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
/** 进行中的安装（#165 建议三）：installId → AbortController，供「取消」RPC 终止 T0/T1 */
const activeInstalls = /* @__PURE__ */ new Map();
/** ai:install 主体（#165 建议三重构出函数）：T0 路由（可取消）→ needAi 时派 T1 子代理（可取消）。
*  取消语义：T0 = 终止正在运行的子进程且不重试；T1 = 终止子代理并丢弃 verdict（不学配方、不记成功）。 */
async function runAiInstall(opts) {
	const { cfg, ctx, args, plugin, profile, security, signal } = opts;
	const t0 = security ? null : await routeInstall(cfg, plugin, {
		profile,
		runner: realRunner(),
		force: Boolean(args.force),
		signal
	});
	if (signal.aborted) return {
		started: false,
		childSessionId: null,
		cancelled: true,
		ok: false,
		error: "安装已取消"
	};
	if (!security && t0 && !t0.needAi) {
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
			error: t0.result?.error ?? null,
			classified: !t0.ok && t0.result?.error ? classifyFailure(t0.result.error) : void 0
		};
	}
	const agents = ctx.get("agents");
	const subagents = ctx.get("subagents");
	if (!subagents) throw new Error("子代理服务不可用");
	const agent = (agents?.roots?.() ?? agents?.list?.() ?? [])[0];
	if (!agent) throw new Error("当前会话代理不可用");
	const provider = subagents.list().includes("spawn") ? "spawn" : subagents.list()[0];
	const prompt = buildInstallPrompt(plugin, profile, t0?.reason, { security });
	const run = await Promise.race([subagents.start(provider, {
		label: `安装 ${plugin.name}`,
		prompt: [{
			type: "text",
			text: prompt
		}],
		parent: agent,
		signal: AbortSignal.any([signal, AbortSignal.timeout(6e5)])
	}), new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("子代理启动超时")), 1e4))]);
	const sessionId = run.sessionId ?? run.id ?? null;
	recordInstallMetric(cfg, {
		ts: (/* @__PURE__ */ new Date()).toISOString(),
		pluginId: plugin.id,
		type: "ai",
		mode: "t1",
		ok: false,
		phase: "start",
		error: t0?.reason ?? null
	});
	if (sessionId) {
		const sq = ctx.get("sessionQuery");
		if (sq?.readSession) watchInstallVerdict({
			cfg,
			plugin,
			profile,
			sessionId,
			readSession: sq.readSession,
			signal
		});
	}
	return {
		started: true,
		childSessionId: sessionId,
		mode: "t1",
		reason: t0?.reason ?? null,
		security
	};
}
//#endregion
export { apply, inject, name };
