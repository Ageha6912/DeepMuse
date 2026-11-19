import { useEffect, useRef, useState } from 'react'

/**
 * 为「条件渲染的浮层」提供进出场挂载管理：
 * - active 变 true 时立即挂载，phase = 'enter'
 * - active 变 false 时先切到 phase = 'exit' 播放退场动画，delay 毫秒后再卸载
 * - 偏好减少动效时不等待，立即卸载
 *
 * 典型用法：
 *   const presence = usePresence(open, 220)
 *   if (!presence.mounted) return null
 *   return <div data-phase={presence.phase}>...</div>
 *
 * 组件根节点需根据 data-phase 在 CSS 中定义 enter / exit 两段动画。
 * 注意 delay 必须 ≥ CSS 退场动画时长，否则元素会在动画结束前被卸载。
 */
export const usePresence = (active: boolean, delay: number) => {
  const [mounted, setMounted] = useState(active)
  const [phase, setPhase] = useState<'enter' | 'exit'>(active ? 'enter' : 'exit')
  const reduceRef = useRef(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => {
      reduceRef.current = query.matches
    }
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (active) {
      setMounted(true)
      setPhase('enter')
      return
    }
    setPhase('exit')
    // 从未挂载过就收到关闭，直接保持卸载，不制造一次空转。
    if (!mounted) {
      return
    }
    const timer = window.setTimeout(() => setMounted(false), reduceRef.current ? 0 : delay)
    return () => window.clearTimeout(timer)
  }, [active, delay, mounted])

  return { mounted, phase }
}
