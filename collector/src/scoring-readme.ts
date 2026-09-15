import { cached, cacheGet } from "./cache.js";
import { fetchRawFile } from "./github.js";

/** The seven-day detection cache can outlive the 24-hour README cache. */
export async function loadScoringReadme(
  fullName: string,
  branch: string | null,
  reuseUnchangedDetection = false
): Promise<string | null> {
  const content = await cached<string | null>("readmes", fullName, () =>
    fetchRawFile(fullName, "README.md", branch)
  );
  if (content !== null || !reuseUnchangedDetection) return content;

  // Only reuse stale text when detection confirmed the same pushedAt. Do not
  // renew its mtime: the next collection must retry the failed refresh.
  const stale = cacheGet<string>("readmes", fullName, Infinity);
  console.warn(`[README] ${fullName}: refresh unavailable; ${stale !== null ? "using stale text for unchanged repository" : "no cached text available"}`);
  return stale;
}
