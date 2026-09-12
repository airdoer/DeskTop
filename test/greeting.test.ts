import { describe, expect, it } from 'vitest'
import {
  greetingMessages,
  rangeStartMinutes,
  TIME_BOUNDARY_MINUTES,
  TIME_GREETING_RANGES,
} from '@/features/greeting/greeting.config'
import { msUntilNextBoundary, resolveGreeting, resolveTimeGreetingType } from '@/features/greeting/GreetingResolver'
import type { GreetingType } from '@/features/greeting/greeting.types'

/*
 * Greeting 单测：docs/GREETING_SPEC.md §23（时间边界必须覆盖）、§10（优先级）、§7（MVP 不产生「辛苦了」）。
 * 不依赖真实系统时间：全部通过显式传入 now 构造。
 */

/** 本地时间构造（§14：必须本地时间，不使用 UTC） */
function at(hour: number, minute = 0, second = 0, ms = 0): Date {
  return new Date(2026, 8, 11, hour, minute, second, ms)
}

/** 用同一套固定时间点跑一遍解析，只取问候类型 */
function typeAt(hour: number, minute = 0, second = 0): string {
  return resolveTimeGreetingType(at(hour, minute, second))
}

describe('时间区间 → 问候类型（§5.1 / §23 边界表）', () => {
  const cases: Array<[string, string]> = [
    ['00:00', 'lateNight'],
    ['04:59', 'lateNight'],
    ['05:00', 'morning'],
    ['11:29', 'morning'],
    ['11:30', 'noon'],
    ['12:10', 'noon'],
    ['13:59', 'noon'],
    ['14:00', 'afternoon'],
    ['17:59', 'afternoon'],
    ['18:00', 'evening'],
    ['23:59', 'evening'],
  ]

  it.each(cases)('%s → %s', (time, expected) => {
    const [hour, minute] = time.split(':').map(Number)
    expect(typeAt(hour, minute)).toBe(expected)
  })

  it('中午为 11:30–13:59（非整点起点）：11:29:59 仍是上午，13:59:59 仍是中午', () => {
    expect(typeAt(11, 29, 59)).toBe('morning')
    expect(typeAt(11, 30, 0)).toBe('noon')
    expect(typeAt(13, 59, 59)).toBe('noon')
    expect(typeAt(14, 0, 0)).toBe('afternoon')
  })

  it('00:00 属于跨零点区间，落在 04:59 之后而不是 05:00 之前', () => {
    expect(typeAt(0, 0)).toBe('lateNight')
    expect(typeAt(0, 1)).toBe('lateNight')
    expect(typeAt(23, 59, 59)).toBe('evening')
  })

  it('24 小时内任意时刻都有非空问候文案（§2.1：问候语是兜底信息，不允许缺失）', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const result = resolveGreeting({
        now: at(hour),
        isFirstLaunchToday: false,
        isReturningFromBackground: false,
      })
      expect(result.text).not.toBe('')
      expect(result.priority).toBe(10)
    }
  })
})

describe('resolveGreeting 优先级（§10）', () => {
  it('默认返回时间问候，文案与优先级符合 §9 示例（下午取 14:00–17:59）', () => {
    expect(
      resolveGreeting({
        now: at(15),
        isFirstLaunchToday: false,
        isReturningFromBackground: false,
      }),
    ).toEqual({ type: 'afternoon', text: '下午好', priority: 10 })
  })

  it('12:10 属于中午区间 → 中午好（用户明确要求 11:30–14:00 为中午）', () => {
    expect(
      resolveGreeting({
        now: at(12, 10),
        isFirstLaunchToday: false,
        isReturningFromBackground: false,
      }),
    ).toEqual({ type: 'noon', text: '中午好', priority: 10 })
  })

  it('当天首次启动 / 从后台恢复 → 欢迎回来，优先级 100 覆盖时间问候', () => {
    for (const flag of ['isFirstLaunchToday', 'isReturningFromBackground'] as const) {
      const result = resolveGreeting({
        now: at(9),
        isFirstLaunchToday: flag === 'isFirstLaunchToday',
        isReturningFromBackground: flag === 'isReturningFromBackground',
      })
      expect(result).toEqual({ type: 'welcomeBack', text: '欢迎回来', priority: 100 })
    }
  })

  it('MVP 不产生「辛苦了」：即使传入长活跃时长也不出现（§7 / §28）', () => {
    const result = resolveGreeting({
      now: at(23),
      isFirstLaunchToday: false,
      isReturningFromBackground: false,
      activeDuration: 12 * 60 * 60 * 1000,
      sessionActive: true,
    })
    expect(result.type).toBe('evening')
    expect(result.text).not.toBe('辛苦了')
  })
})

