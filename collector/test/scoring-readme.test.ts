import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rmSync, statSync, utimesSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cacheGet, cacheSet } from "../src/cache.js";
import { fetchRawFile } from "../src/github.js";
import { loadScoringReadme } from "../src/scoring-readme.js";
import { scoreEase, scorePractical } from "../src/scoring.js";

vi.mock("../src/github.js", () => ({ fetchRawFile: vi.fn() }));

const fullName = `cache-test-${process.pid}/scoring-readme`;
const path = fileURLToPath(new URL(`../../data/cache/readmes/${fullName.replaceAll("/", "_")}.json`, import.meta.url));
const readme = "# Example\n## Installation\n```sh\ndsh plugin --profile web add example\n```\n" + "Documentation. ".repeat(200);
const fetchReadme = vi.mocked(fetchRawFile);

function expireReadme() {
  cacheSet("readmes", fullName, readme);
  const expired = new Date(Date.now() - 25 * 3600_000);
  utimesSync(path, expired, expired);
}

beforeEach(() => {
  rmSync(path, { force: true });
  fetchReadme.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  rmSync(path, { force: true });
  vi.restoreAllMocks();
});

describe("README scoring with reused detection", () => {
  it("keeps a fresh README without another request", async () => {
    cacheSet("readmes", fullName, readme);
    expect(await loadScoringReadme(fullName, "main", true)).toBe(readme);
    expect(fetchReadme).not.toHaveBeenCalled();
  });

  it("refills a 25-hour README even while unchanged detection is reusable", async () => {
    expireReadme();
    expect(cacheGet("readmes", fullName)).toBeNull();
    const updated = readme + "New documentation";
    fetchReadme.mockResolvedValue(updated);
    const result = await loadScoringReadme(fullName, "release-branch", true);
    expect(fetchReadme).toHaveBeenCalledWith(fullName, "README.md", "release-branch");
    expect(result).toBe(updated);
    expect(cacheGet("readmes", fullName)).toBe(updated);
    expect(scorePractical(result, false)).toBe(80);
    expect(scoreEase(result, true)).toBe(65);
  });

  it("fetches when the README cache is missing", async () => {
    fetchReadme.mockResolvedValue(readme);
    expect(await loadScoringReadme(fullName, "main", true)).toBe(readme);
    expect(fetchReadme).toHaveBeenCalledOnce();
  });

  it("uses stale text on refresh failure only for unchanged detection, without renewing it", async () => {
    expireReadme();
    const before = statSync(path).mtimeMs;
    fetchReadme.mockResolvedValue(null);
    expect(await loadScoringReadme(fullName, "main", true)).toBe(readme);
    expect(statSync(path).mtimeMs).toBe(before);
    expect(cacheGet("readmes", fullName)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("using stale text"));
    await loadScoringReadme(fullName, "main", true);
    expect(fetchReadme).toHaveBeenCalledTimes(2);
  });

  it("does not reuse stale text when the repository changed", async () => {
    expireReadme();
    fetchReadme.mockResolvedValue(null);
    expect(await loadScoringReadme(fullName, "main")).toBeNull();
  });

  it("does not fabricate text or cache a failed fetch when no previous README exists", async () => {
    fetchReadme.mockResolvedValue(null);
    expect(await loadScoringReadme(fullName, "main", true)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("no cached text"));
    fetchReadme.mockResolvedValue(readme);
    expect(await loadScoringReadme(fullName, "main", true)).toBe(readme);
    expect(fetchReadme).toHaveBeenCalledTimes(2);
  });
});
