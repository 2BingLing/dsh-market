/**
 * DSH Market 主应用
 * 视图：home（推荐分区 + 全部插件）/ detail / guide（评分体系）/ quiz（冷启动问卷）
 * 筛选：搜索 + 标签多选 AND + 类型/分数段/配置/星星多维筛选
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Fuse from "fuse.js";
import type { DshPlugin, DshPack, MarketData } from "@dsh-market/schema";
import PluginCard from "./components/PluginCard";
import PackCard from "./components/PackCard";
import PackDetailView from "./components/PackDetailView";
import DetailView from "./components/DetailView";
import ScoringGuide from "./components/ScoringGuide";
import QuizView from "./components/QuizView";
import TagPanel from "./components/TagPanel";
import FilterBar, { type ScoreRange, type StarRange, type ConfigFilter, type TypeFilter } from "./components/FilterBar";
import Logo from "./components/Logo";
import { matchesTags } from "./lib/tags";

type SortKey = "score" | "stars" | "newest";
type View = "home" | "detail" | "guide" | "quiz" | "packDetail";
type NavKey = "market" | "favorites" | "packs";
type SectionKey = "all" | "elite" | "friendly" | "fresh";

const SORT_LABEL: Record<SortKey, string> = { score: "实用分", stars: "热度", newest: "最新" };
const SECTION_LABEL: Record<SectionKey, string> = {
  all: "全部插件",
  elite: "高分精选",
  friendly: "新手友好",
  fresh: "最新上架",
};
const FRESH_COUNT = 24;
/** 每页卡片数 */
const PAGE_SIZE = 60;
const FAV_KEY = "dsh-market:favorites";

