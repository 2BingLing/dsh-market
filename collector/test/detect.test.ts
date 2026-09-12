/**
 * detectSubdirBundle 单元测试：子目录 bundle 探测（根目录无标记、插件在子目录）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectPlugin, detectSubdirBundle, isCordisPackageJson, extractDshEngines } from "../src/detect.js";
import { fetchRepoRoot, fetchFileViaApi } from "../src/github.js";

vi.mock("../src/github.js", () => ({
  fetchRepoRoot: vi.fn(),
  fetchFileViaApi: vi.fn(),
}));

const mockFetch = fetchRepoRoot as unknown as ReturnType<typeof vi.fn>;
const mockFetchFile = fetchFileViaApi as unknown as ReturnType<typeof vi.fn>;

function rootItem(name: string, type: "file" | "dir" = "file") {
  return { name, path: name, type, size: type === "file" ? 1 : 0 };
}

const CORDIS_SUBDIR = [
  rootItem("package.json"),
  rootItem("cordis.patch.yml"),
  rootItem("lib", "dir"),
];

describe("detectSubdirBundle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("命中间名子目录（dsh-pet 场景：根目录无标记，插件在 dsh-pet/）", async () => {
    const root = [
      rootItem("README.md"),
      rootItem("DESIGN.md"),
      rootItem("dsh-pet", "dir"),
      rootItem("assets", "dir"),
      rootItem("scripts", "dir"),
    ];
    mockFetch.mockResolvedValue(CORDIS_SUBDIR);
    const r = await detectSubdirBundle("PC2005-cloud/dsh-pet", root as never, "master");
    expect(r?.subdir).toBe("dsh-pet");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("PC2005-cloud/dsh-pet", "master", "dsh-pet");
  });

  it("dsh- 前缀子目录命中", async () => {
    const root = [
      rootItem("README.md"),
      rootItem("dsh-plugin", "dir"),
      rootItem("docs", "dir"),
    ];
    mockFetch.mockResolvedValue(CORDIS_SUBDIR);
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r?.subdir).toBe("dsh-plugin");
  });

  it("无可疑目录（仅 docs/assets/src 等）返回 null 且不调 API", async () => {
    const root = [
      rootItem("README.md"),
      rootItem("docs", "dir"),
      rootItem("assets", "dir"),
      rootItem("src", "dir"),
      rootItem("public", "dir"),
    ];
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("可疑目录存在但无 cordis 标记（无 package.json）返回 null", async () => {
    const root = [rootItem("README.md"), rootItem("dsh-tool", "dir")];
    mockFetch.mockResolvedValue([rootItem("README.md"), rootItem("lib", "dir")]);
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
  });

  it("可疑目录有 package.json 但无 cordis 标记返回 null", async () => {
    const root = [rootItem("README.md"), rootItem("plugin", "dir")];
    mockFetch.mockResolvedValue([rootItem("package.json"), rootItem("README.md")]);
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
  });

  it("最多探测 4 个候选目录（含 monorepo 子包）", async () => {
    const root = [
      rootItem("README.md"),
      rootItem("dsh-a", "dir"),
      rootItem("dsh-b", "dir"),
      rootItem("dsh-c", "dir"),
      rootItem("dsh-d", "dir"),
    ];
    mockFetch.mockResolvedValue([rootItem("package.json")]);
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });
});

describe("isCordisPackageJson", () => {
  it("纯 client 注入插件（dsh.client 字段，dsh-read-history 案例）判定为插件", () => {
    const pkg = JSON.stringify({
      name: "dsh-read-history",
      main: "lib/index.js",
      exports: { ".": "./lib/index.js", "./client": "./lib/client.js" },
      dsh: { client: { platform: "web", inject: ["@deepseek-ai/dsh-client-runtime"] } },
    });
    expect(isCordisPackageJson(pkg)).toBe(true);
  });

  it("dshClient 顶层字段不参与判定；该案例仍靠 dsh.bundle.patch 命中（With-With 形态）", () => {
    const pkg = JSON.stringify({
      name: "dsh-hindsight-plugins",
      dsh: { bundle: { patch: "./cordis.patch.yml" } },
      dshClient: { inject: ["@deepseek-ai/dsh-client-runtime"], platform: "web" },
    });
    expect(isCordisPackageJson(pkg)).toBe(true);
  });

  it("只有 dshClient 顶层字段（无 dsh.client / bundle / cordis 依赖）判定为非插件", () => {
    // DSH 的 parseDshClient 只读 pkg.dsh.client；dshClient 从未被任何 0.1.x 读取，
    // 这类包装上去不会被加载，不该进市场清单。
    const pkg = JSON.stringify({
      name: "some-legacy-client-plugin",
      dshClient: { inject: ["@deepseek-ai/dsh-client-runtime"], platform: "web" },
    });
    expect(isCordisPackageJson(pkg)).toBe(false);
  });

  it("无任何 DSH/cordis 标记的普通包判定为非插件", () => {
    const pkg = JSON.stringify({
      name: "some-tool",
      dependencies: { lodash: "^4.0.0" },
    });
    expect(isCordisPackageJson(pkg)).toBe(false);
  });

  it("dsh 字段存在但无 client/bundle（如只有 dsh.xxx 自定义）判定为非插件", () => {
    const pkg = JSON.stringify({
      name: "some-repo",
      dsh: { something: { else: true } },
    });
    expect(isCordisPackageJson(pkg)).toBe(false);
  });

  it("null/空内容返回 false", () => {
    expect(isCordisPackageJson(null)).toBe(false);
    expect(isCordisPackageJson("")).toBe(false);
  });
});

describe("detectSubdirBundle 子目录依赖判据（#34 search2chart-mcp 场景）", () => {
  beforeEach(() => vi.clearAllMocks());

  it("子目录无批处理文件但 package.json 依赖 @deepseek-ai → 命中", async () => {
    const root = [rootItem("README.md"), rootItem("dsh", "dir")];
    mockFetch.mockResolvedValue([rootItem("package.json")]);
    mockFetchFile.mockResolvedValue({
      content: JSON.stringify({
        name: "dsh-chart",
        peerDependencies: { "@deepseek-ai/dsh-tools": "*" },
      }),
      sha: "x",
    });
    const r = await detectSubdirBundle("iqingyoung/search2chart-mcp", root as never, "main");
    expect(r?.subdir).toBe("dsh");
    expect(r?.evidence[0]).toContain("DSH 依赖");
  });

  it("子目录 package.json 无 DSH 依赖且无标记 → 不命中", async () => {
    const root = [rootItem("README.md"), rootItem("dsh", "dir")];
    mockFetch.mockResolvedValue([rootItem("package.json")]);
    mockFetchFile.mockResolvedValue({
      content: JSON.stringify({ name: "lib", dependencies: { lodash: "^4" } }),
      sha: "x",
    });
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
  });
});

describe("detectPlugin manifest + detectSubdirBundle monorepo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("根目录有 dsh-manifest.json → 判定 cordis-plugin（#53 新形态）", async () => {
    const root = [
      rootItem("README.md"),
      rootItem("dsh-manifest.json"),
      rootItem("package.json"),
      rootItem("packages", "dir"),
    ];
    const det = await detectPlugin("iqingyoung/429-throttle-mcp", root as never);
    expect(det.isPlugin).toBe(true);
    expect(det.type).toBe("cordis-plugin");
    expect(det.evidence.join()).toContain("cordis marker");
  });

  it("monorepo：packages/ 下插件包命中（#52 类：插件在 packages/plugin）", async () => {
    const root = [rootItem("README.md"), rootItem("package.json"), rootItem("packages", "dir")];
    // detectSubdirBundle 内部：先取 packages 子目录列表，再探测 plugin 子包
    mockFetch.mockImplementation(async (_fn, _br, path) => {
      if (path === "packages") {
        return [rootItem("api", "dir"), rootItem("plugin", "dir"), rootItem("shared", "dir")];
      }
      if (path === "packages/plugin") {
        return [rootItem("package.json"), rootItem("cordis.patch.yml")];
      }
      return [];
    });
    const r = await detectSubdirBundle("uruana33/dsh-cost-meter", root as never, "main");
    expect(r?.subdir).toBe("packages/plugin");
  });

  it("monorepo：packages/ 下子包无插件标记 → 不命中", async () => {
    const root = [rootItem("README.md"), rootItem("packages", "dir")];
    mockFetch.mockImplementation(async (_fn, _br, path) => {
      if (path === "packages") return [rootItem("api", "dir")];
      if (path === "packages/api") return [rootItem("README.md")];
      return [];
    });
    const r = await detectSubdirBundle("someone/some-repo", root as never, "main");
    expect(r).toBeNull();
  });
});

/**
 * extractDshEngines（N2 · Host-aware 兼容门禁的数据来源）
 * 原则：宁缺勿错 —— 拿不准就返回 null（= 未知），绝不用猜测的版本去拦截安装。
 */
