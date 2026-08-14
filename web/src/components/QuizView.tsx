/**
 * 冷启动问卷：选 2-3 个想要的功能 → 生成推荐结果
 * 结果：标签 AND 匹配优先，不足时 OR + 评分加权，附带推荐理由
 */
import { useMemo, useState } from "react";
import type { DshPlugin } from "@dsh-market/schema";
import { aggregateTags, tagMatchCount } from "../lib/tags";
import PluginCard from "./PluginCard";

interface Props {
  plugins: DshPlugin[];
  favorites: string[];
  onToggleFavorite: (id: string) => void;
  onOpen: (p: DshPlugin) => void;
  onBack: () => void;
}

const MAX_SELECT = 3;
const RESULT_COUNT = 9;

export default function QuizView({ plugins, favorites, onToggleFavorite, onOpen, onBack }: Props) {
  const [picked, setPicked] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  const tagStats = useMemo(() => aggregateTags(plugins).slice(0, 40), [plugins]);

  const toggle = (t: string) => {
    setPicked((prev) => {
      if (prev.includes(t)) return prev.filter((x) => x !== t);
      if (prev.length >= MAX_SELECT) return prev;
      return [...prev, t];
    });
  };

  const results = useMemo(() => {
    if (picked.length === 0) return [];
    // 先 AND 全匹配
    const and = plugins.filter((p) => picked.every((t) => p.tags.includes(t)));
    const pool = and.length >= 3 ? and : plugins.filter((p) => tagMatchCount(p, picked) > 0);
    return pool
      .map((p) => ({ p, matched: tagMatchCount(p, picked) }))
      .sort((a, b) => b.matched - a.matched || b.p.score.total - a.p.score.total)
      .slice(0, RESULT_COUNT)
      .map((x) => x.p);
  }, [plugins, picked]);

  return (
    <div className="quiz">
      <button className="back-btn" onClick={onBack}>← 返回市场</button>

      {!done ? (
        <>
          <div className="guide-head">
            <span className="hero-eyebrow">快速上手 · 三步找到你的插件</span>
            <h2>你想用 DSH 做什么？</h2>
            <p className="guide-lead">
              选 2-3 个你需要的功能（可搜索），我们会从 {plugins.length} 个插件里帮你筛出最合适的。
            </p>
          </div>

          <div className="quiz-pick">
            <div className="quiz-count">
              已选 <b>{picked.length}</b> / {MAX_SELECT}
            </div>
            <div className="quiz-tags">
              {tagStats.map((t) => {
                const on = picked.includes(t.tag);
                const disabled = !on && picked.length >= MAX_SELECT;
                return (
                  <span
                    key={t.tag}
                    className={`quiz-tag ${on ? "on" : ""} ${disabled ? "disabled" : ""}`}
                    onClick={() => !disabled && toggle(t.tag)}
                  >
                    {t.tag}
                    <em>{t.count}</em>
                  </span>
                );
              })}
            </div>
          </div>

          <div className="quiz-actions">
            <button
              className="btn btn-primary"
              disabled={picked.length === 0}
              onClick={() => setDone(true)}
            >
              {picked.length === 0 ? "先选 1-3 个功能" : `为我推荐（${picked.length} 个功能）`}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="guide-head">
            <span className="hero-eyebrow">为你推荐</span>
            <h2>
              基于「{picked.join("」+「")}」的推荐
            </h2>
            <p className="guide-lead">
              匹配全部所选功能优先，其次按匹配数和实用分排序。
              <a
                href="#"
                style={{ marginLeft: 10, color: "#2864A9" }}
                onClick={(e) => { e.preventDefault(); setPicked([]); setDone(false); }}
              >
                重新选择
              </a>
            </p>
          </div>
          {results.length > 0 ? (
            <div className="grid">
              {results.map((p) => (
                <PluginCard
                  key={p.id}
                  plugin={p}
                  favorite={favorites.includes(p.id)}
                  onToggleFavorite={onToggleFavorite}
                  onOpen={onOpen}
                />
              ))}
            </div>
          ) : (
            <div className="state-hint">没有找到匹配的插件，换个功能试试</div>
          )}
        </>
      )}
    </div>
  );
}
