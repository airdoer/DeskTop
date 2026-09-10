import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import { ColorSwatches } from '@/components/ui/ColorSwatches'
import { ViewModeToggle } from '@/components/ui/ViewModeToggle'
import {
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  GlobeIcon,
  GlobeSolidIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons'
import { WEBSITE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import { deriveDirectoryBadge, deriveDirectoryColor, moveItem } from '@/services/quickDirectories'
import {
  buildWebsiteLists,
  deriveWebsiteName,
  EMPTY_WEBSITE_CONFIG,
  genWebsiteId,
  getWebsiteConfig,
  MAX_BADGE_LENGTH,
  MAX_CUSTOM_WEBSITES,
  normalizeWebsiteUrl,
  openWebsite,
  orderOf,
  resolveWebsiteBadge,
  resolveWebsiteColor,
  saveWebsiteConfig,
  type Website,
  type WebsiteConfig,
} from '@/services/websites'
import {
  WEBSITES_VIEW_KEY,
  readViewMode,
  saveViewMode,
  type ViewMode,
} from '@/services/uiPreferences'

/*
 * WebsitesPanel — Business Feature：常用内网站点快捷入口.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26：shell.openExternal 经 websites Service（IPC）调用，
 *   站内链接一律在系统默认浏览器中打开（企业站点多为 SSO 登录态，内嵌窗口会丢失登录态）；
 * §21 Empty State 清晰可操作；§11.1 操作反馈用 Toast。
 *
 * 数据分层：
 *   - 内置站点：来自 src/features/websites/presets.ts，UI 只读，只能「隐藏 / 恢复」
 *   - 自定义站点：用户自行添加（名称 / 链接 / 颜色 / 徽标），可编辑、可删除
 *   - 顺序与隐藏：随配置一起落盘到 Main Process（userData/frequent-websites.json）
 *
 * 四项能力：
 *   1. 卡片 / 列表双视图（偏好持久化，与常用目录、P4 工作区一致的 ViewModeToggle）
 *   2. 拖动排序（内置与自定义混排），并提供 Alt+↑/↓ 键盘等价操作
 *   3. 自定义站点 CRUD（链接校验为 http/https，缺协议时自动补 https）
 *   4. 内置站点可隐藏，隐藏后在底部「已隐藏」区一键恢复
 *
 * 两类拖拽如何区分：本面板只处理内部排序（自定义 MIME REORDER_MIME），
 * 不接受外部文件拖入——拖入目录/文件没有语义，故不注册文件 drop。
 */

type PanelViewMode = ViewMode

/** 内部排序拖拽的私有 MIME：与系统文件拖入区分（types 在 dragover 阶段可读） */
const REORDER_MIME = 'application/x-c7-website-id'

export function WebsitesPanel() {
  const [config, setConfig] = useState<WebsiteConfig>(EMPTY_WEBSITE_CONFIG)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [view, setView] = useState<PanelViewMode>('list')

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formUrl, setFormUrl] = useState('')
  const [formBadge, setFormBadge] = useState('')
  const [formColor, setFormColor] = useState<string | null>(null)

  // 拖动排序：被拖条目 id + 插入位置（0..length，等于 length 表示末尾）
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // dragId 用 ref 同步持有：避免 React 批处理导致 onDragOver 首次读到 null 而漏掉
  // preventDefault（那样 drop 目标收不到 drop 事件，排序会静默失败）
  const dragIdRef = useRef<string | null>(null)

  const { visible, hidden } = useMemo(() => buildWebsiteLists(config), [config])

  // 视图偏好读取：异步来自 Main Process，首帧用默认值，读回后立即纠正
  const [viewLoaded, setViewLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void readViewMode(WEBSITES_VIEW_KEY).then((mode) => {
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
    void saveViewMode(WEBSITES_VIEW_KEY, view)
  }, [view, viewLoaded])

  useEffect(() => {
    let alive = true
    void getWebsiteConfig()
      .then((loaded) => {
        if (!alive) return
        setConfig(loaded)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [])

  /** 统一落盘：先本地更新保证交互即时，再用 Main 净化后的结果校正 */
  const commit = useCallback(async (next: WebsiteConfig) => {
    setConfig(next)
    try {
      setConfig(await saveWebsiteConfig(next))
    } catch {
      toast.error('保存失败')
    }
  }, [])

  /* ---------- 打开 ---------- */

  const openSite = useCallback(async (site: Website) => {
    setOpeningId(site.id)
    try {
      const res = await openWebsite(site.url)
      if (res.ok) toast.success(`已在浏览器中打开 ${site.name}`)
      else toast.error(`打开失败：${res.error ?? '未知错误'}`)
    } finally {
      setOpeningId(null)
    }
  }, [])

  /* ---------- 增删改 ---------- */

  const openAdd = () => {
    setEditingId(null)
    setFormName('')
    setFormUrl('')
    setFormBadge('')
    setFormColor(null)
    setFormOpen(true)
  }

  const openEdit = (site: Website) => {
    setEditingId(site.id)
    setFormName(site.name)
    setFormUrl(site.url)
    setFormBadge(site.badge ?? '')
    setFormColor(site.color ?? null)
    setFormOpen(true)
  }

  const cancelForm = () => setFormOpen(false)

  const saveForm = useCallback(async () => {
    const url = normalizeWebsiteUrl(formUrl)
    if (!url) {
      // 提示里带上实际收到的内容：链接框留空（填到了名称框）与链接非法是两种常见误操作
      const trimmed = formUrl.trim()
      toast.warning(
        trimmed
          ? `链接无效：${trimmed.slice(0, 40)}，仅支持 http/https`
          : '请填写链接（在「名称」右侧的输入框）',
      )
      return
    }
    const name = formName.trim().slice(0, 40) || deriveWebsiteName(url)
    const color = formColor ?? undefined
    const badge = formBadge.trim().slice(0, MAX_BADGE_LENGTH) || undefined

    setSaving(true)
    try {
      const next: WebsiteConfig = editingId
        ? {
            ...config,
            custom: config.custom.map((w) =>
              w.id === editingId ? { ...w, name, url, color, badge } : w,
            ),
          }
        : { ...config, custom: [...config.custom, { id: genWebsiteId(), name, url, color, badge }] }
      await commit(next)
      setFormOpen(false)
      toast.success(editingId ? '网站已更新' : '网站已添加')
    } finally {
      setSaving(false)
    }
  }, [commit, config, editingId, formBadge, formColor, formName, formUrl])

  const removeSite = useCallback(
    (site: Website) => {
      void commit({
        ...config,
        custom: config.custom.filter((w) => w.id !== site.id),
        // 一并清理该站点残留的排序/隐藏记录，避免配置里堆积无效 id
        order: config.order.filter((id) => id !== site.id),
        hidden: config.hidden.filter((id) => id !== site.id),
      })
      toast.success('已删除')
    },
    [commit, config],
  )

  const hideSite = useCallback(
    (site: Website) => {
      if (config.hidden.includes(site.id)) return
      void commit({ ...config, hidden: [...config.hidden, site.id] })
      toast.success(`已隐藏 ${site.name}`)
    },
    [commit, config],
  )

  const restoreSite = useCallback(
    (site: Website) => {
      void commit({ ...config, hidden: config.hidden.filter((id) => id !== site.id) })
      toast.success(`已恢复 ${site.name}`)
    },
    [commit, config],
  )

  const restoreAll = useCallback(() => {
    void commit({ ...config, hidden: [] })
    toast.success('已恢复全部隐藏站点')
  }, [commit, config])

  /* ---------- 拖动排序 ---------- */

  const clearReorder = useCallback(() => {
    dragIdRef.current = null
    setDragId(null)
    setDropIndex(null)
  }, [])

  /** 落盘新顺序：把当前可见顺序整体写回 order（内置与自定义混排） */
  const persistOrder = useCallback(
    async (next: Website[]) => {
      const order = orderOf(next)
      setConfig((prev) => ({ ...prev, order }))
      try {
        setConfig(await saveWebsiteConfig({ ...config, order }))
      } catch {
        toast.error('排序保存失败')
      }
    },
    [config],
  )

  /** 落盘新顺序：to 为插入位置（0..length，length 表示末尾） */
  const commitReorder = useCallback(
    (to: number) => {
      const id = dragIdRef.current
      if (!id) return
      const from = visible.findIndex((w) => w.id === id)
      clearReorder()
      if (from < 0) return
      const next = moveItem(visible, from, to)
      if (next.every((w, i) => w.id === visible[i].id)) return
      void persistOrder(next)
    },
    [clearReorder, persistOrder, visible],
  )

  /** Alt + ↑/↓：拖放的键盘等价入口，保证无鼠标场景也能调整顺序 */
  const moveByKeyboard = useCallback(
    (id: string, delta: number) => {
      const from = visible.findIndex((w) => w.id === id)
      if (from < 0) return
      const to = delta > 0 ? from + delta + 1 : from + delta
      if (to < 0 || to > visible.length) return
      void persistOrder(moveItem(visible, from, to))
    },
    [persistOrder, visible],
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
    draggingId: dragId,
    onDragStart: (id) => {
      dragIdRef.current = id
      setDragId(id)
    },
    onDragEnd: clearReorder,
    onDragOverRow: (index, e) => {
      if (!dragIdRef.current) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropIndex(insertIndexAt(index, e))
    },
    onDropRow: (index, e) => {
      if (!dragIdRef.current) return
      e.preventDefault()
      e.stopPropagation()
      commitReorder(insertIndexAt(index, e))
    },
    onMove: moveByKeyboard,
  }

  const atLimit = config.custom.length >= MAX_CUSTOM_WEBSITES
  const showEmpty = !loading && visible.length === 0 && !formOpen

  return (
    <Panel
      title="常用网站"
      icon={<GlobeSolidIcon size={14} style={{ color: WEBSITE_BLUE }} />}
      help="内置站点可隐藏，自定义站点可增删改；点击条目在系统默认浏览器中打开，拖动条目可调整顺序（Alt+↑/↓ 亦可）"
      actions={
        <>
          <ViewModeToggle mode={view} onChange={setView} label="常用网站视图模式" />
          <AppButton
            variant="primary"
            size="sm"
            onClick={openAdd}
            disabled={atLimit}
            title={atLimit ? `自定义站点已达上限 ${MAX_CUSTOM_WEBSITES} 个` : undefined}
          >
            <PlusIcon size={14} />
            添加网站
          </AppButton>
        </>
      }
    >
      {loading ? (
        <div className="text-xs text-foreground-tertiary py-2">加载中…</div>
      ) : (
        <div className="flex flex-col gap-2">
          {formOpen && (
            <EditRow
              formName={formName}
              formUrl={formUrl}
              formBadge={formBadge}
              formColor={formColor}
              editing={!!editingId}
              saving={saving}
              onName={setFormName}
              onUrl={setFormUrl}
              onBadge={setFormBadge}
              onColor={setFormColor}
              onSave={saveForm}
              onCancel={cancelForm}
            />
          )}

          {showEmpty ? (
            <div className="flex flex-col items-start gap-1 py-3">
              <p className="text-[13px] text-foreground-secondary">暂无常用网站</p>
              <p className="text-xs text-foreground-tertiary">
                点击右上「添加网站」新增，或在底部「已隐藏」区恢复内置站点。
              </p>
            </div>
          ) : visible.length > 0 ? (
            view === 'list' ? (
              <ListView
                sites={visible}
                openingId={openingId}
                reorder={reorder}
                dropIndex={dropIndex}
                onOpen={openSite}
                onEdit={openEdit}
                onHide={hideSite}
                onRemove={removeSite}
              />
            ) : (
              <CardView
                sites={visible}
                openingId={openingId}
                reorder={reorder}
                dropIndex={dropIndex}
                onOpen={openSite}
                onEdit={openEdit}
                onHide={hideSite}
                onRemove={removeSite}
              />
            )
          ) : null}

          {hidden.length > 0 && (
            <HiddenSection
              sites={hidden}
              onRestore={restoreSite}
              onRestoreAll={restoreAll}
            />
          )}
        </div>
      )}
    </Panel>
  )
}

/* ---------- 子组件 ---------- */

/** 站点徽标：标识色方块 + ≤2 字符文字，用于列表/卡片中快速识别 */
function SiteBadge({ site, size = 22 }: { site: Website; size?: number }) {
  const color = resolveWebsiteColor(site)
  const badge = resolveWebsiteBadge(site)
  const fontSize = badge.length >= 2 ? Math.round(size * 0.42) : Math.round(size * 0.52)
  return (
    <span
      className="flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none"
      style={{ width: size, height: size, backgroundColor: color, fontSize }}
      title={badge ? `${site.name}（${badge}）` : site.name}
      aria-hidden
    >
      {badge ? badge : <GlobeIcon size={Math.round(size * 0.58)} />}
    </span>
  )
}

/** 拖动排序所需的回调集合，由面板持有状态、下发给列表/卡片条目 */
interface ReorderProps {
  draggingId: string | null
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOverRow: (index: number, e: React.DragEvent<HTMLElement>) => void
  onDropRow: (index: number, e: React.DragEvent<HTMLElement>) => void
  onMove: (id: string, delta: number) => void
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

interface ViewCommonProps {
  sites: Website[]
  openingId: string | null
  reorder: ReorderProps
  dropIndex: number | null
  onOpen: (site: Website) => void
  onEdit: (site: Website) => void
  onHide: (site: Website) => void
  onRemove: (site: Website) => void
}

/**
 * 行内操作按钮：
 *   - 打开（外链，任何站点都有）
 *   - 编辑 / 删除：仅自定义站点
 *   - 隐藏：仅内置站点
 * 内置与自定义互斥，避免出现「内置项删不掉、自定义项隐藏后无法彻底清除」的歧义。
 */
function RowActions({
  site,
  opening,
  onOpen,
  onEdit,
  onHide,
  onRemove,
  iconSize = 14,
}: {
  site: Website
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onHide: () => void
  onRemove: () => void
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
        aria-label="在浏览器中打开"
        title="在浏览器中打开"
      >
        <ExternalLinkIcon size={iconSize} />
      </AppButton>
      {site.builtin ? (
        <AppButton
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onHide()
          }}
          className="!px-1"
          aria-label="隐藏"
          title="隐藏此站点"
        >
          <EyeOffIcon size={iconSize} />
        </AppButton>
      ) : (
        <>
          <AppButton
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onEdit()
            }}
            className="!px-1"
            aria-label="编辑"
            title="编辑"
          >
            <PencilIcon size={iconSize} />
          </AppButton>
          <AppButton
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onRemove()
            }}
            className="!px-1 hover:text-error"
            aria-label="删除"
            title="删除"
          >
            <TrashIcon size={iconSize} />
          </AppButton>
        </>
      )}
    </div>
  )
}

