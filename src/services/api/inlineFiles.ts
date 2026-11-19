import type { FileObject } from './types.js'

/**
 * OpenAI 兼容接口没有可引用的 Files API，附件改为在浏览器内转成可直接发送的内容：
 * 图片压成 data URL 交给 image_url，文档提取纯文本后并入消息正文。
 */
export type InlineFilePart =
  | { type: 'image'; url: string }
  | { type: 'text'; name: string; text: string }

/** 浏览器内无法解析成可发送内容的格式，例如 PDF、旧版 Office 二进制。 */
export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedFileError'
  }
}

/** 单个文档注入请求的字符上限，避免超出上下文窗口。 */
const MAX_TEXT_CHARS = 60000
/** 图片压缩后的最大边长与质量，兼顾清晰度和请求体积。 */
const IMAGE_MAX_EDGE = 1568
const IMAGE_QUALITY = 0.85

const IMAGE_MIME = /^image\//
const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'svg',
  'svgz',
  'avif',
  'ico',
  'tif',
  'tiff',
  'apng',
  'jfif',
  'pjpeg',
  'dib',
  'xbm',
  'pjp',
])

/** 已解析的附件内容，按上传时分配的 id 缓存；刷新后历史附件降级为不进入请求。 */
const inlineFiles = new Map<string, InlineFilePart>()
let inlineSeq = 0

export const inlineFilePart = (id: string): InlineFilePart | undefined => inlineFiles.get(id)

const extOf = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

const readAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })

/** 统一压到 JPEG 并限制长边，减小 base64 体积；解不出位图时退回原始 data URL。 */
const toImageDataUrl = async (blob: Blob, name: string): Promise<string> => {
  if (blob.type === 'image/svg+xml' || extOf(name) === 'svg') {
    return readAsDataUrl(blob)
  }
  const bitmap = await createImageBitmap(blob).catch(() => null)
  if (!bitmap) {
    return readAsDataUrl(blob)
  }
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    return readAsDataUrl(blob)
  }
  // JPEG 不支持透明，先铺白底避免透明区域变黑。
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  return canvas.toDataURL('image/jpeg', IMAGE_QUALITY)
}

type ZipEntry = { name: string; method: number; size: number; offset: number }

/** 解析 ZIP 中央目录；Office 文档都是普通 ZIP，足够覆盖 docx/pptx/xlsx。 */
const readZipEntries = (buffer: ArrayBuffer): ZipEntry[] => {
  // EOCD 固定 22 字节，更小的文件不可能是合法 ZIP。
  if (buffer.byteLength < 22) {
    return []
  }
  const view = new DataView(buffer)
  let eocd = -1
  const min = Math.max(0, buffer.byteLength - 66000)
  for (let i = buffer.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) {
    return []
  }
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      break
    }
    const method = view.getUint16(offset + 10, true)
    const size = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(buffer, offset + 46, nameLength))
    entries.push({ name, method, size, offset: localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

const readZipEntry = async (buffer: ArrayBuffer, entry: ZipEntry): Promise<string> => {
  const view = new DataView(buffer)
  const nameLength = view.getUint16(entry.offset + 26, true)
  const extraLength = view.getUint16(entry.offset + 28, true)
  const start = entry.offset + 30 + nameLength + extraLength
  const data = new Uint8Array(buffer, start, entry.size)
  if (entry.method !== 8) {
    return new TextDecoder().decode(data)
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Response(stream).text()
}

const decodeEntities = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Word/PPT 的 XML 去标签：保留段落与换行，去掉其余标记。 */
const officeXmlToText = (xml: string) =>
  decodeEntities(
    xml
      .replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<\/a:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

const readOfficeText = async (buffer: ArrayBuffer, ext: string): Promise<string> => {
  const entries = readZipEntries(buffer)
  if (entries.length === 0) {
    return ''
  }
  if (ext === 'docx') {
    const target = entries.find((entry) => entry.name === 'word/document.xml')
    return target ? officeXmlToText(await readZipEntry(buffer, target)) : ''
  }
  if (ext === 'pptx') {
    const slides = entries
      .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
      .sort((a, b) => Number(a.name.replace(/\D/g, '')) - Number(b.name.replace(/\D/g, '')))
    const texts = await Promise.all(slides.map((entry) => readZipEntry(buffer, entry)))
    return texts.map((xml, index) => `第 ${index + 1} 页\n${officeXmlToText(xml)}`).join('\n\n')
  }
  if (ext === 'xlsx') {
    const target = entries.find((entry) => entry.name === 'xl/sharedStrings.xml')
    if (!target) {
      return ''
    }
    const xml = await readZipEntry(buffer, target)
    return decodeEntities(xml.replace(/<\/si>/g, '\n').replace(/<[^>]+>/g, ''))
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
  return ''
}

/** UTF-8 解码；替换字符过多说明是二进制，返回 null。 */
const decodeText = (buffer: ArrayBuffer): string | null => {
  const text = new TextDecoder('utf-8').decode(buffer)
  const sample = text.slice(0, 4000)
  const broken = (sample.match(/\uFFFD/g) ?? []).length
  return sample.length > 0 && broken / sample.length < 0.01 ? text : null
}

const clip = (text: string) => {
  const chars = [...text]
  return chars.length > MAX_TEXT_CHARS
    ? `${chars.slice(0, MAX_TEXT_CHARS).join('')}\n\n（内容过长，已截断）`
    : text
}

const buildPart = async (file: Blob, name: string): Promise<InlineFilePart> => {
  const ext = extOf(name)
  if (IMAGE_MIME.test(file.type) || IMAGE_EXTS.has(ext)) {
    return { type: 'image', url: await toImageDataUrl(file, name) }
  }
  const buffer = await file.arrayBuffer()
  if (['docx', 'pptx', 'xlsx'].includes(ext)) {
    const text = await readOfficeText(buffer, ext)
    if (!text) {
      throw new UnsupportedFileError(`无法从 ${name} 中提取文本`)
    }
    return { type: 'text', name, text: clip(text) }
  }
  const decoded = decodeText(buffer)
  if (decoded === null) {
    throw new UnsupportedFileError(`当前接口不支持直接发送 ${ext || '该'} 格式`)
  }
  return { type: 'text', name, text: clip(decoded) }
}

/** 解析并登记一个附件，返回可当作 file_id 使用的本地 id。 */
export const registerInlineFile = async (file: Blob, name: string): Promise<FileObject> => {
  const part = await buildPart(file, name)
  const id = `inline_${(inlineSeq += 1)}`
  inlineFiles.set(id, part)
  return {
    id,
    type: 'file',
    size_bytes: file.size,
    created_at: new Date().toISOString(),
    filename: name,
    mime_type: file.type || 'application/octet-stream',
  }
}
