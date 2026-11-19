import { createRoot } from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import { App } from './app/App.js'
import { setupTheme } from './app/theme.js'
import { ensureKatex } from './services/markdown/katex.js'
import './app/theme.css'
import './app/global.css'

// 原生容器标记：安卓 WebView 上关闭开销大的模糊与循环动画，避免掉帧
if (Capacitor.isNativePlatform()) {
  document.documentElement.dataset.native = 'true'
}

ensureKatex()
setupTheme()

createRoot(document.getElementById('root') as HTMLElement).render(<App />)
