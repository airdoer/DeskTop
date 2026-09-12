import { useMemo, useState, type ReactNode } from 'react'
import { AppInput } from '@/components/ui/AppInput'
import { AppButton } from '@/components/ui/AppButton'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, P4VWindowIcon, TicketSolidIcon } from '@/components/ui/icons'
import { PERFORCE_BLUE, REDMINE_RED } from '@/components/ui/brandColors'
import { ResizableTable, type ResizableColumn } from './ResizableTable'
import {
  buildRedmineIssueUrl,
  humanizeDate,
  parseRedmineRefs,
  openMergeResultInP4V,
  type P4Changelist,
} from '@/services/p4Merge'
import { openWebsite } from '@/services/websites'
import { toast } from '@/components/feedback/Toast'
import type { P4VConnection } from '@/services/p4Workspaces'

/*
 * ChangelistList — Source Changelist 列表.
 * 列：Change（点击开 P4V）| Date（绝对 + human 相对）| Redmine（红色图标 + #单号，外部浏览器跳转） | Description | 选择
 *   - 时间列默认 180px（绝对 + 相对两行）
 *   - 描述列默认 flex（剩余空间），多行不截断（回填 describe 的完整描述）
 *   - Redmine 单号独立列：红色 TicketSolidIcon + #单号，点击跳外部浏览器（openWebsite → shell.openExternal）
 *   - 描述列内的 #单号 不再可点击（纯文本）
 *   - 斑马纹、可拖拽列宽、关键词搜索、分页（默认每页 10，可调 10/20/50/100）
 */

/*
 * 列宽分配（默认值，可拖拽调整）：
 *   Changelist 80 / 时间 150 / Redmine单号 104 / 提交描述 自适应剩余 / pick 44
 *   收紧前三列让提交描述尽量单行显示完整.
 */
const DEFAULT_COLUMNS: ResizableColumn[] = [
  { key: 'change', label: 'Changelist', width: 80, minWidth: 64, maxWidth: 140 },
  { key: 'date', label: '时间', width: 150, minWidth: 120, maxWidth: 260 },
  { key: 'redmine', label: 'Redmine 单号', width: 104, minWidth: 80, maxWidth: 220 },
  { key: 'desc', label: '提交描述', width: 360, minWidth: 120, maxWidth: 1600 },
  { key: 'pick', label: '', width: 44, minWidth: 32, maxWidth: 72, align: 'center' },
]

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]

interface ChangelistListProps {
  changes: P4Changelist[]
  selected: number | null
  onSelect: (change: number) => void
  loading: boolean
  /** Source workspace client 名 + 连接信息，用于 Change 号点击开 P4V */
  sourceClient?: string
  connection?: P4VConnection
}

