import { describe, expect, it, vi } from "vitest";
import { fetchCurrentUser, fetchStarred, starredPluginIds } from "../src/github.js";
import { makeMarket } from "./fixture.js";

function mockFetch(responses: Array<{ ok: boolean; status: number; body: unknown }>) {
  return vi.fn(async () => {
    const r = responses.shift()!;
    return { ok: r.ok, status: r.status, json: async () => r.body };
  }) as unknown as typeof fetch;
}

describe("github", () => {
  it("fetchCurrentUser 返回 login", async () => {
    const f = mockFetch([{ ok: true, status: 200, body: { login: "2BingLing", avatar_url: null } }]);
    const u = await fetchCurrentUser("token-x", f);
    expect(u.login).toBe("2BingLing");
    // 请求带了 Authorization
    const call = (f as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((call[1] as Record<string, unknown>).headers).toMatchObject({
      Authorization: "Bearer token-x",
    });
  });

  it("fetchStarred 有 token 走 /user/starred（分页聚合）", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ full_name: `repo${i}/pkg${i}` }));
    const f = mockFetch([
      { ok: true, status: 200, body: page1 },
      { ok: true, status: 200, body: [] },
    ]);
    const starred = await fetchStarred({ token: "t" }, f);
    expect(starred.length).toBe(100);
    const url = (f as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/user/starred");
  });

  it("fetchStarred 无 token 有 username 走公开端点", async () => {
    const f = mockFetch([{ ok: true, status: 200, body: [{ full_name: "feishu/feishu-doc" }] }]);
    const starred = await fetchStarred({ username: "2BingLing" }, f);
    expect(starred).toEqual(["feishu/feishu-doc"]);
    const url = (f as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain("/users/2BingLing/starred");
  });

  it("无 token 无 username → 空列表", async () => {
    const starred = await fetchStarred({}, mockFetch([]));
    expect(starred).toEqual([]);
  });

  it("starredPluginIds 命中收录", () => {
    const market = makeMarket();
    const ids = starredPluginIds(
      ["feishu/feishu-doc", "some/unlisted"],
      market.plugins,
    );
    expect(ids).toEqual(["feishu/feishu-doc"]);
  });
});
