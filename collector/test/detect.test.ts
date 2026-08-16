/**
 * detectSubdirBundle 单元测试：子目录 bundle 探测（根目录无标记、插件在子目录）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { detectSubdirBundle } from "../src/detect.js";
import { fetchRepoRoot } from "../src/github.js";

vi.mock("../src/github.js", () => ({
  fetchRepoRoot: vi.fn(),
}));

const mockFetch = fetchRepoRoot as unknown as ReturnType<typeof vi.fn>;

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

  it("最多探测 3 个候选目录", async () => {
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
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
