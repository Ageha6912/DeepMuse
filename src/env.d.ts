declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module '*.css' {}

/** 公开 API 的地址，见 rspack.config.ts 的 createConfig */
declare const __API_ORIGIN__: string

/** 服务端模式：API Key 由同源代理注入，终端用户无需填写 */
declare const __SERVER_MODE__: boolean

/** 服务端模式下前端默认使用的接口协议 */
declare const __DEFAULT_PROTOCOL__: 'anthropic' | 'openai'

/** Prism 语言包通过副作用注册到全局 Prism */
declare module 'prismjs/components/*' {}

/** KaTeX 化学公式扩展通过副作用注册到 KaTeX */
declare module 'katex/contrib/mhchem' {}
