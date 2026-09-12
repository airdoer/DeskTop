import { describe, expect, it } from 'vitest'
import {
  isQuickNavHotkey,
  isSubsequence,
  moveActiveIndex,
  normalizeKeyword,
  scoreCandidate,
  searchQuickNav,
  splitHighlight,
  type QuickNavCandidate,
} from '@/services/quickNav'
import { buildQuickNavEntries, QUICK_NAV_ENTRIES } from '@/features/quick-nav/entries'
import { NAV_ITEMS, type NavItem, type RouteId } from '@/shell/navigation'

/*
 * 快捷跳转单测：覆盖 docs/UI_DESIGN_SYSTEM.md §22（Ctrl+K / Esc / Enter）与 §23（Command Palette）。
 * 纯逻辑（匹配、打分、高亮、索引、快捷键）全部直测；条目构建用可控的假菜单树，
 * 再对真实 NAV_ITEMS 做一次「不漏路由」的断言。
 */

/* ---------- 关键词归一化 ---------- */

describe('normalizeKeyword / toLower 语义', () => {
  it('去首尾空白并转小写', () => {
    expect(normalizeKeyword('  P4Merge  ')).toBe('p4merge')
  })

  it('空关键词归一化为空串（表示不过滤）', () => {
    expect(normalizeKeyword('   ')).toBe('')
  })
})

/* ---------- 模糊匹配 ---------- */

describe('isSubsequence', () => {
  it('字符按顺序出现即命中', () => {
    expect(isSubsequence('pin', 'playerinfo')).toBe(true)
    expect(isSubsequence('pm', 'p4-merge')).toBe(true)
  })

  it('顺序被打断则不命中', () => {
    expect(isSubsequence('nip', 'playerinfo')).toBe(false)
  })

  it('空 needle 不命中（避免空关键词把所有条目都算模糊命中）', () => {
    expect(isSubsequence('', 'playerinfo')).toBe(false)
  })
})

/* ---------- 高亮切分 ---------- */

describe('splitHighlight', () => {
  it('无关键词时整段非命中', () => {
    expect(splitHighlight('路径转换', '')).toEqual([{ text: '路径转换', hit: false }])
  })

  it('未命中时整段非命中', () => {
    expect(splitHighlight('路径转换', 'zzz')).toEqual([{ text: '路径转换', hit: false }])
  })

  it('命中在开头：只切两段', () => {
    expect(splitHighlight('路径转换', '路径')).toEqual([
      { text: '路径', hit: true },
      { text: '转换', hit: false },
    ])
  })

  it('命中在中部：切三段', () => {
    expect(splitHighlight('p4merge工具', 'merge')).toEqual([
      { text: 'p4', hit: false },
      { text: 'merge', hit: true },
      { text: '工具', hit: false },
    ])
  })

  it('命中在结尾：只切两段', () => {
    expect(splitHighlight('p4merge', 'merge')).toEqual([
      { text: 'p4', hit: false },
      { text: 'merge', hit: true },
    ])
  })

  it('大小写不敏感，且保留原文大小写', () => {
    expect(splitHighlight('P4Merge', 'merge')).toEqual([
      { text: 'P4', hit: false },
      { text: 'Merge', hit: true },
    ])
  })

  it('拼回所有片段等于原文（不丢字符）', () => {
    const segments = splitHighlight('跨分支 Merge 工具', 'merge')
    expect(segments.map((s) => s.text).join('')).toBe('跨分支 Merge 工具')
  })
})

/* ---------- 相关度打分 ---------- */