function ListView({
  sites,
  openingId,
  reorder,
  dropIndex,
  onOpen,
  onEdit,
  onHide,
  onRemove,
}: ViewCommonProps) {
  return (
    // 列表视图按表格处理：外框 + 斑马纹（奇数行底色），行间不留缝以便条纹连续
    <div className="flex flex-col rounded-md border border-border-subtle overflow-hidden">
      {sites.map((site, index) => {
        const dragging = reorder.draggingId === site.id
        const edge = edgeAt(index, dropIndex, sites.length)
        return (
          <div
            key={site.id}
            role="button"
            tabIndex={0}
            draggable
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-no-open]')) return
              void onOpen(site)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void onOpen(site)
              }
              // Alt + ↑/↓ 是拖放的键盘等价操作
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                reorder.onMove(site.id, e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(REORDER_MIME, site.id)
              e.dataTransfer.setData('text/plain', site.id)
              e.dataTransfer.effectAllowed = 'move'
              reorder.onDragStart(site.id)
            }}
            onDragEnd={reorder.onDragEnd}
            onDragOver={(e) => reorder.onDragOverRow(index, e)}
            onDrop={(e) => reorder.onDropRow(index, e)}
            className={`group flex items-center gap-2 h-10 px-2.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
              index % 2 === 1 ? 'bg-surface-2' : 'bg-surface-1'
            } ${dragging ? 'opacity-40' : ''} ${edge ? DROP_EDGE_CLASS[edge] : ''}`}
            title={`打开 ${site.url}（拖动可排序，Alt+↑/↓ 亦可）`}
          >
            <SiteBadge site={site} size={22} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-[13px] text-foreground truncate leading-5">{site.name}</span>
                {!site.builtin && (
                  <span className="shrink-0 text-[10px] leading-4 px-1 rounded-sm border border-border text-foreground-tertiary">
                    自定义
                  </span>
                )}
              </div>
              <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">
                {site.url}
              </div>
            </div>
            <RowActions
              site={site}
              opening={openingId === site.id}
              onOpen={() => void onOpen(site)}
              onEdit={() => onEdit(site)}
              onHide={() => onHide(site)}
              onRemove={() => onRemove(site)}
            />
          </div>
        )
      })}
    </div>
  )
}

