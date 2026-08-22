/**
 * 轻量 .env 加载器（跨平台）
 * 用模块路径定位仓库根目录的 .env（不依赖 cwd），已存在的环境变量不覆盖。
 * 由 index.ts 在入口处 import。
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, "../../.env"); // collector/src -> 仓库根

if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  // 兼容 LF / CRLF / 仅 CR 三种换行（实测用户的 .env 是仅 \r 换行，/\r?\n/ 会把整个文件当一行导致读不到 token）
  for (const line of content.split(/[\r\n]+/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (key in process.env) continue; // 环境变量优先
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