describe("extractDshEngines", () => {
  const pkg = (o: Record<string, unknown>) => JSON.stringify(o);

  it("engines.dsh 优先，来源标 engines", () => {
    expect(extractDshEngines(pkg({ engines: { dsh: ">=0.1.5" } }))).toEqual({
      range: ">=0.1.5",
      source: "engines",
    });
  });

  it("engines.dsh 优先于依赖约束（即使依赖也在）", () => {
    const r = extractDshEngines(
      pkg({
        engines: { dsh: "^0.1.2" },
        peerDependencies: { "@deepseek-ai/dsh-web-app": ">=0.1.5" },
      }),
    );
    expect(r).toEqual({ range: "^0.1.2", source: "engines" });
  });

  it("无 engines 时退 peerDependencies，再退 devDependencies", () => {
    expect(
      extractDshEngines(pkg({ peerDependencies: { "@deepseek-ai/dsh-base": ">=0.1.5" } })),
    ).toEqual({ range: ">=0.1.5", source: "peer-dep" });
    expect(
      extractDshEngines(pkg({ devDependencies: { "@deepseek-ai/dsh-client-ui-layout": "~0.1.2" } })),
    ).toEqual({ range: "~0.1.2", source: "dev-dep" });
  });

  it("只看 @deepseek-ai/dsh 前缀的包（cordis / 其他 scope 不算）", () => {
    expect(extractDshEngines(pkg({ dependencies: { cordis: "^3.0.0" } }))).toBeNull();
    expect(extractDshEngines(pkg({ dependencies: { "@other/dsh-thing": "^1.0.0" } }))).toBeNull();
  });

  it("通配/空/非 npm 源声明一律视为未知（避免拿 `*` 当范围）", () => {
    expect(extractDshEngines(pkg({ engines: { dsh: "*" } }))).toBeNull();
    expect(extractDshEngines(pkg({ engines: { dsh: "" } }))).toBeNull();
    expect(extractDshEngines(pkg({ engines: { dsh: 5 } }))).toBeNull();
    expect(
      extractDshEngines(pkg({ peerDependencies: { "@deepseek-ai/dsh-base": "link:../dsh" } })),
    ).toBeNull();
  });

  it("解析失败 / 空内容 → null（绝不抛错影响检测主流程）", () => {
    expect(extractDshEngines(null)).toBeNull();
    expect(extractDshEngines("{ 坏 json")).toBeNull();
    expect(extractDshEngines(pkg({ name: "x" }))).toBeNull();
  });

  it("engines.dsh 存在但不是合法范围 → 不在 engines 上勉强命中，继续看依赖", () => {
    const r = extractDshEngines(
      pkg({ engines: { dsh: "见 README" }, peerDependencies: { "@deepseek-ai/dsh": ">=0.1.5" } }),
    );
    expect(r).toEqual({ range: ">=0.1.5", source: "peer-dep" });
  });
});
