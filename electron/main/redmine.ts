/*
 * Redmine 客户端 — Main Process 实现.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接访问外网，
 *   统一经 IPC Service 转发到 Main Process；API Key 只存在于主进程。
 *
 * 参考：E:\Project\C7_project\Tools\QATools\p4submit\requests.js 的 RedmineClient.
 * 过滤条件对应 Web URL:
 *   https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues
 *     ?set_filter=1&group_by=fixed_version&sort=estimated_hours:desc,id:desc
 *     &f[]=status_id&op[status_id]==&v[status_id][]=7
 *     &f[]=assigned_to_id&op[assigned_to_id]==&v[assigned_to_id][]=me
 *     &f[]=fixed_version_id&op[fixed_version_id]=!&v[fixed_version_id][]=223
 * 说明：Web URL 里的 "me" 指 **API Key 的持有者**（实测为 admin，id=1），不是「登录本应用的人」。
 *       本应用允许任意 SSO 用户登录，因此必须解析出登录用户**本人**的 user_id 再作为
 *       assigned_to_id 传参 —— 直接用 "me" 会把所有人的单子都查成 admin 的。
 */

/** Redmine API 基址（参考 p4submit/requests.js 的 REDMINE_URL，已验证可用） */
export const REDMINE_BASE_URL = 'https://c7-game-redmine.corp.kuaishou.com/'

/**
 * Redmine API Key（与 p4submit/requests.js 同源，只存在于主进程）.
 *
 * **权限前提**：解析「用户名 → user_id」需要管理员权限。当前这个 Key 的持有者是 admin（id=1）——
 * 实测 /users/current.json 返回 {"id":1,"login":"admin","admin":true}，因此 /users.json 可用。
 * 若将来换成非管理员 Key，resolveRedmineUserId 会拿到 403 并明确报「无权限」，不会静默失败。
 */
const REDMINE_API_KEY = 'c7669fcbaacbbd7106ebd2a3da57e9597cfa6b15'

/** 网页端基址（用户筛选 URL 用的 gamecloud-redmine 域，点击单子时在浏览器打开） */
export const REDMINE_WEB_URL = 'https://gamecloud-redmine.corp.kuaishou.com/'

/** 单次 Redmine 请求的超时（用户查询与单子查询共用） */
const REDMINE_REQUEST_TIMEOUT_MS = 15000

/**
 * 用户查询的 limit.
 * /users.json 的 name 过滤是**模糊匹配**（login / firstname / lastname / mail 任一命中），
 * 必须把 limit 放大到足以覆盖模糊结果，再在结果里按 login 精确匹配。
 * 实测：name=chen 命中 79 条，name=<完整登录名> 通常只命中 1 条。
 */
const USER_LOOKUP_LIMIT = 100

/**
 * 查询用户时依次尝试的账号状态（Redmine：1=活跃 2=待激活 3=停用）.
 *
 * **不能省略这个参数**：不传 status 时 /users.json 只返回活跃账号，停用账号被静默过滤掉，
 * 表现为这些用户「查不到自己的单子」。实测：name=hantao03 不带 status 返回 0 条，
 * 带 status=3 返回 id=544（与 p4submit 的静态映射表一致）。
 *
 * **也不能一次传多个**：status 是单值过滤，重复传参时**后者覆盖前者**
 * （status=1&status=3 等价于 status=3），所以只能逐个状态串行查询。
 * 顺序按命中概率排：活跃 → 停用 → 待激活。
 */
const USER_LOOKUP_STATUSES = [1, 3, 2] as const

/** 默认过滤的目标版本：fixed_version_id != 223（与用户筛选 URL 一致） */
export const DEFAULT_EXCLUDE_FIXED_VERSION_ID = 223

/** 默认过滤的状态：status_id = 7（进行中，与用户筛选 URL 一致） */
export const DEFAULT_STATUS_ID = 7

/** Redmine 返回非 2xx 时抛出，带上状态码供调用方区分（如 403 = 权限不足） */
class RedmineHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
  ) {
    super(`Redmine 返回 ${status} ${statusText}`)
    this.name = 'RedmineHttpError'
  }
}

/**
 * 带超时的 Redmine GET + JSON 解析（Redmine 只走 GET，超时逻辑在这里收口）.
 * 非 2xx 抛 RedmineHttpError；超时抛 fetch 的 abort 异常，由 toFriendlyError 翻译文案。
 */
async function redmineGetJson(url: string): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REDMINE_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) throw new RedmineHttpError(response.status, response.statusText)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

/** 把请求异常翻译成给用户看的文案：超时单独提示，其余透传（HTTP 错误自带状态码） */
function toFriendlyError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e)
  return /abort/i.test(message) ? `Redmine 请求超时（${REDMINE_REQUEST_TIMEOUT_MS}ms）` : message
}

