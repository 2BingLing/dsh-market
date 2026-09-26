/**
 * 标签面板：中文分类行（§5.3 词典驱动）+ 热门标签行 + 「全部标签 ▾」展开完整面板（可搜索、多选 AND 组合）
 */
import { useMemo, useState } from "react";
import { aggregateTags, type TagStat } from "../lib/tags";
import type { ZhFacet } from "../lib/zh-taxonomy";

interface Props {
  plugins: import("@dsh-market/schema").DshPlugin[];
  selected: string[];
  onToggle: (tag: string) => void;
  /** 中文分类 facets（词典推导，App 层 useMemo 传入） */
  zhFacets: ZhFacet[];
  /** 当前选中的中文分类（单选） */
  zhCat: string;
  onToggleZhCat: (key: string) => void;
}

const HOT_COUNT = 12;
const PANEL_COUNT = 60;
/** 中文分类行展示的意图数（其余靠搜索词命中） */
const ZH_FACET_COUNT = 14;

export default function TagPanel({ plugins, selected, onToggle, zhFacets, zhCat, onToggleZhCat }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const all = useMemo(() => aggregateTags(plugins), [plugins]);
  const hot = all.slice(0, HOT_COUNT);
  // 面板只展示 count>=2 的标签（单插件标签无筛选价值，用搜索框找）；搜索时不过滤
  const panelTags = useMemo(() => all.filter((t) => t.count >= 2), [all]);

  const visible = useMemo(() => {
    if (!tagQuery.trim()) return panelTags.slice(0, PANEL_COUNT);
    const q = tagQuery.trim().toLowerCase();
    return all.filter((t) => t.tag.toLowerCase().includes(q)).slice(0, 30);
  }, [all, panelTags, tagQuery]);

  // 中文分类展示集：top N + 当前选中（选中项不在 top N 时置前）
  const zhVisible = useMemo(() => {
    const top = zhFacets.slice(0, ZH_FACET_COUNT);
    if (zhCat && !top.some((f) => f.key === zhCat)) {
      const sel = zhFacets.find((f) => f.key === zhCat);
      if (sel) return [sel, ...top.slice(0, ZH_FACET_COUNT - 1)];
    }
    return top;
  }, [zhFacets, zhCat]);

  const chip = (t: TagStat) => {
    const on = selected.includes(t.tag);
    return (
      <span
        key={t.tag}
        className={`chip ${on ? "on" : ""}`}
        onClick={() => onToggle(t.tag)}
        title={`${t.tag} · ${t.count} 个插件`}
      >
        {t.tag}
        <em className="chip-count">{t.count}</em>
      </span>
    );
  };

  return (
    <div className="tag-panel">
      {zhVisible.length > 0 && (
        <div className="filter-row">
          <span className="filter-label">中文分类：</span>
          {zhVisible.map((f) => (
            <span
              key={f.key}
              className={`chip chip-zh ${zhCat === f.key ? "on" : ""}`}
              onClick={() => onToggleZhCat(f.key)}
              title={`按「${f.key}」浏览 · ${f.count} 个插件（词典强信号匹配）`}
            >
              {f.key}
              <em className="chip-count">{f.count}</em>
            </span>
          ))}
        </div>
      )}

      <div className="filter-row hot-row">
        <span className="filter-label">热门功能：</span>
        {hot.map(chip)}
        <span
          className={`chip chip-more ${expanded ? "on" : ""}`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起 ▴" : `全部标签 ▾`}
        </span>
      </div>

      {expanded && (
        <div className="tag-expand">
          <div className="tag-search">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="7" cy="7" r="5" />
              <path d="M11 11l3.5 3.5" />
            </svg>
            <input
              type="text"
              value={tagQuery}
              onChange={(e) => setTagQuery(e.target.value)}
              placeholder="搜索标签…"
            />
            {selected.length > 0 && (
              <button className="tag-clear" onClick={() => selected.forEach(onToggle)}>
                清除已选 ({selected.length})
              </button>
            )}
          </div>
          <div className="tag-cloud">
            {visible.map(chip)}
            {visible.length === 0 && <span className="tag-empty">没有匹配的标签</span>}
          </div>
        </div>
      )}
    </div>
  );
}
