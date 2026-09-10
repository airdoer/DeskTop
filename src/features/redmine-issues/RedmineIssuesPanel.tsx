import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { EmptyState } from '@/components/layout/EmptyState'
import { AppButton } from '@/components/ui/AppButton'
import { CopyIcon, ExternalLinkIcon, RefreshIcon, TicketSolidIcon } from '@/components/ui/icons'
import { REDMINE_RED } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import {
  DEFAULT_REDMINE_USER_NAME,
  buildCopyDescriptionText,
  getRedmineIssues,
  getVersionWeekLabel,
  groupIssuesByVersion,
  priorityColor,
  REDMINE_FILTER_WEB_URL,
  type RedmineIssue,
  type RedmineIssueGroup,
  type RedmineIssuesSnapshot,
} from '@/services/redmineIssues'
import { PANEL_COLLAPSED_KEYS } from '@/services/uiPreferences'
import { usePanelCollapsed } from '@/hooks/usePanelCollapsed'

/*
 * RedmineIssuesPanel — Business Feature：展示当前用户的 Redmine 进行中单子.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，Redmine API 经 redmineIssues Service（IPC）调用；
 * §21 Empty State 清晰可操作；§11.1 操作反馈用 Toast；§20 用局部 loading。
 *
 * 过滤条件（与用户提供的筛选 URL 一致）：
 *   project=c7, status_id=7（进行中）, assigned_to_id=chenzhixu 的 user_id,
 *   fixed_version_id != 223, sort=estimated_hours:desc,id:desc, group_by=fixed_version
 *
 * 布局：按 fixed_version 分组，每组一个标题 + 表格行列表。
 *   行列：ID（链接）/ Tracker / 优先级 / 主题 / 预计 / 状态 / 开始 / 截止 / 作者
 *   assigned_to 始终是当前用户，不单独占列，只在面板头摘要里回显。
 */

/** 排除掉的目标版本 id（与用户筛选 URL 一致） */
const EXCLUDE_FIXED_VERSION_ID = 223
/** 状态 id（7 = 进行中） */
const STATUS_ID = 7

export function RedmineIssuesPanel() {
  const [snapshot, setSnapshot] = useState<RedmineIssuesSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  // 用户名：当前任务要求先用 chenzhixu，后续可扩展为可编辑
  const [userName] = useState(DEFAULT_REDMINE_USER_NAME)
  const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.redmineIssues)

  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setSnapshot(await getRedmineIssues(userName))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [userName])

  useEffect(() => {
    void load()
  }, [load])

  const groups = snapshot ? groupIssuesByVersion(snapshot.issues) : []
  // 是否存在「当周」版本的分组：没有则提示「当周单子已完成 👍」
  const hasCurrentWeek = groups.some((g) => getVersionWeekLabel(g.label) === '当周')

  return (
    <Panel
      title="Redmine 单子"
      icon={<TicketSolidIcon size={14} style={{ color: REDMINE_RED }} />}
      help={
        <div className="text-xs leading-5">
          <div>过滤：chenzhixu · 状态=进行中 · 目标版本≠#{EXCLUDE_FIXED_VERSION_ID}</div>
          <div>按目标版本分组，按预计工时倒序</div>
        </div>
      }
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      actions={
        <>
          <a
            href={REDMINE_FILTER_WEB_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 h-7 px-2 text-xs font-medium rounded-md transition-colors select-none bg-transparent text-foreground border border-transparent hover:bg-surface-hover focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer"
            title="在浏览器中打开当前筛选（Redmine 网页）"
          >
            <ExternalLinkIcon size={13} />
            浏览器打开
          </a>
          <AppButton
            variant="ghost"
            size="sm"
            onClick={() => void load()}
            loading={loading}
            aria-label="刷新"
          >
            <RefreshIcon size={14} />
            刷新
          </AppButton>
        </>
      }
    >
      {loading && !snapshot ? (
        <div className="text-xs text-foreground-tertiary py-2">加载中…</div>
      ) : error ? (
        <div className="text-xs text-error py-2">{error}</div>
      ) : snapshot && !snapshot.available ? (
        <EmptyState
          title="无法加载 Redmine 单子"
          hint={snapshot.error || '请检查内网连接后重试'}
          action={
            <AppButton variant="default" size="sm" onClick={() => void load()}>
              <RefreshIcon size={13} />
              重试
            </AppButton>
          }
        />
      ) : snapshot && snapshot.issues.length === 0 ? (
        <EmptyState
          title="当前没有符合条件的单子"
          hint={`chenzhixu · 状态=进行中 · 目标版本≠#${EXCLUDE_FIXED_VERSION_ID}`}
          action={
            <a
              href={REDMINE_FILTER_WEB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              在 Redmine 中查看 →
            </a>
          }
        />
      ) : snapshot ? (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-foreground-secondary">
            共 <span className="font-medium text-foreground">{snapshot.totalCount}</span> 个单子
            {snapshot.serverTotal !== undefined && snapshot.serverTotal > snapshot.totalCount ? (
              <span className="text-foreground-tertiary">（服务端总计 {snapshot.serverTotal}，受 limit 约束）</span>
            ) : null}
            <span className="text-foreground-tertiary"> · 指派给 {snapshot.userName}</span>
          </div>
          {!hasCurrentWeek && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700">
              <span className="text-base leading-none" aria-hidden>
                👍
              </span>
              <span className="text-[13px] font-medium">当周单子已完成</span>
            </div>
          )}
          {groups.map((group) => (
            <IssueGroup key={group.versionId ?? '__none'} group={group} />
          ))}
        </div>
      ) : null}
    </Panel>
  )
}