/**
 * 用户查询失败的提示.
 * 403 单独点明「需要管理员权限」：只给一个状态码，将来 Key 被换成非管理员时会很难定位。
 */
function toUserLookupError(e: unknown): string {
  const message = toFriendlyError(e)
  return e instanceof RedmineHttpError && e.status === 403
    ? `${message}；解析登录名对应的 user_id 需要管理员权限的 API Key`
    : message
}

export interface RedmineRef {
  id: number
  name: string
}

export interface RedmineCustomField {
  id: number
  name: string
  value: string | string[]
}

export interface RedmineIssue {
  id: number
  tracker?: RedmineRef
  priority?: RedmineRef
  subject?: string
  fixed_version?: RedmineRef | null
  /** 预计工时（小时），可能为 null/undefined */
  estimated_hours?: number | null
  status?: RedmineRef
  assigned_to?: RedmineRef | null
  author?: RedmineRef
  parent?: { id: number } | null
  created_on?: string
  updated_on?: string
  start_date?: string
  due_date?: string | null
  custom_fields?: RedmineCustomField[]
  /** 由主进程补齐的网页链接，避免渲染层拼接 */
  web_url?: string
}

export interface RedmineIssuesSnapshot {
  available: boolean
  /** 实际返回的单子（已按 fixed_version 分组前的扁平列表） */
  issues: RedmineIssue[]
  /** 查询时使用的用户名（回显用） */
  userName: string
  /** 查询时使用的 user_id（无法解析时为 null） */
  userId: number | null
  /** 单子总数 */
  totalCount: number
  /** 服务端上报的 total_count（可能大于 issues.length，受 limit 约束） */
  serverTotal?: number
  error?: string
}

/** 查询参数（用于构造 URLSearchParams，独立成函数以便单元测试） */
export interface RedmineIssueFilter {
  project: string
  userName: string
  userId: number | null
  statusId: number
  excludeFixedVersionId: number
  sort: string
  limit: number
}

/**
 * 默认过滤条件（不含用户名与 user_id）.
 * 两者都由调用方按**登录用户**注入，这里不设「默认用户」——
 * 静默回退到某个固定账号会返回**别人的单子**，比报错更难发现。
 */
export const DEFAULT_REDMINE_FILTER: Omit<RedmineIssueFilter, 'userId' | 'userName'> = {
  project: 'c7',
  statusId: DEFAULT_STATUS_ID,
  excludeFixedVersionId: DEFAULT_EXCLUDE_FIXED_VERSION_ID,
  sort: 'estimated_hours:desc,id:desc',
  limit: 100,
}

/** 构造用户查询 URL（纯函数，便于单元测试） */
export function buildUserLookupUrl(login: string, status: number): string {
  const params = new URLSearchParams()
  params.set('key', REDMINE_API_KEY)
  params.set('name', login)
  params.set('status', String(status))
  params.set('limit', String(USER_LOOKUP_LIMIT))
  return `${REDMINE_BASE_URL}users.json?${params.toString()}`
}

/**
 * 从 /users.json 的返回里按 login **精确**匹配 user_id（纯函数，便于单元测试）.
 *
 * 为什么必须精确匹配：name 是模糊过滤（实测 name=chen 命中 79 条），
 * 直接取第一条会把别人的 id 当成自己的，进而查到别人的单子。
 * 比较忽略大小写：SSO 返回的用户名大小写不保证与 Redmine login 一致（接口本身也忽略大小写）。
 */
export function pickUserIdByLogin(raw: unknown, login: string): number | null {
  const wanted = (login ?? '').trim().toLowerCase()
  if (!wanted) return null
  const list = (raw as { users?: unknown } | null | undefined)?.users
  if (!Array.isArray(list)) return null
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const user = item as Record<string, unknown>
    if (String(user.login ?? '').toLowerCase() !== wanted) continue
    const id = typeof user.id === 'number' ? user.id : Number.parseInt(String(user.id ?? ''), 10)
    if (Number.isFinite(id) && id > 0) return id
  }
  return null
}

/**
 * 已解析成功的 用户名 → user_id 缓存.
 * **只缓存命中结果**：查不到可能是账号刚建或名字打错，缓存空值会让该用户永远看不到单子。
 */
const userIdCache = new Map<string, number>()

/**
 * 由用户名解析 Redmine user_id（按需向 Redmine 查询）.
 *
 * 为什么不维护本地映射表（2026-09 改版）：
 *   原先是一张 1 条的硬编码映射 `{ chenzhixu: 1077 }`，非 chenzhixu 的用户直接查不到单子。
 *   参考实现 p4submit/requests.js 用的是 588 条静态表（redmineid.json），但静态表会过期且可能抄错：
 *   实测其中 `xuxinyi0 → 864` 是错的（该 id 的真实 login 是 `xuxinyi06`），接口查询反而更准。
 *
 * 返回 null 表示「Redmine 里确实没有这个登录名」；查询本身失败（无权限/超时/网络）会抛异常，
 * 由调用方翻译成错误提示 —— 两种情况不能混为一谈。
 */
