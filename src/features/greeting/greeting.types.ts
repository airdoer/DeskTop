/*
 * Greeting Domain — 类型定义.
 * 依据 docs/GREETING_SPEC.md §8.1（Type Definition）、§9（Resolver API）、§21（配置项）。
 *
 * 分层：GreetingContext（输入）→ resolveGreeting() → GreetingResult（输出）。
 * 本文件不依赖 React / Electron / DOM，可被纯单测覆盖（test/greeting.test.ts）。
 */

/** 时间问候：第一阶段（MVP）唯一实际产生的类型，区间见 §5.1 */
export type TimeGreetingType = 'morning' | 'noon' | 'afternoon' | 'evening' | 'lateNight'

/**
 * 全部问候类型（§8.1）。
 * welcomeBack / hardWork 属第二阶段 Session Context，MVP 不产生，类型与优先级先占位，
 * 以保证未来新增类型时不需要改动 UI 层（§10）。
 */
export type GreetingType = TimeGreetingType | 'welcomeBack' | 'hardWork'

export interface GreetingSettings {
  /** 是否启用问候语。由 UI 层（useGreeting）消费；Resolver 不读取该字段 */
  enabled: boolean
  /** 是否在问候语后拼接用户名（§3.1「下午好，志旭」）。MVP 默认 false */
  showUserName: boolean
  /** 是否使用操作系统本地时间（§14.1）。MVP 只有 system 一种来源，字段预留 */
  useLocalTime: boolean
}

export interface GreetingContext {
  /** 当前系统本地时间（§14：必须 getHours()，禁止 Date.UTC） */
  now: Date
  /** 当天首次启动（第二阶段 Session Context，§6） */
  isFirstLaunchToday: boolean
  /** 应用从后台恢复（第二阶段 Session Context，§6） */
  isReturningFromBackground: boolean
  /** 已连续活跃时长 ms，第二阶段「辛苦了」判定用（§7） */
  activeDuration?: number
  /** 当前会话是否活跃，第二阶段「辛苦了」判定用（§7） */
  sessionActive?: boolean
  /** 当前登录用户名，仅当 settings.showUserName 为 true 时拼接 */
  username?: string
  /** 问候语配置，缺省项回退 DEFAULT_GREETING_SETTINGS */
  settings?: Partial<GreetingSettings>
}

export interface GreetingResult {
  type: GreetingType
  text: string
  priority: number
}
