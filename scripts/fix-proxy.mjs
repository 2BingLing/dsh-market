/**
 * 自动探测本机 HTTP 代理并写入 pnpm 用户配置
 *
 * 背景：DSH 安装插件（dsh plugin add → pnpm install）需要访问 registry，
 * 但代理端口经常变化（Clash/v2ray 等换端口），导致安装失败/残缺 lockfile。
 *
 * 用法：node scripts/fix-proxy.mjs [端口...]
 *   - 不带参数：扫描常见端口（7890 7891 7897 7898 10808 10809 2080 8888 8080 1080 33210 3128）
 *   - 带参数：只测指定端口，如 node scripts/fix-proxy.mjs 7890 7891
 *
 * 找到有效代理后：
 *   1. 写入 pnpm/npm 用户级配置（~/.npmrc 的 proxy/https-proxy）
 *   2. 打印当前会话可用的环境变量（export HTTP_PROXY=...）
 *   之后任何 dsh plugin add 前先跑一次本脚本即可。
 */
import { createConnection } from "node:net";
import { execSync } from "node:child_process";

const DEFAULT_PORTS = [7890, 7891, 7897, 7898, 10808, 10809, 2080, 8888, 8080, 1080, 33210, 3128];
const TARGET = "registry.npmjs.org:443";

/** 通过 CONNECT 隧道探测端口是否为可用 HTTP 代理 */
function probe(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: "127.0.0.1", port, timeout: timeoutMs });
    let done = false;
    const finish = (ok, msg) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch {}
      resolve({ port, ok, msg });
    };
    sock.on("connect", () => {
      sock.write(`CONNECT ${TARGET} HTTP/1.1\r\nHost: ${TARGET}\r\n\r\n`);
    });
    let buf = "";
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      if (buf.includes("\r\n\r\n")) {
        const status = /^HTTP\/1\.[01]\s(\d{3})/.exec(buf)?.[1] ?? "000";
        finish(status.startsWith("2"), `CONNECT -> HTTP ${status}`);
      }
    });
    sock.on("timeout", () => finish(false, "超时"));
    sock.on("error", (e) => finish(false, e.code ?? e.message));
  });
}

const ports = process.argv.slice(2).map(Number).filter(Boolean);
const targets = ports.length ? ports : DEFAULT_PORTS;

console.log(`探测 127.0.0.1 上的 HTTP 代理（目标 ${TARGET}）...`);
const results = [];
for (const port of targets) {
  const r = await probe(port);
  results.push(r);
  console.log(`  :${port} ${r.ok ? "✅ 可用" : "— " + r.msg}`);
}

const hit = results.find((r) => r.ok);
if (!hit) {
  console.error("\n未找到可用代理。请确认代理软件运行中，或手动指定端口：");
  console.error('  node scripts/fix-proxy.mjs 7890 7891');
  process.exit(1);
}

const proxy = `http://127.0.0.1:${hit.port}`;
console.log(`\n✅ 有效代理: ${proxy}`);

// 写入 pnpm / npm 用户级配置
try {
  execSync(`pnpm config set --location=user proxy "${proxy}"`, { stdio: "pipe" });
  execSync(`pnpm config set --location=user https-proxy "${proxy}"`, { stdio: "pipe" });
  execSync(`npm config set proxy "${proxy}" --location=user`, { stdio: "pipe" });
  execSync(`npm config set https-proxy "${proxy}" --location=user`, { stdio: "pipe" });
  console.log("已写入 pnpm/npm 用户级 proxy/https-proxy 配置");
} catch (e) {
  console.warn("配置写入失败（可能是权限/沙箱），手动执行：");
  console.warn(`  pnpm config set --location=user proxy "${proxy}"`);
  console.warn(`  pnpm config set --location=user https-proxy "${proxy}"`);
}

// 当前会话环境变量提示
console.log(`\n当前会话可用（PowerShell）：`);
console.log(`  $env:HTTP_PROXY="${proxy}"; $env:HTTPS_PROXY="${proxy}"`);
console.log(`之后安装插件：Node scripts/fix-proxy.mjs（或省略）→ dsh plugin --profile web add <包>`);