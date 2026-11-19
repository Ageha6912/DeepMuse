import { create } from 'zustand'
import type { TtsVoice } from './api/speech.js'
import { normalizeLocation, type UserLocation } from './location.js'

export type Locale = 'zh-CN' | 'en-US'

/** 聊天接口协议：默认 Anthropic Messages，可选 OpenAI Chat Completions */
export type ApiProtocol = 'anthropic' | 'openai'

/** 主题偏好；默认跟随系统 */
export type ThemePreference = 'light' | 'dark' | 'system'

/** 本机设置，存 localStorage：API Key、语言、主题、位置、朗读音色、深度思考与智能搜索开关、侧边栏收起状态 */
type Settings = {
  apiKey: string | null
  /** 留空使用构建期默认地址；可填任意兼容 Anthropic Messages 协议的服务 */
  apiOrigin: string
  /** 留空使用 deepseek-flash；可作为请求中的 model 字段 */
  model: string
  protocol: ApiProtocol
  locale: Locale
  themePreference: ThemePreference
  location: UserLocation | null
  ttsVoice: TtsVoice
  thinking: boolean
  search: boolean
  siderCollapsed: boolean
}

const KEYS = {
  apiKey: 'chat-demo:api-key',
  apiOrigin: 'deepmuse:api-origin',
  model: 'deepmuse:model',
  protocol: 'deepmuse:protocol',
  locale: 'chat-demo:locale',
  location: 'chat-demo:location',
  themePreference: 'chat-demo:theme-preference',
  ttsVoice: 'chat-demo:tts-voice',
  thinking: 'chat-demo:thinking',
  search: 'chat-demo:search',
  siderCollapsed: 'chat-demo:sider-collapsed',
} as const

const read = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

const write = (key: string, value: string | null) => {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // 存储不可用时只在内存中生效
  }
}

/** 位置选择模式跟随浏览器语言，与应用内选择的界面语言无关。 */
export const isChineseBrowser = (): boolean =>
  (typeof navigator === 'undefined' ? 'zh' : navigator.language).toLowerCase().startsWith('zh')

const initialLocale = (): Locale => {
  const saved = read(KEYS.locale)
  if (saved === 'zh-CN' || saved === 'en-US') {
    return saved
  }
  return isChineseBrowser() ? 'zh-CN' : 'en-US'
}

const initialLocation = (): UserLocation | null => {
  try {
    const location = normalizeLocation(JSON.parse(read(KEYS.location) ?? 'null'))
    if (!location) {
      return null
    }
    return isChineseBrowser()
      ? location.region === 'CN' && location.province
        ? location
        : null
      : { region: location.region }
  } catch {
    return null
  }
}

/** 服务端模式固定使用构建时协议，避免终端用户切换后打错路径 */
const initialProtocol = (): ApiProtocol => {
  if (__SERVER_MODE__) {
    return __DEFAULT_PROTOCOL__
  }
  return read(KEYS.protocol) === 'openai' ? 'openai' : 'anthropic'
}

/** 未保存过时跟随系统 */
const initialThemePreference = (): ThemePreference => {
  const saved = read(KEYS.themePreference)
  return saved === 'light' || saved === 'dark' ? saved : 'system'
}

/** 未保存过时使用服务端默认音色 stella（海星） */
const initialTtsVoice = (): TtsVoice => (read(KEYS.ttsVoice) === 'tide' ? 'tide' : 'stella')

export const useSettings = create<Settings>(() => ({
  apiKey: read(KEYS.apiKey),
  apiOrigin: __SERVER_MODE__ ? '' : (read(KEYS.apiOrigin) ?? ''),
  model: __SERVER_MODE__ ? '' : (read(KEYS.model) ?? ''),
  protocol: initialProtocol(),
  locale: initialLocale(),
  location: initialLocation(),
  themePreference: initialThemePreference(),
  ttsVoice: initialTtsVoice(),
  // 服务端模式默认开启深度思考；用户手动切换过则沿用其选择。
  thinking: read(KEYS.thinking) === null ? __SERVER_MODE__ : read(KEYS.thinking) === 'true',
  search: read(KEYS.search) === 'true',
  siderCollapsed: read(KEYS.siderCollapsed) === 'true',
}))

export const setLocale = (locale: Locale) => {
  write(KEYS.locale, locale)
  useSettings.setState({ locale })
}

export const setLocation = (value: UserLocation | null) => {
  const location = normalizeLocation(value)
  write(KEYS.location, location ? JSON.stringify(location) : null)
  useSettings.setState({ location })
}

export const setThemePreference = (themePreference: ThemePreference) => {
  write(KEYS.themePreference, themePreference)
  useSettings.setState({ themePreference })
}

export const setTtsVoice = (ttsVoice: TtsVoice) => {
  write(KEYS.ttsVoice, ttsVoice)
  useSettings.setState({ ttsVoice })
}

export const setApiKey = (apiKey: string | null) => {
  write(KEYS.apiKey, apiKey)
  useSettings.setState({ apiKey })
}

/** 应用会自行拼接 /anthropic/v1 与 /v1/tools，所以这里只保留服务根地址。 */
export const normalizeApiOrigin = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.replace(/\/v1$/i, '')
}

export const setApiOrigin = (apiOrigin: string) => {
  const normalized = normalizeApiOrigin(apiOrigin)
  write(KEYS.apiOrigin, normalized === '' ? null : normalized)
  useSettings.setState({ apiOrigin: normalized })
}

export const setModel = (model: string) => {
  write(KEYS.model, model.trim() === '' ? null : model.trim())
  useSettings.setState({ model })
}

export const setProtocol = (protocol: ApiProtocol) => {
  write(KEYS.protocol, protocol)
  useSettings.setState({ protocol })
}

export const setThinking = (thinking: boolean) => {
  write(KEYS.thinking, String(thinking))
  useSettings.setState({ thinking })
}

export const setSearch = (search: boolean) => {
  write(KEYS.search, String(search))
  useSettings.setState({ search })
}

export const setSiderCollapsed = (siderCollapsed: boolean) => {
  write(KEYS.siderCollapsed, String(siderCollapsed))
  useSettings.setState({ siderCollapsed })
}