describe('scoreCandidate 档位', () => {
  const item: QuickNavCandidate = { label: 'p4merge', crumb: 'p4工具', keywords: 'p4-merge' }

  it('完全相等 > 前缀 > 包含', () => {
    expect(scoreCandidate(item, 'p4merge')).toBe(1000)
    expect(scoreCandidate(item, 'p4m')).toBe(900)
    expect(scoreCandidate(item, 'merg')).toBeGreaterThan(0)
    expect(scoreCandidate(item, 'merg')).toBeLessThan(900)
  })

  it('命中位置越靠前分越高', () => {
    const front = scoreCandidate({ label: 'abxxx' }, 'ab')
    const back = scoreCandidate({ label: 'xxxab' }, 'ab')
    expect(front).toBeGreaterThan(back)
  })

  it('标题命中优先级高于面包屑', () => {
    const titleHit = scoreCandidate({ label: 'p4工具', crumb: '其他' }, 'p4')
    const crumbHit = scoreCandidate({ label: '其他', crumb: 'p4工具' }, 'p4')
    expect(titleHit).toBeGreaterThan(crumbHit)
  })

  it('附加关键词（如路由 id）可命中，但权重低于标题', () => {
    const keywordHit = scoreCandidate({ label: '主页', keywords: 'home' }, 'home')
    const titleHit = scoreCandidate({ label: 'home' }, 'home')
    expect(keywordHit).toBeGreaterThan(0)
    expect(keywordHit).toBeLessThan(titleHit)
  })

  it('纯英文输入允许标题的模糊顺序匹配，中文不做模糊匹配', () => {
    expect(scoreCandidate({ label: 'p4-merge' }, 'pm')).toBe(300)
    // 中文按子串匹配：'转路' 不是 '路径转换' 的子串，且不进入模糊分支
    expect(scoreCandidate({ label: '路径转换' }, '转路')).toBe(-1)
  })

  it('不匹配返回 -1', () => {
    expect(scoreCandidate({ label: '主页' }, 'zzz')).toBe(-1)
  })
})

/* ---------- 检索与排序 ---------- */

interface FakeEntry extends QuickNavCandidate {
  id: string
}

const fakeEntries: FakeEntry[] = [
  { id: 'home', label: '主页', keywords: 'home' },
  { id: 'websites', label: '常用网站', keywords: 'websites' },
  { id: 'settings', label: '设置', keywords: 'settings' },
  { id: 'p4-update', label: 'p4更新', crumb: 'p4工具', keywords: 'p4-update' },
  { id: 'p4-merge', label: 'p4merge', crumb: 'p4工具', keywords: 'p4-merge' },
]

describe('searchQuickNav', () => {
  it('空关键词返回全部条目，且保持声明顺序（与侧边栏一致）', () => {
    const results = searchQuickNav(fakeEntries, '')
    expect(results.map((r) => r.item.id)).toEqual([
      'home',
      'websites',
      'settings',
      'p4-update',
      'p4-merge',
    ])
  })

  it('关键词过滤掉不匹配的条目', () => {
    const results = searchQuickNav(fakeEntries, 'p4')
    expect(results.map((r) => r.item.id)).toEqual(['p4-update', 'p4-merge'])
  })

  it('按分组名（面包屑）也能检索到子项', () => {
    const results = searchQuickNav(fakeEntries, 'p4工具')
    expect(results.map((r) => r.item.id)).toEqual(['p4-update', 'p4-merge'])
  })

  it('相关度降序：完全匹配排第一', () => {
    const results = searchQuickNav(fakeEntries, '设置')
    expect(results[0].item.id).toBe('settings')
  })

  it('同分条目保持声明顺序（排序稳定）', () => {
    const results = searchQuickNav(fakeEntries, 'p4工具')
    const scores = results.map((r) => r.score)
    expect(scores[0]).toBe(scores[1])
    expect(results.map((r) => r.item.id)).toEqual(['p4-update', 'p4-merge'])
  })

  it('每个结果都带高亮片段', () => {
    const results = searchQuickNav(fakeEntries, 'p4')
    expect(results[0].labelSegments.some((s) => s.hit)).toBe(true)
  })

  it('maxResults 截断结果条数', () => {
    expect(searchQuickNav(fakeEntries, '', 2)).toHaveLength(2)
    expect(searchQuickNav(fakeEntries, '', 0)).toHaveLength(0)
  })

  it('无匹配时返回空数组', () => {
    expect(searchQuickNav(fakeEntries, 'zzzzz')).toEqual([])
  })
})

/* ---------- 上下键索引循环 ---------- */

