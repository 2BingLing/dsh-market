/**
 * 整合包卡片：PACK 标记 / 名称 / 作者 / 中文简介 / 条目解析率徽章 / 五维评分
 */
import type { DshPack } from "@dsh-market/schema";
import { RADAR_ORDER, RADAR_LABELS } from "./RadarChart";

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
  pack: DshPack;
  onOpen: (pack: DshPack) => void;
}

export default function PackCard({ pack, onOpen }: Props) {
  const b = pack.score.breakdown;
  const { total, ok, inMarket } = pack.entryStats;
  const resolveRate = total > 0 ? Math.round((ok / total) * 100) : 0;
  return (
    <article className="card" onClick={() => onOpen(pack)}>
      <div className="card-top">
        <span className="pill pill-pack">PACK</span>
        <span style={{ fontSize: 11, color: "#8CA3BB" }}>{timeAgo(pack.pushedAt)}</span>
      </div>
      <h4>{pack.name}</h4>
      <div className="desc" title={pack.descriptionZh || pack.description}>
        {pack.descriptionZh || pack.description || "（无简介）"}
      </div>
      <div className="tags">
        <span className="tag-mini">作者 {pack.author}</span>
        {pack.tags.slice(0, 2).map((t) => (
          <span className="tag-mini" key={t}>{t}</span>
        ))}
      </div>
      {/* 条目解析率徽章：整合包核心质量信号 */}
      <div className={`pack-stats ${resolveRate >= 80 ? "ok" : resolveRate >= 50 ? "warn" : "bad"}`}>
        <span>✓ {ok}/{total} 条目可解析</span>
        <span>·</span>
        <span>{inMarket} 个已在市场</span>
        <b>{resolveRate}%</b>
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
          <div className="pack-total">
            <b>{pack.score.total}</b>
            <span>实用分</span>
          </div>
        </div>
      </div>
      <div className="foot">
        <span className="star">{fmt(pack.stars)}</span>
        <span>{total} 个条目</span>
        <span>一键装包</span>
      </div>
    </article>
  );
}
