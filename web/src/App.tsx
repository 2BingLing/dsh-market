/**
 * DSH Market 主应用：Hero + 精选卡 + 搜索/筛选/排序 + 卡片网格 + 详情页 + 收藏
 * 数据来自 data/plugins.json（构建时复制到 public/）
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import type { DshPlugin, MarketData } from "@dsh-market/schema";
import PluginCard from "./components/PluginCard";
import DetailView from "./components/DetailView";
import ScoringGuide from "./components/ScoringGuide";

type SortKey = "score" | "stars" | "newest";
type View = "home" | "detail" | "guide";
type NavKey = "market" | "favorites";

const SORT_LABEL: Record<SortKey, string> = { score: "实用分", stars: "热度", newest: "最新" };
const FAV_KEY = "dsh-market:favorites";

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

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const [plugins, setPlugins] = useState<DshPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [sort, setSort] = useState<SortKey>("score");
  const [nav, setNav] = useState<NavKey>("market");
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<DshPlugin | null>(null);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);

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

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      localStorage.setItem(FAV_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const openDetail = useCallback((p: DshPlugin) => {
    setSelected(p);
    setView("detail");
    window.scrollTo({ top: 0 });
  }, []);

  const backHome = useCallback(() => {
    setView("home");
    setSelected(null);
  }, []);

  const openGuide = useCallback(() => {
    setView("guide");
    window.scrollTo({ top: 0 });
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
    if (nav === "favorites") {
      list = list.filter((p) => favorites.includes(p.id));
    }
    if (tag) list = list.filter((p) => p.tags.includes(tag));
    if (sort === "score") list.sort((a, b) => b.score.total - a.score.total);
    else if (sort === "stars") list.sort((a, b) => b.stars - a.stars);
    else list.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
    return list;
  }, [plugins, fuse, query, tag, sort, nav, favorites]);

  const weeklyPick = useMemo(
    () => [...plugins].sort((a, b) => b.score.total - a.score.total)[0],
    [plugins]
  );

  const gotoNav = useCallback((key: NavKey) => {
    setNav(key);
    setView("home");
    setQuery("");
    setTag("");
    window.scrollTo({ top: 0 });
  }, []);

  if (view === "detail" && selected) {
    return (
      <div className="wrap">
        <header className="nav">
          <a className="logo" href="#" onClick={(e) => { e.preventDefault(); backHome(); }}>
            <span className="logo-mark"><span>DSH</span></span>
            <span className="logo-text">DSH <em>Market</em></span>
          </a>
          <nav className="nav-links">
            <a onClick={() => gotoNav("market")}>市场</a>
            <a onClick={() => gotoNav("favorites")} className={nav === "favorites" ? "on" : ""}>收藏</a>
            <a onClick={openGuide}>评分体系</a>
            <a className="nav-cta" href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交插件</a>
          </nav>
        </header>
        <DetailView
          plugin={selected}
          favorite={favorites.includes(selected.id)}
          onToggleFavorite={() => toggleFavorite(selected.id)}
          onBack={backHome}
        />
        <footer className="footer">
          <span>DSH Market · 数据更新于 {generatedAt ? generatedAt.slice(0, 10) : "—"}</span>
          <span>
            <a href="https://github.com/2BingLing/dsh-market" target="_blank" rel="noreferrer">GitHub</a>
            {" · "}<a onClick={openGuide}>评分说明</a>
          </span>
        </footer>
      </div>
    );
  }

  if (view === "guide") {
    return (
      <div className="wrap">
        <header className="nav">
          <a className="logo" href="#" onClick={(e) => { e.preventDefault(); backHome(); }}>
            <span className="logo-mark"><span>DSH</span></span>
            <span className="logo-text">DSH <em>Market</em></span>
          </a>
          <nav className="nav-links">
            <a onClick={() => gotoNav("market")}>市场</a>
            <a onClick={() => gotoNav("favorites")} className={nav === "favorites" ? "on" : ""}>收藏{favorites.length > 0 ? ` (${favorites.length})` : ""}</a>
            <a onClick={openGuide} className="on">评分体系</a>
            <a className="nav-cta" href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交插件</a>
          </nav>
        </header>
        <ScoringGuide plugins={plugins} onBack={backHome} />
        <footer className="footer">
          <span>DSH Market · 数据更新于 {generatedAt ? generatedAt.slice(0, 10) : "—"}</span>
          <span>
            <a href="https://github.com/2BingLing/dsh-market" target="_blank" rel="noreferrer">GitHub</a>
            {" · "}<a onClick={openGuide}>评分说明</a>
          </span>
        </footer>
      </div>
    );
  }

  return (
    <div className="wrap">
      {/* 导航 */}
      <header className="nav">
        <a className="logo" href="#" onClick={(e) => { e.preventDefault(); gotoNav("market"); }}>
          <span className="logo-mark"><span>DSH</span></span>
          <span className="logo-text">DSH <em>Market</em></span>
        </a>
        <nav className="nav-links">
          <a onClick={() => gotoNav("market")} className={nav === "market" ? "on" : ""}>市场</a>
          <a onClick={() => gotoNav("favorites")} className={nav === "favorites" ? "on" : ""}>收藏{favorites.length > 0 ? ` (${favorites.length})` : ""}</a>
          <a onClick={openGuide}>评分体系</a>
          <a className="nav-cta" href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交插件</a>
        </nav>
      </header>

      {/* Hero + 精选卡（仅市场首页显示） */}
      {nav === "market" && (
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
              <a className="btn btn-ghost" onClick={openGuide}>了解评分体系</a>
            </div>
          </div>
          {weeklyPick && (
            <div className="feature-card" onClick={() => openDetail(weeklyPick)}>
              <div className="tag">WEEKLY PICK · 本周精选</div>
              <h3>{weeklyPick.name}</h3>
              <p>{(weeklyPick.descriptionZh || weeklyPick.description || "").slice(0, 70)}…</p>
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
      )}

      {/* 搜索 + 筛选 */}
      <div className="search-zone" id="market">
        <form
          className="search-row"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8CA3BB" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                nav === "favorites"
                  ? "在收藏中搜索…"
                  : "搜索插件：按功能、标签、关键词，例如「浏览器」「测试」「角色扮演」"
              }
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
          {nav === "favorites" ? `收藏 ${visible.length} / ${favorites.length}` : `共 ${visible.length} 个插件`}
        </span>
      </div>

      {loading ? (
        <div className="state-hint loading-dots">正在加载插件市场</div>
      ) : visible.length === 0 ? (
        <div className="state-hint">
          {nav === "favorites" && favorites.length === 0
            ? "还没有收藏任何插件\n点击卡片右上角 ☆ 收藏你喜欢的插件"
            : "暂无符合条件的插件"}
          <br />
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); setQuery(""); setTag(""); }}
            style={{ color: "#2864A9" }}
          >
            清除筛选，浏览全部插件
          </a>
        </div>
      ) : (
        <div className="grid">
          {visible.map((p) => (
            <PluginCard
              key={p.id}
              plugin={p}
              favorite={favorites.includes(p.id)}
              onToggleFavorite={toggleFavorite}
              onOpen={openDetail}
            />
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
          <a onClick={openGuide}>评分说明</a>
        </span>
      </footer>
    </div>
  );
}
