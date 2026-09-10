import { describe, it, expect } from 'vitest'
import {
  buildWebsiteLists,
  deriveWebsiteName,
  normalizeWebsiteUrl,
  orderOf,
  sortByOrder,
  type Website,
  type WebsiteConfig,
} from '../src/services/websites'
import { WEBSITE_PRESETS } from '@/features/websites/presets'
import { sanitizeWebsiteConfig, normalizeWebsiteUrl as normalizeUrlMain } from '../electron/main/websites'

/*
 * 常用网站：链接规范化 + 配置净化 + 可见/隐藏列表构建.
 * 背景：链接会进持久化数据并被 shell.openExternal 打开，必须限定 http/https，
 * 否则 javascript: 之类的协议会成为本地攻击面；隐藏/排序以站点 id 为键，
 * 内置清单新增站点时不能把用户既有设置打乱。
 */

const site = (id: string, extra: Partial<Website> = {}): Website => ({
  id,
  name: id,
  url: `https://${id}.example.com`,
  ...extra,
})

describe('normalizeWebsiteUrl', () => {
  it('缺少协议时补全 https', () => {
    expect(normalizeWebsiteUrl('docs.corp.kuaishou.com/home')).toBe(
      'https://docs.corp.kuaishou.com/home',
    )
  })

  it('保留既有 http/https 协议', () => {
    expect(normalizeWebsiteUrl('http://a.example.com/x')).toBe('http://a.example.com/x')
  })

  it('保留 hash 路由与查询串（企业站点多为 SPA）', () => {
    const url = 'https://ksgame-gm-c7.corp.kuaishou.com/#/AreaClothing/RegionalNew'
    expect(normalizeWebsiteUrl(url)).toBe(url)
  })

  it('拒绝非 http/https 协议与非法输入', () => {
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWebsiteUrl('file:///C:/Windows')).toBeNull()
    expect(normalizeWebsiteUrl('')).toBeNull()
    expect(normalizeWebsiteUrl('   ')).toBeNull()
  })

  /*
   * 中文输入法把 : / 输出为全角 ：／ 时，WHATWG URL 视全角冒号为非法主机字符并抛
   * Invalid URL，用户会遇到「填的是正常链接却提示无效」。这里折算为半角后应正常通过。
   */
  it('中文标点（全角冒号/斜杠/问号）自动折算为半角', () => {
    expect(normalizeWebsiteUrl('https：//www.baidu.com/')).toBe('https://www.baidu.com/')
    expect(normalizeWebsiteUrl('http：//www.baidu.com')).toBe('http://www.baidu.com/')
    expect(normalizeWebsiteUrl('https:／／www.baidu.com/')).toBe('https://www.baidu.com/')
    expect(normalizeWebsiteUrl('https://www.baidu.com/？wd=c7')).toBe(
      'https://www.baidu.com/?wd=c7',
    )
    expect(normalizeWebsiteUrl('https://www。baidu.com/')).toBe('https://www.baidu.com/')
  })

  it('清除粘贴常带的零宽字符与 BOM', () => {
    expect(normalizeWebsiteUrl('\uFEFFhttps://www.baidu.com/\u200B')).toBe(
      'https://www.baidu.com/',
    )
  })

  /*
   * 内网地址带端口时，冒号前那段不是协议：旧实现按「scheme:」判定会把 localhost:
   * 当成协议而拒绝，现在只在出现 :// 时才按原样判定。
   */
  it('内网 host:port 不再被误判为协议', () => {
    expect(normalizeWebsiteUrl('localhost:8080')).toBe('https://localhost:8080/')
    expect(normalizeWebsiteUrl('192.168.1.10:8080')).toBe('https://192.168.1.10:8080/')
    expect(normalizeWebsiteUrl('http://192.168.1.10:8080/admin')).toBe(
      'http://192.168.1.10:8080/admin',
    )
  })

  // 危险协议不能被「补 https://」的兜底路径放行
  it('危险协议在补协议兜底下仍被拒绝', () => {
    expect(normalizeWebsiteUrl('JavaScript:alert(1)')).toBeNull()
    expect(normalizeWebsiteUrl('data:text/html,<script>1</script>')).toBeNull()
  })

  // 渲染层与主进程两份实现必须行为一致，否则保存后会被主进程净化丢弃
  it('渲染层与主进程实现结果一致', () => {
    const samples = [
      'https://www.baidu.com/',
      'https：//www.baidu.com/',
      'http://www.baidu.com',
      'www.baidu.com',
      'localhost:8080',
      'javascript:alert(1)',
      'file:///C:/Windows',
      '',
    ]
    const fromRenderer = samples.map((s) => normalizeWebsiteUrl(s))
    const fromMain = samples.map((s) => normalizeUrlMain(s))
    expect(fromMain).toEqual(fromRenderer)
  })

  it('主进程实现同样折算全角标点', () => {
    expect(normalizeUrlMain('https：//www.baidu.com/')).toBe('https://www.baidu.com/')
    expect(normalizeUrlMain('localhost:8080')).toBe('https://localhost:8080/')
    expect(normalizeUrlMain(123 as unknown as string)).toBeNull()
  })

  /*
   * 兜底路径：严格解析（new URL）之外的宽容分支。
   * 站点链接打开前主进程还有一层 http/https 白名单，这里只需保证"形态正常就别拒"。
   */
  it('兜底：形态正常但严格解析失败时仍接受', () => {
    expect(normalizeWebsiteUrl('https://www.baidu.com/')).toBe('https://www.baidu.com/')
    expect(normalizeWebsiteUrl('http://www.baidu.com/')).toBe('http://www.baidu.com/')
    expect(normalizeWebsiteUrl('https://a.example.com:8443/x?y=1#z')).toBe(
      'https://a.example.com:8443/x?y=1#z',
    )
  })

  it('兜底不放松安全边界：危险协议、空白、畸形主机名仍拒绝', () => {
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeWebsiteUrl('file:///C:/Windows')).toBeNull()
    expect(normalizeWebsiteUrl('data:text/html,hi')).toBeNull()
    expect(normalizeWebsiteUrl('https://||')).toBeNull()
    expect(normalizeWebsiteUrl('   ')).toBeNull()
  })
})