describe('GreetingSettings（§21）', () => {
  const base = { now: at(15), isFirstLaunchToday: false, isReturningFromBackground: false }

  it('showUserName 默认关闭，开启且用户名非空时拼接为「下午好，志旭」', () => {
    expect(resolveGreeting({ ...base, username: '志旭' }).text).toBe('下午好')

    expect(resolveGreeting({ ...base, username: '志旭', settings: { showUserName: true } }).text).toBe(
      '下午好，志旭',
    )
  })

  it('开启 showUserName 但用户名为空/空白时不留下多余标点', () => {
    const settings = { showUserName: true }
    expect(resolveGreeting({ ...base, settings }).text).toBe('下午好')
    expect(resolveGreeting({ ...base, username: '   ', settings }).text).toBe('下午好')
  })

  it('未显式提供的配置项回退默认值，不会被 undefined 覆盖', () => {
    expect(
      resolveGreeting({ ...base, settings: { showUserName: undefined } }).text,
    ).toBe('下午好')
  })
})

describe('msUntilNextBoundary（§16 时间跨越）', () => {
  it('11:29:50 距 11:30 中午边界还有 10 秒', () => {
    expect(msUntilNextBoundary(at(11, 29, 50))).toBe(10_000)
  })

  it('恰好落在边界上时指向下一个边界，避免重复触发', () => {
    expect(msUntilNextBoundary(at(11, 30, 0))).toBe(2.5 * 60 * 60 * 1000)
    expect(msUntilNextBoundary(at(14, 0, 0))).toBe(4 * 60 * 60 * 1000)
    expect(msUntilNextBoundary(at(0, 0, 0))).toBe(5 * 60 * 60 * 1000)
  })

  it('中午期间指向下一个边界 14:00', () => {
    expect(msUntilNextBoundary(at(12, 10))).toBe((14 * 60 - (12 * 60 + 10)) * 60 * 1000)
  })

  it('当天最后一个边界之后指向次日 0 点', () => {
    expect(msUntilNextBoundary(at(23, 59, 59))).toBe(1_000)
  })

  it('毫秒级精度：04:59:59.500 距 05:00 还有 500ms', () => {
    expect(msUntilNextBoundary(at(4, 59, 59, 500))).toBe(500)
  })

  it('边界分钟数派生自时间区间，新增/调整区间时自动跟随', () => {
    expect(TIME_BOUNDARY_MINUTES).toEqual([0, ...TIME_GREETING_RANGES.map(rangeStartMinutes)])
    expect(TIME_BOUNDARY_MINUTES).toEqual([0, 5 * 60, 11 * 60 + 30, 14 * 60, 18 * 60])
  })
})

describe('文案配置（§11 / §22）', () => {
  it('每种 GreetingType 在每种语言下都有文案', () => {
    const types: GreetingType[] = [
      'morning',
      'noon',
      'afternoon',
      'evening',
      'lateNight',
      'welcomeBack',
      'hardWork',
    ]
    for (const locale of ['zh-CN', 'en'] as const) {
      for (const type of types) {
        expect(greetingMessages[locale][type]).toBeTruthy()
      }
    }
  })
})
