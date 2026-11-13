//#region src/subagent-compat.ts
/** getProvider 能力探测的候选序：spawn 优先（DSH 内置零依赖路径） */
const PROVIDER_CANDIDATES = [
	"spawn",
	"fork",
	"claude-code",
	"codex",
	"acp"
];
/**
* #378 · provider 选择改为能力探测：0.2.2-rc.2 删除了 subagents.list()（且 npm 上
* @deepseek-ai/dsh-subagent 发布的 0.0.1-rc.1 与实机版本完全脱节，按版本号分支不可行）。
* 探测序：list() 可用且有结果 → 用之（老宿主原语义）；getProvider 可用 → 按候选序探测
* 第一个真实存在的 provider；都不可用 → 'spawn' 兜底（startActivation 时宿主自己也会校验）。
*/
function pickSubagentProvider(subagents) {
	const anySub = subagents;
	try {
		if (typeof anySub.list === "function") {
			const names = anySub.list();
			if (Array.isArray(names) && names.length > 0) return names.includes("spawn") ? "spawn" : String(names[0]);
		}
	} catch {}
	if (typeof anySub.getProvider === "function") for (const candidate of PROVIDER_CANDIDATES) try {
		if (anySub.getProvider(candidate)) return candidate;
	} catch {}
	return "spawn";
}
/** 启动一个子代理：宿主有 startActivation（alpha.2+）走新 API（扁平 spec 先试、嵌套回退），否则回退旧 start */
async function startSubagent(subagents, provider, opts) {
	const anySub = subagents;
	if (typeof anySub.startActivation === "function") {
		let run;
		try {
			run = await anySub.startActivation({
				provider,
				label: opts.label,
				prompt: opts.prompt,
				parent: opts.parent,
				signal: opts.signal,
				delivery: "caller"
			});
		} catch (flatError) {
			try {
				run = await anySub.startActivation({
					provider,
					label: opts.label,
					request: {
						prompt: opts.prompt,
						parent: opts.parent
					},
					signal: opts.signal,
					delivery: "caller"
				});
			} catch {
				throw flatError;
			}
		}
		const childId = run.childId ?? null;
		return {
			sessionId: run.sessionId ?? run.id ?? childId,
			childId
		};
	}
	const run = await subagents.start(provider, {
		label: opts.label,
		prompt: opts.prompt,
		parent: opts.parent,
		signal: opts.signal
	});
	return {
		sessionId: run.sessionId ?? run.id ?? null,
		childId: null
	};
}
/**
* alpha.2+ 下真正终止一个已启动的子代理：优先 interrupt(childId, {kind:'ancestor', agent})，
* 失败降级 {kind:'user', parentSessionId}（#228 报告者验证的调用形态）。
* interrupt 不存在（旧宿主）或 childId 缺失时返回 false——旧宿主 abort 信号本就能带走
* 子代理，降级为「仅 abort」是安全的，绝不因终止逻辑自身抛错而让取消流程失败。
*/
async function interruptSubagent(subagents, child) {
	if (!child.childId) return false;
	const anySub = subagents;
	if (!anySub || typeof anySub.interrupt !== "function") return false;
	try {
		await anySub.interrupt(child.childId, {
			kind: "ancestor",
			agent: child.agent
		});
		return true;
	} catch {
		const parentSessionId = child.agent?.sessionId;
		if (!parentSessionId) return false;
		try {
			await anySub.interrupt(child.childId, {
				kind: "user",
				parentSessionId
			});
			return true;
		} catch {
			return false;
		}
	}
}
//#endregion
export { interruptSubagent, pickSubagentProvider, startSubagent };
