/**
 * 评分体系说明页：实用五维评分的完整解释
 */
import type { DshPlugin } from "@dsh-market/schema";

interface Props {
  plugins: DshPlugin[];
  onBack: () => void;
}

interface Dim {
  key: string;
  name: string;
  weight: number;
  color: string;
  what: string;
  how: string;
  why: string;
}

const DIMS: Dim[] = [
  {
    key: "maintain",
    name: "维护活跃",
    weight: 0.3,
    color: "#2864A9",
    what: "插件是不是「活着」——最近有没有更新、issue 处理得怎么样。",
    how: "近 90 天提交活跃度（7 天内更新满分）+ 最近 release 时间 + issue 健康度（Wilson Score 处理小样本）。",
    why: "DSH 还在快速迭代阶段，API 经常变，一个不维护的插件很快会坏——会修 bug 的插件才是好插件。权重最高。",
  },
  {
    key: "practical",
    name: "实用度",
    weight: 0.25,
    color: "#4C7FC4",
    what: "装上了能不能用明白——文档、示例、安装说明是否齐全。",
    how: "README 结构完备度：有无安装/使用章节、代码示例、功能说明；skill 型额外看 SKILL.md 完整性。",
    why: "功能再强，看不懂怎么用就等于没用。README 质量是「实用」的第一信号。",
  },
  {
    key: "popularity",
    name: "生态热度",
    weight: 0.2,
    color: "#78A5DB",
    what: "社区认不认可——星星数和参与度。",
    how: "stars 对数归一化（以全库 99 分位为动态基准，避免大仓库霸榜）+ fork 参与率（Wilson Score 稳健估计）。",
    why: "星星多不一定好用，但完全没人用的插件风险更高。热度是「口碑」的粗略代理指标。",
  },
  {
    key: "ease",
    name: "便捷度",
    weight: 0.15,
    color: "#9CC1E7",
    what: "好不好装——安装步骤是否清晰、要不要额外配置。",
    how: "README 有无明确安装命令（git clone / pnpm add / npx skills add）+ 是否无需 token/API Key 等额外配置。",
    why: "「一键安装」是 DSH Market 的核心体验，需要复杂配置的插件会降低便捷分。",
  },
  {
    key: "signal",
    name: "信号质量",
    weight: 0.1,
    color: "#BFD5F0",
    what: "项目信息是否完整可信。",
    how: "description / license / topics / homepage / README 五项完备度加权。",
    why: "信息残缺的仓库（没协议、没描述）风险更高，完整度是基本信任门槛。",
  },
];

const RANK: { label: string; range: string; desc: string }[] = [
  { label: "全能型", range: "90+", desc: "各维度均衡且优秀，维护活跃、文档齐全、社区认可" },
  { label: "优秀", range: "70–89", desc: "整体出色，可能个别维度偏弱" },
  { label: "良好", range: "50–69", desc: "可用，但有明显短板（如更新较慢或文档不全）" },
  { label: "待观察", range: "<50", desc: "新插件或信息不全，建议看详情再决定" },
];

export default function ScoringGuide({ plugins, onBack }: Props) {
  const sample = [...plugins].sort((a, b) => b.score.total - a.score.total)[0];
  const b = sample?.score.breakdown;

  return (
    <div className="guide">
      <button className="back-btn" onClick={onBack}>← 返回市场</button>
      <div className="guide-head">
        <span className="hero-eyebrow">评分体系 · 实用五维</span>
        <h2>实用五维评分</h2>
        <p className="guide-lead">
          星星多 ≠ 好用。DSH Market 用五个维度判断一个插件「值不值得装」，加权几何平均融合成 0–100 的实用分。
        </p>
      </div>

      {/* 权重总览 */}
      <section className="guide-block">
        <h4>权重构成</h4>
        <div className="weight-bar">
          {DIMS.map((d) => (
            <div
              key={d.key}
              className="weight-seg"
              style={{ width: `${d.weight * 100}%`, background: d.color }}
              title={`${d.name} ${Math.round(d.weight * 100)}%`}
            >
              <span>{d.name}</span>
            </div>
          ))}
        </div>
        <div className="weight-legend">
          {DIMS.map((d) => (
            <span key={d.key}>
              <i style={{ background: d.color }} />
              {d.name} {Math.round(d.weight * 100)}%
            </span>
          ))}
        </div>
      </section>

      {/* 各维度详解 */}
      <section className="guide-block">
        <h4>各维度详解</h4>
        <div className="dim-cards">
          {DIMS.map((d) => (
            <div className="dim-card" key={d.key}>
              <div className="dim-card-head">
                <span className="dim-dot" style={{ background: d.color }} />
                <b>{d.name}</b>
                <span className="dim-weight">{Math.round(d.weight * 100)}%</span>
              </div>
              <p className="dim-what">{d.what}</p>
              <p className="dim-how"><em>计算</em>{d.how}</p>
              <p className="dim-why"><em>为什么</em>{d.why}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 融合机制 */}
      <section className="guide-block">
        <h4>融合机制：加权几何平均</h4>
        <div className="fusion-row">
          <div className="fusion-text">
            <p>
              总分不是五个维度简单相加，而是<strong>加权几何平均</strong>——任何一个维度差，都会明显拉低总分。
            </p>
            <p className="fusion-example">
              举例：A 插件「热度 95、维护 20」，算术平均能给 57 分（虚高），几何平均只有 44 分——因为「热度高但已经不维护」的插件对用户是坑。几何平均惩罚这种「偏科」。
            </p>
            <p>
              此外还有两道保险：<strong>贝叶斯置信</strong>——信息不完整的新插件自动降权，不会因样本少而分数剧烈波动；<strong>解释层</strong>——每个高分插件都生成「为什么推荐」的理由，分数可追溯。
            </p>
          </div>
          {sample && b && (
            <div className="fusion-sample">
              <p className="sample-label">真实示例 · {sample.name}</p>
              <div className="sample-num">{sample.score.total}<small> / 100</small></div>
              <div className="sample-dims">
                {DIMS.map((d) => (
                  <div className="sample-dim" key={d.key}>
                    <span>{d.name}</span>
                    <div className="sample-track">
                      <div className="sample-fill" style={{ width: `${b[d.key as keyof typeof b]}%`, background: d.color }} />
                    </div>
                    <b>{b[d.key as keyof typeof b]}</b>
                  </div>
                ))}
              </div>
              <p className="sample-explain">「{sample.score.explanation}」</p>
            </div>
          )}
        </div>
      </section>

      {/* 分数怎么读 */}
      <section className="guide-block">
        <h4>分数怎么读</h4>
        <div className="rank-list">
          {RANK.map((r) => (
            <div className="rank-item" key={r.label}>
              <span className="rank-label">{r.label}</span>
              <span className="rank-range">{r.range}</span>
              <span className="rank-desc">{r.desc}</span>
            </div>
          ))}
        </div>
        <p className="guide-note">
          * 评分每日自动更新，基于 GitHub 公开数据计算，仅供参考；安装前请自行查看仓库详情与协议。
        </p>
      </section>
    </div>
  );
}
