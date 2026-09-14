import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  buildIssueFilterParams,
  buildFilterWebUrl,
  buildIssueWebUrl,
  buildUserLookupUrl,
  fetchRedmineIssues,
  pickUserIdByLogin,
  type RedmineIssueFilter,
} from '../electron/main/redmine'
import {
  buildCopyDescriptionText,
  groupIssuesByVersion,
  formatHours,
  formatDate,
  formatDateShort,
  getVersionWeekLabel,
  priorityColor,
  REDMINE_FILTER_WEB_URL,
  stripLeadingBrackets,
  type RedmineIssue,
} from '../src/services/redmineIssues'

/*
 * Redmine 过滤参数 / 用户解析 / 分组 / 格式化 单元测试.
 * 覆盖 buildIssueFilterParams 的 f[]/op[]/v[] 语法、用户名→user_id 的接口解析、
 *   分组、工时/日期格式化、优先级着色，以及网页端筛选 URL 与用户提供的 URL 同构。
 */

const baseFilter: RedmineIssueFilter = {
  project: 'c7',
  userName: 'chenzhixu',
  userId: 1077,
  statusId: 7,
  excludeFixedVersionId: 223,
  sort: 'estimated_hours:desc,id:desc',
  limit: 100,
}

/*
 * 用户解析：原先是一张 1 条的硬编码映射（只有 chenzhixu），非 chenzhixu 的用户查不到单子。
 * 现改为按需调用 /users.json，下面锁定接口契约与几条实测踩到的规则。
 */
describe('buildUserLookupUrl', () => {
  it('指向 users.json，带 key / name / status / limit', () => {
    const url = new URL(buildUserLookupUrl('chenzhixu', 1))
    expect(url.pathname).toBe('/users.json')
    expect(url.searchParams.get('key')).toBeTruthy()
    expect(url.searchParams.get('name')).toBe('chenzhixu')
    expect(url.searchParams.get('status')).toBe('1')
    expect(url.searchParams.get('limit')).toBe('100')
  })

  it('status 只出现一次（重复传参时后者覆盖前者，必须逐个状态串行查询）', () => {
    const url = new URL(buildUserLookupUrl('chenzhixu', 3))
    expect(url.searchParams.getAll('status')).toEqual(['3'])
  })
})

describe('pickUserIdByLogin', () => {
  it('按 login 精确匹配，不取模糊命中的第一条', () => {
    // 实测 name=chen 命中 79 条，直接取第一条会拿到别人的 id
    const raw = {
      users: [
        { id: 590, login: 'chenchen36' },
        { id: 1077, login: 'chenzhixu' },
      ],
    }
    expect(pickUserIdByLogin(raw, 'chenzhixu')).toBe(1077)
  })

  it('模糊命中里没有本人时返回 null（不能退而求其次取第一条）', () => {
    expect(pickUserIdByLogin({ users: [{ id: 590, login: 'chenchen36' }] }, 'chenzhixu')).toBeNull()
  })

  it('login 大小写不敏感', () => {
    expect(pickUserIdByLogin({ users: [{ id: 1077, login: 'chenzhixu' }] }, 'ChenZhixu')).toBe(1077)
  })

  it('id 为字符串时也能解析', () => {
    expect(pickUserIdByLogin({ users: [{ id: '1077', login: 'chenzhixu' }] }, 'chenzhixu')).toBe(1077)
  })

  it('结构异常时返回 null', () => {
    expect(pickUserIdByLogin(null, 'chenzhixu')).toBeNull()
    expect(pickUserIdByLogin({}, 'chenzhixu')).toBeNull()
    expect(pickUserIdByLogin({ users: 'oops' }, 'chenzhixu')).toBeNull()
    expect(pickUserIdByLogin({ users: [null, 1, 'x'] }, 'chenzhixu')).toBeNull()
    expect(pickUserIdByLogin({ users: [{ id: 0, login: 'chenzhixu' }] }, 'chenzhixu')).toBeNull()
  })

  it('查询名为空时返回 null', () => {
    expect(pickUserIdByLogin({ users: [{ id: 1, login: 'chenzhixu' }] }, '   ')).toBeNull()
  })
})

