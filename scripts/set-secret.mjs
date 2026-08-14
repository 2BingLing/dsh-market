/**
 * 通过 GitHub API 设置仓库 Actions secret（libsodium sealed box 加密）
 * 用法：node scripts/set-secret.mjs <secret-name>
 * 从 .env 同名变量取值；凭据从 Git Credential Manager 获取
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import nacl from "tweetnacl";
import { blake2b } from "blakejs";

const name = process.argv[2];
if (!name) {
  console.error("用法: node scripts/set-secret.mjs <SECRET_NAME>");
  process.exit(1);
}

// 从 Git Credential Manager 取 token（直接通过 stdin 喂给 git credential fill）
const out = execFileSync("git", ["credential", "fill"], {
  input: "protocol=https\nhost=github.com\n",
  encoding: "utf8",
});
const pass = out
  .split(/\r?\n/)
  .find((l) => l.startsWith("password="))
  ?.slice(9);
if (!pass) {
  console.error("无法获取 GitHub 凭据");
  process.exit(1);
}

const H = {
  Authorization: `token ${pass}`,
  "User-Agent": "dsh-market",
  Accept: "application/vnd.github+json",
};
const REPO = "2BingLing/dsh-market";

const value = readFileSync(join(process.cwd(), ".env"), "utf-8").match(new RegExp(`${name}=(\\S+)`))?.[1];
if (!value) {
  console.error(`.env 里没有 ${name}`);
  process.exit(1);
}

const pk = await (await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/public-key`, { headers: H })).json();
if (!pk.key) {
  console.error("获取公钥失败:", JSON.stringify(pk).slice(0, 200));
  process.exit(1);
}

const pub = Buffer.from(pk.key, "base64");
const ep = nacl.box.keyPair();
// libsodium crypto_box_seal：nonce = blake2b(ephemeral_pk || recipient_pk, outlen=24)
const nonce = Buffer.from(blake2b(Buffer.concat([ep.publicKey, pub]), null, 24));
const cipher = nacl.box(Buffer.from(value), nonce, pub, ep.secretKey);
const sealed = Buffer.concat([ep.publicKey, cipher]).toString("base64");

const res = await fetch(`https://api.github.com/repos/${REPO}/actions/secrets/${name}`, {
  method: "PUT",
  headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ encrypted_value: sealed, key_id: pk.key_id }),
});
console.log(`secret ${name}:`, res.status, res.status === 201 || res.status === 204 ? "OK" : (await res.text()).slice(0, 200));
