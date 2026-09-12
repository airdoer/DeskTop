import { useEffect, useRef, useState } from 'react'
import { DEFAULT_GREETING_SETTINGS, GREETING_TIMER_GUARD_MS } from './greeting.config'
import { msUntilNextBoundary, resolveGreeting } from './GreetingResolver'
import type { GreetingContext, GreetingResult } from './greeting.types'

/*
 * Greeting — 通用问候语 UI primitive + 运行时.
 * 依据 docs/GREETING_SPEC.md §12（UI Component）、§16（时间变化）、§17（页面切换）、
 *   §19（Accessibility）、§20（Responsive）。
 *
 * 定位：Header/TitleBar 内的被动辅助信息，不是交互入口（§13）。
 *   - 渲染为普通 <span>：不进入 Tab 顺序、不抢占 focus、无 aria-live（§19）
 *   - 无动画、无 Toast、无弹窗（§2.3 / §18）
 *   - 只在时间跨越问候语边界时重算，不使用 setInterval 每秒计算（§16）
 */

interface GreetingProps {
  /** 问候文案，来自 resolveGreeting().text。空串则不渲染 */
  message: string
  /** 布局/响应式类由调用方（Shell）注入，primitive 自身只负责排版 */
  className?: string
}

/**
 * §12.1 视觉规格：13px / 400 / nowrap / 低对比度。
 * 颜色取 text-foreground-secondary（65% 黑）：在 surface-2(#fafafa) 上对比度约 6.9:1，
 *   与 §12.1 的「默认前景色 + opacity 0.75」在本项目 token 体系下等价，
 *   但不额外叠加 opacity，避免对比度掉到 WCAG AA 以下。
 */
export function Greeting({ message, className }: GreetingProps) {
  if (!message) return null
  return (
    <span
      className={`text-[13px] font-normal whitespace-nowrap text-foreground-secondary ${className ?? ''}`}
    >
      {message}
    </span>
  )
}

export interface UseGreetingOptions {
  /** 是否启用（默认取 DEFAULT_GREETING_SETTINGS.enabled）。Shell 可传入登录态 */
  enabled?: boolean
  /** 是否拼接用户名（默认 false） */
  showUserName?: boolean
  /** 当前登录用户名，仅在 showUserName 为 true 时生效 */
  username?: string
  /** 第二阶段：当天首次启动（§6）。MVP 由调用方传 false 或不传 */
  isFirstLaunchToday?: boolean
  /** 第二阶段：应用从后台恢复（§6） */
  isReturningFromBackground?: boolean
  /** 第二阶段：已连续活跃时长 ms（§7） */
  activeDuration?: number
  /** 第二阶段：当前会话是否活跃（§7） */
  sessionActive?: boolean
}

/**
 * 运行时（§28 Task 4）：应用启动计算 Greeting，并只在跨时间边界时更新。
 *
 * 与 §17 的关系：本 hook 挂在 Shell 的 TitleBar 上，TitleBar 不随路由切换卸载，
 *   因此页面切换不会重算；只有时间边界或显式上下文变化（登录/登出）才更新。
 *
 * @returns 需要展示的问候语；未启用时返回 null
 */
export function useGreeting(options: UseGreetingOptions = {}): GreetingResult | null {
  // 用 ref 持有最新入参：定时器回调里读 ref，避免因 options 每次渲染都是新对象而反复重建定时器
  const optionsRef = useRef(options)
  optionsRef.current = options

  const [result, setResult] = useState<GreetingResult | null>(() => computeGreeting(options))

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const now = new Date()
      setResult(computeGreeting(optionsRef.current, now))
      // 每次重算后重新计算下一个边界，而不是固定 1s 轮询
      timer = setTimeout(schedule, msUntilNextBoundary(now) + GREETING_TIMER_GUARD_MS)
    }
    timer = setTimeout(schedule, msUntilNextBoundary(new Date()) + GREETING_TIMER_GUARD_MS)
    return () => clearTimeout(timer)
  }, [])

  // 上下文变化需要立即反映（如登录后标题栏才出现问候语），不能等到下一个时间边界
  useEffect(() => {
    setResult(computeGreeting(optionsRef.current))
  }, [
    options.enabled,
    options.showUserName,
    options.username,
    options.isFirstLaunchToday,
    options.isReturningFromBackground,
    options.activeDuration,
    options.sessionActive,
  ])

  return result
}

/** 组装 GreetingContext 并解析；未启用时返回 null 由 UI 决定不渲染 */
function computeGreeting(
  options: UseGreetingOptions,
  now: Date = new Date(),
): GreetingResult | null {
  if (!(options.enabled ?? DEFAULT_GREETING_SETTINGS.enabled)) return null

  const context: GreetingContext = {
    now,
    isFirstLaunchToday: options.isFirstLaunchToday ?? false,
    isReturningFromBackground: options.isReturningFromBackground ?? false,
    activeDuration: options.activeDuration,
    sessionActive: options.sessionActive,
    username: options.username,
    settings: { showUserName: options.showUserName },
  }
  return resolveGreeting(context)
}