describe('fetchRedmineIssues', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** 构造最小 Response 替身：只用到 ok/status/statusText/json */
  function jsonResponse(body: unknown, status = 200, statusText = 'OK') {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      json: async () => body,
    } as unknown as Response
  }

  it('用户名为空时不发请求，直接返回错误（不再回退到固定账号）', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const snapshot = await fetchRedmineIssues('   ')
    expect(snapshot.available).toBe(false)
    expect(snapshot.userId).toBeNull()
    expect(snapshot.error).toContain('未获取到登录用户名')
    expect(spy).not.toHaveBeenCalled()
  })

  it('查不到该登录名时给出明确错误', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ users: [], total_count: 0 })),
    )
    const snapshot = await fetchRedmineIssues('no_such_user_zzz')
    expect(snapshot.available).toBe(false)
    expect(snapshot.userId).toBeNull()
    expect(snapshot.error).toContain('找不到登录名为 no_such_user_zzz')
  })

  it('任意用户都能解析出 user_id 并查询到自己的单子', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('users.json')) {
          return jsonResponse({
            users: [
              { id: 590, login: 'wangjing6' },
              { id: 718, login: 'wangjing65' },
            ],
            total_count: 2,
          })
        }
        return jsonResponse({ issues: [{ id: 368799, subject: '导表检查功能' }], total_count: 1 })
      }),
    )

    const snapshot = await fetchRedmineIssues('wangjing65')
    expect(snapshot.available).toBe(true)
    expect(snapshot.userId).toBe(718)
    expect(snapshot.userName).toBe('wangjing65')
    expect(snapshot.issues.map((i) => i.id)).toEqual([368799])
    // 第一次是用户查询（活跃状态），第二次的单子查询带上解析出的 user_id
    expect(calls).toHaveLength(2)
    expect(calls[0]).toContain('users.json')
    expect(calls[0]).toContain('status=1')
    expect(calls[1]).toContain('v%5Bassigned_to_id%5D%5B%5D=718')
  })

  it('活跃状态查不到时回退查停用状态（停用账号仍能看到自己的单子）', async () => {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('users.json')) {
          if (url.includes('status=1')) return jsonResponse({ users: [], total_count: 0 })
          if (url.includes('status=3')) {
            return jsonResponse({ users: [{ id: 544, login: 'hantao03' }], total_count: 1 })
          }
          return jsonResponse({ users: [], total_count: 0 })
        }
        return jsonResponse({ issues: [], total_count: 0 })
      }),
    )

    const snapshot = await fetchRedmineIssues('hantao03')
    expect(snapshot.available).toBe(true)
    expect(snapshot.userId).toBe(544)
    const lookups = calls.filter((c) => c.includes('users.json'))
    expect(lookups).toHaveLength(2)
    expect(lookups[0]).toContain('status=1')
    expect(lookups[1]).toContain('status=3')
  })

  it('用户查询遇 403 时点明需要管理员权限，而不是误报成「查无此人」', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({}, 403, 'Forbidden')),
    )
    const snapshot = await fetchRedmineIssues('forbidden_probe')
    expect(snapshot.available).toBe(false)
    expect(snapshot.error).toContain('403')
    expect(snapshot.error).toContain('管理员权限')
  })

  it('单子查询失败时保留已解析出的 userId，便于定位', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input)
        if (url.includes('users.json')) {
          return jsonResponse({ users: [{ id: 1234, login: 'issues_fail_probe' }], total_count: 1 })
        }
        return jsonResponse({}, 500, 'Internal Server Error')
      }),
    )
    const snapshot = await fetchRedmineIssues('issues_fail_probe')
    expect(snapshot.available).toBe(false)
    expect(snapshot.userId).toBe(1234)
    expect(snapshot.error).toContain('500')
  })
})

