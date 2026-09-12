/*
 * GreetingResolver — 问候语解析（纯函数，无 React / Electron 依赖）.
 * 依据 docs/GREETING_SPEC.md §4、§9、§10、§14、§16、§7。
 *
 * 解析流水线（§10）：
 *   收集候选 Greeting → 过滤不满足条件的 → 按 priority 排序 → 取最高优先级 → 返回结果
 * 未来新增 BuildCompleted / DeployCompleted 等类型时只需追加候选与优先级，
 * 不会破坏既有时间问候。
 */

import {
  DEFAULT_GREETING_SETTINGS,
  GREETING_PRIORITY,
  LATE_NIGHT_GREETING_TYPE,
  TIME_BOUNDARY_MINUTES,
  TIME_GREETING_RANGES,
  rangeStartMinutes,
  resolveGreetingText,
} from './greeting.config'
import type {
  GreetingContext,
  GreetingResult,
  GreetingSettings,
  GreetingType,
  TimeGreetingType,
} from './greeting.types'

/** 「辛苦了」判定阈值（§7）：连续活跃超过 4 小时 */
const HARD_WORK_ACTIVE_DURATION_MS = 4 * 60 * 60 * 1000

/**
 * 「辛苦了」总开关。
 * §7 明确：时间 ≠ 工作状态，该文案必须依赖真实 Session / Activity Context，
 * 且 §7 末 / §28 均要求 MVP 不实现。因此 MVP 恒为 false，
 * 下方判定条件作为第二阶段接入 SessionContext 后的实现草案保留。
 */
const HARD_WORK_ENABLED = false

/**
 * 由本地时间解析时间问候类型（§5.1 / §14：使用本地时间，禁止 Date.UTC）。
 * 按「当日 0 点起的分钟数」比较，因此支持 11:30 这类非整点边界；
 * 00:00–04:59 落在所有区间起点之前，回退为 lateNight。
 */
export function resolveTimeGreetingType(now: Date): TimeGreetingType {
  const minutes = now.getHours() * 60 + now.getMinutes()
  let type: TimeGreetingType = LATE_NIGHT_GREETING_TYPE
  for (const range of TIME_GREETING_RANGES) {
    if (minutes >= rangeStartMinutes(range)) type = range.type
  }
  return type
}

/**
 * 距离下一个时间边界还有多少毫秒（§16）。
 * 边界为 00:00 / 05:00 / 11:30 / 14:00 / 18:00（派生自 TIME_GREETING_RANGES）。
 */
export function msUntilNextBoundary(now: Date): number {
  const time = now.getTime()
  for (const boundary of TIME_BOUNDARY_MINUTES) {
    const at = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      Math.floor(boundary / 60),
      boundary % 60,
      0,
      0,
    ).getTime()
    if (at > time) return at - time
  }
  // 当天所有边界已过（18:00 之后）→ 次日 0 点。交给 Date 归一化，自动处理跨月/跨年
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime() - time
}

/**
 * 解析当前应展示的问候语。
 *
 * 时间问候始终作为兜底候选存在，因此返回值永不为空；
 * 第二阶段候选（welcomeBack / hardWork）仅在上下文明确满足时进入候选集。
 */
export function resolveGreeting(context: GreetingContext): GreetingResult {
  const settings = normalizeSettings(context.settings)

  const candidates: GreetingType[] = [resolveTimeGreetingType(context.now)]

  // 第二阶段（§6）：首次启动 / 从后台恢复 → 欢迎回来（优先级 100，覆盖时间问候）
  if (context.isFirstLaunchToday || context.isReturningFromBackground) {
    candidates.push('welcomeBack')
  }
  // 第二阶段（§7）：真实活跃时长驱动的「辛苦了」
  if (isHardWorkContext(context)) {
    candidates.push('hardWork')
  }

  const type = pickHighestPriority(candidates)
  return {
    type,
    text: withUserName(resolveGreetingText(type), context, settings),
    priority: GREETING_PRIORITY[type],
  }
}

/** 配置项逐键回退默认值（不用展开合并，避免显式 undefined 覆盖默认值） */
function normalizeSettings(settings?: Partial<GreetingSettings>): GreetingSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_GREETING_SETTINGS.enabled,
    showUserName: settings?.showUserName ?? DEFAULT_GREETING_SETTINGS.showUserName,
    useLocalTime: settings?.useLocalTime ?? DEFAULT_GREETING_SETTINGS.useLocalTime,
  }
}

/**
 * 取优先级最高的候选；同优先级保留先出现者（稳定排序），保证结果可预测。
 * 时间问候彼此互斥，不会同时进入候选集，因此不存在同级竞争。
 */
function pickHighestPriority(candidates: GreetingType[]): GreetingType {
  let best = candidates[0]
  for (const type of candidates) {
    if (GREETING_PRIORITY[type] > GREETING_PRIORITY[best]) best = type
  }
  return best
}

/**
 * 「辛苦了」判定草案（§7）。
 * 条件：连续活跃 > 4h 且当前会话活跃。MVP 由 HARD_WORK_ENABLED 关闭，
 * 且此时 activeDuration / sessionActive 由 UI 层传入，不由 Resolver 自行推断。
 */
function isHardWorkContext(context: GreetingContext): boolean {
  if (!HARD_WORK_ENABLED) return false
  return (
    (context.activeDuration ?? 0) > HARD_WORK_ACTIVE_DURATION_MS && context.sessionActive === true
  )
}

/** 按 §3.1 / §13 拼接用户名：空间足够时为「下午好，志旭」，默认关闭 */
function withUserName(text: string, context: GreetingContext, settings: GreetingSettings): string {
  if (!settings.showUserName) return text
  const username = context.username?.trim()
  return username ? `${text}，${username}` : text
}