export async function resolveRedmineUserId(userName: string): Promise<number | null> {
  const login = (userName ?? '').trim()
  if (!login) return null

  const cacheKey = login.toLowerCase()
  const cached = userIdCache.get(cacheKey)
  if (cached !== undefined) return cached

  for (const status of USER_LOOKUP_STATUSES) {
    const data = await redmineGetJson(buildUserLookupUrl(login, status))
    const id = pickUserIdByLogin(data, login)
    if (id !== null) {
      userIdCache.set(cacheKey, id)
      return id
    }
  }
  return null
}

/**
 * 构造 Redmine issues.json 查询参数.
 * 使用 Web UI 同款 f[]/op[]/v[] 语法以精确表达 "fixed_version_id != 223" 这类否定过滤。
 * 纯函数：不访问网络，便于单元测试覆盖。
 */
export function buildIssueFilterParams(filter: RedmineIssueFilter): URLSearchParams {
  const params = new URLSearchParams()
  params.set('key', REDMINE_API_KEY)
  params.set('project_id', filter.project)
  params.set('group_by', 'fixed_version')
  params.set('sort', filter.sort)
  params.set('limit', String(filter.limit))
  params.set('offset', '0')

  // status_id = <statusId>
  params.append('f[]', 'status_id')
  params.set('op[status_id]', '=')
  params.append('v[status_id][]', String(filter.statusId))

  // assigned_to_id = <userId>（userId 为 null 时跳过该过滤，避免查询返回全量单子）
  if (filter.userId !== null) {
    params.append('f[]', 'assigned_to_id')
    params.set('op[assigned_to_id]', '=')
    params.append('v[assigned_to_id][]', String(filter.userId))
  }

  // fixed_version_id != <excludeFixedVersionId>
  params.append('f[]', 'fixed_version_id')
  params.set('op[fixed_version_id]', '!')
  params.append('v[fixed_version_id][]', String(filter.excludeFixedVersionId))

  return params
}

/**
 * 单子网页链接基址：与用户提供的筛选 URL 同路径前缀（/1007/projects/c7/issues/）。
 * 用户在 Redmine 网页已登录态下点击 #ID 跳转，避免无权限提示。
 */
export const REDMINE_ISSUE_WEB_BASE_URL = 'https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues/'

/** 构造单子的网页链接（点击在浏览器打开） */
export function buildIssueWebUrl(issueId: number): string {
  return `${REDMINE_ISSUE_WEB_BASE_URL}${issueId}`
}

/** 构造用户筛选 URL（"在浏览器中打开当前筛选"按钮用） */
export function buildFilterWebUrl(filter: RedmineIssueFilter): string {
  // 与用户提供的筛选 URL 同构，但用具体 user_id 替换 "me"
  const params = new URLSearchParams()
  params.set('utf8', '✓')
  params.set('set_filter', '1')
  params.set('sort', filter.sort)
  params.set('group_by', 'fixed_version')
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
    params.append('c[]', col)
  }
  params.append('f[]', 'status_id')
  params.append('f[]', 'assigned_to_id')
  params.append('f[]', 'fixed_version_id')
  params.set('op[status_id]', '=')
  params.set('op[assigned_to_id]', '=')
  params.set('op[fixed_version_id]', '!')
  params.append('v[status_id][]', String(filter.statusId))
  if (filter.userId !== null) {
    params.append('v[assigned_to_id][]', String(filter.userId))
  }
  params.append('v[fixed_version_id][]', String(filter.excludeFixedVersionId))
  return `${REDMINE_WEB_URL}${filter.project}/issues?${params.toString()}`
}

interface RedmineIssuesResponse {
  issues?: unknown
  total_count?: number
}