function IssueGroup({ group }: { group: RedmineIssueGroup }) {
  const weekLabel = getVersionWeekLabel(group.label)
  return (
    <section className="rounded-md border border-border-subtle bg-surface-2/40 overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-3 h-8 bg-surface-header border-b border-border-subtle">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ backgroundColor: group.versionId === null ? '#9ca3af' : REDMINE_RED }}
            aria-hidden
          />
          <h3 className="text-[13px] font-medium text-foreground truncate">{group.label}</h3>
          {weekLabel && (
            <span
              className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium leading-tight ${
                weekLabel === '当周'
                  ? 'bg-primary/15 text-primary'
                  : weekLabel === '下周'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              {weekLabel}
            </span>
          )}
        </div>
        <span className="text-xs text-foreground-tertiary shrink-0">{group.issues.length} 个</span>
      </header>
      <div className="flex flex-col">
        <TableHeader />
        {group.issues.map((issue, idx) => (
          <IssueRow key={issue.id} issue={issue} index={idx} />
        ))}
      </div>
    </section>
  )
}

/** 列定义：ID / Tracker / 优先级 / 主题 / 状态 / 作者 */
const GRID_COLS = 'grid-cols-[64px_72px_64px_1fr_72px_96px]'

function TableHeader() {
  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-2 h-7 px-3 text-[11px] font-medium text-foreground-tertiary border-b border-border-subtle bg-surface-header/60`}
    >
      <span>#</span>
      <span>类型</span>
      <span>优先级</span>
      <span>主题</span>
      <span>状态</span>
      <span>作者</span>
    </div>
  )
}

function IssueRow({ issue, index }: { issue: RedmineIssue; index: number }) {
  const striped = index % 2 === 1
  const copyDesc = useCallback(async () => {
    const text = buildCopyDescriptionText(issue.id, issue.subject)
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`已复制 #${issue.id} 描述`)
    } catch {
      toast.error('复制失败')
    }
  }, [issue])
  return (
    <div
      className={`grid ${GRID_COLS} items-center gap-2 h-9 px-3 text-xs ${
        striped ? 'bg-surface-2/50' : ''
      } hover:bg-surface-hover transition-colors -mx-0`}
    >
      <span className="font-mono text-foreground">
        <a
          href={issue.web_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
          title={`在 Redmine 中打开 #${issue.id}`}
        >
          #{issue.id}
        </a>
      </span>
      <span className="truncate text-foreground-secondary" title={issue.tracker?.name}>
        {issue.tracker?.name || '—'}
      </span>
      <span
        className="truncate font-medium"
        style={{ color: priorityColor(issue.priority?.name) }}
        title={issue.priority?.name}
      >
        {issue.priority?.name || '—'}
      </span>
      <div className="min-w-0 flex items-center gap-1">
        <span className="min-w-0 truncate text-foreground" title={issue.subject}>
          {issue.subject || '—'}
        </span>
        <button
          type="button"
          onClick={() => void copyDesc()}
          className="shrink-0 inline-flex items-center justify-center h-5 w-5 rounded text-foreground-tertiary hover:text-primary hover:bg-surface-hover transition-colors"
          title={`复制描述：${buildCopyDescriptionText(issue.id, issue.subject)}`}
          aria-label="复制描述"
        >
          <CopyIcon size={12} />
        </button>
      </div>
      <span className="truncate text-foreground-secondary" title={issue.status?.name}>
        {issue.status?.name || '—'}
      </span>
      <span className="truncate text-foreground-secondary" title={issue.author?.name}>
        {issue.author?.name || '—'}
      </span>
    </div>
  )
}

/*
 * 日期单元格已移除（开始/截止列不再展示）。短日期格式化函数仍保留在 service，
 * 供将来需要时复用，不在此处引用。
 */