describe('buildIssueFilterParams', () => {
  it('包含项目、分组、排序、limit 等基础参数', () => {
    const params = buildIssueFilterParams(baseFilter)
    expect(params.get('project_id')).toBe('c7')
    expect(params.get('group_by')).toBe('fixed_version')
    expect(params.get('sort')).toBe('estimated_hours:desc,id:desc')
    expect(params.get('limit')).toBe('100')
    expect(params.get('offset')).toBe('0')
    // API Key 不应暴露在渲染层，但主进程构造的 URL 必须包含
    expect(params.get('key')).toBeTruthy()
  })

  it('status_id 用 = 操作符与值 7', () => {
    const params = buildIssueFilterParams(baseFilter)
    expect(params.getAll('f[]')).toContain('status_id')
    expect(params.get('op[status_id]')).toBe('=')
    expect(params.getAll('v[status_id][]')).toContain('7')
  })

  it('assigned_to_id 用 = 操作符与具体 user_id（不用 me）', () => {
    const params = buildIssueFilterParams(baseFilter)
    expect(params.getAll('f[]')).toContain('assigned_to_id')
    expect(params.get('op[assigned_to_id]')).toBe('=')
    expect(params.getAll('v[assigned_to_id][]')).toContain('1077')
    // 不应包含 "me"，避免依赖 API Key 持有者身份
    expect(params.getAll('v[assigned_to_id][]')).not.toContain('me')
  })

  it('fixed_version_id 用 ! 操作符表示「不等于」223', () => {
    const params = buildIssueFilterParams(baseFilter)
    expect(params.getAll('f[]')).toContain('fixed_version_id')
    expect(params.get('op[fixed_version_id]')).toBe('!')
    expect(params.getAll('v[fixed_version_id][]')).toContain('223')
  })

  it('userId 为 null 时跳过 assigned_to_id 过滤', () => {
    const params = buildIssueFilterParams({ ...baseFilter, userId: null })
    expect(params.getAll('f[]')).not.toContain('assigned_to_id')
    expect(params.get('op[assigned_to_id]')).toBeNull()
  })
})

describe('buildFilterWebUrl', () => {
  it('与用户提供的筛选 URL 同构（同列、同操作符、同值）', () => {
    const url = buildFilterWebUrl(baseFilter)
    expect(url.startsWith('https://')).toBe(true)
    expect(url).toContain('/c7/issues?')
    expect(url).toContain('set_filter=1')
    expect(url).toContain('group_by=fixed_version')
    expect(url).toContain('sort=estimated_hours%3Adesc%2Cid%3Adesc')
    // 用户提供的列集
    for (const col of [
      'id',
      'tracker',
      'priority',
      'subject',
      'fixed_version',
      'estimated_hours',
      'created_on',
      'assigned_to',
      'cf_40',
      'status',
      'parent.subject',
      'start_date',
      'due_date',
      'author',
    ]) {
      expect(url).toContain(`c%5B%5D=${encodeURIComponent(col)}`)
    }
    expect(url).toContain('op%5Bstatus_id%5D=%3D')
    expect(url).toContain('op%5Bassigned_to_id%5D=%3D')
    expect(url).toContain('op%5Bfixed_version_id%5D=%21')
    expect(url).toContain('v%5Bstatus_id%5D%5B%5D=7')
    expect(url).toContain('v%5Bassigned_to_id%5D%5B%5D=1077')
    expect(url).toContain('v%5Bfixed_version_id%5D%5B%5D=223')
  })
})

describe('groupIssuesByVersion', () => {
  const mkIssue = (id: number, fvId?: number, fvName?: string): RedmineIssue => ({
    id,
    fixed_version:
      fvId !== undefined ? { id: fvId, name: fvName ?? `v${fvId}` } : null,
  })

  it('按 fixed_version 分组，无版本归到「（无版本）」', () => {
    const groups = groupIssuesByVersion([
      mkIssue(1, 10, 'v10'),
      mkIssue(2),
      mkIssue(3, 10, 'v10'),
      mkIssue(4, 20, 'v20'),
    ])
    expect(groups).toHaveLength(3)
    const v10 = groups.find((g) => g.versionId === 10)
    expect(v10?.issues.map((i) => i.id)).toEqual([1, 3])
    const none = groups.find((g) => g.versionId === null)
    expect(none?.label).toBe('（无版本）')
    expect(none?.issues.map((i) => i.id)).toEqual([2])
  })

  it('空列表返回空数组', () => {
    expect(groupIssuesByVersion([])).toEqual([])
  })
})

describe('formatHours', () => {
  it('数值后缀 h', () => {
    expect(formatHours(1.5)).toBe('1.5h')
    expect(formatHours(0)).toBe('0h')
  })

  it('null/undefined 返回 —', () => {
    expect(formatHours(null)).toBe('—')
    expect(formatHours(undefined)).toBe('—')
  })
})

describe('formatDate', () => {
  it('截取 ISO 日期前 10 位', () => {
    expect(formatDate('2024-09-10T18:52:01Z')).toBe('2024-09-10')
  })

  it('空值返回 —', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate(undefined)).toBe('—')
    expect(formatDate('')).toBe('—')
  })
})

describe('priorityColor', () => {
  it('高优先级映射为橙红', () => {
    expect(priorityColor('高')).toBe('#e67e22')
    expect(priorityColor('紧急')).toBe('#e74c3c')
  })

  it('一般优先级映射为灰', () => {
    expect(priorityColor('一般')).toBe('#595959')
  })

  it('未知优先级降级为灰', () => {
    expect(priorityColor('未知')).toBe('#595959')
    expect(priorityColor(undefined)).toBe('#595959')
  })
})