function loadFavorites(): string[] {
  try {
    return JSON.parse(localStorage.getItem(FAV_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export default function App() {
  const [plugins, setPlugins] = useState<DshPlugin[]>([]);
  const [packs, setPacks] = useState<DshPack[]>([]);
  const [loading, setLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<string>("");
  const [query, setQuery] = useState("");
  const [packQuery, setPackQuery] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("score");
  const [nav, setNav] = useState<NavKey>("market");
  const [view, setView] = useState<View>("home");
  const [selected, setSelected] = useState<DshPlugin | null>(null);
  const [selectedPack, setSelectedPack] = useState<DshPack | null>(null);
  const [favorites, setFavorites] = useState<string[]>(loadFavorites);
  // 分区（小按钮 Tab）
  const [section, setSection] = useState<SectionKey>("all");
  // 多维筛选
  const [fType, setFType] = useState<TypeFilter>("");
  const [fScore, setFScore] = useState<ScoreRange>("");
  const [fConfig, setFConfig] = useState<ConfigFilter>("");
  const [fStars, setFStars] = useState<StarRange>("");
  // 分页
  const [page, setPage] = useState(1);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}plugins.json`)
      .then((r) => r.json())
      .then((data: MarketData) => {
        setPlugins(data.plugins);
        setGeneratedAt(data.generatedAt);
      })
      .catch((e) => console.error("加载插件数据失败:", e))
      .finally(() => setLoading(false));
    // 整合包通道（独立文件；缺失时静默降级为空）
    fetch(`${import.meta.env.BASE_URL}packs.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { packs?: DshPack[] } | null) => {
        setPacks(data?.packs ?? []);
      })
      .catch(() => setPacks([]));
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

  const openPackDetail = useCallback((p: DshPack) => {
    setSelectedPack(p);
    setView("packDetail");
    window.scrollTo({ top: 0 });
  }, []);

  const backHome = useCallback(() => {
    setView("home");
    setSelected(null);
    setSelectedPack(null);
  }, []);

  const openGuide = useCallback(() => {
    setView("guide");
    window.scrollTo({ top: 0 });
  }, []);

  const openQuiz = useCallback(() => {
    setView("quiz");
    window.scrollTo({ top: 0 });
  }, []);

  // 防抖搜索词（避免每次按键都触发全量搜索）
  const [debouncedQuery, setDebouncedQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  // Fuse 模糊搜索兜底（仅当精确匹配为空时使用）
  const fuse = useMemo(
    () =>
      new Fuse(plugins, {
        keys: [
          { name: "name", weight: 0.5 },
          { name: "fullName", weight: 0.15 },
          { name: "descriptionZh", weight: 0.2 },
          { name: "description", weight: 0.1 },
          { name: "tags", weight: 0.05 },
        ],
        threshold: 0.3,
        minMatchCharLength: 2,
      }),
    [plugins]
  );

  /** 混合搜索：包含匹配（快/准）优先，Fuse 模糊兜底 */
  const searchPlugins = useCallback(
    (list: DshPlugin[], q: string): DshPlugin[] => {
      const ql = q.trim().toLowerCase();
      if (!ql) return list;
      // 1. 快速包含匹配（名称/作者·仓库名/中文简介/英文简介/标签）
      const exact = list.filter(
        (p) =>
          p.name.toLowerCase().includes(ql) ||
          p.fullName.toLowerCase().includes(ql) ||
          (p.descriptionZh ?? "").toLowerCase().includes(ql) ||
          (p.description ?? "").toLowerCase().includes(ql) ||
          p.tags.some((t) => t.toLowerCase().includes(ql))
      );
      if (exact.length > 0) {
        // 名称开头/完全匹配优先，再按实用分
        return exact.sort((a, b) => {
          const rank = (p: DshPlugin) =>
            p.name.toLowerCase() === ql ? 0 : p.name.toLowerCase().startsWith(ql) ? 1 : 2;
          return rank(a) - rank(b) || b.score.total - a.score.total;
        });
      }
      // 2. Fuse 模糊兜底（含中文自然语言查询）
      return fuse.search(ql).map((r) => r.item);
    },
    [fuse]
  );

  const hasActiveFilter = Boolean(debouncedQuery.trim() || tags.length || fType || fScore || fConfig || fStars);

  // 分区候选集
  const sectionList = useMemo((): DshPlugin[] => {
    if (section === "elite") return plugins.filter((p) => p.score.total >= 80);
    if (section === "friendly") return plugins.filter((p) => p.score.total >= 60 && !p.install.needsConfig);
    if (section === "fresh") return [...plugins].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, FRESH_COUNT);
    return plugins;
  }, [plugins, section]);

  const visible = useMemo(() => {
    let list = debouncedQuery.trim()
      ? searchPlugins(sectionList, debouncedQuery)
      : [...sectionList];
    if (nav === "favorites") list = list.filter((p) => favorites.includes(p.id));
    // 标签多选 AND
    if (tags.length) list = list.filter((p) => matchesTags(p, tags));
    // 多维筛选
    if (fType) list = list.filter((p) => p.type === fType);
    if (fScore === "80") list = list.filter((p) => p.score.total >= 80);
    else if (fScore === "60") list = list.filter((p) => p.score.total >= 60 && p.score.total < 80);
    else if (fScore === "40") list = list.filter((p) => p.score.total >= 40 && p.score.total < 60);
    else if (fScore === "lt40") list = list.filter((p) => p.score.total < 40);
    if (fConfig === "ready") list = list.filter((p) => !p.install.needsConfig);
    else if (fConfig === "config") list = list.filter((p) => p.install.needsConfig);
    if (fStars === "lt10") list = list.filter((p) => p.stars < 10);
    else if (fStars === "10-50") list = list.filter((p) => p.stars >= 10 && p.stars < 50);
    else if (fStars === "50") list = list.filter((p) => p.stars >= 50);
    // 排序
    if (sort === "score") list.sort((a, b) => b.score.total - a.score.total);
    else if (sort === "stars") list.sort((a, b) => b.stars - a.stars);
    else list.sort((a, b) => b.pushedAt.localeCompare(a.pushedAt));
    return list;
  }, [sectionList, debouncedQuery, searchPlugins, tags, nav, favorites, fType, fScore, fConfig, fStars, sort]);

  // 分页切片（每页 PAGE_SIZE 个）
  const totalPages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const pagedPlugins = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // 搜索/筛选/分区/排序变化时回到第 1 页
  useEffect(() => {
    setPage(1);
  }, [debouncedQuery, tags, fType, fScore, fConfig, fStars, section, nav, sort]);

  const weeklyPick = useMemo(
    () => [...plugins].sort((a, b) => b.score.total - a.score.total)[0],
    [plugins]
  );

  const gotoNav = useCallback((key: NavKey) => {
    setNav(key);
    setView("home");
    setQuery("");
    setPackQuery("");
    setTags([]);
    window.scrollTo({ top: 0 });
  }, []);

  const resetFilters = useCallback(() => {
    setQuery("");
    setTags([]);
    setFType("");
    setFScore("");
    setFConfig("");
    setFStars("");
  }, []);

  const shell = (active: string, children: React.ReactNode) => (
    <div className="wrap">
      <header className="nav">
        <a className="logo" href="#" onClick={(e) => { e.preventDefault(); gotoNav("market"); }}>
          <Logo size={30} />
          <span className="logo-text">DSH <em>Market</em></span>
        </a>
        <nav className="nav-links">
          <a onClick={() => gotoNav("market")} className={active === "market" ? "on" : ""}>市场</a>
          <a onClick={() => gotoNav("packs")} className={active === "packs" ? "on" : ""}>整合包</a>
          <a onClick={() => gotoNav("favorites")} className={active === "favorites" ? "on" : ""}>收藏</a>
          <a onClick={openGuide} className={active === "guide" ? "on" : ""}>评分体系</a>
          <a className="gh-link" href="https://github.com/2BingLing/dsh-market" target="_blank" rel="noreferrer" title="GitHub 仓库">
            <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
            </svg>
          </a>
          <a className="nav-cta" href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_plugin.md" target="_blank" rel="noreferrer">提交插件</a>
        </nav>
      </header>
      {children}
      <footer className="footer">
        <span>DSH Market · 已收录 {plugins.length} 个插件 · {packs.length} 个整合包 · 数据更新于 {generatedAt ? generatedAt.slice(0, 10) : "—"}</span>
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

  if (view === "detail" && selected) {
    return shell("market", (
      <DetailView
        plugin={selected}
        favorite={favorites.includes(selected.id)}
        onToggleFavorite={() => toggleFavorite(selected.id)}
        onBack={backHome}
      />
    ));
  }

  if (view === "packDetail" && selectedPack) {
    return shell("packs", <PackDetailView pack={selectedPack} onBack={backHome} />);
  }

  if (view === "guide") {
    return shell("guide", <ScoringGuide plugins={plugins} onBack={backHome} />);
  }

  if (view === "quiz") {
    return shell("market", (
      <QuizView
        plugins={plugins}
        favorites={favorites}
        onToggleFavorite={toggleFavorite}
        onOpen={openDetail}
        onBack={backHome}
      />
    ));
  }

  if (nav === "packs") {
    const ql = packQuery.trim().toLowerCase();
    const visiblePacks = [...packs]
      .sort((a, b) => b.score.total - a.score.total)
      .filter(
        (p) =>
          !ql ||
          p.name.toLowerCase().includes(ql) ||
          (p.descriptionZh ?? "").toLowerCase().includes(ql) ||
          (p.description ?? "").toLowerCase().includes(ql) ||
          p.tags.some((t) => t.toLowerCase().includes(ql)) ||
          p.author.toLowerCase().includes(ql)
      );
    return shell("packs", (
      <>
        <section className="hero hero-packs">
          <div>
            <span className="hero-eyebrow">插件 · 技能 · 整合包</span>
            <h1>
              一个文件，装好
              <br />
              <strong>一个 Agent 环境</strong>
            </h1>
            <p className="lead">
              整合包是把一组插件/技能 + 版本策略打包的「开箱即用环境」——当前收录 {packs.length} 个，每日自动校验包内条目的可解析性与市场收录状态。
            </p>
            <div className="hero-actions">
              <a className="btn btn-primary" href="#pack-list">浏览整合包</a>
              <a
                className="btn btn-ghost"
                href="https://github.com/2BingLing/dsh-market/issues/new?template=submit_pack.md"
                target="_blank"
                rel="noreferrer"
              >
                提交你的整合包
              </a>
            </div>
          </div>
        </section>

        <div className="search-zone" id="pack-list">
          <form className="search-row" onSubmit={(e) => e.preventDefault()}>
            <div className="search-box">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8CA3BB" strokeWidth="1.5">
                <circle cx="7" cy="7" r="5" />
                <path d="M11 11l3.5 3.5" />
              </svg>
              <input
                type="text"
                value={packQuery}
                onChange={(e) => setPackQuery(e.target.value)}
                placeholder="搜索整合包：翻译 / 安全 / MCP / 环境…"
              />
            </div>
            <button className="search-btn" type="submit">搜索</button>
          </form>
        </div>

        {visiblePacks.length === 0 ? (
          <div className="state-hint">
            {packs.length === 0
              ? "整合包正式协议开发中，暂未开放收录——敬请期待"
              : "暂无符合条件的整合包，换个关键词试试"}
          </div>
        ) : (
          <>
            <div className="grid">
              {visiblePacks.map((p) => (
                <PackCard key={p.id} pack={p} onOpen={openPackDetail} />
              ))}
            </div>
            <div className="pagination" style={{ justifyContent: "center" }}>
              <span className="page-info">共 {visiblePacks.length} 个整合包</span>
            </div>
          </>
        )}
      </>
    ));
  }

  return shell(nav === "favorites" ? "favorites" : "market", (
    <>
      {/* Hero + 精选卡（仅市场首页、无筛选时） */}
      {nav === "market" && !hasActiveFilter && (
        <>
          {/* 紧凑 Hero 条 */}
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
                DeepSeek Harness 插件市场，已收录 {plugins.length} 个插件。每日自动扫描 GitHub 生态，用「实用五维评分」帮你判断每个插件值不值得装。
              </p>
              <div className="hero-actions">
                <a className="btn btn-primary" href="#market">浏览插件市场</a>
                <button className="btn btn-ghost" onClick={openQuiz}>不知道选什么？帮我推荐</button>
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
        </>
      )}

      {/* 搜索区 */}
      <div className="search-zone" id="market">
        <form className="search-row" onSubmit={(e) => e.preventDefault()}>
          <div className="search-box">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8CA3BB" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={nav === "favorites" ? "在收藏中搜索…" : "搜索插件：功能 / 名称 / 关键词，如「浏览器」「角色扮演」"}
            />
          </div>
          <button className="search-btn" type="submit">搜索</button>
        </form>

        <TagPanel plugins={plugins} selected={tags} onToggle={(t) => setTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))} />
        <FilterBar
          type={fType}
          score={fScore}
          config={fConfig}
          stars={fStars}
          onChange={(patch) => {
            if (patch.type !== undefined) setFType(patch.type);
            if (patch.score !== undefined) setFScore(patch.score);
            if (patch.config !== undefined) setFConfig(patch.config);
            if (patch.stars !== undefined) setFStars(patch.stars);
          }}
          onReset={resetFilters}
        />
      </div>

      {/* 分区小按钮 + 排序 */}
      <div className="toolbar-row">
        <div className="section-pills">
          {(Object.keys(SECTION_LABEL) as SectionKey[]).map((k) => (
            <button
              key={k}
              className={`pill-btn ${section === k ? "on" : ""}`}
              onClick={() => setSection(k)}
            >
              {SECTION_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="tabs">
          {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
            <button key={k} className={`tab ${sort === k ? "on" : ""}`} onClick={() => setSort(k)}>
              {SORT_LABEL[k]}
            </button>
          ))}
          <span className="tab-count">
            {nav === "favorites" ? `收藏 ${visible.length} / ${favorites.length}` : `共 ${visible.length} 个插件`}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="state-hint loading-dots">正在加载插件市场</div>
      ) : visible.length === 0 ? (
        <div className="state-hint">
          {nav === "favorites" && favorites.length === 0
            ? "还没有收藏任何插件\n点击卡片右上角 ☆ 收藏你喜欢的插件"
            : "暂无符合条件的插件，试试放宽筛选条件"}
          <br />
          <a href="#" onClick={(e) => { e.preventDefault(); resetFilters(); }} style={{ color: "#2864A9" }}>
            清除全部筛选，浏览 {plugins.length} 个插件
          </a>
        </div>
      ) : (
        <>
          <div className="grid">
            {pagedPlugins.map((p) => (
              <PluginCard key={p.id} plugin={p} favorite={favorites.includes(p.id)} onToggleFavorite={toggleFavorite} onOpen={openDetail} />
            ))}
          </div>
          {totalPages > 1 && (
            <div className="pagination">
              <button className="page-btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                ‹ 上一页
              </button>
              <span className="page-info">
                第 {page} / {totalPages} 页 · 共 {visible.length} 个插件
              </span>
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                下一页 ›
              </button>
            </div>
          )}
        </>
      )}
    </>
  ));
}
