/**
 * WSL 真实 Linux 环境验证：issue #78 平台分支修复
 * 复刻 core/cli.ts（spawn）与 ui/index.ts（execFile）修复后的 POSIX 命令执行语义，
 * 在真 Linux node 下验证 /bin/sh -c 可用、cwd 生效、超时与错误路径正常。
 *
 * 用法（在 WSL 内，用 Linux node 运行）：
 *   /mnt/e/wm/tool/node-linux-x64/bin/node /mnt/e/wm/tool/lader/scripts/wsl-verify.mjs
 */
import { spawn, execFile } from "node:child_process";

const isWin = process.platform === "win32";
let failures = 0;
const ok = (name, cond) => {
  console.log(`${cond ? "✓" : "✗ FAIL"} ${name}`);
  if (!cond) failures++;
};

console.log(`platform=${process.platform} arch=${process.arch} node=${process.version}`);
ok("运行在 POSIX（非 win32）", !isWin);

/** core/cli.ts realRunner 的 POSIX 分支（spawn /bin/sh -c，stdio ignore） */
function runSpawn(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = isWin
      ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", command], { cwd: opts.cwd, windowsHide: true, stdio: "ignore" })
      : spawn("/bin/sh", ["-c", command], { cwd: opts.cwd, stdio: "ignore" });
    const timer = setTimeout(() => child.kill(), opts.timeoutMs ?? 120000);
    child.on("error", (err) => { clearTimeout(timer); reject(err); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1 }); });
  });
}

/** ui/index.ts realRunner 的 POSIX 分支（execFile /bin/sh -c，捕获输出） */
function runExecFile(command, opts = {}) {
  return new Promise((resolve, reject) => {
    const file = isWin ? process.env.ComSpec ?? "cmd.exe" : "/bin/sh";
    const args = isWin ? ["/d", "/s", "/c", command] : ["-c", command];
    execFile(file, args, { cwd: opts.cwd, timeout: opts.timeoutMs ?? 120000, windowsHide: isWin }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || stdout || err.message));
      else resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

// 1. spawn 语义（core）
const r1 = await runSpawn("pwd");
ok("spawn /bin/sh -c 执行 pwd（exit 0）", r1.exitCode === 0);

const r2 = await runSpawn("echo POSIX-RUNNER-OK && exit 7");
ok("spawn 复合命令 + 退出码透传（exit 7）", r2.exitCode === 7);

const r3 = await runSpawn("nonexistent-cmd-xyz");
ok("spawn 命令不存在（exit 127）", r3.exitCode === 127);

// 2. cwd 生效（spawn）
const tmp = "/tmp/wsl-runner-test";
const r4 = await runSpawn(`mkdir -p ${tmp} && cd ${tmp} && pwd`);
ok("spawn cwd 生效（经由 shell cd）", r4.exitCode === 0);

const r5 = await runSpawn("true", { cwd: tmp });
ok("spawn 带 cwd 参数可执行", r5.exitCode === 0);

// 3. execFile 语义（ui）
const e1 = await runExecFile("echo EXECFILE-OK && printf 'line2\\n'");
ok("execFile /bin/sh -c 执行成功", e1.exitCode === 0 && e1.stdout.includes("EXECFILE-OK"));
ok("execFile 捕获多行输出", e1.stdout.includes("line2"));

const e2 = await runExecFile("exit 3").catch((e) => ({ caught: e.message }));
ok("execFile 非零退出拒绝（带错误信息）", e2.caught && /(exit|command|Error)/i.test(e2.caught));

// 4. 超时（spawn）
const t0 = Date.now();
const r6 = await runSpawn("sleep 30", { timeoutMs: 800 }).then(() => "resolved", () => "rejected");
ok(`spawn 超时后 kill（${Date.now() - t0}ms，应 <3000ms）`, r6 === "resolved" && Date.now() - t0 < 3000);

console.log(failures === 0 ? "\n全部通过 ✅" : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);