describe('REDMINE_FILTER_WEB_URL', () => {
  it('是用户提供的固定链接，路径含 /1007/projects/c7/issues', () => {
    expect(REDMINE_FILTER_WEB_URL).toContain('/1007/projects/c7/issues')
  })

  it('assigned_to_id 用 me（不依赖具体 user_id，避免权限问题）', () => {
    const params = new URL(REDMINE_FILTER_WEB_URL).searchParams
    expect(params.getAll('v[assigned_to_id][]')).toEqual(['me'])
    expect(params.getAll('v[status_id][]')).toEqual(['7'])
    expect(params.getAll('v[fixed_version_id][]')).toEqual(['223'])
    expect(params.get('op[status_id]')).toBe('=')
    expect(params.get('op[assigned_to_id]')).toBe('=')
    expect(params.get('op[fixed_version_id]')).toBe('!')
  })

  it('包含全部列与排序、分组参数', () => {
    const params = new URL(REDMINE_FILTER_WEB_URL).searchParams
    expect(params.get('set_filter')).toBe('1')
    expect(params.get('group_by')).toBe('fixed_version')
    expect(params.get('sort')).toBe('estimated_hours:desc,id:desc')
    expect(params.getAll('c[]')).toContain('id')
    expect(params.getAll('c[]')).toContain('cf_40')
    expect(params.getAll('c[]')).toContain('parent.subject')
  })
})

describe('buildIssueWebUrl', () => {
  it('链接格式为 /1007/projects/c7/issues/{id}', () => {
    const url = buildIssueWebUrl(368799)
    expect(url).toBe('https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues/368799')
  })

  it('不同 id 拼接正确', () => {
    expect(buildIssueWebUrl(123)).toBe('https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues/123')
  })
})

describe('getVersionWeekLabel', () => {
  // 以 2026-09-10（周四）为今天：当周版本 09-10~09-16，下周版本 09-17~09-23
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('版本起始在当周版本范围返回「当周」', () => {
    expect(getVersionWeekLabel('26/9/10-26/9/16 (S1.3验收配置截止/拉分支）')).toBe('当周')
    expect(getVersionWeekLabel('26/9/10-26/9/16')).toBe('当周')
  })

  it('版本起始在下周版本范围返回「下周」', () => {
    expect(getVersionWeekLabel('26/9/17-26/9/23')).toBe('下周')
    expect(getVersionWeekLabel('26/9/17-26/9/23 (S1.4)')).toBe('下周')
  })

  it('版本起始在下下周版本范围返回「下下周」', () => {
    expect(getVersionWeekLabel('26/9/24-26/9/30')).toBe('下下周')
    expect(getVersionWeekLabel('26/9/24-26/9/30 (S1.5)')).toBe('下下周')
  })

  it('其他周版本（超出当周+后2周）返回 null', () => {
    expect(getVersionWeekLabel('26/9/3-26/9/9')).toBeNull() // 上周版本
    expect(getVersionWeekLabel('26/10/1-26/10/7')).toBeNull() // 下下下周版本
  })

  it('周三（当周版本最后一天）仍属当周，下周四属下周，下下周四属下下周', () => {
    expect(getVersionWeekLabel('26/9/16-26/9/22')).toBe('当周') // 9/16 周三，当周版本末尾
    expect(getVersionWeekLabel('26/9/17-26/9/23')).toBe('下周') // 9/17 周四，下周版本起始
    expect(getVersionWeekLabel('26/9/23-26/9/29')).toBe('下周') // 9/23 周三，下周版本末尾
    expect(getVersionWeekLabel('26/9/24-26/9/30')).toBe('下下周') // 9/24 周四，下下周版本起始
    expect(getVersionWeekLabel('26/9/30-26/10/6')).toBe('下下周') // 9/30 周三，下下周版本末尾
  })

  it('今天所在版本返回「当周」', () => {
    expect(getVersionWeekLabel('26/9/10-26/9/16')).toBe('当周')
  })

  it('支持 4 位年份', () => {
    expect(getVersionWeekLabel('2026/9/10-2026/9/16')).toBe('当周')
    expect(getVersionWeekLabel('2026/9/17-2026/9/23')).toBe('下周')
  })

  it('无日期的版本名返回 null', () => {
    expect(getVersionWeekLabel('S1.3验收配置截止')).toBeNull()
    expect(getVersionWeekLabel('v223')).toBeNull()
  })

  it('空值返回 null', () => {
    expect(getVersionWeekLabel(null)).toBeNull()
    expect(getVersionWeekLabel(undefined)).toBeNull()
    expect(getVersionWeekLabel('')).toBeNull()
  })

  it('以周三为今天时，当周版本仍为 09-10~09-16', () => {
    vi.setSystemTime(new Date(2026, 8, 16, 12, 0, 0)) // 周三
    expect(getVersionWeekLabel('26/9/10-26/9/16')).toBe('当周')
    expect(getVersionWeekLabel('26/9/17-26/9/23')).toBe('下周')
  })

  it('以周五为今天时，当周版本仍为 09-10~09-16', () => {
    vi.setSystemTime(new Date(2026, 8, 11, 12, 0, 0)) // 周五
    expect(getVersionWeekLabel('26/9/10-26/9/16')).toBe('当周')
    expect(getVersionWeekLabel('26/9/17-26/9/23')).toBe('下周')
  })
})

