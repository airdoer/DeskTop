import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import { ViewModeToggle } from '@/components/ui/ViewModeToggle'
import { ColorSwatches } from '@/components/ui/ColorSwatches'
import {
  BranchIcon,
  CopyIcon,
  FolderOpenIcon,
  FolderSolidIcon,
  P4VWindowIcon,
  RefreshIcon,
  StarIcon,
  VersionControlIcon,
} from '@/components/ui/icons'
import { PERFORCE_BLUE, STAR_AMBER } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import { openPath } from '@/services/paths'
import {
  deriveDirectoryColor,
  moveItem,
} from '@/services/quickDirectories'
import {
  deriveWorkspaceBadge,
  getP4Favorites,
  getP4WorkspaceLabels,
  getP4WorkspaceOrder,
  getP4Workspaces,
  openInP4V,
  resolveWorkspaceBadge,
  resolveWorkspaceColor,
  setP4Favorites,
  setP4WorkspaceLabels,
  setP4WorkspaceOrder,
  sortWorkspacesByOrder,
  type P4VConnection,
  type P4Workspace,
  type P4WorkspaceSnapshot,
  type WorkspaceLabel,
  type WorkspaceLabels,
} from '@/services/p4Workspaces'
import {
  PANEL_COLLAPSED_KEYS,
  P4_WORKSPACES_VIEW_KEY,
  readP4StarredFilter,
  readViewMode,
  saveP4StarredFilter,
  saveViewMode,
  type ViewMode,
} from '@/services/uiPreferences'
import { usePanelCollapsed } from '@/hooks/usePanelCollapsed'

/*
 * P4WorkspacesPanel — Business Feature：展示本机的 Perforce 工作区.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，p4 命令行经 p4Workspaces Service（IPC）调用；
 * §21 Empty State 清晰可操作；§11.1 操作反馈用 Toast；§20 用局部 loading。
 *
 * 数据约定：Main 侧只返回 Root 在本机确实存在的 client（Linux / 服务器临时 client 已过滤，
 * 过滤数量通过 hiddenCount 反馈）。因此这里的每一条都可以直接点击打开。
 *
 * 与常用目录面板的差异：本面板是「只读快照」，不提供增删改；但支持：
 *   - 星标（收藏）常用工作区，可一键仅看星标（筛选开关持久化）
 *   - 拖拽排序（持久化 client 名顺序列表，快照刷新后仍按用户顺序渲染）
 *   - 徽标自定义（点击图标编辑文字/颜色，持久化 client 名 → {badge?, color?}）
 *   - 打开资源管理器 / 在 P4V 中打开对应 workspace
 *   - 复制路径
 */

/** 内部排序拖拽的私有 MIME：用于在条目间标识排序拖动 */
const REORDER_MIME = 'application/x-c7-p4-workspace-name'

