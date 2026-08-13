/**
 * 五边形雷达图组件（实用五维评分可视化）
 */
import type { PracticalScoreBreakdown } from "@dsh-market/schema";

const ORDER: (keyof PracticalScoreBreakdown)[] = [
  "maintain",
  "practical",
  "popularity",
  "ease",
  "signal",
];

const LABELS: Record<keyof PracticalScoreBreakdown, string> = {
  maintain: "维护",
  practical: "实用",
  popularity: "热度",
  ease: "便捷",
  signal: "信号",
};

interface Props {
  breakdown: PracticalScoreBreakdown;
  total: number;
  size?: number;
}

export default function RadarChart({ breakdown, total, size = 112 }: Props) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.357; // 40/112 比例
  const pt = (v: number, i: number): [number, number] => {
    const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
    return [cx + r * v * Math.cos(a), cy + r * v * Math.sin(a)];
  };
  const poly = (v: number) =>
    ORDER.map((k, i) => pt(v, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const dataPoly = ORDER.map((k, i) =>
    pt((breakdown[k] ?? 0) / 100, i).map((n) => n.toFixed(1)).join(",")
  ).join(" ");

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {[0.25, 0.5, 0.75, 1].map((v) => (
        <polygon
          key={v}
          points={poly(v)}
          fill="none"
          stroke="#DCE8F4"
          strokeWidth={0.8}
        />
      ))}
      <polygon
        points={dataPoly}
        fill="rgba(76,127,196,0.22)"
        stroke="#4C7FC4"
        strokeWidth={1.3}
        strokeLinejoin="round"
      />
      {ORDER.map((k, i) => {
        const [x, y] = pt((breakdown[k] ?? 0) / 100, i);
        return <circle key={k} cx={x.toFixed(1)} cy={y.toFixed(1)} r={2} fill="#2864A9" />;
      })}
      {ORDER.map((k, i) => {
        const [x, y] = pt(1.24, i);
        return (
          <text
            key={k}
            x={x.toFixed(1)}
            y={(y + 3).toFixed(1)}
            textAnchor="middle"
            fontSize={9}
            fontWeight={500}
            fill="#6B7785"
          >
            {LABELS[k]}
          </text>
        );
      })}
    </svg>
  );
}

export { ORDER as RADAR_ORDER, LABELS as RADAR_LABELS };
