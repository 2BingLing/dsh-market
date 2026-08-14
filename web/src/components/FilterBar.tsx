/**
 * 多维筛选栏：类型 / 分数段 / 配置 / 星星区间
 */
import type { PluginType } from "@dsh-market/schema";

export type ScoreRange = "" | "80" | "60" | "40" | "lt40";
export type StarRange = "" | "lt10" | "10-50" | "50";
export type ConfigFilter = "" | "ready" | "config";
export type TypeFilter = "" | PluginType;

interface Props {
  type: TypeFilter;
  score: ScoreRange;
  config: ConfigFilter;
  stars: StarRange;
  onChange: (patch: Partial<{ type: TypeFilter; score: ScoreRange; config: ConfigFilter; stars: StarRange }>) => void;
  onReset: () => void;
}

const SCORE_OPTS: { key: ScoreRange; label: string }[] = [
  { key: "80", label: "80+" },
  { key: "60", label: "60-79" },
  { key: "40", label: "40-59" },
  { key: "lt40", label: "<40" },
];
const STAR_OPTS: { key: StarRange; label: string }[] = [
  { key: "lt10", label: "新插件(<10★)" },
  { key: "10-50", label: "10-50★" },
  { key: "50", label: "50+★" },
];

function Seg({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <span className={`seg ${active ? "on" : ""}`} onClick={onClick}>
      {label}
    </span>
  );
}

export default function FilterBar({ type, score, config, stars, onChange, onReset }: Props) {
  const active = Boolean(type || score || config || stars);
  return (
    <div className="filter-bar">
      <div className="filter-group">
        <span className="fg-label">类型</span>
        <Seg label="全部" active={!type} onClick={() => onChange({ type: "" })} />
        <Seg label="SKILL" active={type === "skill"} onClick={() => onChange({ type: type === "skill" ? "" : "skill" })} />
        <Seg label="PLUGIN" active={type === "cordis-plugin"} onClick={() => onChange({ type: type === "cordis-plugin" ? "" : "cordis-plugin" })} />
      </div>
      <div className="filter-group">
        <span className="fg-label">实用分</span>
        <Seg label="全部" active={!score} onClick={() => onChange({ score: "" })} />
        {SCORE_OPTS.map((o) => (
          <Seg key={o.key} label={o.label} active={score === o.key} onClick={() => onChange({ score: score === o.key ? "" : o.key })} />
        ))}
      </div>
      <div className="filter-group">
        <span className="fg-label">配置</span>
        <Seg label="全部" active={!config} onClick={() => onChange({ config: "" })} />
        <Seg label="开箱即用" active={config === "ready"} onClick={() => onChange({ config: config === "ready" ? "" : "ready" })} />
        <Seg label="需配置" active={config === "config"} onClick={() => onChange({ config: config === "config" ? "" : "config" })} />
      </div>
      <div className="filter-group">
        <span className="fg-label">规模</span>
        <Seg label="全部" active={!stars} onClick={() => onChange({ stars: "" })} />
        {STAR_OPTS.map((o) => (
          <Seg key={o.key} label={o.label} active={stars === o.key} onClick={() => onChange({ stars: stars === o.key ? "" : o.key })} />
        ))}
      </div>
      {active && (
        <button className="filter-reset" onClick={onReset}>清除筛选</button>
      )}
    </div>
  );
}
