/*
 * redmineIssues Service — 渲染层查询 Redmine 单子的 IPC 封装.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：Renderer 禁止直接访问外网，
 *   统一经 IPC Service 转发到 Main Process（API Key 只存在于主进程）。
 *
 * 过滤条件（与用户提供的筛选 URL 一致）：
 *   project=c7, status_id=7（进行中）, assigned_to_id=<登录用户的 user_id>,
 *   fixed_version_id != 223, sort=estimated_hours:desc,id:desc, group_by=fixed_version
 * 用户名由调用方传入（SSO 登录态）；「用户名 → user_id」的解析在主进程按需查询完成。
 */

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
  /** 主进程补齐的网页链接 */
  web_url?: string
}

export interface RedmineIssuesSnapshot {
  available: boolean
  issues: RedmineIssue[]
  userName: string
  userId: number | null
  totalCount: number
  serverTotal?: number
  error?: string
}

const EMPTY: RedmineIssuesSnapshot = {
  available: false,
  issues: [],
  userName: '',
  userId: null,
  totalCount: 0,
}

/**
 * 查询 Redmine 单子.
 *
 * @param userName 登录用户的 SSO 用户名（必填，来自 useSsoSession）。
 *   刻意不设默认值：默认值会让「忘记传用户名」变成「静默查询某个固定账号的单子」，
 *   而正确行为是让主进程返回明确的错误提示。找不到该登录名时主进程返回空列表 + error。
 */
export async function getRedmineIssues(userName: string): Promise<RedmineIssuesSnapshot> {
  if (!userName.trim()) return EMPTY
  try {
    const result = await window.ipcRenderer.invoke('redmine:issues', userName)
    const snapshot = result as RedmineIssuesSnapshot | undefined
    if (!snapshot || typeof snapshot !== 'object') return EMPTY
    return {
      ...snapshot,
      issues: Array.isArray(snapshot.issues) ? snapshot.issues : [],
    }
  } catch {
    // 主进程未注册该 handler（旧版本）时降级为空，不阻断页面渲染
    return EMPTY
  }
}

/* ---------- 渲染辅助 ---------- */

/** 按 fixed_version 分组，未设置版本的归到 "(无版本)" */
export interface RedmineIssueGroup {
  /** 分组键：版本名（无版本时为固定文案） */
  label: string
  /** 版本 id，无版本时为 null */
  versionId: number | null
  issues: RedmineIssue[]
}

export function groupIssuesByVersion(issues: RedmineIssue[]): RedmineIssueGroup[] {
  const groups = new Map<string, RedmineIssueGroup>()
  const noVersionKey = '__no_version__'
  for (const issue of issues) {
    const fv = issue.fixed_version
    if (!fv) {
      const g = groups.get(noVersionKey)
      if (g) g.issues.push(issue)
      else groups.set(noVersionKey, { label: '（无版本）', versionId: null, issues: [issue] })
    } else {
      const key = `v${fv.id}`
      const g = groups.get(key)
      if (g) g.issues.push(issue)
      else groups.set(key, { label: fv.name || `#${fv.id}`, versionId: fv.id, issues: [issue] })
    }
  }
  return [...groups.values()]
}

/** 优先级中文映射（Redmine 默认 4 档：低/一般/高/紧急/Urgent），用于着色 */
const PRIORITY_COLORS: Record<string, string> = {
  低: '#5b8af5',
  一般: '#595959',
  普通: '#595959',
  高: '#e67e22',
  紧急: '#e74c3c',
  urgent: '#e74c3c',
  high: '#e67e22',
  normal: '#595959',
  low: '#5b8af5',
}

export function priorityColor(name?: string): string {
  if (!name) return '#595959'
  return PRIORITY_COLORS[name.toLowerCase()] ?? PRIORITY_COLORS[name] ?? '#595959'
}

/** 预计工时格式化：1.5 → "1.5h"；undefined/null → "—" */
export function formatHours(hours?: number | null): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—'
  return `${hours}h`
}

/** 截断日期：2024-09-10T18:52:01Z → 2024-09-10 */
export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const head = value.slice(0, 10)
  return head || '—'
}

/* ---------- 复制描述辅助 ---------- */

/*
 * 去掉主题开头被【】包裹的标签段（仅去首个，后续出现的保留）.
 * 例：
 *   "【提交主干 + PreOnline】hotfix生成代码ksbc相同table处理" → "hotfix生成代码ksbc相同table处理"
 *   "导表检查功能" → "导表检查功能"（无【】原样返回）
 *   "【A】【B】xxx" → "【B】xxx"（只去首个，第二个保留）
 * 用于复制描述："{去标签主题} #{单号} {原主题}"，便于在提交信息等场景里
 *   去掉前缀标签、保留原主题作上下文.
 */
