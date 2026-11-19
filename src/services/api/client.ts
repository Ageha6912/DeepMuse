import { translate, type TranslationMessage } from '../../i18n/index.js'
import { normalizeApiOrigin, useSettings } from '../settings.js'
import { inlineFilePart, registerInlineFile } from './inlineFiles.js'
import { readMessageEvent } from './parseEvent.js'
import { readServerSentEvents } from './sse.js'
import type {
  ApiErrorBody,
  CreateMessageRequest,
  FileBlockParam,
  FileObject,
  FilePurpose,
  MessageParam,
  MessageStreamEvent,
  MessageUsage,
  StopReason,
  TextBlockParam,
} from './types.js'

/** 构建期 API 地址，默认 https://api.deepseek.com；本地开发支持开发服务器代理 */
export const DEFAULT_API_ORIGIN = __API_ORIGIN__
/** 设置中自定义的地址优先，留空回退到构建期默认值；两者都统一去掉 /v1 后缀 */
export const getApiOrigin = (): string =>
  normalizeApiOrigin(useSettings.getState().apiOrigin) ||
  normalizeApiOrigin(DEFAULT_API_ORIGIN)
/** Anthropic 兼容接口的前缀 */
export const getAnthropicBaseUrl = (): string => `${getApiOrigin()}/anthropic/v1`
/** 引用 Files API 上传的图片、调用 Anthropic 兼容 Files API 时必须携带 */
const FILES_BETA = 'files-api-2025-04-14'

export type ApiErrorKind =
  /** 非 2xx 响应 */
  | 'http'
  /** 流中返回的错误帧（如等待生成超时），随后连接关闭 */
  | 'stream'
  /** 请求没有到达服务端（断网、跨域被拦截等） */
  | 'network'
  /** 流在 message_stop 之前结束 */
  | 'interrupted'
  /** 响应不符合协议（如非 SSE 响应） */
  | 'protocol'

export class ApiError extends Error {
  readonly localMessage?: TranslationMessage

  constructor(
    readonly kind: ApiErrorKind,
    message: string | TranslationMessage,
    readonly status?: number
  ) {
    super(typeof message === 'string' ? message : translate(message.key, message.params))
    this.name = 'ApiError'
    this.localMessage = typeof message === 'string' ? undefined : message
  }
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof value === 'object' &&
  value !== null &&
  'error' in value &&
  typeof (value as ApiErrorBody).error?.message === 'string'

const readErrorResponse = async (
  response: Response,
  kind: 'http' | 'protocol' = 'http',
  fallback = response.statusText
): Promise<ApiError> => {
  const text = await response.text().catch(() => '')
  let message = text || fallback
  try {
    const body: unknown = JSON.parse(text)
    if (isErrorBody(body)) {
      message = body.error.message
    }
  } catch {
    // 非 JSON 响应体直接展示原文
  }
  return new ApiError(kind, message, response.status)
}

export const request = async (url: string, init: RequestInit): Promise<Response> => {
  let response: Response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (init.signal?.aborted) {
      throw error
    }
    throw new ApiError('network', error instanceof Error ? error.message : String(error))
  }
  if (!response.ok) {
    throw await readErrorResponse(response)
  }
  return response
}

const anthropicHeaders = (apiKey: string, beta: boolean): Record<string, string> => ({
  // DeepSeek 兼容接口的鉴权方式，也可使用 Authorization: Bearer。
  'x-api-key': apiKey,
  // Files API 和通过 file_id 引用图片时必传；纯文本聊天无需携带。
  ...(beta ? { 'anthropic-beta': FILES_BETA } : {}),
})