describe('moveActiveIndex', () => {
  it('常规移动', () => {
    expect(moveActiveIndex(0, 3, 1)).toBe(1)
    expect(moveActiveIndex(2, 3, -1)).toBe(1)
  })

  it('在两端循环', () => {
    expect(moveActiveIndex(2, 3, 1)).toBe(0)
    expect(moveActiveIndex(0, 3, -1)).toBe(2)
  })

  it('无结果时归零', () => {
    expect(moveActiveIndex(5, 0, 1)).toBe(0)
    expect(moveActiveIndex(5, 0, -1)).toBe(0)
  })
})

/* ---------- 快捷键 ---------- */

describe('isQuickNavHotkey（§22 Ctrl+K）', () => {
  it('Ctrl+K 与 ⌘+K 命中', () => {
    expect(isQuickNavHotkey({ key: 'k', ctrlKey: true })).toBe(true)
    expect(isQuickNavHotkey({ key: 'K', ctrlKey: true })).toBe(true)
    expect(isQuickNavHotkey({ key: 'k', metaKey: true })).toBe(true)
  })

  it('无修饰键的 k 不命中（不能吞掉正常输入）', () => {
    expect(isQuickNavHotkey({ key: 'k' })).toBe(false)
  })

  it('Ctrl+Shift+K 不命中（DevTools 控制台）', () => {
    expect(isQuickNavHotkey({ key: 'k', ctrlKey: true, shiftKey: true })).toBe(false)
  })

  it('带 Alt 的组合不命中', () => {
    expect(isQuickNavHotkey({ key: 'k', ctrlKey: true, altKey: true })).toBe(false)
  })

  it('其它按键不命中', () => {
    expect(isQuickNavHotkey({ key: 'j', ctrlKey: true })).toBe(false)
    expect(isQuickNavHotkey({ key: 'Enter', ctrlKey: true })).toBe(false)
  })
})

/* ---------- 条目构建 ---------- */

describe('buildQuickNavEntries', () => {
  const tree: NavItem[] = [
    { type: 'leaf', id: 'home', label: '主页', icon: () => null },
    {
      type: 'group',
      id: 'g',
      label: 'p4工具',
      icon: () => null,
      children: [
        { id: 'p4-update', label: 'p4更新', icon: () => null },
        { id: 'p4-merge', label: 'p4merge', icon: () => null },
      ],
    },
  ]

  it('只收录叶子节点（分组本身没有页面，不可跳转）', () => {
    expect(buildQuickNavEntries(tree).map((e) => e.id)).toEqual([
      'home',
      'p4-update',
      'p4-merge',
    ])
  })

  it('顶层条目 crumb 为空，子项 crumb 为所属分组名', () => {
    const entries = buildQuickNavEntries(tree)
    expect(entries[0].crumb).toBe('')
    expect(entries[1].crumb).toBe('p4工具')
  })

  it('keywords 含路由 id 与标题，便于用英文命中中文菜单', () => {
    const entries = buildQuickNavEntries(tree)
    expect(entries[1].keywords).toContain('p4-update')
    expect(entries[1].keywords).toContain('p4更新')
  })
})

describe('QUICK_NAV_ENTRIES（真实导航配置）', () => {
  /** 从 NAV_ITEMS 取出所有真实路由 id */
  function collectRouteIds(items: readonly NavItem[]): RouteId[] {
    return items.flatMap((item) =>
      item.type === 'leaf' ? [item.id] : item.children.map((child) => child.id),
    )
  }

  it('侧边栏每个可跳转路由都有对应条目（不漏路由）', () => {
    const expected = collectRouteIds(NAV_ITEMS).sort()
    const actual = QUICK_NAV_ENTRIES.map((entry) => entry.id).sort()
    expect(actual).toEqual(expected)
  })

  it('条目 id 唯一（React key 与 aria-activedescendant 都依赖唯一性）', () => {
    const ids = QUICK_NAV_ENTRIES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个条目都带图标与标题（浮层需要与侧边栏一致的视觉语言）', () => {
    for (const entry of QUICK_NAV_ENTRIES) {
      expect(entry.label.length).toBeGreaterThan(0)
      expect(typeof entry.icon).toBe('function')
    }
  })

  it('搜索「p4工具」能列出其下全部子项', () => {
    const results = searchQuickNav(QUICK_NAV_ENTRIES, 'p4工具')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((r) => r.item.crumb === 'p4工具')).toBe(true)
  })
})
