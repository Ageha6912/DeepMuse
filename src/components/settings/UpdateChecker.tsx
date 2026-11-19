import { useEffect, useState } from 'react'
import { useTranslate } from '../../i18n/index.js'
import { isNative, openExternal } from '../../services/nativeBridge.js'
import { Button } from '../base/Button.js'
import styles from './Settings.module.css'

const RELEASES_API = 'https://api.github.com/repos/Ageha6912/DeepMuse/releases/latest'
const CACHE_KEY = 'deepmuse:update-check'
const CACHE_MS = 6 * 60 * 60 * 1000

type Cached = { at: number; tag: string | null; url: string | null }

const readCache = (): Cached | null => {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) {
      return null
    }
    const parsed = JSON.parse(raw) as Cached
    return typeof parsed.at === 'number' ? parsed : null
  } catch {
    return null
  }
}

const writeCache = (value: Cached) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(value))
  } catch {
    // 存储不可用时跳过缓存，不影响本次检查
  }
}

const parseVersion = (tag: string | null): number[] => {
  if (!tag) {
    return []
  }
  return (tag.replace(/^v/i, '').match(/\d+/g) ?? []).map(Number)
}

const isNewer = (latest: string | null, current: string): boolean => {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (a.length === 0 || b.length === 0) {
    return false
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x > y) {
      return true
    }
    if (x < y) {
      return false
    }
  }
  return false
}

/**
 * 原生端静默更新检查：启动后请求公开 Releases API，6 小时缓存，
 * 发现新版本只在设置项显示提示，不弹窗打断。Web 端完全不渲染。
 */
export const UpdateChecker = ({ currentVersion }: { currentVersion: string }) => {
  const t = useTranslate()
  const [state, setState] = useState<{ tag: string | null; url: string | null } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!isNative()) {
      return
    }
    const cached = readCache()
    if (cached && Date.now() - cached.at < CACHE_MS) {
      setState({ tag: cached.tag, url: cached.url })
      return
    }
    let cancelled = false
    void (async () => {
      setBusy(true)
      try {
        const response = await fetch(RELEASES_API, {
          headers: { Accept: 'application/vnd.github+json' },
        })
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        const data = (await response.json()) as { tag_name?: string; html_url?: string }
        const tag = data.tag_name ?? null
        const url = data.html_url ?? null
        writeCache({ at: Date.now(), tag, url })
        if (!cancelled) {
          setState({ tag, url })
        }
      } catch {
        // 检查失败静默处理，不影响使用
      } finally {
        if (!cancelled) {
          setBusy(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!isNative()) {
    return null
  }

  const hasUpdate = isNewer(state?.tag ?? null, currentVersion)

  return (
    <div className={`${styles.cell} ${styles.row}`}>
      <div className={styles.text}>
        <div className={styles.label}>
          {t('settingDialogUpdateLabel')}
          {hasUpdate ? <span className={styles.updateBadge}>{t('settingDialogUpdateNew')}</span> : null}
        </div>
        <div className={styles.description}>
          {busy
            ? t('settingDialogUpdateChecking')
            : hasUpdate
              ? t('settingDialogUpdateAvailable', { version: state?.tag ?? '' })
              : t('settingDialogUpdateCurrent', { version: currentVersion })}
        </div>
      </div>
      {state?.url ? (
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          onClick={() => void openExternal(state.url ?? RELEASES_API)}
        >
          {t('settingDialogUpdateOpen')}
        </Button>
      ) : null}
    </div>
  )
}