export function P4WorkspacesPanel() {
  const [snapshot, setSnapshot] = useState<P4WorkspaceSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [openingName, setOpeningName] = useState<string | null>(null)
  const [openingP4VName, setOpeningP4VName] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.p4Workspaces)
  // 收藏（星标）的 client 名集合 + 是否仅看星标
  const [favorites, setFavorites] = useState<Set<string>>(() => new Set())
  const [filterStarred, setFilterStarred] = useState(false)
  // 用户自定义顺序：client 名列表，快照刷新后据此重排
  const [order, setOrder] = useState<string[]>([])
  // 徽标自定义：client 名 → {badge?, color?}，覆盖派生值
  const [labels, setLabels] = useState<WorkspaceLabels>(() => ({}))
  // 徽标内联编辑浮层：当前编辑的 client 名（null 表示关闭）
  const [editingLabelName, setEditingLabelName] = useState<string | null>(null)
  const [labelSaving, setLabelSaving] = useState(false)

  // 视图偏好读取：异步来自 Main Process，首帧用默认值，读回后立即纠正
  const [viewLoaded, setViewLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void readViewMode(P4_WORKSPACES_VIEW_KEY).then((mode) => {
      if (!alive) return
      setView(mode)
      setViewLoaded(true)
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!viewLoaded) return
    void saveViewMode(P4_WORKSPACES_VIEW_KEY, view)
  }, [view, viewLoaded])

  // 收藏列表读取：与工作区快照互相独立，首帧空集合，读回后纠正
  useEffect(() => {
    let alive = true
    void getP4Favorites().then((names) => {
      if (!alive) return
      setFavorites(new Set(names))
    })
    return () => {
      alive = false
    }
  }, [])

  // 自定义顺序读取：同样独立于快照，首帧空，读回后纠正
  useEffect(() => {
    let alive = true
    void getP4WorkspaceOrder().then((names) => {
      if (!alive) return
      setOrder(names)
    })
    return () => {
      alive = false
    }
  }, [])

  // 徽标自定义读取：首帧空映射，读回后纠正
  useEffect(() => {
    let alive = true
    void getP4WorkspaceLabels().then((loaded) => {
      if (!alive) return
      setLabels(loaded)
    })
    return () => {
      alive = false
    }
  }, [])

  // 「仅看星标」筛选开关读取：首帧 false，读回后纠正
  useEffect(() => {
    let alive = true
    void readP4StarredFilter().then((value) => {
      if (!alive) return
      setFilterStarred(value)
    })
    return () => {
      alive = false
    }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setSnapshot(await getP4Workspaces())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** 切换某个 client 的星标并整体落盘（与常用目录面板的落盘策略一致） */
  const toggleFavorite = useCallback((name: string) => {
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      void setP4Favorites([...next])
      return next
    })
  }, [])

  /** 切换「仅看星标」筛选并落盘，下次打开自动恢复 */
  const toggleFilterStarred = useCallback(() => {
    setFilterStarred((prev) => {
      const next = !prev
      void saveP4StarredFilter(next)
      return next
    })
  }, [])

  /** 保存某个 client 的徽标自定义（badge/color），空值会从映射中删除该键 */
  const saveLabel = useCallback(
    async (name: string, badge: string, color: string | null) => {
      const trimmedBadge = badge.trim().slice(0, MAX_BADGE_LENGTH)
      const trimmedColor = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null
      // 先构造目标 label，再整体落盘；IPC 返回主进程净化后的结果，
      // 用它更新 state，保证 UI 与持久化完全一致（避免本地 state 与磁盘脱节）。
      const next: WorkspaceLabels = { ...labels }
      const label: WorkspaceLabel = {}
      if (trimmedBadge) label.badge = trimmedBadge
      if (trimmedColor) label.color = trimmedColor
      if (Object.keys(label).length > 0) next[name] = label
      else delete next[name]

      setLabelSaving(true)
      try {
        const cleaned = await setP4WorkspaceLabels(next)
        setLabels(cleaned)
        setEditingLabelName(null)
      } catch {
        toast.error('保存徽标失败')
      } finally {
        setLabelSaving(false)
      }
    },
    [labels],
  )

  const workspaces = useMemo(() => {
    const sorted = sortWorkspacesByOrder(
      snapshot?.workspaces ?? [],
      order,
    )
    return filterStarred ? sorted.filter((ws) => favorites.has(ws.name)) : sorted
  }, [snapshot, order, filterStarred, favorites])

  const openRoot = useCallback(async (ws: P4Workspace) => {
    setOpeningName(ws.name)
    try {
      const res = await openPath(ws.root)
      if (!res.ok) toast.error(`打开失败：${res.error ?? '未知错误'}`)
    } finally {
      setOpeningName(null)
    }
  }, [])

  /** 在 P4V 中打开：连接信息从快照透传，避免渲染层再访问 p4 set */
  const openP4V = useCallback(
    async (ws: P4Workspace) => {
      if (!snapshot) return
      const conn: P4VConnection = {
        port: snapshot.port,
        user: snapshot.user,
        charset: snapshot.charset,
      }
      setOpeningP4VName(ws.name)
      try {
        const res = await openInP4V(ws.name, conn)
        if (res.ok) toast.success(`已在 P4V 中打开 ${ws.name}`)
        else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
      } finally {
        setOpeningP4VName(null)
      }
    },
    [snapshot],
  )

  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}已复制`)
    } catch {
      toast.error('复制失败')
    }
  }, [])

  /* ---------- 拖动排序 ---------- */

  const [dragName, setDragName] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // dragName 用 ref 同步持有：onDragStart 设 ref 与 state 同步更新，
  // 避免 React 批处理导致 onDragOver 首次读到旧 state（null）而漏掉 preventDefault，
  // 那样 drop 目标无法接收 drop 事件，排序静默失败。
  const dragNameRef = useRef<string | null>(null)

  const clearReorder = useCallback(() => {
    dragNameRef.current = null
    setDragName(null)
    setDropIndex(null)
  }, [])

  /** 落盘新顺序：先按当前显示顺序生成 client 名列表，再整体覆盖 */
  const persistOrder = useCallback(
    async (next: P4Workspace[]) => {
      const names = next.map((ws) => ws.name)
      setOrder(names)
      try {
        await setP4WorkspaceOrder(names)
      } catch {
        toast.error('排序保存失败')
      }
    },
    [],
  )

  const commitReorder = useCallback(
    (to: number) => {
      const name = dragNameRef.current
      if (!name) return
      const from = workspaces.findIndex((ws) => ws.name === name)
      clearReorder()
      if (from < 0) return
      const next = moveItem(workspaces, from, to)
      if (next.every((ws, i) => ws.name === workspaces[i].name)) return
      void persistOrder(next)
    },
    [clearReorder, persistOrder, workspaces],
  )

  /** Alt + ↑/↓：拖放的键盘等价入口，保证无鼠标场景也能调整顺序 */
  const moveByKeyboard = useCallback(
    (name: string, delta: number) => {
      const from = workspaces.findIndex((ws) => ws.name === name)
      if (from < 0) return
      const to = delta > 0 ? from + delta + 1 : from + delta
      if (to < 0 || to > workspaces.length) return
      void persistOrder(moveItem(workspaces, from, to))
    },
    [persistOrder, workspaces],
  )

  /** 由条目落点（上/下半区）推导插入位置；卡片网格按左右半区判断 */
  const insertIndexAt = (index: number, e: React.DragEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const after =
      view === 'card'
        ? e.clientX > rect.left + rect.width / 2
        : e.clientY > rect.top + rect.height / 2
    return after ? index + 1 : index
  }

  const reorder: ReorderProps = {
    draggingName: dragName,
    onDragStart: (name) => {
      dragNameRef.current = name
      setDragName(name)
    },
    onDragEnd: clearReorder,
    onDragOverRow: (index, e) => {
      // 用 ref 判断，避免 onDragStart 的 setState 异步导致首次 onDragOver 读到 null
      if (!dragNameRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropIndex(insertIndexAt(index, e))
    },
    onDropRow: (index, e) => {
      if (!dragNameRef.current) return
      e.preventDefault()
      e.stopPropagation()
      commitReorder(insertIndexAt(index, e))
    },
    onMove: moveByKeyboard,
  }

  const metaText = snapshot
    ? [snapshot.port, snapshot.user].filter(Boolean).join(' · ')
    : ''
  const hiddenCount = snapshot?.hiddenCount ?? 0

  // 问号气泡：仅说明面板能力，隐藏 client 数量改由 metaText 行右侧展示
  const help = (
    <div>
      本机 Perforce 工作区（Root 存在于本机的 client）。点击行在资源管理器中打开，
      星标可收藏常用工作区，拖动条目可自定义排序（Alt+↑/↓ 亦可），「P4V」按钮在 P4V 中打开对应 workspace。
    </div>
  )

  const starredCount = workspaces.filter((ws) => favorites.has(ws.name)).length

  return (
    <Panel
      title="P4 工作区"
      icon={<VersionControlIcon size={14} style={{ color: PERFORCE_BLUE }} />}
      help={help}
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      actions={
        <>
          <AppButton
            variant="ghost"
            size="sm"
            onClick={toggleFilterStarred}
            aria-pressed={filterStarred}
            aria-label={filterStarred ? '显示全部工作区' : '仅看星标工作区'}
            title={filterStarred ? '显示全部工作区' : '仅看星标工作区'}
            style={filterStarred ? { color: STAR_AMBER } : undefined}
          >
            <StarIcon size={14} fill={filterStarred ? 'currentColor' : 'none'} />
            {filterStarred ? '仅看星标' : '星标'}
          </AppButton>
          <ViewModeToggle mode={view} onChange={setView} label="P4 工作区视图模式" />
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
        <div className="text-xs text-foreground-tertiary py-2">正在查询 p4 工作区…</div>
      ) : !snapshot || !snapshot.available ? (
        <div className="flex flex-col items-start gap-1 py-2">
          <p className="text-[13px] text-foreground-secondary">
            {snapshot?.error ?? '未能获取 P4 工作区'}
          </p>
          <p className="text-xs text-foreground-tertiary">
            请确认已安装 p4 命令行工具，且已通过 `p4 set` 配置 P4PORT / P4USER。
          </p>
        </div>
      ) : (snapshot.workspaces ?? []).length === 0 ? (
        <div className="flex flex-col items-start gap-1 py-2">
          <p className="text-[13px] text-foreground-secondary">本机没有 P4 工作区</p>
          {hiddenCount > 0 && (
            <p className="text-xs text-foreground-tertiary">
              该用户名下 {hiddenCount} 个 client 的 Root 不在本机，已隐藏。
            </p>
          )}
        </div>
      ) : workspaces.length === 0 ? (
        <div className="flex flex-col items-start gap-1 py-2">
          <p className="text-[13px] text-foreground-secondary">没有星标的工作区</p>
          <p className="text-xs text-foreground-tertiary">
            点击工作区右侧的星标收藏常用项，再点「仅看星标」筛选。
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {metaText && (
            <div className="flex items-center gap-2 text-xs text-foreground-tertiary leading-4">
              <span className="truncate font-mono">{metaText}</span>
              {filterStarred && (
                <span className="shrink-0 text-foreground-secondary">
                  星标 {starredCount}/{snapshot.workspaces.length}
                </span>
              )}
              {hiddenCount > 0 && (
                <span
                  className="shrink-0 text-foreground-tertiary"
                  title={`另有 ${hiddenCount} 个 client 的 Root 不在本机，已隐藏`}
                >
                  隐藏 {hiddenCount}
                </span>
              )}
            </div>
          )}
          {view === 'list' ? (
            <ListView
              workspaces={workspaces}
              openingName={openingName}
              openingP4VName={openingP4VName}
              favorites={favorites}
              labels={labels}
              reorder={reorder}
              dropIndex={dropIndex}
              onOpen={openRoot}
              onOpenP4V={openP4V}
              onCopy={copyText}
              onToggleFavorite={toggleFavorite}
              onEditLabel={setEditingLabelName}
            />
          ) : (
            <CardView
              workspaces={workspaces}
              openingName={openingName}
              openingP4VName={openingP4VName}
              favorites={favorites}
              labels={labels}
              reorder={reorder}
              dropIndex={dropIndex}
              onOpen={openRoot}
              onOpenP4V={openP4V}
              onCopy={copyText}
              onToggleFavorite={toggleFavorite}
              onEditLabel={setEditingLabelName}
            />
          )}
          {editingLabelName && (
            <LabelEditor
              name={editingLabelName}
              label={labels[editingLabelName]}
              saving={labelSaving}
              onSave={saveLabel}
              onClose={() => setEditingLabelName(null)}
            />
          )}
        </div>
      )}
    </Panel>
  )
}

interface ViewCommonProps {
  workspaces: P4Workspace[]
  openingName: string | null
  openingP4VName: string | null
  /** 已收藏的 client 名集合 */
  favorites: Set<string>
  /** 徽标自定义映射：client 名 → {badge?, color?} */
  labels: WorkspaceLabels
  reorder: ReorderProps
  dropIndex: number | null
  onOpen: (ws: P4Workspace) => void
  onOpenP4V: (ws: P4Workspace) => void
  onCopy: (text: string, label: string) => void
  /** 切换某个 client 的收藏状态 */
  onToggleFavorite: (name: string) => void
  /** 点击徽标进入编辑态 */
  onEditLabel: (name: string) => void
}

/** 图标字母上限（与 electron/main/ipc.ts 的 MAX_BADGE_LENGTH 一致） */
const MAX_BADGE_LENGTH = 2

/** 拖动排序所需的回调集合，由面板持有状态、下发给列表/卡片条目 */
interface ReorderProps {
  draggingName: string | null
  onDragStart: (name: string) => void
  onDragEnd: () => void
  onDragOverRow: (index: number, e: React.DragEvent<HTMLElement>) => void
  onDropRow: (index: number, e: React.DragEvent<HTMLElement>) => void
  onMove: (name: string, delta: number) => void
}

/** 插入指示线的位置：top = 落在该条目之前，bottom = 之后 */
type DropEdge = 'top' | 'bottom' | null

const DROP_EDGE_CLASS: Record<'top' | 'bottom', string> = {
  top: 'shadow-[inset_0_2px_0_0_var(--color-primary)]',
  bottom: 'shadow-[inset_0_-2px_0_0_var(--color-primary)]',
}

function edgeAt(index: number, dropIndex: number | null, total: number): DropEdge {
  if (dropIndex === null) return null
  if (dropIndex === index) return 'top'
  if (dropIndex === total && index === total - 1) return 'bottom'
  return null
}

/**
 * client 标识徽标：优先用用户自定义的 badge/color，回退派生值。
 * 点击徽标进入编辑态（onEditLabel），与常用目录面板的图标编辑一致。
 */
function WorkspaceBadge({
  ws,
  labels,
  size = 22,
  onEdit,
}: {
  ws: P4Workspace
  labels?: WorkspaceLabels
  size?: number
  onEdit?: () => void
}) {
  const color = resolveWorkspaceColor(ws.name, labels)
  const badge = resolveWorkspaceBadge(ws.name, labels)
  const interactive = !!onEdit
  return (
    <span
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      data-no-open
      // 徽标本身可拖拽：从徽标发起的 dragstart 会冒泡到行级 onDragStart，
      // 让用户能从图标位置直接拖动整行排序（与从名称/路径区域拖动一致）。
      draggable
      onClick={
        interactive
          ? (e) => {
              // 阻止冒泡到行级 onClick（打开目录），徽标只触发编辑
              e.stopPropagation()
              onEdit()
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onEdit?.()
              }
            }
          : undefined
      }
      className={`flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none ${
        interactive ? 'cursor-pointer hover:ring-2 hover:ring-primary/40 focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary' : ''
      }`}
      style={{ width: size, height: size, backgroundColor: color, fontSize: Math.round(size * 0.42) }}
      title={interactive ? `${ws.name}（点击编辑徽标）` : ws.name}
      aria-label={interactive ? `编辑 ${ws.name} 徽标` : undefined}
    >
      {badge}
    </span>
  )
}

/**
 * 星标按钮：已收藏时常驻可见且实心琥珀色，使「已收藏」状态在静态界面下一眼可辨；
 * 未收藏时随行 hover / focus 显隐，与打开 / 复制等操作保持一致的克制风格。
 * 点击事件内部 stopPropagation，避免触发行级「打开工作区」。
 */
function StarButton({
  starred,
  size = 14,
  onToggle,
}: {
  starred: boolean
  size?: number
  onToggle: () => void
}) {
  return (
    <AppButton
      variant="ghost"
      size="sm"
      data-no-open
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`!px-1 transition-opacity ${
        starred ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
      }`}
      style={starred ? { color: STAR_AMBER } : undefined}
      aria-label={starred ? '取消星标' : '添加星标'}
      title={starred ? '取消星标' : '添加星标'}
      aria-pressed={starred}
    >
      <StarIcon size={size} fill={starred ? 'currentColor' : 'none'} />
    </AppButton>
  )
}

/** 行内操作按钮（打开 / P4V / 复制）：统一 hover/focus 显隐与 stopPropagation */
function RowActions({
  ws,
  opening,
  openingP4V,
  onOpen,
  onOpenP4V,
  onCopy,
  iconSize = 14,
}: {
  ws: P4Workspace
  opening: boolean
  openingP4V: boolean
  onOpen: () => void
  onOpenP4V: () => void
  onCopy: () => void
  iconSize?: number
}) {
  return (
    <div
      data-no-open
      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
    >
      <AppButton
        variant="ghost"
        size="sm"
        loading={opening}
        onClick={(e) => {
          e.stopPropagation()
          onOpen()
        }}
        className="!px-1"
        aria-label="在资源管理器中打开"
        title="在资源管理器中打开"
      >
        <FolderOpenIcon size={iconSize} />
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        loading={openingP4V}
        onClick={(e) => {
          e.stopPropagation()
          onOpenP4V()
        }}
        className="!px-1"
        aria-label="在 P4V 中打开"
        title="在 P4V 中打开此工作区"
      >
        <P4VWindowIcon size={iconSize} style={{ color: PERFORCE_BLUE }} />
      </AppButton>
      <AppButton
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation()
          onCopy()
        }}
        className="!px-1"
        aria-label="复制路径"
        title="复制路径"
      >
        <CopyIcon size={iconSize - 1} />
      </AppButton>
    </div>
  )
}

/* ---------- 徽标内联编辑浮层 ---------- */

/**
 * 徽标内联编辑浮层：fixed 遮罩 + 居中弹窗，覆盖整个视口。
 * 与常用目录面板的 EditRow 不同：P4 是只读快照，只能改徽标（badge + color），
 * 不能改名称/路径；保存后落盘 labels，清空两者则删除该 client 的 label。
 * 点击遮罩或 Esc 关闭。
 * 用 fixed 定位而非 absolute：避免父容器缺少 relative 导致浮层定位偏移、
 * 保存按钮点击不到；遮罩层拦截下方所有点击，杜绝穿透到行级「打开工作区」。
 */
function LabelEditor({
  name,
  label,
  saving,
  onSave,
  onClose,
}: {
  name: string
  label?: WorkspaceLabel
  saving: boolean
  onSave: (name: string, badge: string, color: string | null) => void
  onClose: () => void
}) {
  const [badge, setBadge] = useState(label?.badge ?? '')
  const [color, setColor] = useState<string | null>(label?.color ?? null)

  // Esc 关闭：onClose 用 ref 持有，避免依赖变化导致 effect 重注册抖动
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const previewColor = color ?? deriveDirectoryColor(name)
  const previewBadge = badge.trim().slice(0, MAX_BADGE_LENGTH) || deriveWorkspaceBadge(name)

  const submit = () => onSave(name, badge, color)

  return (
    // 遮罩层：fixed 铺满视口，点击空白处关闭，拦截对下层行/按钮的点击
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        // 点击遮罩本身（非弹窗）才关闭
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`编辑 ${name} 徽标`}
        onClick={(e) => e.stopPropagation()}
        className="w-[280px] flex flex-col gap-2 p-3 rounded-md border border-primary/40 bg-surface-2 shadow-lg"
      >
        <div className="flex items-center gap-2">
          <span
            className="flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none"
            style={{
              width: 28,
              height: 28,
              backgroundColor: previewColor,
              fontSize: previewBadge.length >= 2 ? 12 : 14,
            }}
            title="图标预览"
            aria-hidden
          >
            {previewBadge ? previewBadge : <FolderSolidIcon size={16} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-foreground truncate leading-5">{name}</div>
            <div className="text-xs text-foreground-tertiary leading-4">点击徽标可编辑标识</div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground-tertiary leading-4" htmlFor="ws-badge">
            图标字母（最多 {MAX_BADGE_LENGTH} 个，支持小写）
          </label>
          <div className="flex items-center gap-1.5">
            <AppInput
              id="ws-badge"
              block={false}
              className="w-20"
              placeholder="自动"
              value={badge}
              onChange={(e) => setBadge(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  submit()
                }
              }}
              aria-label="图标字母"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-tertiary leading-4">图标颜色</span>
          <ColorSwatches
            value={color}
            onChange={setColor}
            label="徽标颜色"
            autoTitle="自动（按 client 名派生）"
          />
        </div>
        <div className="flex justify-end gap-1.5">
          <AppButton variant="ghost" onClick={onClose}>
            取消
          </AppButton>
          <AppButton variant="primary" onClick={submit} loading={saving}>
            保存
          </AppButton>
        </div>
      </div>
    </div>
  )
}

function ListView({
  workspaces,
  openingName,
  openingP4VName,
  favorites,
  labels,
  reorder,
  dropIndex,
  onOpen,
  onOpenP4V,
  onCopy,
  onToggleFavorite,
  onEditLabel,
}: ViewCommonProps) {
  return (
    // 列表视图按表格处理：外框 + 斑马纹（奇数行底色），行间不留缝以便条纹连续
    <div className="flex flex-col rounded-md border border-border-subtle overflow-hidden">
      {workspaces.map((ws, index) => {
        const dragging = reorder.draggingName === ws.name
        return (
          <div
            key={ws.name}
            role="button"
            tabIndex={0}
            draggable
            onClick={(e) => {
              // 兜底：若点击源自徽标/操作按钮等带 data-no-open 的子元素，跳过打开目录
              if ((e.target as HTMLElement).closest('[data-no-open]')) return
              onOpen(ws)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(ws)
              }
              // Alt + ↑/↓ 是拖放的键盘等价操作
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                reorder.onMove(ws.name, e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(REORDER_MIME, ws.name)
              e.dataTransfer.setData('text/plain', ws.name)
              e.dataTransfer.effectAllowed = 'move'
              reorder.onDragStart(ws.name)
            }}
            onDragEnd={reorder.onDragEnd}
            onDragOver={(e) => reorder.onDragOverRow(index, e)}
            onDrop={(e) => reorder.onDropRow(index, e)}
            className={`group flex items-center gap-2 h-11 px-2.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
              index % 2 === 1 ? 'bg-surface-2' : 'bg-surface-1'
            } ${dragging ? 'opacity-40' : ''} ${
              edgeAt(index, dropIndex, workspaces.length) ? DROP_EDGE_CLASS[edgeAt(index, dropIndex, workspaces.length)!] : ''
            }`}
            title={`打开 ${ws.root}（拖动可排序，Alt+↑/↓ 亦可）`}
          >
            <WorkspaceBadge
              ws={ws}
              labels={labels}
              size={22}
              onEdit={() => onEditLabel(ws.name)}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] text-foreground truncate leading-5">{ws.name}</span>
                {ws.stream && (
                  <span className="flex items-center gap-0.5 min-w-0 text-xs text-foreground-tertiary truncate leading-4">
                    <BranchIcon size={12} />
                    <span className="truncate">{ws.stream}</span>
                  </span>
                )}
              </div>
              <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">
                {ws.root}
              </div>
            </div>
            <StarButton starred={favorites.has(ws.name)} onToggle={() => onToggleFavorite(ws.name)} />
            <RowActions
              ws={ws}
              opening={openingName === ws.name}
              openingP4V={openingP4VName === ws.name}
              onOpen={() => onOpen(ws)}
              onOpenP4V={() => onOpenP4V(ws)}
              onCopy={() => void onCopy(ws.root, '工作区路径')}
            />
          </div>
        )
      })}
    </div>
  )
}

function CardView({
  workspaces,
  openingName,
  openingP4VName,
  favorites,
  labels,
  reorder,
  dropIndex,
  onOpen,
  onOpenP4V,
  onCopy,
  onToggleFavorite,
  onEditLabel,
}: ViewCommonProps) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
      {workspaces.map((ws, index) => {
        const dragging = reorder.draggingName === ws.name
        return (
          <div
            key={ws.name}
            role="button"
            tabIndex={0}
            draggable
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-no-open]')) return
              onOpen(ws)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onOpen(ws)
              }
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                reorder.onMove(ws.name, e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(REORDER_MIME, ws.name)
              e.dataTransfer.setData('text/plain', ws.name)
              e.dataTransfer.effectAllowed = 'move'
              reorder.onDragStart(ws.name)
            }}
            onDragEnd={reorder.onDragEnd}
            onDragOver={(e) => reorder.onDragOverRow(index, e)}
            onDrop={(e) => reorder.onDropRow(index, e)}
            className={`group relative overflow-hidden flex flex-col gap-1.5 p-3 rounded-md border border-border-subtle bg-surface-1 hover:border-primary hover:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
              dragging ? 'opacity-40' : ''
            } ${edgeAt(index, dropIndex, workspaces.length) ? DROP_EDGE_CLASS[edgeAt(index, dropIndex, workspaces.length)!] : ''}`}
            title={`打开 ${ws.root}（拖动可排序，Alt+↑/↓ 亦可）`}
          >
            <div className="flex items-start justify-between gap-2">
              <WorkspaceBadge
                ws={ws}
                labels={labels}
                size={26}
                onEdit={() => onEditLabel(ws.name)}
              />
              <div className="flex items-center gap-0.5">
                <StarButton
                  starred={favorites.has(ws.name)}
                  size={13}
                  onToggle={() => onToggleFavorite(ws.name)}
                />
                <RowActions
                  ws={ws}
                  opening={openingName === ws.name}
                  openingP4V={openingP4VName === ws.name}
                  onOpen={() => onOpen(ws)}
                  onOpenP4V={() => onOpenP4V(ws)}
                  onCopy={() => void onCopy(ws.root, '工作区路径')}
                  iconSize={13}
                />
              </div>
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-medium text-foreground truncate leading-5">
                {ws.name}
              </span>
            </div>
            <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">
              {ws.root}
            </div>
            {ws.stream && (
              <div className="flex items-center gap-1 min-w-0 text-xs text-foreground-tertiary leading-4">
                <BranchIcon size={12} />
                <span className="truncate">{ws.stream}</span>
              </div>
            )}
            {/* 悬浮大方形按钮：仅在卡片视图、鼠标 hover 时显示，右下角铺底更显眼。
              方形（宽高一致，只含 "P4V" 文字，上下左右居中），尺寸 64px 见方。
              背景用 P4V 专属蓝（PERFORCE_BLUE），hover/active 沿用同色系深浅过渡。
              data-no-open 阻止冒泡到卡片 onClick（打开目录），点击只触发 P4V 打开。
              pointer-events 仅在 hover 时启用，避免遮挡卡片其余区域的点击。 */}
            <AppButton
              variant="primary"
              size="md"
              data-no-open
              loading={openingP4VName === ws.name}
              onClick={(e) => {
                e.stopPropagation()
                onOpenP4V(ws)
              }}
              className="!w-16 !h-16 !px-0 absolute bottom-2 right-2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto focus-visible:opacity-100 focus-visible:pointer-events-auto transition-opacity !bg-[#42A2DC] hover:!bg-[#2E8FCC] active:!bg-[#1F7BB8]"
              aria-label="在 P4V 中打开此工作区"
              title="在 P4V 中打开此工作区"
            >
              <span className="text-[15px] font-bold leading-none tracking-wide">P4V</span>
            </AppButton>
          </div>
        )
      })}
    </div>
  )
}
