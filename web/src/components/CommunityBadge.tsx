/**
 * 社区提交标识：SVG + 文字（无 emoji，网站蓝系）
 * 插件经 issue 提交（issue-submission 来源）时显示，区别于自动扫描收录
 */
export function CommunityIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 1.8 4 4 4zm0 2c-2.7 0-8 1.4-8 4v2h16v-2c0-2.6-5.3-4-8-4z" />
    </svg>
  );
}

/** 是否社区提交来源（sources 含 issue-submission） */
export function isCommunitySubmitted(plugin: { sources?: string[] }): boolean {
  return (plugin.sources ?? []).includes("issue-submission");
}

export default function CommunityBadge({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "community-badge small" : "community-badge"}>
      <CommunityIcon size={small ? 11 : 13} /> 社区提交
    </span>
  );
}
