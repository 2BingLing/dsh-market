/**
 * DSH Market 插件端 Logo（方向 A：纯黑剪影 + 眼睛镂空点，适配侧边栏）
 * - 单色剪影：fill 用 currentColor（由使用处设置颜色）
 * - 眼睛点：fill 用背景色（eyeColor，默认侧边栏背景 token），形成镂空感
 * - 深色/浅色底自适应：使用处控制 color 与 eyeColor
 */
import { createElement } from 'react'

export function MarketLogo(props: {
  size?: number
  color?: string
  eyeColor?: string
}): React.ReactNode {
  const { size = 22, color = 'currentColor', eyeColor = 'var(--dsw-specific-sidebar-fill, #EDEDF0)' } = props
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      // viewBox 裁剪四周留白（图形实际范围 x≈21-110 / y≈13-97），小尺寸渲染时鲸鱼视觉充满
      viewBox: '14 8 98 102',
      'aria-label': 'DSH Market',
      style: { display: 'block' },
    },
    // 白色图形整体放大 1.35 倍（围绕中心 60,62 缩放）
    createElement(
      'g',
      { transform: 'translate(60 62) scale(1.35) translate(-60 -62)' },
      // 小背鳍（圆润驼峰）
      createElement('path', {
        d: 'M51 42 C52 36 56 32 61 32 C60 37 60 40 60 42 Z',
        fill: color,
      }),
      // 小分叉尾鳍
      createElement('path', {
        d: 'M83 62 C87 57 93 55 97 56 C94 59 91 61 88 62 C91 65 91 69 88 70 C90 66 87 63 83 62 Z',
        fill: color,
      }),
      // 插头主体
      createElement(
        'g',
        { fill: color },
        createElement('path', {
          d: 'M38 42 h44 a6 6 0 0 1 6 6 v8 h-14 a8 8 0 1 0 -16 0 h-20 a6 6 0 0 1 -6 -6 v-2 a6 6 0 0 1 6 -6 z',
        }),
        createElement('rect', { x: '38', y: '60', width: '8', height: '14', rx: '4' }),
        createElement('rect', { x: '50', y: '66', width: '8', height: '18', rx: '4' }),
        createElement('rect', { x: '62', y: '60', width: '8', height: '14', rx: '4' }),
      ),
      // 眼睛（背景色镂空点）
      createElement('circle', { cx: '60', cy: '46', r: '2.8', fill: eyeColor }),
    ),
  )
}
