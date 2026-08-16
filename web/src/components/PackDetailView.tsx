/**
 * 整合包详情页（方向 A「深海清单」原样移植 + B 的五边形雷达与模块装配面板）
 * DOM 结构与样式令牌取自 design-ref/pack-detail-v1-ledger.html（方向 A 高保真原型）
 */
import type { DshPack } from "@dsh-market/schema";
import RadarChart, { RADAR_ORDER, RADAR_LABELS } from "./RadarChart";

interface Props {
  pack: DshPack;
  onBack: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  skill: "skill",
  cordis: "cordis",
  bundle: "bundle",
  pack: "sub-pack",
};

/** 插头图标（B 方向·模块装配语义，呼应品牌 logo 意象） */
function PlugIcon({ lit }: { lit: boolean }) {
  return (
    <svg width="15" height="13" viewBox="0 0 15 13" aria-hidden="true" className="pd-plug">
      <path d="M3.2 0.5 h2 v4.2 h-2 z M9.8 0.5 h2 v4.2 h-2 z" fill={lit ? "#4f9b78" : "#bfd5f0"} />
      <rect x="1" y="4.7" width="13" height="2.6" rx="1.3" fill={lit ? "#4f9b78" : "#bfd5f0"} />
    </svg>
  );
}

/** 模块卡（B 方向·装配面板条目：插头凹槽 + 槽位灯 + 类型芯片 + 状态） */
function ModuleCard({ entry }: { entry: DshPack["entries"][number] }) {
  const entryOk = entry.resolved?.ok ?? false;
  const entryMarket = entry.resolved?.inMarket ?? false;
  return (
    <div className={`pd-mod ${entryOk ? "" : "pd-mod-dead"}`}>
      {/* 卡顶插头凹槽（hover 插脚点亮） */}
      <div className="pd-plug">
        <span className={`pd-prong ${entryOk ? "on" : ""}`} />
        <span className={`pd-prong ${entryOk ? "on" : ""}`} />
      </div>
      {/* 槽位灯 */}
      <span className={`pd-slot-light ${entryOk ? "ok" : "dead"}`} title={entryOk ? "可解析" : "失效"} />
      {/* 已在市场角标 */}
      {entryMarket && <span className="pd-card-badge market">已在市场</span>}

      <div className="pd-card-body">
        <span className={`pd-type-chip chip-${entry.type}`}>
          {TYPE_LABEL[entry.type] ?? entry.type}
        </span>
        <div className="pd-card-info">
          <div className="pd-card-name">{entry.id}</div>
          <div className="pd-card-desc">
            {entryOk
              ? entryMarket
                ? "条目已在市场收录，可直接安装"
                : "条目可解析，安装时自动拉取"
              : entry.resolved?.reason ?? "条目解析失败"}
          </div>
          <div className="pd-card-foot">
            <span className="pd-tier-tag">{entry.version}</span>
            <span className={`pd-state-tag ${entryOk ? "state-ok" : "state-dead"}`}>
              <span className="pd-sig" />
              {entryOk ? "可解析" : "失效"}
            </span>
            {entryMarket && (
              <span className="pd-state-tag state-market">
                <span className="pd-sig" />已在市场
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PackDetailView({ pack, onBack }: Props) {
  const { total, ok, failed, inMarket } = pack.entryStats;
  const resolveRate = total > 0 ? Math.round((ok / total) * 100) : 0;
  const b = pack.score.breakdown;

  // 按类型分区（装配面板分区）
  const groups: { key: string; label: string; entries: DshPack["entries"] }[] = [];
  const order = ["skill", "cordis", "bundle", "pack"];
  for (const t of order) {
    const entries = pack.entries.filter((e) => e.type === t);
    if (entries.length > 0) groups.push({ key: t, label: TYPE_LABEL[t] ?? t, entries });
  }
  const leftover = pack.entries.filter((e) => !order.includes(e.type));
  if (leftover.length > 0) groups.push({ key: "other", label: "other", entries: leftover });

  return (
    <div className="pd-wrap">
      {/* 返回栏 */}
      <nav className="pd-backbar">
        <a href="#" onClick={(e) => { e.preventDefault(); onBack(); }} aria-label="返回市场">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
          返回市场
        </a>
        <span className="pd-lead">PACKS · <b>整合包中心</b></span>
      </nav>

      {/* 顶部 hero：标题区 + 解析率总览 */}
      <section className="pd-hero pd-glass">
        <div>
          <span className="pd-pk-badge">
            PACK
            {pack.kind === "dsh-pack" && <span className="pd-v">v{pack.schemaVersion}</span>}
          </span>
          <h1>{pack.name}</h1>
          <div className="pd-meta">
            <span>作者 <span className="pd-author">{pack.author}</span></span>
            <span className="pd-dot">·</span>
            <span className="pd-star">★ {pack.stars.toLocaleString()}</span>
            <span className="pd-dot">·</span>
            <span>更新于 <span className="pd-mono">{pack.pushedAt.slice(0, 10)}</span></span>
            {pack.homepage && (
              <>
                <span className="pd-dot">·</span>
                <span><a href={pack.homepage} target="_blank" rel="noreferrer">项目主页 ↗</a></span>
              </>
            )}
          </div>
          <p className="pd-intro">
            {pack.descriptionZh || pack.description || "（无简介）"}
          </p>
        </div>

        <div className="pd-overview">
          <div className="pd-cap">解析率总览</div>
          <div className="pd-big">{resolveRate}<small>%</small></div>
          <div className="pd-ov-sub">解析通过 <span className="pd-mono">{ok}/{total}</span> 条目</div>
          <div className="pd-ov-break">
            <div className="pd-ov-row">
              <span className="pd-k">可解析条目</span>
              <span className={`pd-v pd-mono ${resolveRate >= 80 ? "pd-ok" : ""}`}>{ok} / {total}</span>
            </div>
            <div className="pd-ov-row">
              <span className="pd-k">已在市场收录</span>
              <span className="pd-v pd-mono">{inMarket}</span>
            </div>
            {failed > 0 && (
              <div className="pd-ov-row">
                <span className="pd-k">失效条目</span>
                <span className="pd-v pd-mono pd-fail">{failed}</span>
              </div>
            )}
            <div className="pd-ov-row">
              <span className="pd-k">规则版本</span>
              <span className="pd-lbl">pack v{pack.schemaVersion}</span>
            </div>
          </div>
        </div>
      </section>

      {/* 模块装配面板（B 方向） */}
      <section className="pd-ledger">
        <div className="pd-glass pd-dock">
          <div className="pd-dock-head">
            <h2>
              <span className="pd-slot-glyph">◫</span> 内容装配
              <span className="pd-cnt pd-mono">{total} 条</span>
            </h2>
            <span className="pd-dock-sub">解析率 ✓ {ok}/{total} · {inMarket} 已在市场</span>
          </div>

          {groups.map((g) => (
            <div className="pd-zone" key={g.key}>
              <div className="pd-zone-head">
                <span className="pd-zone-rail" />
                <span className="pd-zone-name">{g.label.toUpperCase()}</span>
                <span className="pd-zone-count">{g.entries.length}</span>
              </div>
              {g.entries.map((e, i) => (
                <ModuleCard key={`${e.id}-${i}`} entry={e} />
              ))}
            </div>
          ))}

          <div className="pd-dock-foot">
            <span><span className="pd-ok">✓</span> {ok}/{total} 可解析 ({resolveRate}%)</span>
            <span>{inMarket} 已在市场</span>
            {failed > 0 && <span>{failed} 失效</span>}
          </div>
        </div>
      </section>

      {/* 五维评分（A 横条 + B 雷达）+ 推荐理由 */}
      <section className="pd-rate-wrap">
        <div className="pd-glass pd-score-card">
          <div className="pd-score-top">
            <h2>五维评分</h2>
            <div className="pd-score-total">
              <div className="pd-num">{pack.score.total}</div>
              <div className="pd-cap">综合评分</div>
            </div>
          </div>

          <div className="pd-score-flex">
            <RadarChart breakdown={b} total={pack.score.total} size={150} />
            <div className="pd-bars">
              {RADAR_ORDER.map((k) => (
                <div className="pd-bar-row" key={k}>
                  <span className="pd-k">{RADAR_LABELS[k]}</span>
                  <span className="pd-bar-track">
                    <span className="pd-bar-fill" style={{ width: `${b[k]}%` }} />
                  </span>
                  <span className="pd-v pd-mono">{b[k]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="pd-glass pd-why-card">
          <div className="pd-cap">推荐理由</div>
          <div className="pd-quote-mark">‖ 编辑评语</div>
          <blockquote>{pack.score.explanation}</blockquote>
        </div>
      </section>

      {/* 安装指引 */}
      <section className="pd-install">
        <div className="pd-glass">
          <h2>安装指引</h2>
          <p className="pd-sub">整合包一键安装工具（bundler）研发中，安装方式待定——敬请期待。</p>
        </div>
      </section>
    </div>
  );
}
