/**
 * 下载远端 banner.webp 并转 PNG 检查渲染
 */
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const r = await fetch(
  "https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/banner.webp",
  { headers: { "User-Agent": "Mozilla/5.0" } }
);
console.log("status:", r.status);
const buf = Buffer.from(await r.arrayBuffer());
writeFileSync("design-ref/shots/banner-remote.webp", buf);
console.log("saved, size:", buf.length);

const m = await sharp("design-ref/shots/banner-remote.webp").metadata();
console.log("remote webp:", m.width, "x", m.height);
await sharp("design-ref/shots/banner-remote.webp")
  .png()
  .toFile("design-ref/shots/banner-remote.png");
console.log("converted to png");
