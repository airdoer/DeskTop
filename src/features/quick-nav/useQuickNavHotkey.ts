import { useEffect, useRef } from 'react'
import { isQuickNavHotkey } from '@/services/quickNav'

/*
 * useQuickNavHotkey — 全局 Ctrl/⌘ + K 唤起快捷跳转.
 * 依据 docs/UI_DESIGN_SYSTEM.md §22：Ctrl+K = Global Search / Command Palette。
 *
 * 两个实现要点：
 * 1. 监听挂在 document 冒泡阶段，让浮层内的输入框先处理自己的按键；
 * 2. 回调放进 ref：调用方不必为「避免重复订阅」而包 useCallback，
 *    同时保证每次触发都调用最新一版闭包。
 */
export function useQuickNavHotkey(onTrigger: () => void, enabled = true): void {
  const triggerRef = useRef(onTrigger)

  useEffect(() => {
    triggerRef.current = onTrigger
  }, [onTrigger])

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isQuickNavHotkey(event)) return
      // 阻止 Electron 默认行为（Chromium 的 Ctrl+K 会聚焦地址栏/搜索）
      event.preventDefault()
      triggerRef.current()
    }

    document.addEventListener('keydown', handleKeyDown, false)
    return () => document.removeEventListener('keydown', handleKeyDown, false)
  }, [enabled])
}