/** 网络调用 + JSON 解析的最小防御：只信任 issues 数组，逐项做结构校验 */
function parseIssues(raw: unknown): RedmineIssue[] {
  if (!Array.isArray(raw)) return []
  const result: RedmineIssue[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const obj = item as Record<string, unknown>
    const id = typeof obj.id === 'number' ? obj.id : Number.parseInt(String(obj.id ?? ''), 10)
    if (!Number.isFinite(id) || id <= 0) continue
    const issue: RedmineIssue = { id }
    if (obj.tracker && typeof obj.tracker === 'object') {
      const t = obj.tracker as Record<string, unknown>
      issue.tracker = { id: Number(t.id ?? 0), name: String(t.name ?? '') }
    }
    if (obj.priority && typeof obj.priority === 'object') {
      const p = obj.priority as Record<string, unknown>
      issue.priority = { id: Number(p.id ?? 0), name: String(p.name ?? '') }
    }
    if (typeof obj.subject === 'string') issue.subject = obj.subject
    if (obj.fixed_version && typeof obj.fixed_version === 'object') {
      const fv = obj.fixed_version as Record<string, unknown>
      issue.fixed_version = { id: Number(fv.id ?? 0), name: String(fv.name ?? '') }
    } else if (obj.fixed_version === null) {
      issue.fixed_version = null
    }
    if (typeof obj.estimated_hours === 'number') {
      issue.estimated_hours = obj.estimated_hours
    } else if (obj.estimated_hours === null) {
      issue.estimated_hours = null
    }
    if (obj.status && typeof obj.status === 'object') {
      const s = obj.status as Record<string, unknown>
      issue.status = { id: Number(s.id ?? 0), name: String(s.name ?? '') }
    }
    if (obj.assigned_to && typeof obj.assigned_to === 'object') {
      const a = obj.assigned_to as Record<string, unknown>
      issue.assigned_to = { id: Number(a.id ?? 0), name: String(a.name ?? '') }
    } else if (obj.assigned_to === null) {
      issue.assigned_to = null
    }
    if (obj.author && typeof obj.author === 'object') {
      const au = obj.author as Record<string, unknown>
      issue.author = { id: Number(au.id ?? 0), name: String(au.name ?? '') }
    }
    if (obj.parent && typeof obj.parent === 'object') {
      const pa = obj.parent as Record<string, unknown>
      issue.parent = { id: Number(pa.id ?? 0) }
    } else if (obj.parent === null) {
      issue.parent = null
    }
    if (typeof obj.created_on === 'string') issue.created_on = obj.created_on
    if (typeof obj.updated_on === 'string') issue.updated_on = obj.updated_on
    if (typeof obj.start_date === 'string') issue.start_date = obj.start_date
    if (typeof obj.due_date === 'string') issue.due_date = obj.due_date
    else if (obj.due_date === null) issue.due_date = null
    if (Array.isArray(obj.custom_fields)) {
      issue.custom_fields = obj.custom_fields
        .filter((cf) => cf && typeof cf === 'object')
        .map((cf) => {
          const c = cf as Record<string, unknown>
          return {
            id: Number(c.id ?? 0),
            name: String(c.name ?? ''),
            value: (Array.isArray(c.value) ? c.value : String(c.value ?? '')) as string | string[],
          }
        })
    }
    issue.web_url = buildIssueWebUrl(id)
    result.push(issue)
  }
  return result
}

/**
 * 查询 Redmine 单子.
 * 失败时返回 available=false + error，由 UI 展示降级提示，不抛异常（与 p4:workspaces 同构）。
 *
 * userName 为**必填**：调用方传登录用户的 SSO 用户名。这里不回退到任何固定账号 ——
 * 静默换成别人的账号会返回别人的单子（原先回退 chenzhixu，非 chenzhixu 的用户根本查不到单子）。
 */
export async function fetchRedmineIssues(userName: string): Promise<RedmineIssuesSnapshot> {
  const trimmedName = (userName ?? '').trim()
  if (!trimmedName) {
    return {
      available: false,
      issues: [],
      userName: '',
      userId: null,
      totalCount: 0,
      error: '未获取到登录用户名，无法查询 Redmine 单子',
    }
  }

  let userId: number | null
  try {
    userId = await resolveRedmineUserId(trimmedName)
  } catch (e) {
    // 查询本身失败（无权限/超时/网络）：与「查无此人」区分开，否则会把权限问题误报成用户名错误
    return {
      available: false,
      issues: [],
      userName: trimmedName,
      userId: null,
      totalCount: 0,
      error: toUserLookupError(e),
    }
  }
  if (userId === null) {
    return {
      available: false,
      issues: [],
      userName: trimmedName,
      userId: null,
      totalCount: 0,
      error: `Redmine 中找不到登录名为 ${trimmedName} 的账号`,
    }
  }

  const filter: RedmineIssueFilter = { ...DEFAULT_REDMINE_FILTER, userName: trimmedName, userId }
  const url = `${REDMINE_BASE_URL}issues.json?${buildIssueFilterParams(filter).toString()}`

  try {
    const data = (await redmineGetJson(url)) as RedmineIssuesResponse
    const issues = parseIssues(data?.issues)
    return {
      available: true,
      issues,
      userName: trimmedName,
      userId,
      totalCount: issues.length,
      serverTotal: typeof data?.total_count === 'number' ? data.total_count : undefined,
    }
  } catch (e) {
    return {
      available: false,
      issues: [],
      userName: trimmedName,
      userId,
      totalCount: 0,
      error: toFriendlyError(e),
    }
  }
}