export function stripLeadingBrackets(subject?: string | null): string {
  if (!subject) return ''
  const trimmed = subject.replace(/^\s+/, '')
  const match = trimmed.match(/^【[^】]*】\s*/)
  if (!match) return subject.trim()
  return trimmed.slice(match[0].length).trim()
}

/**
 * 构造复制描述文本："{去首个【】标签的主题} #{单号} {原主题}".
 * 主题无【】时两端都是原主题，等同 "{subject} #{id} {subject}".
 */
export function buildCopyDescriptionText(id: number, subject?: string | null): string {
  const raw = (subject ?? '').trim()
  const stripped = stripLeadingBrackets(raw)
  return `${stripped} #${id} ${raw}`
}

/* ---------- 浏览器端筛选 URL ---------- */

/**
 * 网页端筛选 URL（直接使用用户提供的固定链接）.
 * 用户在 Redmine 网页已登录态下点击此链接，可直接看到同款筛选结果.
 *
 * 为什么不用 user_id：API 查询用的 user_id（chenzhixu=1077）来自特殊用户视角，
 *   而浏览器登录的是用户本人；用 user_id 构造的 URL 在网页端会提示无权限。
 *   assigned_to_id 用 "me"（当前登录用户），由 Redmine 网页侧解析为登录者本人。
 */
export const REDMINE_FILTER_WEB_URL =
  'https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues' +
  '?utf8=%E2%9C%93&set_filter=1&sort=estimated_hours:desc,id:desc&group_by=fixed_version' +
  '&c[]=id&c[]=tracker&c[]=priority&c[]=subject&c[]=fixed_version&c[]=estimated_hours' +
  '&c[]=created_on&c[]=assigned_to&c[]=cf_40&c[]=status&c[]=parent.subject' +
  '&c[]=start_date&c[]=due_date&c[]=author' +
  '&f[]=status_id&f[]=assigned_to_id&f[]=fixed_version_id' +
  '&op[status_id]==&op[assigned_to_id]==&op[fixed_version_id]=!' +
  '&v[status_id][]=7&v[assigned_to_id][]=me&v[fixed_version_id][]=223'

/* ---------- 周版本标签 ---------- */

/*
 * 周版本从周四到下周三。给定一个日期，判断它属于哪个周版本：
 *   当周版本：本周四 ~ 下周三
 *   下周版本：下周四 ~ 下下周三
 *   下下周版本：下下周四 ~ 下下下周三
 *   其他：null
 * 仅展示当周与后面 2 周，更远的版本不加标签。纯函数，便于单元测试。
 */
type WeekVersionLabel = '当周' | '下周' | '下下周'

function getWeekVersionLabelForDate(date: Date): WeekVersionLabel | null {
  date.setHours(12, 0, 0, 0)
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  // 本周四（周版本从周四开始）：JS getDay() 周日=0，周四=4
  const daysSinceThursday = (today.getDay() - 4 + 7) % 7
  const thisThursday = new Date(today)
  thisThursday.setDate(today.getDate() - daysSinceThursday)

  const nextThursday = new Date(thisThursday)
  nextThursday.setDate(thisThursday.getDate() + 7)

  const weekAfterNextThursday = new Date(nextThursday)
  weekAfterNextThursday.setDate(nextThursday.getDate() + 7)

  const weekAfterNextNextThursday = new Date(weekAfterNextThursday)
  weekAfterNextNextThursday.setDate(weekAfterNextThursday.getDate() + 7)

  if (date >= thisThursday && date < nextThursday) return '当周'
  if (date >= nextThursday && date < weekAfterNextThursday) return '下周'
  if (date >= weekAfterNextThursday && date < weekAfterNextNextThursday) return '下下周'
  return null
}

/**
 * 从版本名称中解析日期，判断该版本属于当周、下周还是下下周.
 * 版本名常见格式："26/9/10-26/9/16 (S1.3验收配置截止/拉分支）"，
 *   周版本从周四到下周三，版本起始通常就是周四，取第一个日期判断即可.
 * @returns '当周' | '下周' | '下下周' | null（无日期或超出当周+后2周时）
 */
export function getVersionWeekLabel(versionName?: string | null): WeekVersionLabel | null {
  if (!versionName) return null
  const match = versionName.match(/(\d{2,4})\/(\d{1,2})\/(\d{1,2})/)
  if (!match) return null
  let year = parseInt(match[1], 10)
  if (year < 100) year += 2000 // 26 → 2026
  const month = parseInt(match[2], 10)
  const day = parseInt(match[3], 10)
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) return null
  return getWeekVersionLabelForDate(date)
}

/* ---------- 短日期 ---------- */

/** 短日期：今年显示 MM-DD，往年显示 YYYY-MM-DD（节省列宽，便于和周标签共存） */
export function formatDateShort(value?: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  if (yyyy === new Date().getFullYear()) return `${mm}-${dd}`
  return `${yyyy}-${mm}-${dd}`
}