describe('deriveWebsiteName', () => {
  it('取主机名并去掉 www 前缀', () => {
    expect(deriveWebsiteName('https://www.example.com/a/b')).toBe('example.com')
  })

  it('非法链接回退为原串，不抛异常', () => {
    expect(deriveWebsiteName('not-a-url')).toBe('not-a-url')
  })
})

describe('buildWebsiteLists', () => {
  const presets = [
    { id: 'a', name: 'A', url: 'https://a.com', badge: 'A', color: '#1677ff' },
    { id: 'b', name: 'B', url: 'https://b.com', badge: 'B', color: '#52c41a' },
  ]
  const config = (patch: Partial<WebsiteConfig> = {}): WebsiteConfig => ({
    order: [],
    hidden: [],
    custom: [],
    ...patch,
  })

  it('默认全部内置站点可见，顺序即清单顺序', () => {
    const { visible, hidden } = buildWebsiteLists(config(), presets)
    expect(visible.map((w) => w.id)).toEqual(['a', 'b'])
    expect(visible.every((w) => w.builtin)).toBe(true)
    expect(hidden).toHaveLength(0)
  })

  it('隐藏的站点从可见列表移入隐藏列表', () => {
    const { visible, hidden } = buildWebsiteLists(config({ hidden: ['a'] }), presets)
    expect(visible.map((w) => w.id)).toEqual(['b'])
    expect(hidden.map((w) => w.id)).toEqual(['a'])
  })

  it('自定义站点追加在内置站点之后，且标记为非内置', () => {
    const { visible } = buildWebsiteLists(
      config({ custom: [site('c'), site('d')] }),
      presets,
    )
    expect(visible.map((w) => w.id)).toEqual(['a', 'b', 'c', 'd'])
    expect(visible.filter((w) => !w.builtin).map((w) => w.id)).toEqual(['c', 'd'])
  })

  it('按 order 排序，未列入 order 的新站点追加在末尾', () => {
    const { visible } = buildWebsiteLists(
      config({ order: ['c', 'a'], custom: [site('c') ] }),
      presets,
    )
    expect(visible.map((w) => w.id)).toEqual(['c', 'a', 'b'])
  })

  it('自定义站点即使被列入 hidden 也不进隐藏区（删除即移除）', () => {
    const { visible, hidden } = buildWebsiteLists(
      config({ custom: [site('c')], hidden: ['c'] }),
      presets,
    )
    expect(visible.map((w) => w.id)).toEqual(['a', 'b'])
    expect(hidden).toHaveLength(0)
  })

  it('内置清单中已定义的站点全部带两字以内徽标与合法颜色', () => {
    for (const preset of WEBSITE_PRESETS) {
      expect(preset.badge.length).toBeLessThanOrEqual(2)
      expect(preset.badge.length).toBeGreaterThan(0)
      expect(preset.color).toMatch(/^#[0-9a-fA-F]{6}$/)
      expect(normalizeWebsiteUrl(preset.url)).toBeTruthy()
    }
  })

  it('内置站点 id 唯一（排序与隐藏以 id 为键）', () => {
    const ids = WEBSITE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('sortByOrder / orderOf', () => {
  it('orderOf 输出当前可见顺序，可直接回写配置', () => {
    expect(orderOf([site('x'), site('y')])).toEqual(['x', 'y'])
  })

  it('sortByOrder 对重复 id 只取首次出现的位置', () => {
    const list = [site('a'), site('b')]
    expect(sortByOrder(list, ['b', 'a', 'b']).map((w) => w.id)).toEqual(['b', 'a'])
  })
})

describe('sanitizeWebsiteConfig（Main Process 净化）', () => {
  it('非对象输入回退为空配置', () => {
    expect(sanitizeWebsiteConfig(null)).toEqual({ order: [], hidden: [], custom: [] })
  })

  it('id 列表去空白并去重', () => {
    const result = sanitizeWebsiteConfig({ order: [' a ', 'a', '', 1, 'b'] })
    expect(result.order).toEqual(['a', 'b'])
  })

  it('丢弃链接非法的自定义站点，合法的补全协议', () => {
    const result = sanitizeWebsiteConfig({
      custom: [
        { id: 'ok', name: 'OK', url: 'example.com' },
        { id: 'bad', name: 'Bad', url: 'javascript:alert(1)' },
        { id: 'empty', name: 'Empty', url: '' },
      ],
    })
    expect(result.custom).toHaveLength(1)
    expect(result.custom[0].url).toBe('https://example.com/')
  })

  it('限制徽标长度、校验颜色与名称长度', () => {
    const result = sanitizeWebsiteConfig({
      custom: [
        {
          id: 'x',
          name: 'x'.repeat(80),
          url: 'https://x.com',
          badge: 'ABCDE',
          color: 'red',
        },
      ],
    })
    expect(result.custom[0].badge).toBe('AB')
    expect(result.custom[0].name).toHaveLength(40)
    expect(result.custom[0].color).toBeUndefined()
  })

  it('主进程 URL 规范化与渲染层一致（仅放行 http/https）', () => {
    expect(normalizeUrlMain('a.example.com')).toBe('https://a.example.com/')
    expect(normalizeUrlMain('javascript:alert(1)')).toBeNull()
  })
})
