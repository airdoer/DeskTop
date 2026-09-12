import { useEffect, useRef } from 'react'

/*
 * useTabCycleHotkey — 全局 Ctrl+Tab / Ctrl+Shift+Tab 循环切换 tab.
 *
 * 与浏览器语义一致：
 *   - Ctrl+Tab → 下一个 tab（向右）；
 *   - Ctrl+Shift+Tab → 上一个 tab（向左）；
 *   - 到达边界时循环（最后一个 → 第一个，第一个 → 最后一个）。
 *
 * 实现约定（与 useQuickNavHotkey / useReopenClosedTabHotkey 一致）：
 *   - 监听挂在 document 冒泡阶段；
 *   - 回调放进 ref，调用方不必为「避免重复订阅」包 useCallback，
 *     同时保证每次触发都调用最新一版闭包；
 *   - preventDefault 阻止 Electron/Chromium 默认行为（Ctrl+Tab 在浏览器里是
 *     切换标签页，但 Electron 渲染进程默认无此行为，preventDefault 保险吞掉）。
 *
 * 排除带 Alt 的组合：Alt+Tab 是 OS 级窗口切换，不应被吞。
 */
export function useTabCycleHotkey(onCycle: (step: number) => void, enabled = true): void {
  const cycleRef = useRef(onCycle)

  useEffect(() => {
    cycleRef.current = onCycle
  }, [onCycle])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      if (event.altKey) return
      if (event.key !== 'Tab') return
      event.preventDefault()
      cycleRef.current(event.shiftKey ? -1 : 1)
    }

    document.addEventListener('keydown', handleKeyDown, false)
    return () => document.removeEventListener('keydown', handleKeyDown, false)
  }, [enabled])
}
