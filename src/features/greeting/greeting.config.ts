/*
 * Greeting Domain — 配置（时间区间 / 优先级 / 文案 / 默认设置）.
 * 依据 docs/GREETING_SPEC.md §5.1、§10、§11、§21、§22。
 *
 * 文案不硬编码在 React Component 中（§11）：统一收敛到本文件的 greetingMessages。
 * 单一数据源原则：新增时间区间只改 TIME_GREETING_RANGES，时间边界与定时器自动跟随。
 */

import type { GreetingSettings, GreetingType, TimeGreetingType } from './greeting.types'

/**
 * 时间区间 → 时间问候。startHour / startMinute 为区间起点（含），必须按升序排列。
 * §5.1：05:00–11:29 上午好 / 11:30–13:59 中午好 / 14:00–17:59 下午好 / 18:00–23:59 晚上好。
 *
 * 支持非整点边界（中午自 11:30 起），故用「时 + 分」而非整点小时。
 */
export const TIME_GREETING_RANGES: ReadonlyArray<{
  startHour: number
  startMinute: number
  type: TimeGreetingType
}> = [
  { startHour: 5, startMinute: 0, type: 'morning' },
  { startHour: 11, startMinute: 30, type: 'noon' },
  { startHour: 14, startMinute: 0, type: 'afternoon' },
  { startHour: 18, startMinute: 0, type: 'evening' },
]

/** 00:00–04:59（跨零点区间）的兜底问候。§5.1 明确它属于状态提示，不是「鼓励继续工作」 */
export const LATE_NIGHT_GREETING_TYPE: TimeGreetingType = 'lateNight'

/** 区间起点折算为「当日 0 点起的分钟数」，供比较与边界计算复用 */
export function rangeStartMinutes(range: { startHour: number; startMinute: number }): number {
  return range.startHour * 60 + range.startMinute
}

/**
 * 时间边界（当日 0 点起的分钟数，升序）：0 点 + 各区间起点 → [0, 330, 840, 1080]。
 * §16 用它计算「下一次需要重算问候语」的时刻；派生自 TIME_GREETING_RANGES，勿单独维护。
 */
export const TIME_BOUNDARY_MINUTES: readonly number[] = [
  0,
  ...TIME_GREETING_RANGES.map(rangeStartMinutes),
]

/** 优先级（§10）。时间类问候同级 10，上下文类问候更高，避免用 if/else 互相覆盖 */
export const GREETING_PRIORITY: Record<GreetingType, number> = {
  welcomeBack: 100,
  hardWork: 80,
  morning: 10,
  noon: 10,
  afternoon: 10,
  evening: 10,
  lateNight: 10,
}

/** MVP 默认设置（§21）：启用问候、不拼用户名、使用本地时间 */
export const DEFAULT_GREETING_SETTINGS: GreetingSettings = {
  enabled: true,
  showUserName: false,
  useLocalTime: true,
}

/**
 * 边界定时器的安全余量（ms）。
 * setTimeout 可能因时钟漂移/调度提前触发，若正好落在边界前 1ms 会读到旧时间；
 * 统一延后 1s 重算，代价是问候语最多晚 1s 切换（§16 允许）。
 */
export const GREETING_TIMER_GUARD_MS = 1000

/** 文案语言（§22）。MVP 只提供 zh-CN / en，未接入 i18n 库，见 resolveGreetingText 注释 */
export type GreetingLocale = 'zh-CN' | 'en'

export const DEFAULT_GREETING_LOCALE: GreetingLocale = 'zh-CN'

/**
 * 问候文案（§11）。
 * 结构等价于 §22 的 i18n resource（`greeting.<type>`），按 locale 分组。
 *
 * 说明：本项目当前未引入任何 i18n 库（package.json 无 i18next/react-i18next），
 * 且 docs/UI_DESIGN_SYSTEM.md §30 禁止 AI 自行引入新的 UI/依赖库。
 * 因此这里保留「按 locale 查表」的形状，等接入 i18n 后把 resolveGreetingText 内部
 * 换成 `i18n.t('greeting.' + type)` 即可，调用方无需改动。
 *
 * §11 的「同一类型多套文案」为未来扩展（数组 + Resolver 层选择），MVP 不需要随机文案，
 * 故此处保持单条字符串。
 */
export const greetingMessages: Record<GreetingLocale, Record<GreetingType, string>> = {
  'zh-CN': {
    morning: '上午好',
    noon: '中午好',
    afternoon: '下午好',
    evening: '晚上好',
    lateNight: '夜深了',
    welcomeBack: '欢迎回来',
    hardWork: '辛苦了',
  },
  // 英文没有与「中午」对应的独立问候语，noon 沿用 Good afternoon（非重复定义的笔误）
  en: {
    morning: 'Good morning',
    noon: 'Good afternoon',
    afternoon: 'Good afternoon',
    evening: 'Good evening',
    lateNight: "It's getting late",
    welcomeBack: 'Welcome back',
    hardWork: 'Nice work',
  },
}

/** 取问候文案；未知 locale 回退默认语言，保证 UI 不会出现空白文案 */
export function resolveGreetingText(
  type: GreetingType,
  locale: GreetingLocale = DEFAULT_GREETING_LOCALE,
): string {
  return greetingMessages[locale]?.[type] ?? greetingMessages[DEFAULT_GREETING_LOCALE][type]
}