function CardView({
  sites,
  openingId,
  reorder,
  dropIndex,
  onOpen,
  onEdit,
  onHide,
  onRemove,
}: ViewCommonProps) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
      {sites.map((site, index) => {
        const dragging = reorder.draggingId === site.id
        const edge = edgeAt(index, dropIndex, sites.length)
        return (
          <div
            key={site.id}
            role="button"
            tabIndex={0}
            draggable
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('[data-no-open]')) return
              void onOpen(site)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                void onOpen(site)
              }
              if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                e.preventDefault()
                reorder.onMove(site.id, e.key === 'ArrowUp' ? -1 : 1)
              }
            }}
            onDragStart={(e) => {
              e.dataTransfer.setData(REORDER_MIME, site.id)
              e.dataTransfer.setData('text/plain', site.id)
              e.dataTransfer.effectAllowed = 'move'
              reorder.onDragStart(site.id)
            }}
            onDragEnd={reorder.onDragEnd}
            onDragOver={(e) => reorder.onDragOverRow(index, e)}
            onDrop={(e) => reorder.onDropRow(index, e)}
            className={`group relative flex flex-col gap-1.5 p-3 rounded-md border border-border-subtle bg-surface-1 hover:border-primary hover:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
              dragging ? 'opacity-40' : ''
            } ${edge ? DROP_EDGE_CLASS[edge] : ''}`}
            title={`打开 ${site.url}（拖动可排序，Alt+↑/↓ 亦可）`}
          >
            <div className="flex items-start justify-between gap-2">
              <SiteBadge site={site} size={26} />
              <RowActions
                site={site}
                opening={openingId === site.id}
                onOpen={() => void onOpen(site)}
                onEdit={() => onEdit(site)}
                onHide={() => onHide(site)}
                onRemove={() => onRemove(site)}
                iconSize={13}
              />
            </div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-medium text-foreground truncate leading-5">
                {site.name}
              </span>
              {!site.builtin && (
                <span className="shrink-0 text-[10px] leading-4 px-1 rounded-sm border border-border text-foreground-tertiary">
                  自定义
                </span>
              )}
            </div>
            <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">
              {site.url}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 已隐藏区：内置站点隐藏后在此集中呈现，点击单项恢复或一键全部恢复。
 * 放在列表下方而非顶部，避免占据主视线的同时保证「隐藏了什么」一直可见。
 */
