import { useEffect, useRef } from 'react'

/*
 * useReopenClosedTabHotkey — 全局 Ctrl/⌘ + Shift + T 恢复最近关闭的 tab.
 *
 * 与 useQuickNavHotkey 同一套约定：
 *   - 监听挂在 document 冒泡阶段；
 *   - 回调放进 ref，调用方不必为「避免重复订阅」包 useCallback，
 *     同时保证每次触发都调用最新一版闭包；
 *   - 阻止默认行为（Electron/Chromium 默认 Ctrl+Shift+T 是「重新打开关闭的标签页」，
 *     但我们自管 tab，所以吞掉浏览器侧的实现，触发我们自己的恢复）。
 *
 * 与浏览器原生快捷键语义一致：Chrome / Edge / Firefox 的 Ctrl+Shift+T 都是恢复最近关闭的 tab，
 *   用户无需额外学习。
 */
export function useReopenClosedTabHotkey(onTrigger: () => void, enabled = true): void {
  const triggerRef = useRef(onTrigger)

  useEffect(() => {
    triggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (!event.shiftKey) return
      if (event.altKey) return
      if (event.key !== 't' && event.key !== 'T') return
      event.preventDefault()
      triggerRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, false)
    return () => document.removeEventListener('keydown', handleKeyDown, false)
  }, [enabled])
}
