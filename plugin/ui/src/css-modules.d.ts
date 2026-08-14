/** CSS Modules 类型声明（tsdown 的 lightningcss 插件编译 .module.css） */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}
