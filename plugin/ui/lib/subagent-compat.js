//#region src/subagent-compat.ts
/** 启动一个子代理：宿主有 startActivation（alpha.2+）走新 API，否则回退旧 start */
async function startSubagent(subagents, provider, opts) {
	const anySub = subagents;
	if (typeof anySub.startActivation === "function") {
		const run = await anySub.startActivation({
			provider,
			label: opts.label,
			request: {
				prompt: opts.prompt,
				parent: opts.parent
			},
			signal: opts.signal,
			delivery: "caller"
		});
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
* alpha.2 下真正终止一个已启动的子代理：优先 interrupt(childId, {kind:'ancestor', agent})，
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
export { interruptSubagent, startSubagent };
