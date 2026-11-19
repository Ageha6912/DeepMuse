import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'
import { Directory, Filesystem } from '@capacitor/filesystem'

/**
 * 原生能力桥接层。
 *
 * 设计原则：Web 端行为完全不变；只有 Capacitor 原生平台才走原生 API。
 * 所有方法都先判断 isNative()，在浏览器里是安全 no-op / 回退。
 */

/** 是否运行在安卓 / iOS 原生容器内 */
export const isNative = (): boolean => Capacitor.isNativePlatform()

/** 在系统浏览器打开外部链接；Web 端用 window.open */
export const openExternal = async (url: string): Promise<void> => {
  try {
    if (isNative()) {
      const { Browser } = await import('@capacitor/browser')
      await Browser.open({ url })
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

/** 把一段文本交给系统分享面板；Web 端回退到 navigator.share（若可用） */
export const shareText = async (text: string, title?: string): Promise<boolean> => {
  try {
    if (isNative()) {
      await Share.share({ title, text, dialogTitle: title })
      return true
    }
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text })
      return true
    }
    return false
  } catch {
    // 用户取消分享也会走到这里，视为未分享而非错误
    return false
  }
}

/** 把 Blob 保存到设备 Downloads 并交给系统分享；Web 端回退到 <a download> */
export const saveAndShareBlob = async (blob: Blob, fileName: string): Promise<boolean> => {
  try {
    if (isNative()) {
      const base64 = await blobToBase64(blob)
      const saved = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Documents,
        recursive: true,
      })
      await Share.share({
        title: fileName,
        files: [saved.uri],
        dialogTitle: '保存或分享',
      })
      return true
    }
    // Web 端：触发浏览器下载
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return true
  } catch {
    return false
  }
}

/** 读取一个 Blob 的 base64（不含 data URL 前缀） */
const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('无法读取文件内容'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取失败'))
    reader.readAsDataURL(blob)
  })
