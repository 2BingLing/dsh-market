/**
 * 中文意图词典（原 core/src/zh-intent.ts，2026-09-26 迁至 schema 共享包）
 *
 * 迁移原因：web 站（dsh.market）的搜索也要用同一份词表——
 * 三端（collector / plugin / web）必须遵守同一份定义，避免词表分叉漂移。
 * 本文件保留为 re-export 垫片：core 内部（search.ts / 测试）的既有导入路径不变。
 *
 * ⚠️ 发版顺序注意：这是 schema 的首个**值导出**（此前全部是 type-only）。
 * core 下次发版前必须先发含本文件的 schema 版本，否则已发布的 core 在
 * 运行时会拿到没有 zh-intent 的 schema 包。
 */
export { ZH_INTENTS, expandZhQuery } from "@dsh-market/schema/zh-intent";
export type { ZhIntent, ZhExpansion } from "@dsh-market/schema/zh-intent";
