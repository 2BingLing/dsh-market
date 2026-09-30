/**
 * 插件卡片：类型/名称/描述/标签 + 左短条右雷达图评分区 + 元信息 + 收藏
 * #185 · 整卡为真实 <a href>：右键/中键/Ctrl+点击 新标签页打开详情（浏览器原生），
 * 普通左键拦截为 SPA 跳转，保持即时切换与滚动恢复
 */
import type { DshPlugin } from "@dsh-market/schema";
import RadarChart, { RADAR_ORDER, RADAR_LABELS } from "./RadarChart";
import CommunityBadge, { isCommunitySubmitted } from "./CommunityBadge";
import { formatDshRequirement } from "../lib/dsh-compat";
import { pluginDetailUrl, isPlainLeftClick } from "../lib/deeplink";

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

interface Props {
  plugin: DshPlugin;
  favorite: boolean;
  onToggleFavorite: (id: string) => void;
  onOpen: (plugin: DshPlugin) => void;
}

export default function PluginCard({ plugin, favorite, onToggleFavorite, onOpen }: Props) {
  const b = plugin.score.breakdown;
  const dshReq = formatDshRequirement(plugin.install.dshEngines);
  return (
    <a
      className="card"
      href={pluginDetailUrl(plugin.id)}
      onClick={(e) => {
        if (!isPlainLeftClick(e)) return; // 新标签页/新窗口 → 交给浏览器默认行为
        e.preventDefault();
        onOpen(plugin);
      }}
    >
      <div className="card-top">
        <span className="card-type">
          <span className={`pill ${plugin.type === "skill" ? "pill-skill" : "pill-plugin"}`}>
            {plugin.type === "skill" ? "SKILL" : "PLUGIN"}
          </span>
          {/* #169 E2 · 跨生态 skill：主要面向其他 AI 宿主，中性灰标注 */}
          {plugin.crossEcosystem && (
            <span className="pill pill-cross" title={plugin.crossEcosystemHint ?? undefined}>
              跨生态
            </span>
          )}
          {isCommunitySubmitted(plugin) && <CommunityBadge small />}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 11, color: "#8CA3BB" }}>{timeAgo(plugin.pushedAt)}</span>
          <button
            className={`fav-star ${favorite ? "on" : ""}`}
            onClick={(e) => {
              e.preventDefault(); // 卡片现在是 <a>：仅 stopPropagation 不够，需阻止锚点默认跳转
              e.stopPropagation();
              onToggleFavorite(plugin.id);
            }}
            title={favorite ? "取消收藏" : "收藏"}
          >
            {favorite ? "★" : "☆"}
          </button>
        </span>
      </div>
      <h4>{plugin.name}</h4>
      <div className="desc" title={plugin.descriptionZh || plugin.description}>
        {plugin.descriptionZh || plugin.description}
      </div>
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
        <span>{plugin.install.needsConfig ? "需配置" : plugin.install.usageNeedsConfig ? "装后需配模型" : "开箱即用"}</span>
        {/* #165 建议五：市场侧风险标记（README 安装命令含远程脚本执行 / 全局安装） */}
        {plugin.install.risky ? <span style={{ color: "#c8943d" }}>⚠ {plugin.install.riskyReasons?.[0]?.includes("全局") ? "全局安装" : "远程脚本"}</span> : null}
        <span>{plugin.install.method === "skills-add" ? "一键安装" : "pnpm 安装"}</span>
        {/* N2 · 宿主版本要求（Web 只展示需求，本机是否装得上由插件端判定） */}
        {dshReq ? <span title={plugin.install.dshEngines ?? undefined}>{dshReq}</span> : null}
      </div>
    </a>
  );
}
