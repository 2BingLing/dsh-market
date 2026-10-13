/**
 * #241 防回归守卫：@dsh-market/schema 依赖范围声明
 *
 * 背景：core 曾把 schema 声明成 "*"，pnpm 在 profile 里解析到没有 ./zh-intent
 * 子路径导出的旧版（≤0.1.2），core 加载即抛 ERR_PACKAGE_PATH_NOT_EXPORTED，
 * 市场入口整个消失——且版本号层面一切"正常"，极难自查。
 *
 * 本测试锁三件事：
 * 1. 已发布包（core / plugin）声明的 schema 范围**不允许通配**，且下限 ≥ 0.1.4
 *    （0.1.3 曾把子路径指向未编译的 .ts，在 node_modules 下被 Node 拒绝，同样是坏的）；
 * 2. workspace schema 的 exports 确实提供这两个子路径，且指向 dist/*.js（而非 src/*.ts）；
 * 3. 范围解析到的最低版本，workspace 版本必须满足。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

interface Pkg {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  exports?: Record<string, unknown>;
}

function readPkg(rel: string): Pkg {
  return JSON.parse(readFileSync(resolve(here, rel), "utf8")) as Pkg;
}

/** 解析我们实际使用的窄范围写法（^x.y.z / >=x.y.z），返回下限三元组；不认识的形状返回 null */
function rangeFloor(range: string): [number, number, number] | null {
  const m = /^(?:\^|>=?)?\s*(\d+)\.(\d+)\.(\d+)/.exec(range.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

const FLOOR: [number, number, number] = [0, 1, 4];
const atLeastFloor = (v: [number, number, number]): boolean =>
  v[0] > FLOOR[0] ||
  (v[0] === FLOOR[0] && (v[1] > FLOOR[1] || (v[1] === FLOOR[1] && v[2] >= FLOOR[2])));

describe("#241 schema 依赖范围守卫", () => {
  it("已发布包的 schema 范围不允许通配、下限 ≥ 0.1.4", () => {
    for (const rel of ["../package.json", "../../ui/package.json"]) {
      const pkg = readPkg(rel);
      const range = pkg.dependencies?.["@dsh-market/schema"];
      expect(range, `${pkg.name} 必须显式声明 @dsh-market/schema`).toBeDefined();
      const floor = rangeFloor(range!);
      expect(floor, `${pkg.name} 的范围 "${range}" 必须是 ^x.y.z / >=x.y.z 形式（禁止 "*" 等通配）`).not.toBeNull();
      expect(
        atLeastFloor(floor!),
        `${pkg.name} 的范围 "${range}" 下限低于 0.1.4——0.1.3 及以下缺 ./zh-intent（≤0.1.2）或子路径指向未编译 .ts（0.1.3），会导致 core 加载即崩`,
      ).toBe(true);
    }
  });

  it("web 的声明同样收窄（monorepo 内不发布，纯一致性）", () => {
    const pkg = readPkg("../../../web/package.json");
    const floor = rangeFloor(pkg.dependencies?.["@dsh-market/schema"] ?? "*");
    expect(floor).not.toBeNull();
    expect(atLeastFloor(floor!)).toBe(true);
  });

  it("workspace schema 提供 zh-intent / zh-taxonomy 子路径，且指向 dist 而非 src", () => {
    const pkg = readPkg("../../../schema/package.json");
    const exports = pkg.exports ?? {};
    for (const key of ["./zh-intent", "./zh-taxonomy"]) {
      expect(exports, `schema 缺少子路径导出 ${key}`).toHaveProperty(key);
      const target = JSON.stringify(exports[key as keyof typeof exports]);
      expect(target, `${key} 必须指向 dist/*.js（node_modules 下拒绝 .ts 类型剥离）`).toContain("/dist/");
      expect(target).not.toContain("/src/");
    }
  });

  it("workspace schema 版本满足声明的下限", () => {
    const schema = readPkg("../../../schema/package.json");
    const v = schema.version.split(".").map(Number) as [number, number, number];
    expect(atLeastFloor(v)).toBe(true);
  });
});