describe('formatDateShort', () => {
  it('今年显示 MM-DD', () => {
    const thisYear = new Date().getFullYear()
    expect(formatDateShort(`${thisYear}-09-10`)).toBe('09-10')
  })

  it('往年显示 YYYY-MM-DD', () => {
    expect(formatDateShort('2024-09-10')).toBe('2024-09-10')
  })

  it('空值/非法值返回 —', () => {
    expect(formatDateShort(null)).toBe('—')
    expect(formatDateShort(undefined)).toBe('—')
    expect(formatDateShort('')).toBe('—')
    expect(formatDateShort('not-a-date')).toBe('—')
  })

  it('支持含本地时间的日期字符串', () => {
    const thisYear = new Date().getFullYear()
    expect(formatDateShort(`${thisYear}-09-10T18:52:01`)).toBe('09-10')
  })
})

describe('stripLeadingBrackets', () => {
  it('去掉开头【】标签段及其后空白', () => {
    expect(
      stripLeadingBrackets('【提交主干 + PreOnline】hotfix生成代码ksbc相同table处理'),
    ).toBe('hotfix生成代码ksbc相同table处理')
  })

  it('无【】的主题原样返回（仅 trim 空白）', () => {
    expect(stripLeadingBrackets('导表检查功能')).toBe('导表检查功能')
    expect(stripLeadingBrackets('  导表检查功能  ')).toBe('导表检查功能')
  })

  it('只去首个【】，后续【】保留', () => {
    expect(stripLeadingBrackets('【A】【B】xxx')).toBe('【B】xxx')
  })

  it('空【】标签被去掉', () => {
    expect(stripLeadingBrackets('【】xxx')).toBe('xxx')
  })

  it('标签后有空格时一并去掉', () => {
    expect(stripLeadingBrackets('【标签】   xxx')).toBe('xxx')
  })

  it('空值返回空字符串', () => {
    expect(stripLeadingBrackets(null)).toBe('')
    expect(stripLeadingBrackets(undefined)).toBe('')
    expect(stripLeadingBrackets('')).toBe('')
  })

  it('只 trim 开头，不 trim 结尾后再判断', () => {
    // 主题里标签后还有内容，正常返回
    expect(stripLeadingBrackets('【X】y')).toBe('y')
  })
})

describe('buildCopyDescriptionText', () => {
  it('主题含【】时，前段去标签、后段保留原主题', () => {
    expect(
      buildCopyDescriptionText(
        368799,
        '【提交主干 + PreOnline】hotfix生成代码ksbc相同table处理',
      ),
    ).toBe(
      'hotfix生成代码ksbc相同table处理 #368799 【提交主干 + PreOnline】hotfix生成代码ksbc相同table处理',
    )
  })

  it('主题无【】时，两端都是原主题', () => {
    expect(buildCopyDescriptionText(340676, '导表检查功能')).toBe(
      '导表检查功能 #340676 导表检查功能',
    )
  })

  it('主题为空时，前段空但保留 #id 与空后段', () => {
    expect(buildCopyDescriptionText(123, '')).toBe(' #123 ')
    expect(buildCopyDescriptionText(123, null)).toBe(' #123 ')
  })

  it('id 与原主题之间有固定格式（# 前一个空格、id 后一个空格）', () => {
    const text = buildCopyDescriptionText(1, '【A】B')
    expect(text).toBe('B #1 【A】B')
  })
})
