/**
 * P5 备份/恢复测试：导出形状、坏文件校验、导入合并语义（只补装缺失，不动后来装的）
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BACKUP_KIND,
  BACKUP_SCHEMA_VERSION,
  buildBackup,
  importBackup,
  isBackupFile,
  type BackupFile,
} from "../src/backup.js";
import { readSettings, resolveConfig } from "../src/config.js";
import { makeMarket } from "./fixture.js";
import type { CommandRunner } from "../src/types.js";

/** mock runner：记录执行的命令，全部"成功"但不产生真实落位（冒烟应如实失败） */
function mockRunner(log: string[] = []): CommandRunner {
  return {
    async run(command) {
      log.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

/** 模拟真实落位的 runner：git clone 时真的建出 <dest>/SKILL.md，让结构化冒烟能通过 */
function simulatingRunner(log: string[] = []): CommandRunner {
  return {
    async run(command) {
      log.push(command);
      if (/git\s+clone/.test(command)) {
        // 取末位参数当克隆目标（与 router.ts cloneDestOf 同思路）
        const tokens = command.trim().split(/\s+/).filter(Boolean);
        const dest = tokens[tokens.length - 1]?.replace(/^"+|"+$/g, "");
        if (dest && dest !== "-") {
          mkdirSync(dest, { recursive: true });
          writeFileSync(join(dest, "SKILL.md"), "# skill");
        }
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
}

function tempCfg() {
  const dir = mkdtempSync(join(tmpdir(), "dsh-backup-"));
  const cfg = resolveConfig({
    dshHome: dir,
    skillsDir: join(dir, "skills"),
    profilesDir: join(dir, "profiles"),
    dataDir: join(dir, "data"),
  });
  return { cfg, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("buildBackup", () => {
  it("导出含 kind/schemaVersion/settings/installed，且不含凭据字段", () => {
    const { cfg, cleanup } = tempCfg();
    try {
      const market = makeMarket();
      const b = buildBackup(cfg, market, { appVersion: "0.4.10", favorites: ["a/b"] });
      expect(b.kind).toBe(BACKUP_KIND);
      expect(b.schemaVersion).toBe(BACKUP_SCHEMA_VERSION);
      expect(b.appVersion).toBe("0.4.10");
      expect(b.favorites).toEqual(["a/b"]);
      expect(b.settings).toBeTruthy();
      expect(Array.isArray(b.installed)).toBe(true);
      // 凭据绝不进备份
      expect(JSON.stringify(b)).not.toContain("token");
      expect(JSON.stringify(b)).not.toContain("ghp_");
    } finally {
      cleanup();
    }
  });
});

describe("isBackupFile", () => {
  it("接受合法备份，拒绝坏形状", () => {
    const good = {
      kind: BACKUP_KIND,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      installed: [],
    };
    expect(isBackupFile(good)).toBe(true);
    expect(isBackupFile(null)).toBe(false);
    expect(isBackupFile({})).toBe(false);
    expect(isBackupFile({ ...good, schemaVersion: 99 })).toBe(false);
    expect(isBackupFile({ ...good, installed: "x" })).toBe(false);
  });
});

describe("importBackup", () => {
  it("合并语义：已装 → already，缺失 → 补装（skill 冒烟通过），市场已无 → unmatched", async () => {
    const { cfg, cleanup } = tempCfg();
    try {
      const market = makeMarket();
      // 已装：skill 目录真落位（scanInstalled 的判定真值）
      mkdirSync(join(cfg.skillsDir, "obsidian-sync"), { recursive: true });
      writeFileSync(join(cfg.skillsDir, "obsidian-sync", "SKILL.md"), "# skill");
      const log: string[] = [];
      const backup: BackupFile = {
        kind: BACKUP_KIND,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        installed: [
          { pluginId: "note/obsidian-sync", localName: "obsidian-sync", version: null, source: "skills" as const, pluginName: "obsidian-sync", fullName: "note/obsidian-sync" },
          { pluginId: "acme/web-scraper", localName: "web-scraper", version: null, source: "skills" as const, pluginName: "web-scraper", fullName: "acme/web-scraper" },
          { pluginId: "gone/delisted-plugin", localName: "delisted-plugin", version: null, source: "skills" as const, pluginName: "delisted-plugin", fullName: "gone/delisted-plugin" },
          { pluginId: null, localName: "some-unknown-skill", version: null, source: "other" as const },
        ],
      };
      const r = await importBackup(cfg, market, backup, { runner: simulatingRunner(log) });
      // 已在本机 → already（合并语义：不动后来装的）
      expect(r.already).toContain("note/obsidian-sync");
      // 缺失的 skill 型 → T0 确定性安装（git clone），模拟落位后冒烟通过
      expect(r.restored).toContain("acme/web-scraper");
      expect(log.some((c) => /git\s+clone/.test(c))).toBe(true);
      // 已下架 / 未收录 → unmatched，不静默丢弃
      expect(r.unmatched).toHaveLength(2);
      expect(r.failed).toHaveLength(0);
    } finally {
      cleanup();
    }
  });

  it("冒烟失败 → failed 带原因（不伪报恢复成功）", async () => {
    const { cfg, cleanup } = tempCfg();
    try {
      const backup: BackupFile = {
        kind: BACKUP_KIND,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        installed: [
          { pluginId: "acme/web-scraper", localName: "web-scraper", version: null, source: "skills" as const, pluginName: "web-scraper", fullName: "acme/web-scraper" },
        ],
      };
      // mock runner 假装 clone 成功但没落位 → 冒烟如实失败
      const r = await importBackup(cfg, makeMarket(), backup, { runner: mockRunner() });
      expect(r.restored).toHaveLength(0);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0].error).toBeTruthy();
    } finally {
      cleanup();
    }
  });

  it("坏备份文件在动手之前就报错", async () => {
    const { cfg, cleanup } = tempCfg();
    try {
      await expect(
        importBackup(cfg, makeMarket(), { hello: 1 } as never, { runner: mockRunner() }),
      ).rejects.toThrow(/不是有效的 dsh-market 备份文件/);
    } finally {
      cleanup();
    }
  });

  it("settings 随导入恢复", async () => {
    const { cfg, cleanup } = tempCfg();
    try {
      const backup: BackupFile = {
        kind: BACKUP_KIND,
        schemaVersion: BACKUP_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        settings: { modeOverride: "veteran" as const, profile: "work" },
        installed: [],
      };
      await importBackup(cfg, makeMarket(), backup, { runner: mockRunner() });
      const s = readSettings(cfg);
      expect(s.modeOverride).toBe("veteran");
      expect(s.profile).toBe("work");
    } finally {
      cleanup();
    }
  });
});
