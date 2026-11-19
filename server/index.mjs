import http from 'node:http'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

/**
 * DeepMuse 生产服务：
 * - 托管 dist 静态文件（同源部署，无跨域）
 * - 把 /api/* 代理到上游 API，并在服务端注入 API Key
 * - 浏览器永远拿不到 Key；支持 Anthropic Messages、OpenAI Chat Completions、
 *   附件 Files API 与语音工具，全部按原路径透传。
 */

const root = path.resolve(
  process.env.STATIC_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
)
const upstream = (process.env.UPSTREAM_ORIGIN || 'https://api.deepseek.com').replace(/\/+$/, '')
const apiKey = (process.env.API_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
const overrideModel = (process.env.MODEL || '').trim()
const port = Number(process.env.PORT || 8080)
const host = process.env.HOST || '0.0.0.0'
const rateLimit = Math.max(1, Number(process.env.RATE_LIMIT_PER_MINUTE || 30))
const maxBody = Math.max(1, Number(process.env.MAX_BODY_MB || 32)) * 1024 * 1024

if (!apiKey) {
  console.error('[deepmuse] 缺少 API_KEY 环境变量，已停止启动。')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/** 只允许应用真正用到的上游路径，避免服务端 Key 被当成通用代理。 */
const ALLOWED_PATHS = [
  '/anthropic/v1/messages',
  '/anthropic/v1/files',
  '/v1/chat/completions',
  '/v1/tools/asr',
  '/v1/tools/tts',
  '/models',
  '/v1/models',
]

const isAllowedPath = (pathname) => {
  const proxyPath = pathname.slice('/api'.length)
  return ALLOWED_PATHS.some(
    (allowed) => proxyPath === allowed || proxyPath.startsWith(`${allowed}/`)
  )
}

const hits = new Map()
const allowRequest = (ip) => {
  const now = Date.now()
  const windowStart = now - 60_000
  const list = (hits.get(ip) || []).filter((time) => time > windowStart)
  if (list.length >= rateLimit) {
    hits.set(ip, list)
    return false
  }
  list.push(now)
  hits.set(ip, list)
  return true
}

const cleanupTimer = setInterval(() => {
  const cutoff = Date.now() - 120_000
  for (const [ip, list] of hits) {
    const kept = list.filter((time) => time > cutoff)
    if (kept.length === 0) {
      hits.delete(ip)
    } else {
      hits.set(ip, kept)
    }
  }
}, 60_000)
cleanupTimer.unref()

/**
 * 允许的原生客户端来源。安卓 Capacitor 以 https://localhost 或
 * capacitor://localhost 加载内置页面，相对站点本身是跨域请求。
 */
const CORS_ORIGINS = new Set([
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
  'ionic://localhost',
])

/** 为代表原生容器的请求补上 CORS 头；同源请求不受影响 */
const applyCors = (req, res) => {
  const origin = req.headers.origin
  if (!origin || !CORS_ORIGINS.has(origin)) {
    return
  }
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Vary', 'Origin')
  res.setHeader(
    'Access-Control-Allow-Headers',
    'authorization, content-type, x-api-key, anthropic-beta, anthropic-version, accept'
  )
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Max-Age', '86400')
}

const json = (res, status, payload) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

const readBody = async (req) => {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBody) {
      const error = new Error('body too large')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const proxy = async (req, res, url) => {
  const target = `${upstream}${url.pathname.slice('/api'.length)}${url.search}`
  let body
  try {
    body = await readBody(req)
  } catch (error) {
    if (error.code === 'BODY_TOO_LARGE') {
      json(res, 413, { error: { message: `请求体超过 ${maxBody / 1024 / 1024} MB 限制` } })
      return
    }
    throw error
  }

  const contentType = String(req.headers['content-type'] || '')
  if (overrideModel && body.length > 0 && contentType.includes('application/json')) {
    try {
      const payload = JSON.parse(body.toString('utf8'))
      if (payload && typeof payload === 'object' && 'model' in payload) {
        payload.model = overrideModel
        body = Buffer.from(JSON.stringify(payload))
      }
    } catch {
      // 非 JSON 或解析失败时按原文透传
    }
  }

  const headers = new Headers()
  for (const [name, value] of Object.entries(req.headers)) {
    if (
      [
        'host',
        'authorization',
        'x-api-key',
        'cookie',
        'origin',
        'referer',
        'content-length',
        'accept-encoding',
        'connection',
      ].includes(name)
    ) {
      continue
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item)
      }
    } else if (value !== undefined) {
      headers.set(name, value)
    }
  }
  headers.set('authorization', `Bearer ${apiKey}`)
  headers.set('x-api-key', apiKey)
  if (body.length > 0) {
    headers.set('content-length', String(body.length))
  }

  const controller = new AbortController()
  const onClose = () => controller.abort()
  req.on('close', onClose)

  try {
    const upstreamResponse = await fetch(target, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      signal: controller.signal,
    })

    res.statusCode = upstreamResponse.status
    for (const [name, value] of upstreamResponse.headers) {
      if (
        ['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(name)
      ) {
        continue
      }
      res.setHeader(name, value)
    }
    res.setHeader('Cache-Control', 'no-store')

    if (!upstreamResponse.body) {
      res.end()
      return
    }
    for await (const chunk of upstreamResponse.body) {
      if (!res.write(Buffer.from(chunk))) {
        await once(res, 'drain')
      }
    }
    res.end()
  } catch (error) {
    if (controller.signal.aborted) {
      res.destroy()
      return
    }
    console.error('[deepmuse] upstream error:', error instanceof Error ? error.message : error)
    if (!res.headersSent) {
      json(res, 502, { error: { message: '上游 API 请求失败，请稍后重试' } })
    } else {
      res.destroy()
    }
  } finally {
    req.off('close', onClose)
  }
}

const serveStatic = async (req, res, url) => {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400)
    res.end('Bad request')
    return
  }

  let filePath = path.resolve(root, `.${pathname}`)
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403)
    res.end('Forbidden')
    return
  }

  let info
  try {
    info = await stat(filePath)
  } catch {
    info = null
  }
  if (info?.isDirectory()) {
    filePath = path.join(filePath, 'index.html')
    info = await stat(filePath).catch(() => null)
  }
  if (!info?.isFile()) {
    // SPA 回退：无扩展名的前端路由交给 index.html
    if (path.extname(pathname) === '' || pathname === '/') {
      filePath = path.join(root, 'index.html')
      info = await stat(filePath).catch(() => null)
    }
  }
  if (!info?.isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': pathname.startsWith('/static/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(filePath).pipe(res)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)

  if (url.pathname === '/healthz') {
    json(res, 200, { ok: true, upstream, model: overrideModel || 'client' })
    return
  }

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    applyCors(req, res)
    // 预检请求：CORS 头已经写好，直接结束，不占用限流额度
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (!isAllowedPath(url.pathname)) {
      json(res, 404, { error: { message: '不支持的接口路径' } })
      return
    }
    const ip = req.socket.remoteAddress || 'unknown'
    if (!allowRequest(ip)) {
      json(res, 429, { error: { message: '请求过于频繁，请稍后再试' } })
      return
    }
    await proxy(req, res, url)
    return
  }

  await serveStatic(req, res, url)
})

server.listen(port, host, () => {
  console.log(`[deepmuse] listening on http://${host}:${port}`)
  console.log(`[deepmuse] upstream: ${upstream}`)
  console.log(`[deepmuse] model override: ${overrideModel || 'client request'}`)
  console.log(`[deepmuse] rate limit: ${rateLimit}/min per IP`)
})
