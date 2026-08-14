/**
 * 插件详情页：五维大雷达图 + 档案元数据 + README 摘要 + 安装信息
 */
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

export default function DetailView({ plugin, favorite, onToggleFavorite, onBack }: Props) {
  const b = plugin.score.breakdown;
  const installText =
    plugin.install.method === "skills-add"
      ? "克隆到 ~/.agents/skills（skill 型）"
      : plugin.install.method === "pnpm-profile"
        ? "在目标 profile 中 pnpm add + patch（cordis 型）"
        : "通用 git clone";

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
              <p>{installText}</p>
              <p className={`install-state ${plugin.install.needsConfig ? "warn" : "ok"}`}>
                {plugin.install.needsConfig ? "需要额外配置（API Key / Token 等）" : "开箱即用，无需额外配置"}
              </p>
              {plugin.install.target && <p className="install-target">目标位置：{plugin.install.target}</p>}
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