/** 用 GET /models 校验 API Key（不产生费用）；OpenAI 兼容服务使用 /v1/models */
export const verifyApiKey = async (apiKey: string, signal?: AbortSignal): Promise<void> => {
  const modelsUrl =
    useSettings.getState().protocol === 'openai'
      ? `${getApiOrigin()}/v1/models`
      : `${getApiOrigin()}/models`
  await request(modelsUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
}

/**
 * POST /anthropic/v1/files 上传附件（不设过期时间，会话里的历史附件一直可用）。
 * purpose 为 null 时不传该字段（图片）；purpose 必须排在 file 之前。
 */
export const uploadFile = async (
  apiKey: string,
  file: File,
  purpose: FilePurpose | null,
  signal?: AbortSignal
): Promise<FileObject> => {
  // OpenAI 兼容接口没有可引用文件的 Files API，直接在浏览器内转成可发送的内容。
  if (useSettings.getState().protocol === 'openai') {
    return registerInlineFile(file, file.name)
  }
  const form = new FormData()
  if (purpose) {
    form.append('purpose', purpose)
  }
  form.append('file', file)
  const response = await request(`${getAnthropicBaseUrl()}/files`, {
    method: 'POST',
    headers: anthropicHeaders(apiKey, true),
    body: form,
    signal,
  })
  return (await response.json()) as FileObject
}

/** DELETE /anthropic/v1/files/{file_id} */
export const deleteFile = async (apiKey: string, fileId: string): Promise<void> => {
  await request(`${getAnthropicBaseUrl()}/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: anthropicHeaders(apiKey, true),
  })
}

const hasFile = (body: CreateMessageRequest) =>
  body.messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((block) => block.type === 'image' || block.type === 'document')
  )

/**
 * POST /anthropic/v1/messages（stream: true），逐个产出流式事件，收到 message_stop 时结束。
 * ping、保活注释与无法解析的内容不产出；中止请求时抛出 signal 的 AbortError。
 */
export async function* streamMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  if (useSettings.getState().protocol === 'openai') {
    yield* streamOpenAIMessage(apiKey, body, signal)
    return
  }
  const response = await request(`${getAnthropicBaseUrl()}/messages`, {
    method: 'POST',
    headers: {
      ...anthropicHeaders(apiKey, hasFile(body)),
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }
  for await (const { event: eventName, data } of readServerSentEvents(response.body, signal)) {
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      if (eventName !== 'error') {
        continue
      }
    }
    if (isErrorBody(payload)) {
      throw new ApiError('stream', payload.error.message)
    }
    if (eventName === 'error') {
      throw new ApiError('stream', data)
    }
    const event = readMessageEvent(payload)
    if (!event) {
      continue
    }
    yield event
    if (event.type === 'message_stop') {
      return
    }
  }
  // 服务端没有提供错误内容时保持为空，不推测断流原因。
  throw new ApiError('interrupted', '')
}

// ---------------------------------------------------------------------------
// OpenAI Chat Completions 适配：把请求转成 OpenAI 格式，再把 SSE 增量映射回
// 上面已有的 MessageStreamEvent，聊天状态层无需知道当前使用哪种协议。
// ---------------------------------------------------------------------------

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

type OpenAIChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | OpenAIContentPart[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const blockText = (block: unknown): string => {
  if (typeof block === 'string') {
    return block
  }
  if (isRecord(block) && block.type === 'text' && typeof block.text === 'string') {
    return block.text
  }
  return ''
}

const messageText = (content: MessageParam['content']): string =>
  Array.isArray(content) ? content.map(blockText).filter(Boolean).join('\n') : blockText(content)

/**
 * user 消息转 OpenAI 内容块：图片走 image_url，文档的纯文本并入正文。
 * 附件内容在上传时已解析并登记，未命中（例如刷新后）的附件不进入请求。
 */
const toOpenAIContent = (
  content: string | (FileBlockParam | TextBlockParam)[],
  prefix: string
): string | OpenAIContentPart[] => {
  if (typeof content === 'string') {
    return [prefix, content].filter(Boolean).join('\n\n')
  }
  const parts: OpenAIContentPart[] = []
  if (prefix) {
    parts.push({ type: 'text', text: prefix })
  }
  for (const block of content) {
    if (block.type === 'text') {
      if (block.text) {
        parts.push({ type: 'text', text: block.text })
      }
      continue
    }
    const inline = inlineFilePart(block.source.file_id)
    if (!inline) {
      continue
    }
    if (inline.type === 'image') {
      parts.push({ type: 'image_url', image_url: { url: inline.url } })
    } else {
      parts.push({ type: 'text', text: `文件《${inline.name}》的内容：\n${inline.text}` })
    }
  }
  if (parts.every((part) => part.type === 'text')) {
    return parts.map((part) => (part as { text: string }).text).join('\n\n')
  }
  return parts
}

/** Anthropic 的 latest_reminder 合并到下一条用户消息，其余按角色分别转换。 */
const toOpenAIMessages = (body: CreateMessageRequest): OpenAIChatMessage[] => {
  const messages: OpenAIChatMessage[] = [{ role: 'system', content: body.system }]
  const reminders: string[] = []
  for (const message of body.messages) {
    if (message.role === 'latest_reminder') {
      reminders.push(message.content)
      continue
    }
    const reminder = reminders.splice(0).join('\n')
    const content =
      message.role === 'assistant'
        ? [reminder, messageText(message.content)].filter(Boolean).join('\n\n')
        : toOpenAIContent(message.content, reminder)
    const empty = typeof content === 'string' ? content.length === 0 : content.length === 0
    if (!empty) {
      messages.push({ role: message.role, content })
    }
  }
  return messages
}

const toOpenAIUsage = (value: unknown): MessageUsage | undefined => {
  if (!isRecord(value)) {
    return undefined
  }
  return {
    input_tokens: typeof value.prompt_tokens === 'number' ? value.prompt_tokens : 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: typeof value.completion_tokens === 'number' ? value.completion_tokens : 0,
  }
}

/**
 * OpenAI 协议下开启深度思考：reasoning_effort 是标准字段，多数兼容服务据此返回
 * delta.reasoning_content。关闭时不传该字段，由上游保持默认（通常是关闭）。
 */
const openAIReasoningPayload = (body: CreateMessageRequest): Record<string, string> =>
  body.thinking.type === 'enabled' ? { reasoning_effort: 'medium' } : {}

/**
 * 部分网关不认识 reasoning_effort 会以 400 拒绝；此时去掉该字段重试一次，
 * 保证开启深度思考不会让本来可用的服务直接失败。
 */
const requestOpenAIStream = async (
  apiKey: string,
  payload: Record<string, unknown>,
  signal: AbortSignal
): Promise<Response> => {
  const send = (data: Record<string, unknown>) =>
    request(`${getApiOrigin()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(data),
      signal,
    })
  try {
    return await send(payload)
  } catch (error) {
    if (
      'reasoning_effort' in payload &&
      error instanceof ApiError &&
      error.status === 400 &&
      /reasoning[_\s-]?effort|unknown|unsupported|unrecognized/i.test(error.message)
    ) {
      const retry = { ...payload }
      delete retry.reasoning_effort
      return await send(retry)
    }
    throw error
  }
}

/** POST /v1/chat/completions（stream: true），产出的事件与 Anthropic 路径完全一致。 */
async function* streamOpenAIMessage(
  apiKey: string,
  body: CreateMessageRequest,
  signal: AbortSignal
): AsyncGenerator<MessageStreamEvent> {
  const payload = {
    model: body.model,
    messages: toOpenAIMessages(body),
    stream: true,
    ...openAIReasoningPayload(body),
  }
  const response = await requestOpenAIStream(apiKey, payload, signal)
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!response.body || !contentType.includes('text/event-stream')) {
    throw await readErrorResponse(response, 'protocol', '')
  }

  let responseId = response.headers.get('x-request-id') ?? `chatcmpl-${Date.now()}`
  let model = body.model
  let usage: MessageUsage | undefined
  let finishReason: string | null = null
  let thinkingIndex: number | null = null
  let textIndex: number | null = null
  let nextIndex = 0

  yield { type: 'message_start', message: { id: responseId, model } }

  for await (const { data } of readServerSentEvents(response.body, signal)) {
    if (data.trim() === '[DONE]') {
      break
    }
    let payload: unknown
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (!isRecord(payload)) {
      continue
    }
    if (isRecord(payload.error) && typeof payload.error.message === 'string') {
      throw new ApiError('stream', payload.error.message)
    }
    if (typeof payload.id === 'string') {
      responseId = payload.id
    }
    if (typeof payload.model === 'string') {
      model = payload.model
    }
    if (payload.usage) {
      usage = toOpenAIUsage(payload.usage)
    }
    const choice = Array.isArray(payload.choices) ? payload.choices.find(isRecord) : undefined
    if (!choice) {
      continue
    }
    if (typeof choice.finish_reason === 'string') {
      finishReason = choice.finish_reason
    }
    const delta = isRecord(choice.delta) ? choice.delta : null
    if (!delta) {
      continue
    }
    const reasoning = typeof delta.reasoning_content === 'string' ? delta.reasoning_content : ''
    const text = typeof delta.content === 'string' ? delta.content : ''
    if (reasoning) {
      if (thinkingIndex === null) {
        thinkingIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: thinkingIndex,
          content_block: { type: 'thinking', thinking: '', signature: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: thinkingIndex,
        delta: { type: 'thinking_delta', thinking: reasoning },
      }
    }
    if (text) {
      if (textIndex === null) {
        if (thinkingIndex !== null) {
          yield { type: 'content_block_stop', index: thinkingIndex }
        }
        textIndex = nextIndex++
        yield {
          type: 'content_block_start',
          index: textIndex,
          content_block: { type: 'text', text: '' },
        }
      }
      yield {
        type: 'content_block_delta',
        index: textIndex,
        delta: { type: 'text_delta', text },
      }
    }
  }

  if (textIndex !== null) {
    yield { type: 'content_block_stop', index: textIndex }
  } else if (thinkingIndex !== null) {
    yield { type: 'content_block_stop', index: thinkingIndex }
  } else {
    yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }
    yield { type: 'content_block_stop', index: 0 }
  }
  const stopReason: StopReason = finishReason === 'length' ? 'max_tokens' : 'end_turn'
  yield {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage,
  }
  yield { type: 'message_stop' }
}
