/**
 * 从 README 解析真实安装命令（精确命令优先于类型模板）
 * - 定位安装章节（Install / Setup / Getting Started / 安装 等标题）
 * - 提取代码块 / $ 前缀行中的安装类命令
 * - 清洗 shell 提示符与注释
 */

/** 定位 README 中的安装章节（返回章节文本） */
export function extractInstallSection(readme: string): string | null {
  const lines = readme.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,4})\s+(.+)$/);
    if (!m) continue;
    const lv = m[1].length;
    const title = m[2].toLowerCase();
    if (start < 0) {
      if (
        /^(install|installation|setup|getting started|quick start|deploy|安装|快速开始|开始使用|使用说明)/.test(
          title
        )
      ) {
        start = i;
        level = lv;
      }
    } else if (lv <= level) {
      // 遇到同级或更高级标题，章节结束
      return lines.slice(start + 1, i).join("\n");
    }
  }
  return start >= 0 ? lines.slice(start + 1).join("\n") : null;
}

const INSTALL_CMD_RE =
  /^(git clone|git submodule|git config|dsh plugin|dsh\s+.*\sadd|pnpm (add|i)\b|npm (install|i)\b|npx skills add|npx @[^\s]+ add|npx -y @deepseek-ai\/dsh plugin|npx @deepseek-ai\/dsh plugin|curl .*install|pip install|uv (tool )?install|brew install|cargo install|git init)/;

/** 判断是否为安装类命令 */
function isInstallCmd(cmd: string): boolean {
  return INSTALL_CMD_RE.test(cmd);
}

/** 清洗单行命令：去提示符/注释/无意义前缀 */
function cleanCmdLine(line: string): string {
  let c = line.trim();
  c = c.replace(/^[$\#>]\s*/, "");
  c = c.replace(/\s*#.*$/, "").trim();
  // 过滤 cd/mkdir/echo 等纯前置命令（不含 && 链的）
  if (/^(cd |mkdir |echo |touch |cat >|ls |rm )/.test(c) && !c.includes("&&")) return "";
  // 过滤引用 shell 变量的下载/写入行（#394）：`curl … -o "$PURGE_INSTALL_DIR/install.sh"`
  // 这类行依赖前文定义的变量，单独收录既装不了也误导；变量引用识别 = $VAR / ${VAR}
  if (/\$\{?[A-Za-z_]\w*\}?/.test(c) && /(?:curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod|fetch)\b/i.test(c)) {
    return "";
  }
  // 过滤「远程脚本下载执行」行（#408）：`curl -fsSL https://…/install.sh | bash`——
  // 对 cordis-plugin 从来不是有效的插件安装命令（必撞直装白名单），只是别的
  // 产品的环境引导（如 Antigravity CLI）；riskyInstall 评分标记不受影响
  if (/(?:curl|wget)\b/i.test(c) && /\|\s*(?:sudo\s+)?(?:ba|z|fi|da)?sh\b/.test(c)) {
    return "";
  }
  return c;
}

/**
 * #408 · `npx [-y] @deepseek-ai/dsh plugin …` 归一为 `dsh plugin …`：
 * README 常用 npx 直接调用宿主 CLI（如 liustack/modlens），形态不被 dsh 前缀
 * 规则之外的启发式覆盖时整条漏抓，被 curl|bash 环境引导行顶替。npx 调的
 * 就是 dsh 本体，归一为官方 CLI 命令语义等价（profile 参数原样保留）。
 */
export function normalizeDshCliCmd(cmd: string): string {
  return cmd
    .replace(/^npx\s+(?:-y\s+)?@deepseek-ai\/dsh\s+plugin\b/, "dsh plugin")
    .replace(/^npx\s+@deepseek-ai\/dsh\s+plugin\b/, "dsh plugin");
}

/** 从安装章节提取安装命令列表（去重，最多 3 条） */
export function extractInstallCommands(section: string): string[] {
  const cmds: string[] = [];
  const push = (line: string) => {
    const c = cleanCmdLine(line);
    if (!c || !isInstallCmd(c)) return;
    const norm = normalizeDshCliCmd(c);
    if (!cmds.includes(norm)) cmds.push(norm);
  };

  // 1. 代码块内的行
  for (const m of section.matchAll(/```(?:bash|sh|shell|console|zsh)?\s*\n([\s\S]*?)```/g)) {
    for (const line of m[1].split(/\r?\n/)) push(line);
  }
  // 2. $ / # 前缀的命令行
  for (const line of section.split(/\r?\n/)) {
    if (/^\s*[$#>]\s*/.test(line)) push(line);
  }
  return cmds.slice(0, 3);
}

/** 综合入口：从 README 提取安装命令 */
export function parseInstallCommands(readme: string | null): { commands: string[]; source: string } {
  if (!readme) return { commands: [], source: "template" };
  const section = extractInstallSection(readme);
  if (section) {
    const cmds = extractInstallCommands(section);
    if (cmds.length > 0) return { commands: cmds, source: "README install section" };
  }
  // 兜底：全文找安装命令
  const cmds = extractInstallCommands(readme);
  if (cmds.length > 0) return { commands: cmds, source: "README" };
  return { commands: [], source: "template" };
}