function HiddenSection({
  sites,
  onRestore,
  onRestoreAll,
}: {
  sites: Website[]
  onRestore: (site: Website) => void
  onRestoreAll: () => void
}) {
  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-foreground-tertiary leading-4">
          已隐藏 {sites.length} 个内置站点
        </span>
        <AppButton variant="link" size="sm" onClick={onRestoreAll}>
          全部恢复
        </AppButton>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {sites.map((site) => (
          <button
            key={site.id}
            type="button"
            onClick={() => onRestore(site)}
            title={`恢复 ${site.name}（${site.url}）`}
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md border border-border-subtle bg-surface-2 text-xs text-foreground-secondary hover:border-primary hover:text-primary transition-colors"
          >
            <SiteBadge site={site} size={16} />
            <span className="truncate max-w-[140px]">{site.name}</span>
            <EyeIcon size={13} />
          </button>
        ))}
      </div>
    </div>
  )
}

function EditRow({
  formName,
  formUrl,
  formBadge,
  formColor,
  editing,
  saving,
  onName,
  onUrl,
  onBadge,
  onColor,
  onSave,
  onCancel,
}: {
  formName: string
  formUrl: string
  formBadge: string
  formColor: string | null
  editing: boolean
  saving: boolean
  onName: (v: string) => void
  onUrl: (v: string) => void
  onBadge: (v: string) => void
  onColor: (v: string | null) => void
  onSave: () => void
  onCancel: () => void
}) {
  const normalized = normalizeWebsiteUrl(formUrl)
  const tooLongBadge = formBadge.trim().length > MAX_BADGE_LENGTH
  const invalidUrl = formUrl.trim().length > 0 && !normalized
  const previewName = formName.trim() || (normalized ? deriveWebsiteName(normalized) : '')
  const previewColor = formColor ?? deriveDirectoryColor(normalized ?? previewName ?? 'preview')
  const previewBadge =
    formBadge.trim().slice(0, MAX_BADGE_LENGTH) || deriveDirectoryBadge(previewName)

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md border border-primary/40 bg-surface-2">
      <div className="flex gap-1.5">
        <AppInput
          placeholder="名称（可选，留空则用域名）"
          value={formName}
          onChange={(e) => onName(e.target.value)}
          className="w-48 shrink-0"
          aria-label="网站名称"
        />
        <AppInput
          placeholder="链接，如 https://example.com"
          value={formUrl}
          onChange={(e) => onUrl(e.target.value)}
          onKeyDown={(e) => {
            // 中文输入法用 Enter 确认候选词时不提交：此时输入尚未落到 state，会拿到空值误判无效
            if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
            e.preventDefault()
            onSave()
          }}
          className="flex-1 min-w-0"
          aria-label="网站链接"
          invalid={invalidUrl}
        />
      </div>
      {invalidUrl && (
        <span className="text-xs text-error leading-4">链接无效，仅支持 http / https</span>
      )}
      <div className="flex items-end gap-3 flex-wrap">
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
          {previewBadge ? previewBadge : <GlobeIcon size={16} />}
        </span>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground-tertiary leading-4" htmlFor="website-badge">
            缩写（最多 {MAX_BADGE_LENGTH} 个字）
          </label>
          <AppInput
            id="website-badge"
            block={false}
            className="w-20"
            placeholder="自动"
            value={formBadge}
            invalid={tooLongBadge}
            onChange={(e) => onBadge(e.target.value)}
            aria-label="徽标文字"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-tertiary leading-4">标识颜色</span>
          <ColorSwatches
            value={formColor}
            onChange={onColor}
            label="网站标识颜色"
            autoTitle="自动（按链接分配）"
          />
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <AppButton variant="ghost" onClick={onCancel}>
          取消
        </AppButton>
        <AppButton variant="primary" onClick={onSave} loading={saving}>
          {editing ? '保存' : '添加'}
        </AppButton>
      </div>
    </div>
  )
}
