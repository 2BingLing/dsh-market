/**
 * 插件卡片：类型/名称/描述/标签 + 左短条右雷达图评分区 + 元信息
 */
import type { DshPlugin } from "@dsh-market/schema";
import RadarChart, { RADAR_ORDER, RADAR_LABELS } from "./RadarChart";

function fmt(n: number): string {
  return n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n);
}

function timeAgo(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days <= 0) return "今天更新";
  if (days === 1) return "昨天更新";
  if (days < 30) return `${days} 天前更新`;
  return iso.slice(0, 10);
}

export default function PluginCard({ plugin }: { plugin: DshPlugin }) {
  const b = plugin.score.breakdown;
  return (
    <article className="card">
      <div className="card-top">
        <span className={`pill ${plugin.type === "skill" ? "pill-skill" : "pill-plugin"}`}>
          {plugin.type === "skill" ? "SKILL" : "PLUGIN"}
        </span>
        <span style={{ fontSize: 11, color: "#8CA3BB" }}>{timeAgo(plugin.pushedAt)}</span>
      </div>
      <h4>{plugin.name}</h4>
      <div className="desc">{plugin.description}</div>
      <div className="tags">
        {plugin.tags.slice(0, 3).map((t) => (
          <span className="tag-mini" key={t}>{t}</span>
        ))}
      </div>
      <div className="score-zone">
        <div className="score-left">
          {RADAR_ORDER.map((k) => (
            <div className="mbar" key={k}>
              <i>{RADAR_LABELS[k]}</i>
              <div className="track">
                <div className="fill" style={{ width: `${b[k]}%` }} />
              </div>
              <b>{b[k]}</b>
            </div>
          ))}
        </div>
        <div className="radar-wrap">
          <RadarChart breakdown={b} total={plugin.score.total} />
          <div className="rtotal">
            <b>{plugin.score.total}</b>
            <span>实用分</span>
          </div>
        </div>
      </div>
      <div className="foot">
        <span className="star">{fmt(plugin.stars)}</span>
        <span>{plugin.install.needsConfig ? "需配置" : "开箱即用"}</span>
        <span>{plugin.install.method === "skills-add" ? "一键安装" : "pnpm 安装"}</span>
      </div>
    </article>
  );
}