export function ChangelistList({
  changes,
  selected,
  onSelect,
  loading,
  sourceClient,
  connection,
}: ChangelistListProps) {
  const [keyword, setKeyword] = useState('')
  const [pageSize, setPageSize] = useState<PageSize>(10)
  const [page, setPage] = useState(0)

  /** 关键词过滤：change 号或描述包含 keyword（大小写不敏感） */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return changes
    return changes.filter((c) => {
      return String(c.change).includes(kw) || (c.description ?? '').toLowerCase().includes(kw)
    })
  }, [changes, keyword])

  // 分页：keyword 改变时回到第一页
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages - 1)
  if (safePage !== page) setPage(safePage)
  const pageStart = safePage * pageSize
  const pageRows = filtered.slice(pageStart, pageStart + pageSize)

  const rows = useMemo(
    () =>
      pageRows.map((c) => ({
        change: renderChangeCell(c, sourceClient, connection, () => {
          // 点击 Changelist 文字：在 P4V 打开该已提交 changelist（p4vc change <num>）
          if (!sourceClient) {
            toast.warning('未选择 Source Workspace，无法跳转 P4V')
            return
          }
          void openMergeResultInP4V({
            client: sourceClient,
            port: connection?.port,
            user: connection?.user,
            charset: connection?.charset,
            change: c.change,
          }).then((res) => {
            if (res.ok) toast.success(`已在 P4V 中打开 CL ${c.change}`)
            else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
          })
        }),
        date: renderDateCell(c.date),
        redmine: renderRedmineCell(c.description, (ref) => {
          setKeyword(ref)
          setPage(0)
        }),
        desc: renderDescriptionCell(c.description),
        pick: c.change === selected ? <span className="text-[11px] text-primary font-medium">已选</span> : '',
      })),
    [pageRows, selected, sourceClient, connection],
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold text-foreground-secondary">
          Source Changelist
          {loading && <span className="text-foreground-tertiary font-normal ml-1">（加载 describe / preview…）</span>}
        </div>
        <div className="w-56">
          <AppInput
            value={keyword}
            onChange={(e) => {
              setKeyword((e.target as HTMLInputElement).value)
              setPage(0)
            }}
            placeholder="搜索 CL 号或描述…"
            prefix={<SearchIcon />}
            suffix={
              keyword ? (
                <button
                  type="button"
                  onClick={() => {
                    setKeyword('')
                    setPage(0)
                  }}
                  className="flex items-center justify-center w-4 h-4 rounded text-foreground-tertiary hover:text-error hover:bg-surface-hover transition-colors"
                  title="清空搜索"
                  aria-label="清空搜索"
                >
                  <CloseIcon size={11} />
                </button>
              ) : undefined
            }
          />
        </div>
      </div>
      {changes.length === 0 ? (
        <div className="text-xs text-foreground-tertiary py-2">点击上方「加载 Source Changelist」获取列表</div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-foreground-tertiary py-2">没有匹配 「{keyword}」 的 Changelist</div>
      ) : (
        <>
          <ResizableTable
            columns={DEFAULT_COLUMNS}
            rows={rows}
            zebra
            onRowClick={(ri) => onSelect(pageRows[ri].change)}
            selectedRowIndex={pageRows.findIndex((c) => c.change === selected)}
          />
          {/* 分页栏 */}
          <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-foreground-tertiary">
            <div>
              共 {filtered.length} 个 · 第 {safePage + 1}/{totalPages} 页
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1">
                <span>每页</span>
                <div className="relative">
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      setPageSize(Number(e.target.value) as PageSize)
                      setPage(0)
                    }}
                    className="h-6 appearance-none rounded border border-border bg-surface-1 pl-1.5 pr-5 text-[11px] text-foreground focus:border-primary focus:outline-2 focus:-outline-offset-2 outline-primary cursor-pointer"
                  >
                    {PAGE_SIZE_OPTIONS.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-foreground-tertiary" aria-hidden>
                    <ChevronDownIcon size={11} />
                  </span>
                </div>
                <span>条</span>
              </div>
              <AppButton
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="上一页"
              >
                <ChevronRightIcon size={12} className="rotate-180" />
              </AppButton>
              <AppButton
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                aria-label="下一页"
              >
                <ChevronRightIcon size={12} />
              </AppButton>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/* ---------- 单元格渲染 ---------- */

/** Changelist：蓝色 P4V 图标 + CL 编号文字（点击在 P4V 打开该已提交 changelist）
 *  hover 浮层即时提示「点击在 P4V 中打开」，不再有额外按钮.
 */
function renderChangeCell(
  c: P4Changelist,
  sourceClient: string | undefined,
  _connection: P4VConnection | undefined,
  onOpen: () => void,
): ReactNode {
  return (
    <HoverTip text={sourceClient ? '点击在 P4V 中打开' : `CL ${c.change} by ${c.user}`}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[11px] font-mono font-semibold transition-colors hover:bg-primary-bg"
        style={{ color: PERFORCE_BLUE, border: `1px solid ${PERFORCE_BLUE}55` }}
      >
        <P4VWindowIcon size={11} style={{ color: PERFORCE_BLUE }} />
        {c.change}
      </button>
    </HoverTip>
  )
}

/** Date：绝对时间 + 绿色时钟图标 + human 相对时间标签，同一行横向排列（超 4 天不显示标签） */
function renderDateCell(date: string): ReactNode {
  const human = humanizeDate(date)
  return (
    <div className="flex items-center gap-1 min-w-0 whitespace-nowrap" title={date}>
      <span className="font-mono text-foreground-secondary text-[11px]">{date}</span>
      {human && (
        <span
          className="inline-flex items-center gap-0.5 px-1 h-4 rounded text-[10px] font-medium whitespace-nowrap"
          style={{ color: '#16a34a', border: '1px solid #16a34a55' }}
        >
          <ClockIcon size={9} />
          {human}
        </span>
      )}
    </div>
  )
}

/** Redmine 单号列：红色 TicketSolidIcon + #单号文字（点击在浏览器打开 Redmine issue）+ 搜索图标
 *  文字 hover 浮层即时提示「点击跳转 Redmine 浏览器」，搜索图标 hover 提示「以 #单号 搜索列表」.
 */
function renderRedmineCell(
  description: string,
  onSearch: (ref: string) => void,
): ReactNode {
  const refs = parseRedmineRefs(description ?? '')
  if (refs.length === 0) {
    return <span className="text-foreground-quaternary text-[11px]">—</span>
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      {refs.map((ref) => (
        <div key={ref.id} className="inline-flex items-center gap-0.5">
          <HoverTip text="点击跳转 Redmine 浏览器">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                void openWebsite(buildRedmineIssueUrl(ref.id))
              }}
              className="inline-flex items-center gap-1 px-1.5 h-5 rounded text-[11px] font-medium transition-colors hover:bg-red-50"
              style={{ color: REDMINE_RED, border: `1px solid ${REDMINE_RED}88` }}
            >
              <TicketSolidIcon size={10} style={{ color: REDMINE_RED }} />
              {ref.match}
            </button>
          </HoverTip>
          <HoverTip text={`以 ${ref.match} 搜索列表`}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onSearch(ref.match)
              }}
              className="inline-flex items-center justify-center w-5 h-5 rounded text-foreground-tertiary hover:text-primary hover:bg-surface-hover transition-colors"
              aria-label={`以 ${ref.match} 搜索列表`}
            >
              <SearchIcon />
            </button>
          </HoverTip>
        </div>
      ))}
    </div>
  )
}

