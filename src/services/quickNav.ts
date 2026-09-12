/*
 * quickNav Service — 全局快捷跳转（Command Palette）的纯逻辑.
 * 依据 docs/UI_DESIGN_SYSTEM.md §22 Keyboard Interaction / §23 Command Palette：
 *   Ctrl+K 唤起 → 输入关键词 → ↑/↓ 选择 → Enter 跳转 → Esc 关闭。
 *
 * 本模块只负责「匹配 + 打分 + 高亮切分 + 索引循环 + 快捷键判定」，
 *   不依赖 React、不感知菜单树与路由实现——数据源由调用方注入，
 *   因此可被单测直接覆盖（见 test/quick-nav.test.ts）。
 */

/** 参与匹配的候选项最小形状 */
export interface QuickNavCandidate {
  /** 主标题（菜单名）：匹配与高亮都基于它 */
  label: string
  /** 面包屑（所属分组路径）：权重低于标题，但可命中，便于按分组名检索 */
  crumb?: string
  /** 附加检索词（路由 id、别名等）：只参与匹配，不参与高亮 */
  keywords?: string
}

/** 高亮片段：hit=true 的片段是关键词命中处 */
export interface HighlightSegment {
  text: string
  hit: boolean
}

export interface QuickNavMatch<T> {
  item: T
  score: number
  labelSegments: HighlightSegment[]
}

/** 结果条数上限：菜单很多时避免一次渲染过多 DOM */
export const MAX_QUICK_NAV_RESULTS = 50

/** 统一的降噪取值：undefined / null 一律视为空串，避免 toLowerCase 抛错 */
export function toLower(value: unknown): string {
  return String(value ?? '').toLowerCase()
}

/** 关键词归一化：小写 + 去首尾空白；空关键词表示「不过滤」 */
export function normalizeKeyword(keyword: string): string {
  return toLower(keyword).trim()
}

/**
 * needle 的字符是否按顺序出现在 haystack 中（模糊匹配）。
 * 例：'pin' 可命中 'playerinfo'。
 * 仅对纯英文/数字/连字符输入启用——中文按连续子串匹配更符合直觉。
 */
export function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return false
  let cursor = 0
  for (let i = 0; i < haystack.length && cursor < needle.length; i += 1) {
    if (haystack[i] === needle[cursor]) cursor += 1
  }
  return cursor === needle.length
}

/**
 * 把文本按命中的关键词切分为若干片段，用于高亮渲染。
 * 大小写不敏感，只高亮第一处命中。
 */
export function splitHighlight(text: string, keyword: string): HighlightSegment[] {
  const raw = String(text ?? '')
  const kw = normalizeKeyword(keyword)
  if (!kw) return [{ text: raw, hit: false }]

  const idx = toLower(raw).indexOf(kw)
  if (idx < 0) return [{ text: raw, hit: false }]

  const segments: HighlightSegment[] = []
  if (idx > 0) segments.push({ text: raw.slice(0, idx), hit: false })
  segments.push({ text: raw.slice(idx, idx + kw.length), hit: true })
  if (idx + kw.length < raw.length) segments.push({ text: raw.slice(idx + kw.length), hit: false })
  return segments
}

/**
 * 相关度打分，返回 -1 表示不匹配。
 * 优先级（高 → 低）：完全相等 > 标题前缀 > 标题包含 > 附加关键词 > 面包屑包含 > 标题模糊顺序匹配。
 * 同档内命中位置越靠前得分越高（- Math.min(idx, 100) 保证档位之间不会互相越界）。
 */
export function scoreCandidate(candidate: QuickNavCandidate, keyword: string): number {
  const kw = normalizeKeyword(keyword)
  if (!kw) return 0

  const label = toLower(candidate.label)
  const crumb = toLower(candidate.crumb)
  const keywords = toLower(candidate.keywords)

  if (label === kw) return 1000
  if (label.startsWith(kw)) return 900

  const labelIdx = label.indexOf(kw)
  if (labelIdx >= 0) return 800 - Math.min(labelIdx, 100)

  if (keywords && keywords.indexOf(kw) >= 0) return 700

  const crumbIdx = crumb.indexOf(kw)
  if (crumbIdx >= 0) return 600 - Math.min(crumbIdx, 100)

  if (/^[a-z0-9-]+$/.test(kw) && isSubsequence(kw, label)) return 300
  return -1
}

/**
 * 检索入口：空关键词返回全部条目（保持声明顺序，与侧边栏一致），
 * 有关键词则按相关度降序（同分保持声明顺序，依赖 Array#sort 的稳定性）。
 */
export function searchQuickNav<T extends QuickNavCandidate>(
  items: readonly T[],
  keyword: string,
  maxResults: number = MAX_QUICK_NAV_RESULTS,
): QuickNavMatch<T>[] {
  const kw = normalizeKeyword(keyword)
  const matched: QuickNavMatch<T>[] = []

  for (const item of items) {
    const score = kw ? scoreCandidate(item, kw) : 0
    if (kw && score < 0) continue
    matched.push({ item, score, labelSegments: splitHighlight(item.label, kw) })
  }

  if (kw) matched.sort((a, b) => b.score - a.score)
  return matched.slice(0, Math.max(0, maxResults))
}

/** ↑/↓ 在结果列表内循环移动；无结果时归零 */
export function moveActiveIndex(current: number, total: number, step: number): number {
  if (total <= 0) return 0
  const next = current + step
  if (next < 0) return total - 1
  if (next >= total) return 0
  return next
}

/** 快捷键事件的最小形状（便于单测直接构造，无需真实 KeyboardEvent） */
export interface HotkeyLikeEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}

/**
 * 是否命中「唤起快捷跳转」的快捷键：Ctrl/⌘ + K。
 * 排除 Ctrl+Shift+K（DevTools 控制台）与带 Alt 的组合。
 *
 * 不额外支持 Ctrl+Space：中文输入法普遍占用该组合（切换输入法），
 *   在中文环境下会表现为「时灵时不灵」，收益低于干扰，故不做绑定。
 */
export function isQuickNavHotkey(event: HotkeyLikeEvent): boolean {
  if (!event.ctrlKey && !event.metaKey) return false
  if (event.altKey || event.shiftKey) return false
  return toLower(event.key) === 'k'
}
