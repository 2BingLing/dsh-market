/**
 * 插件详情页：五维大雷达图 + 档案元数据 + README 摘要 + 安装信息
 */
import { useMemo, useState } from "react";
import type { DshPlugin } from "@dsh-market/schema";
import RadarChart, { RADAR_ORDER, RADAR_LABELS } from "./RadarChart";

function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

/** 清洗 markdown/HTML 源码 → 可读纯文本 */
export function cleanMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/<[^>]+>/g, " ") // HTML 标签
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[\]\([^)]*\)/g, " ") // 空文本链接
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接 → 文本
    .replace(/[#>*_`~|]{1,}/g, " ") // markdown 标记
    .replace(/\s+/g, " ")
    .trim();
}

interface Props {
  plugin: DshPlugin;
  favorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
}

/** 生成具体安装命令（按插件类型） */
export function buildInstallCommand(p: DshPlugin): string {
  const repoUrl = `https://github.com/${p.fullName}`;
  if (p.install.method === "skills-add") {
    return `git clone ${repoUrl}.git ~/.agents/skills/${p.repo}`;
  }
  if (p.install.method === "pnpm-profile") {
    return `dsh plugin --profile web add ${repoUrl}`;
  }
  return `git clone ${repoUrl}.git`;
}

/** 生成「让 Harness AI 安装」的提示词 */
export function buildInstallPrompt(p: DshPlugin): string {
  const typeDesc = p.type === "skill" ? "skill（技能，装到 ~/.agents/skills 目录）" : "cordis 插件（装到 DSH profile）";
  const configNote = p.install.needsConfig
    ? "注意：该插件可能需要额外配置（API Key / Token 等），装完后请告诉我如何配置。"
    : "该插件开箱即用，无需额外配置。";
  return [
    `请帮我安装 DeepSeek Harness 插件「${p.name}」：`,
    `- GitHub 仓库：${p.fullName}（${`https://github.com/${p.fullName}`}）`,
    `- 类型：${typeDesc}`,
    `- ${configNote}`,
    ``,
    `请先查看仓库 README 确认安装步骤，然后按官方方式安装（skill 型克隆到 ~/.agents/skills，cordis 型用 dsh plugin 装到我的 profile）。装完后告诉我怎么使用。`,
  ].join("\n");
}

export default function DetailView({ plugin, favorite, onToggleFavorite, onBack }: Props) {
  const b = plugin.score.breakdown;
  const [copied, setCopied] = useState<string | null>(null);

  const installCmd = buildInstallCommand(plugin);
  const installPrompt = buildInstallPrompt(plugin);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    } catch {
      // 降级：选中文本
      setCopied(key);
      setTimeout(() => setCopied(null), 1800);
    }
  };

  return (
    <div className="detail">
      {/* 顶部条 */}
      <div className="detail-top">
        <button className="back-btn" onClick={onBack}>← 返回市场</button>
        <div className="detail-title-row">
          <span className={`pill ${plugin.type === "skill" ? "pill-skill" : "pill-plugin"}`}>
            {plugin.type === "skill" ? "SKILL" : "PLUGIN"}
          </span>
          <h2>{plugin.name}</h2>
          <button
            className={`fav-btn ${favorite ? "on" : ""}`}
            onClick={onToggleFavorite}
            title={favorite ? "取消收藏" : "收藏"}
          >
            {favorite ? "★ 已收藏" : "☆ 收藏"}
          </button>
        </div>
        <p className="detail-desc">{plugin.descriptionZh || plugin.description}</p>
        <div className="tags">
          {plugin.tags.map((t) => (
            <span className="tag-mini" key={t}>{t}</span>
          ))}
        </div>
      </div>

      <div className="detail-body">
        {/* 左栏：评分 */}
        <div className="detail-score">
          <div className="score-card">
            <div className="score-card-head">
              <span className="score-big-num">{plugin.score.total}</span>
              <span className="score-big-label">实用分 / 100</span>
            </div>
            <div className="radar-lg">
              <RadarChart breakdown={b} total={plugin.score.total} size={220} />
            </div>
            <div className="score-dims">
              {RADAR_ORDER.map((k) => (
                <div className="dim-row" key={k}>
                  <span className="dim-name">{RADAR_LABELS[k]}</span>
                  <div className="dim-track">
                    <div className="dim-fill" style={{ width: `${b[k]}%` }} />
                  </div>
                  <b>{b[k]}</b>
                </div>
              ))}
            </div>
            <p className="explain">「{plugin.score.explanation}」</p>
            <p className="conf">数据置信度 {Math.round(plugin.score.confidence * 100)}%</p>
          </div>
        </div>

        {/* 右栏：档案信息 */}
        <div className="detail-info">
          <section className="info-block">
            <h4>档案信息</h4>
            <dl>
              <div><dt>仓库</dt><dd><a href={`https://github.com/${plugin.fullName}`} target="_blank" rel="noreferrer">{plugin.fullName} ↗</a></dd></div>
              <div><dt>作者</dt><dd>{plugin.owner}</dd></div>
              <div><dt>协议</dt><dd>{plugin.license ?? "无 LICENSE"}</dd></div>
              <div><dt>语言</dt><dd>{plugin.language ?? "—"}</dd></div>
              <div><dt>Stars</dt><dd>★ {fmt(plugin.stars)}</dd></div>
              <div><dt>Forks</dt><dd>{fmt(plugin.forks)}</dd></div>
              <div><dt>更新时间</dt><dd>{fmtDate(plugin.pushedAt)}</dd></div>
              <div><dt>创建时间</dt><dd>{fmtDate(plugin.createdAt)}</dd></div>
              <div><dt>收录来源</dt><dd>{plugin.sources.join(" / ")}</dd></div>
            </dl>
          </section>

          <section className="info-block">
            <h4>安装</h4>
            <div className="install-box">
              {/* 安装命令 + 复制 */}
              <div className="cmd-box">
                <code>{installCmd}</code>
                <button className={`copy-btn ${copied === "cmd" ? "ok" : ""}`} onClick={() => copy("cmd", installCmd)}>
                  {copied === "cmd" ? "✓ 已复制" : "复制命令"}
                </button>
              </div>

              {/* 复制提示词 + 说明（同行） */}
              <div className="prompt-row">
                <button className={`copy-btn ${copied === "prompt" ? "ok" : ""}`} onClick={() => copy("prompt", installPrompt)}>
                  {copied === "prompt" ? "✓ 已复制" : "复制安装提示词"}
                </button>
                <span className="prompt-note">如已装 DSH 插件端（开发中），以后可一键安装</span>
              </div>
            </div>
          </section>

          {plugin.readmeSummary && (
            <section className="info-block">
              <h4>README 摘要</h4>
              <p className="readme-summary">
                {cleanMarkdown(plugin.readmeSummary)}
                {plugin.readmeSummary.trimEnd().endsWith("…") && "（摘要节选）"}
              </p>
              <a
                className="readme-link"
                href={`https://github.com/${plugin.fullName}`}
                target="_blank"
                rel="noreferrer"
              >
                查看完整 README ↗
              </a>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
