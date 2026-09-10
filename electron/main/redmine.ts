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
 * 说明：URL 里的 "me" 指当前登录用户；API 调用使用具体 user_id（chenzhixu → 1077）
 *       以避免依赖 API Key 持有者身份。
 */

/** Redmine API 基址（参考 p4submit/requests.js 的 REDMINE_URL，已验证可用） */
export const REDMINE_BASE_URL = 'https://c7-game-redmine.corp.kuaishou.com/'

/** Redmine API Key（与 p4submit/requests.js 同源，只存在于主进程） */
const REDMINE_API_KEY = 'c7669fcbaacbbd7106ebd2a3da57e9597cfa6b15'

/** 网页端基址（用户筛选 URL 用的 gamecloud-redmine 域，点击单子时在浏览器打开） */
export const REDMINE_WEB_URL = 'https://gamecloud-redmine.corp.kuaishou.com/'

/**
 * 用户名 → Redmine user_id 映射.
 * 完整映射见 p4submit/requests.js 的 UserData / p4submit/redmineid.json（1300+ 条），
 * 这里按需精简：当前任务只用 chenzhixu，保留为常量映射便于后续扩展。
 * 若用户名找不到，调用方降级为空列表（与 requests.js 的 getSelfOpenedIssue 一致）。
 */
const USER_NAME_TO_ID: Record<string, number> = {
  chenzhixu: 1077,
}

export const DEFAULT_REDMINE_USER_NAME = 'chenzhixu'

/** 默认过滤的目标版本：fixed_version_id != 223（与用户筛选 URL 一致） */
export const DEFAULT_EXCLUDE_FIXED_VERSION_ID = 223

/** 默认过滤的状态：status_id = 7（进行中，与用户筛选 URL 一致） */
export const DEFAULT_STATUS_ID = 7

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

export const DEFAULT_REDMINE_FILTER: Omit<RedmineIssueFilter, 'userId'> = {
  project: 'c7',
  userName: DEFAULT_REDMINE_USER_NAME,
  statusId: DEFAULT_STATUS_ID,
  excludeFixedVersionId: DEFAULT_EXCLUDE_FIXED_VERSION_ID,
  sort: 'estimated_hours:desc,id:desc',
  limit: 100,
}

/**
 * 由用户名解析 Redmine user_id.
 * 当前仅支持 chenzhixu；其它用户名返回 null，调用方降级为空列表。
 */
export function resolveRedmineUserId(userName: string): number | null {
  const trimmed = userName?.trim()
  if (!trimmed) return null
  const id = USER_NAME_TO_ID[trimmed]
  return typeof id === 'number' ? id : null
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

const REDMINE_REQUEST_TIMEOUT_MS = 15000

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
 */
export async function fetchRedmineIssues(
  userName: string = DEFAULT_REDMINE_USER_NAME,
): Promise<RedmineIssuesSnapshot> {
  const trimmedName = (userName ?? '').trim() || DEFAULT_REDMINE_USER_NAME
  const userId = resolveRedmineUserId(trimmedName)
  if (userId === null) {
    return {
      available: false,
      issues: [],
      userName: trimmedName,
      userId: null,
      totalCount: 0,
      error: `未找到用户 ${trimmedName} 的 Redmine ID（当前仅支持 chenzhixu）`,
    }
  }

  const filter: RedmineIssueFilter = { ...DEFAULT_REDMINE_FILTER, userName: trimmedName, userId }
  const params = buildIssueFilterParams(filter)
  const url = `${REDMINE_BASE_URL}issues.json?${params.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REDMINE_REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      return {
        available: false,
        issues: [],
        userName: trimmedName,
        userId,
        totalCount: 0,
        error: `Redmine 返回 ${response.status} ${response.statusText}`,
      }
    }
    const data = (await response.json()) as RedmineIssuesResponse
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
    const message = e instanceof Error ? e.message : String(e)
    const friendly = /abort/i.test(message)
      ? `Redmine 请求超时（${REDMINE_REQUEST_TIMEOUT_MS}ms）`
      : message
    return {
      available: false,
      issues: [],
      userName: trimmedName,
      userId,
      totalCount: 0,
      error: friendly,
    }
  } finally {
    clearTimeout(timer)
  }
}
