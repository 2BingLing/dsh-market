/**
 * DSH Market 主应用：Hero + 精选卡 + 搜索/筛选/排序 + 插件卡片网格
 * 数据来自 data/plugins.json（构建时复制到 public/）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import PluginCard from "./components/PluginCard";

type SortKey = "score" | "stars" | "newest";

const SORT_LABEL: Record<SortKey, string> = { score: "实用分", stars: "热度", newest: "最新" };

/** 常见功能标签（首版静态清单，后续从数据聚合） */
const TAG_PRESETS = [
  { key: "", label: "全部" },
  { key: "browser", label: "浏览器" },
  { key: "agent", label: "Agent" },
  { key: "tool", label: "工具" },
  { key: "data", label: "数据处理" },
  { key: "ui", label: "界面" },
  { key: "security", label: "安全" },
  { key: "automation", label: "自动化" },
  { key: "testing", label: "测试" },
];

export default function App() {
  const [plugins, setPlugins] = useState<DshPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortKey>("score");

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}plugins.json`)
      .then((r) => r.json())
      .then((data: MarketData) => {
        setPlugins(data.plugins);
        setGeneratedAt(data.generatedAt);
      })
      .catch((e) => console.error("加载插件数据失败:", e))
      .finally(() => setLoading(false));
  }, []);

  const fuse = useMemo(
    () =>
      new Fuse(plugins, {
        keys: [
          { name: "name", weight: 0.4 },
          { name: "description", weight: 0.25 },
          { name: "descriptionZh", weight: 0.25 },
          { name: "tags", weight: 0.1 },
        ],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [plugins]
  );

  const visible = useMemo(() => {
    let list = query.trim()
      ? fuse.search(query.trim()).map((r) => r.item)
      : [...plugins];
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    if (sort === "score") list.sort((a, b) => b.score.total - a.score.total);
    else if (sort === "stars") list.sort((a, b) => b.stars - a.stars);
    else list.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
    return list;
  }, [plugins, fuse, query, tag, sort]);

  const weeklyPick = useMemo(
    () => [...plugins].sort((a, b) => b.score.total - a.score.total)[0],
    [plugins]
  );

  const onSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
  }, []);

  return (
    <div className="wrap">
      {/* 导航 */}
      <header className="nav">
        <a className="logo" href="#">
          <span className="logo-mark"><span>DSH</span></span>
          <span className="logo-text">DSH <em>Market</em></span>
        </a>
        <nav className="nav-links">
          <a href="#" className="on">市场</a>
          <a href="#">热门</a>
          <a href="#">精选</a>
          <a href="#">收藏</a>
          <a className="nav-cta" href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交插件</a>
        </nav>
      </header>

      {/* Hero + 精选卡 */}
      <section className="hero">
        <div>
          <span className="hero-eyebrow">持续收录 · 每日更新</span>
          <h1>
            发现<span style={{ letterSpacing: "0.12em" }}>「</span>
            <strong>实用、便捷</strong>
            <span style={{ letterSpacing: "0.12em" }}>」</span>
            <br />的 DSH 插件
          </h1>
          <p className="lead">
            DeepSeek Harness 插件市场。每日自动扫描 GitHub 生态，用「实用五维评分」帮你判断每个插件值不值得装——维护活跃、实用度、生态热度、便捷度、信号质量。
          </p>
          <div className="hero-actions">
            <a className="btn btn-primary" href="#market">浏览插件市场</a>
            <a className="btn btn-ghost" href="#market">了解评分体系</a>
          </div>
        </div>
        {weeklyPick && (
          <div className="feature-card">
            <div className="tag">WEEKLY PICK · 本周精选</div>
            <h3>{weeklyPick.name}</h3>
            <p>{(weeklyPick.description || "").slice(0, 70)}…</p>
            <div className="score-line">
              <span className="score-big">{weeklyPick.score.total}</span>
              <span className="score-total">实用分 / 100<br />本周最佳</span>
            </div>
            <div className="meta">
              <span>★ {weeklyPick.stars.toLocaleString()} stars</span>
              <span>{weeklyPick.type === "skill" ? "SKILL 技能" : "CORDIS 插件"}</span>
            </div>
          </div>
        )}
      </section>

      {/* 搜索 + 筛选 */}
      <div className="search-zone" id="market">
        <form className="search-row" onSubmit={onSearch}>
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8CA3BB" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索插件：按功能、标签、关键词，例如「浏览器」「测试」「角色扮演」"
            />
          </div>
          <button className="search-btn" type="submit">搜索</button>
        </form>
        <div className="filter-row">
          <span className="filter-label">筛选：</span>
          {TAG_PRESETS.map((t) => (
            <span
              key={t.key}
              className={`chip ${tag === t.key ? "on" : ""}`}
              onClick={() => setTag(t.key)}
            >
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {/* 排序 + 网格 */}
      <div className="tabs">
        {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
          <button key={k} className={`tab ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>
            {SORT_LABEL[k]}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#8CA3BB", alignSelf: "center" }}>
          共 {visible.length} 个插件
        </span>
      </div>

      {loading ? (
        <div className="state-hint loading-dots">正在加载插件市场</div>
      ) : visible.length === 0 ? (
        <div className="state-hint">
          暂无符合条件的插件
          <br />
          <a href="#" onClick={(e) => { e.preventDefault(); setQuery(""); setTag(""); }} style={{ color: "#2864A9" }}>
            清除筛选，浏览全部插件
          </a>
        </div>
      ) : (
        <div className="grid">
          {visible.map((p) => (
            <PluginCard key={p.id} plugin={p} />
          ))}
        </div>
      )}

      {/* 页脚 */}
      <footer className="footer">
        <span>DSH Market · 数据更新于 {generatedAt ? generatedAt.slice(0, 10) : "—"}</span>
        <span>
          <a href="https://github.com/2BingLing/dsh-market" target="_blank" rel="noreferrer">GitHub</a>
          {" · "}
          <a href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交收录</a>
          {" · "}
          <a href="#">评分说明</a>
        </span>
      </footer>
    </div>
  );
}