/** Description：单行显示，不换行，超长用省略号 + title 全文提示（不渲染链接）.
 *  describe 返回的完整描述可能含 \n（多行），这里合并为单行避免行高跳动. */
function renderDescriptionCell(description: string): ReactNode {
  const raw = description || '(无描述)'
  // 把 \n / \r 换成空格，连续空格合并，保证单行（whitespace-nowrap 对 \n 无效）
  const desc = raw.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return (
    <span
      className="text-foreground-secondary whitespace-nowrap truncate text-[12px] leading-4"
      title={raw}
    >
      {desc}
    </span>
  )
}

/** 轻量搜索图标（不进 icons.tsx，避免污染通用图标库） */
function SearchIcon() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

/** 轻量时钟图标（绿色标签用，不进通用图标库） */
function ClockIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

/**
 * HoverTip —— 自定义 hover 浮层，替代浏览器原生 title（原生 hover 几秒延迟才显示）.
 * 用 group + peer-hover 实现：鼠标进入立即显示，离开立即隐藏，无延迟.
 * 浮层绝对定位在触发元素上方，深色底白字，pointer-events-none 避免遮挡点击.
 */
function HoverTip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span className="relative inline-block group align-middle">
      {children}
      <span
        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded text-[10px] font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-100 z-30 bg-foreground text-surface-1 shadow-md"
        role="tooltip"
      >
        {text}
      </span>
    </span>
  )
}
