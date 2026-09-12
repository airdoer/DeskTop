import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FOLDER_YELLOW, NAV_ICON_COLORS } from '@/components/ui/brandColors'

/*
 * 侧边栏图标识别色的约束测试.
 *
 * 这组色是为「16px 线性图标（1.5px stroke）在浅底上可读」而专门挑的，
 *   而不是审美偏好——所以「可读」这条约束必须被锁住，否则后续随手换个更鲜艳的色
 *   就会把某个页签变成看不见的浅色描边（FOLDER_YELLOW #F8D775 就是这么翻车的）。
 *
 * 底色不硬编码：直接从 src/index.css 的 @theme 里读，
 *   这样谁改了 surface-sidebar / surface-active，测试会立刻发现对比度塌了。
 */

const CSS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'index.css',
)
const CSS = readFileSync(CSS_PATH, 'utf8')

/** 从 index.css 读设计 token 的十六进制值（读不到直接失败，避免测试静默变成空断言） */
function cssVar(name: string): string {
  const match = CSS.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`))
  if (!match) throw new Error(`src/index.css 中找不到 --${name} 的十六进制值`)
  return match[1]
}

function channels(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
}

/** WCAG 2.1 相对亮度 */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG 2.1 对比度，范围 1:1 ~ 21:1 */
function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter + 0.05) / (darker + 0.05)
}

/** 图标实际会落到的三种侧边栏底色：常态 / 激活 / 悬停 */
const SIDEBAR_BACKGROUNDS = [
  ['surface-sidebar（常态）', cssVar('color-surface-sidebar')],
  ['surface-active（激活）', cssVar('color-surface-active')],
  ['surface-hover（悬停）', cssVar('color-surface-hover')],
] as const

describe('NAV_ICON_COLORS', () => {
  it('全部为 6 位十六进制（inline style 直接使用，写错不会被类型系统拦住）', () => {
    for (const [key, color] of Object.entries(NAV_ICON_COLORS)) {
      expect(color, key).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('对侧边栏的每种底色都满足 WCAG 非文本对比度 3:1', () => {
    for (const [key, color] of Object.entries(NAV_ICON_COLORS)) {
      for (const [label, background] of SIDEBAR_BACKGROUNDS) {
        expect(
          contrast(color, background),
          `${key} ${color} 在 ${label} ${background} 上对比度不足`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('两两不同（重复色会让两个页签看起来是同一个功能）', () => {
    const colors = Object.values(NAV_ICON_COLORS)
    expect(new Set(colors).size).toBe(colors.length)
  })

  it('确实不能直接用面板标题的品牌色：FOLDER_YELLOW 在侧边栏底上不达标', () => {
    // 这条断言记录「为什么需要单独一套色」，防止有人为省事把 NAV_ICON_COLORS 合并回品牌色
    expect(contrast(FOLDER_YELLOW, cssVar('color-surface-sidebar'))).toBeLessThan(3)
  })
})
