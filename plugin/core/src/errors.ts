/**
 * P6 错误分类：把安装/更新/卸载的原始失败输出翻译成人话。
 *
 * 目标（竞品借鉴项 P6）：用户看到的不该是 30 行 pnpm 报错，而是
 * 「什么原因（title）+ 该做什么（hint）」，再附关键行（keyLines）给需要深究的人。
 *
 * 分类是**保守的单次正则匹配**，按优先级短路：同一个输出可能同时含多个关键词
 * （如 rate limit 页面里也有 403），先命中的类别优先级更高。
 * 兜底 unknown 也给出有用的 keyLines（输出尾部），绝不返回空手。
 */

export interface FailureClass {
  /** 机器可读类别（写进操作日志，便于统计高频失败原因） */
  code:
    | "network"
    | "rate-limit"
    | "not-found"
    | "version"
    | "file-locked"
    | "permission"
    | "disk"
    | "unknown";
  /** 人话原因（一句话，面板直接展示） */
  title: string;
  /** 建议动作（一句话，可操作） */
  hint: string;
  /** 原始输出里的关键行（≤5 行，给复制诊断/人工排查用） */
  keyLines: string[];
}

interface Rule {
  code: FailureClass["code"];
  re: RegExp;
  title: string;
  hint: string;
}

/** 按优先级排列：越靠前越特异（file-locked 在 permission 前——Windows 的 EPERM 多是文件占用而非权限） */
const RULES: Rule[] = [
  {
    code: "rate-limit",
    re: /rate limit|API rate limit exceeded|secondary rate|EAI_AGAIN.*api\.github/i,
    title: "GitHub API 限流了",
    hint: "等几分钟再试；或在设置 Tab 绑定 GitHub 账号提高配额",
  },
  {
    code: "file-locked",
    re: /EBUSY|EBDFD|ETXTBSY|being used by another process|资源占用|epipe/i,
    title: "文件被占用（harness 正在运行或杀毒软件临时锁定）",
    hint: "完全退出 harness 后重试；仍不行就重启电脑后再装",
  },
  {
    code: "permission",
    re: /EACCES|EPERM|access denied|权限被拒绝|permission denied/i,
    title: "权限不足",
    hint: "以管理员运行一次；或检查目标目录是否被别的程序占用",
  },
  {
    code: "not-found",
    re: /404|Not Found|ENOENT|package does not exist|仓库不存在/i,
    title: "找不到东西（仓库可能已删除/改名，或包名失效）",
    hint: "到插件仓库主页确认还存在；若已删除，这个插件会很快从市场里清掉",
  },
  {
    code: "version",
    re: /No matching version|ERR_PNPM_NO_MATCHING_VERSION|ERESOLVE|peer dep|Unsupported engine|not in the npm registry/i,
    title: "版本对不上（包版本/依赖约束冲突）",
    hint: "先更新 DSH 宿主和已装插件再重试；仍失败就把提示词发给 AI 帮你解",
  },
  {
    code: "disk",
    re: /ENOSPC|no space left|磁盘空间不足/i,
    title: "磁盘空间不足",
    hint: "清理出至少 1GB 空间后重试",
  },
  {
    code: "network",
    re: /ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND|getaddrinfo|network|timeout|fetch failed|EAI_AGAIN|certificate|TLS|ssl|EPROTO/i,
    title: "网络不通或不稳定",
    hint: "检查网络/代理设置后重试；公司网络可能拦了 npm 或 GitHub",
  },
];

/** 从原始输出挑关键行：优先含错误标志的行，不足则取尾部 */
function extractKeyLines(output: string): string[] {
  const lines = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const flagged = lines.filter((l) =>
    /(ERR|error|Error|ERROR|EACCES|EPERM|EBUSY|ENOENT|ENOSPC|ETIMEDOUT|ECONN|404|403|warn)/.test(l)
  );
  const picked = (flagged.length >= 2 ? flagged : [...flagged, ...lines]).slice(-5);
  return picked.map((l) => (l.length > 160 ? `${l.slice(0, 160)}…` : l));
}

/**
 * 分类失败输出。任何输入都返回可用结果——分类器自己绝不抛错、绝不返回空。
 */
export function classifyFailure(output: string): FailureClass {
  const text = (output ?? "").slice(0, 8000); // 防御超长输出拖慢正则
  for (const rule of RULES) {
    if (rule.re.test(text)) {
      return { code: rule.code, title: rule.title, hint: rule.hint, keyLines: extractKeyLines(text) };
    }
  }
  return {
    code: "unknown",
    title: "安装失败，原因没能自动识别",
    hint: "点「复制诊断」把信息发给 AI，通常一轮就能定位",
    keyLines: extractKeyLines(text),
  };
}
