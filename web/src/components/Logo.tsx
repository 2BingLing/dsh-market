/**
 * DSH Market Logo（虎鲸插头：C 插头主体 + 小背鳍 + 小分叉尾鳍，蓝底白主）
 */
import { useId } from "react";

export default function Logo({ size = 30 }: { size?: number }) {
  const gid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const grad = `dshLogoGrad_${gid}`;
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" aria-label="DSH Market">
      <defs>
        <linearGradient id={grad} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4C7FC4" />
          <stop offset="1" stopColor="#173F73" />
        </linearGradient>
      </defs>
      <rect width="120" height="120" rx="28" fill={`url(#${grad})`} />
      {/* 小背鳍（圆润驼峰） */}
      <path d="M51 42 C52 36 56 32 61 32 C60 37 60 40 60 42 Z" fill="#fff" />
      {/* 小分叉尾鳍 */}
      <path d="M83 62 C87 57 93 55 97 56 C94 59 91 61 88 62 C91 65 91 69 88 70 C90 66 87 63 83 62 Z" fill="#fff" />
      {/* 插头主体 */}
      <g fill="#fff">
        <path d="M38 42 h44 a6 6 0 0 1 6 6 v8 h-14 a8 8 0 1 0 -16 0 h-20 a6 6 0 0 1 -6 -6 v-2 a6 6 0 0 1 6 -6 z" />
        <rect x="38" y="60" width="8" height="14" rx="4" />
        <rect x="50" y="66" width="8" height="18" rx="4" />
        <rect x="62" y="60" width="8" height="14" rx="4" />
      </g>
      <circle cx="60" cy="46" r="2.8" fill="#173F73" />
    </svg>
  );
}
