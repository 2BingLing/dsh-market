/**
 * tsdown config for @dsh-market/plugin — mirrors dsh-focus-chat's layout:
 *  - lib/index.js + lib/invariant.js: the Node half (ESM) the host Loader mounts
 *  - lib/client.js: the browser half (CJS closure bundle) served into
 *    window.__DSH_BOOT__ by the modules node half; externals are exactly the
 *    platform seed modules answered at runtime by the shell's loader.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { transform } from 'lightningcss'

const PLUGIN_ID = '@dsh-market/plugin'

/**
 * 0.1.5 壳层静态种子表（web boot 的 staticModules，权威来源是
 * dsh-web-frontend 里 `My()` 的返回对象）。列在这里的 specifier 由 shell 直接
 * 应答，构建期必须留作 external；其余一律内联。
 *
 * 0.1.5 变更：`@deepseek-ai/dsh-client-runtime` 与 `@deepseek-ai/dsh-client-web-react`
 * 已从运行时消失（前者职责拆给 dsh-client-modules + dsh-cordis-client-runner）。
 * 留在清单里会让未来的 import 产出一个无法解析的 require()，到运行时才炸。
 * 裸 `cordis` 也一并改为种子表里的真实名 `@deepseek-ai/cordis`。
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

const EXTERNALS: readonly string[] = [...PLATFORM_MODULES]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

export default [
  {
    name: `${PLUGIN_ID}/node`,
    entry: ['src/index.ts', 'src/invariant.ts'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: [...EXTERNALS],
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    noExternal: (id: string) => (EXTERNALS.includes(id) ? undefined : true),
    plugins: [{
      name: 'dsh-css-modules-inline',
      resolveId(source: string, importer: string | undefined) {
        if (!source.endsWith('.module.css')) return null
        const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
        return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
      },
      async load(virtualId: string) {
        if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
        const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
        this.addWatchFile(fileId)
        const source = await readFile(fileId)
        const { code, exports: cssExports } = transform({
          filename: fileId,
          code: source,
          cssModules: { pattern: '[hash]_[local]' },
          minify: true,
        })
        const classMap: Record<string, string> = {}
        for (const [local, exp] of Object.entries(cssExports ?? {})) classMap[local] = exp.name
        return [
          `const css = ${JSON.stringify(code.toString())};`,
          `const tagId = ${JSON.stringify(`${PLUGIN_ID}/${basename(fileId)}`)};`,
          'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
          '  const tag = document.createElement(\'style\');',
          `  tag.dataset.plugin = ${JSON.stringify(PLUGIN_ID)};`,
          '  tag.dataset.pluginCss = tagId;',
          '  tag.textContent = css;',
          '  document.head.appendChild(tag);',
          '}',
          `export default ${JSON.stringify(classMap)};`,
        ].join('\n')
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
] satisfies UserConfig[]
