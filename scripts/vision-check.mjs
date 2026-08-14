/** 快速 luna 视觉检查：node scripts/vision-check.mjs <img> <prompt> */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const img = process.argv[2];
const prompt = process.argv[3] ?? "检查这张图的视觉效果，80 字内给出结论和建议。";

const cfg = JSON.parse(
  readFileSync(join(process.env.USERPROFILE, ".config", "opencode", "opencode.json"), "utf-8")
);

const buf = await sharp(join(root, img)).resize({ width: 900 }).jpeg({ quality: 82 }).toBuffer();
const body = {
  model: "gpt-5.6-luna",
  messages: [{ role: "user", content: [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: `data:image/jpeg;base64,${buf.toString("base64")}` } },
  ]}],
  max_tokens: 400,
};
let data = null;
for (let i = 1; i <= 3 && !data; i++) {
  const res = await fetch(cfg.provider.cctq.options.baseURL + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.provider.cctq.options.apiKey}` },
    body: JSON.stringify(body),
  });
  if (res.ok) data = await res.json();
  else { console.warn(`attempt ${i} failed`); await new Promise((r) => setTimeout(r, 5000 * i)); }
}
console.log(data?.choices?.[0]?.message?.content ?? "FAILED");
