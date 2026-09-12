/**
 * DSH 宿主兼容判定（N2 · Host-aware 兼容门禁）
 *
 * 问题：DSH 迭代极快（0.1.0-rc.8 → 0.1.1-rc.2 → 0.1.5-rc.1 都在数周内），
 * 插件坏掉的头号原因就是宿主版本不匹配。用户最痛的不是"哪个插件好用"，
 * 而是"这个插件在我这儿到底装得上吗"。
 *
 * 原则（比功能本身重要）：
 *   1. **未知绝不拦截**。插件没声明 / 本机版本读不到 → status="unknown"，只提示不阻断。
 *      宁可漏一次提醒，也不能错误地拦住一次本来能用的安装——后者会立刻摧毁信任。
 *   2. **只对「作者显式声明」做强提示**。`engines.dsh` 是作者有意写的；
 *      从 peer/dev 依赖推断来的约束可能只是开发期对齐，故降级为软提示（soft=true）。
 *   3. 判定逻辑与版本解析集中在 `version.ts`（prerelease 宽容，见该文件注释）。
 */
import type { DshPlugin } from "@dsh-market/schema";
import { describeRange, satisfiesRange } from "./version.js";
import { detectDshVersion, type DshVersionInfo } from "./host.js";
import type { ResolvedConfig } from "./config.js";

export type DshCompatStatus = "ok" | "incompatible" | "unknown";

export interface DshCompat {
  status: DshCompatStatus;
  /** 插件声明的宿主版本要求（未声明为 null） */
  required: string | null;
  /** 要求声明的来源：engines / peer-dep / dev-dep */
  requiredSource: string | null;
  /** 本机宿主版本（读不到为 null） */
  local: string | null;
  /** 本机版本的探测来源 */
  localSource: DshVersionInfo["source"];
  /** 是否软提示（推断来源的要求 → true，UI 用弱化样式，且不建议阻断） */
  soft: boolean;
  /** 人类可读的一句话（UI 直接展示） */
  reason: string;
  /** 是否应当**阻止**这次安装（只有"incompatible + 非推断来源"才为 true） */
  block: boolean;
}

/**
 * 判定某个插件与（默认本机的）DSH 宿主是否兼容。
 * @param plugin 市场条目
 * @param opts.localVersion 显式指定宿主版本（不传则探测本机；传 null 表示强制"未知"）
 * @param opts.cfg 传入则以 profile 作为最后一级探测来源
 */
export function checkDshCompat(
  plugin: Pick<DshPlugin, "install" | "fullName">,
  opts: { localVersion?: string | null; cfg?: Pick<ResolvedConfig, "profilesDir" | "defaultProfile"> } = {},
): DshCompat {
  const info = opts.cfg ? detectDshVersion(opts.cfg) : detectDshVersion();
  const local = "localVersion" in opts ? (opts.localVersion ?? null) : info.version;
  const locals = { local, localSource: info.source };

  const required = plugin.install?.dshEngines ?? null;
  const requiredSource = plugin.install?.dshEnginesSource ?? null;
  const soft = requiredSource === "peer-dep" || requiredSource === "dev-dep";

  if (!required) {
    return {
      status: "unknown",
      required: null,
      requiredSource,
      ...locals,
      soft: false,
      reason: "该插件未声明 DSH 宿主版本要求，无法判断兼容性",
      block: false,
    };
  }

  const need = describeRange(required);

  if (!local) {
    return {
      status: "unknown",
      required,
      requiredSource,
      ...locals,
      soft,
      reason: `该插件要求 ${need}；本机 DSH 版本读取失败，无法确认`,
      block: false,
    };
  }

  const ok = satisfiesRange(local, required);
  if (ok === null) {
    return {
      status: "unknown",
      required,
      requiredSource,
      ...locals,
      soft,
      // 范围解析不了（作者写了奇怪的值）→ 只提示需求，不做判断
      reason: `该插件声明 ${need}；本机 DSH ${local}，要求无法解析，请自行确认`,
      block: false,
    };
  }

  if (ok) {
    return {
      status: "ok",
      required,
      requiredSource,
      ...locals,
      soft,
      reason: `兼容：要求 ${need}，本机 DSH ${local}`,
      block: false,
    };
  }

  const hint = soft ? `（要求来自 package.json 的依赖推断，可能不是作者本意）` : "";
  return {
    status: "incompatible",
    required,
    requiredSource,
    ...locals,
    soft,
    reason: `不兼容：该插件要求 ${need}，本机 DSH 是 ${local}${hint}`,
    // 推断来源不阻断（可能只是开发期对齐）；作者显式声明的才阻断
    block: !soft,
  };
}

/**
 * UI 列表直接渲染用的兼容信息（Host 侧算好下发）。
 *
 * 为什么要"Host 侧算好"而不是客户端自己判：客户端 bundle 跑在浏览器里，
 * 不能 import core（core 依赖 node:fs 等 Node 内建），也不该在客户端重复一份版本解析逻辑。
 * → 版本判定只有一处实现（本文件），客户端只做渲染。
 */
export interface LiteDshCompat {
  status: DshCompatStatus;
  /** 人话版要求，如 "DSH ≥ 0.1.5" */
  label: string;
  /** 原始范围（便于排障/展示细节） */
  required: string;
  reason: string;
  /** 是否应阻止安装（作者显式声明且不兼容） */
  block: boolean;
  /** 是否为推断来源的软提示 */
  soft: boolean;
  /** 本机宿主版本（读不到为 null） */
  local: string | null;
}

/**
 * 生成 UI 用的精简兼容信息。
 * **只在插件真的声明了要求时返回**（未声明 → undefined）——避免给全量 6000+ 条目
 * 都塞一个恒为"未知"的字段，白白撑大 RPC 载荷。
 */
export function liteDshCompat(
  plugin: Pick<DshPlugin, "install" | "fullName">,
  opts: { localVersion?: string | null } = {},
): LiteDshCompat | undefined {
  const required = plugin.install?.dshEngines ?? null;
  if (!required) return undefined;
  const c = checkDshCompat(plugin, opts);
  return {
    status: c.status,
    label: describeRange(required),
    required,
    reason: c.reason,
    block: c.block,
    soft: c.soft,
    local: c.local,
  };
}
