import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import { ViewModeToggle } from '@/components/ui/ViewModeToggle'
import { ColorSwatches } from '@/components/ui/ColorSwatches'
import {
  FolderIcon,
  FolderOpenIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import {
  deriveDirectoryBadge,
  deriveDirectoryColor,
  getDroppedFilePath,
  listQuickDirectories,
  MAX_QUICK_DIRECTORIES,
  moveItem,
  openDirectory,
  pickDirectory,
  resolveDirectoryBadge,
  resolveDirectoryColor,
  saveQuickDirectories,
  statPath,
  type QuickDirectory,
} from '@/services/quickDirectories'
import {
  PANEL_COLLAPSED_KEYS,
  readQuickDirsViewMode,
  saveQuickDirsViewMode,
  type QuickDirsViewMode,
} from '@/services/uiPreferences'
import { usePanelCollapsed } from '@/hooks/usePanelCollapsed'
import { NavIcon } from '@/shell/NavIcon'

/*
 * QuickDirectoriesPanel — Business Feature：管理最多 MAX_QUICK_DIRECTORIES 个
 * 常用 Windows 资源管理器目录，点击快速跳转。
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，shell.openPath / dialog / webUtils 经 IPC Service；
 * §21 Empty State 清晰、可操作；§11.1 操作反馈用 Toast。
 *
 * 四项能力：
 *   1. 拖拽解析：从资源管理器拖入文件夹即可解析绝对路径并添加（path:stat 校验目录）。
 *   2. 标识徽标：文件夹图标替换为可选颜色徽标，最多 2 个字符（保留用户输入的大小写），
 *      缺省按名称派生。
 *   3. 颜色圆点：列表/卡片视图均展示标识色圆点。
 *   4. 拖动排序：列表/卡片均可拖动条目调整顺序，顺序随业务数据一同落盘。
 *
 * 支持两种视图模式：
 *   - list: 紧凑横向列表，适合信息密度优先（§7 Compact Desktop Density），行间用斑马纹区分
 *   - card: 卡片网格，适合视觉分组与可扫描性
 * 视图偏好经 uiPreferences Service 持久化到 Main Process（不用 localStorage：
 * 生产构建以 file:// 加载，localStorage 不保证持久化）。
 *
 * 两类拖拽如何区分：外部拖入的是文件（dataTransfer.types 含 'Files'），
 * 内部排序拖的是条目（自定义 MIME REORDER_MIME），两者互不影响。
 */

type ViewMode = QuickDirsViewMode

/** 内部排序拖拽的私有 MIME：与系统文件拖入区分（types 在 dragover 阶段可读，getData 不可读） */
const REORDER_MIME = 'application/x-c7-quick-dir-id'

const isReorderDrag = (e: React.DragEvent) =>
  Array.from(e.dataTransfer.types).includes(REORDER_MIME)

function genId(): string {
  return `dir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function QuickDirectoriesPanel() {
  const [dirs, setDirs] = useState<QuickDirectory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>('list')
  const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.quickDirs)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formPath, setFormPath] = useState('')
  const [formColor, setFormColor] = useState<string | null>(null)
  const [formBadge, setFormBadge] = useState('')

  const [dragActive, setDragActive] = useState(false)
  const [dropping, setDropping] = useState(false)
  // 拖动排序：被拖条目 id + 插入位置（0..dirs.length，等于 length 表示末尾）
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  // dragenter/dragleave 会在子元素间反复触发，用深度计数避免高亮闪烁
  const dragDepth = useRef(0)

  // 视图偏好读取：异步来自 Main Process，首帧用默认值，读回后立即纠正
  const [viewLoaded, setViewLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    void readQuickDirsViewMode().then((mode) => {
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
    void saveQuickDirsViewMode(view)
  }, [view, viewLoaded])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDirs(await listQuickDirectories())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openAdd = () => {
    setEditingId(null)
    setFormName('')
    setFormPath('')
    setFormColor(null)
    setFormBadge('')
    setFormOpen(true)
  }

  const openEdit = (dir: QuickDirectory) => {
    setEditingId(dir.id)
    setFormName(dir.name)
    setFormPath(dir.path)
    setFormColor(dir.color ?? null)
    setFormBadge(dir.badge ?? '')
    setFormOpen(true)
  }

  const cancelForm = () => setFormOpen(false)

  const onPickPath = useCallback(async () => {
    try {
      const picked = await pickDirectory()
      if (!picked) return
      setFormPath(picked.path)
      setFormName((prev) => prev || picked.name)
    } catch {
      toast.error('选择目录失败')
    }
  }, [])

  const saveForm = useCallback(async () => {
    const path = formPath.trim()
    if (!path) {
      toast.warning('请选择目录路径')
      return
    }
    const name = (formName.trim() || path.split(/[\\/]/).pop() || path).slice(0, 40)
    const color = formColor ?? undefined
    const badge = formBadge.trim().slice(0, 2) || undefined
    setSaving(true)
    try {
      const next = editingId
        ? dirs.map((d) => (d.id === editingId ? { ...d, name, path, color, badge } : d))
        : [...dirs, { id: genId(), name, path, color, badge }]
      const saved = await saveQuickDirectories(next)
      setDirs(saved)
      setFormOpen(false)
      toast.success(editingId ? '目录已更新' : '目录已添加')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [dirs, editingId, formBadge, formColor, formName, formPath])

  const removeDir = useCallback(async (id: string) => {
    setSaving(true)
    try {
      const saved = await saveQuickDirectories(dirs.filter((d) => d.id !== id))
      setDirs(saved)
      toast.success('已删除')
    } finally {
      setSaving(false)
    }
  }, [dirs])

  /* ---------- 拖动排序 ---------- */

  const clearReorder = useCallback(() => {
    setDragId(null)
    setDropIndex(null)
  }, [])

  const persistOrder = useCallback(async (next: QuickDirectory[]) => {
    setDirs(next)
    try {
      await saveQuickDirectories(next)
    } catch {
      toast.error('排序保存失败')
    }
  }, [])

  /** 落盘新顺序：to 为插入位置（0..length，length 表示末尾） */
  const commitReorder = useCallback(
    (to: number) => {
      if (!dragId) return
      const from = dirs.findIndex((d) => d.id === dragId)
      clearReorder()
      if (from < 0) return
      const next = moveItem(dirs, from, to)
      if (next.every((d, i) => d.id === dirs[i].id)) return
      void persistOrder(next)
    },
    [clearReorder, dirs, dragId, persistOrder],
  )

  /** Alt + ↑/↓：拖放的键盘等价入口，保证无鼠标场景也能调整顺序 */
  const moveByKeyboard = useCallback(
    (id: string, delta: number) => {
      const from = dirs.findIndex((d) => d.id === id)
      if (from < 0) return
      const to = delta > 0 ? from + delta + 1 : from + delta
      if (to < 0 || to > dirs.length) return
      void persistOrder(moveItem(dirs, from, to))
    },
    [dirs, persistOrder],
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
    onDragStart: (id) => setDragId(id),
    onDragEnd: clearReorder,
    onDragOverRow: (index, e) => {
      if (!dragId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropIndex(insertIndexAt(index, e))
    },
    onDropRow: (index, e) => {
      if (!dragId) return
      e.preventDefault()
      e.stopPropagation()
      commitReorder(insertIndexAt(index, e))
    },
    onMove: moveByKeyboard,
  }

  const openDir = useCallback(async (dir: QuickDirectory) => {
    setOpeningId(dir.id)
    try {
      const res = await openDirectory(dir.path)
      if (res.ok) {
        toast.success(`已打开 ${dir.name}`)
      } else {
        toast.error(`打开失败：${res.error ?? '未知错误'}`)
      }
    } finally {
      setOpeningId(null)
    }
  }, [])

  /** 批量落盘：校验为目录 → 与现有项去重 → 受上限约束 */
  const addPaths = useCallback(
    async (rawPaths: string[]) => {
      if (rawPaths.length === 0) return
      setDropping(true)
      try {
        const stats = await Promise.all(rawPaths.map((p) => statPath(p)))
        const valid = stats.filter((s) => s.exists && s.isDirectory)
        if (valid.length === 0) {
          toast.warning('仅支持添加文件夹')
          return
        }

        const known = new Set(dirs.map((d) => d.path.toLowerCase()))
        const accepted: QuickDirectory[] = []
        let duplicated = 0
        for (const item of valid) {
          const key = item.path.toLowerCase()
          if (known.has(key)) {
            duplicated += 1
            continue
          }
          const room = MAX_QUICK_DIRECTORIES - dirs.length - accepted.length
          if (room <= 0) break
          known.add(key)
          accepted.push({ id: genId(), name: item.name || item.path, path: item.path })
        }

        if (accepted.length === 0) {
          toast.warning(duplicated > 0 ? '目录已在列表中' : `最多 ${MAX_QUICK_DIRECTORIES} 个目录`)
          return
        }

        setDirs(await saveQuickDirectories([...dirs, ...accepted]))
        toast.success(`已添加 ${accepted.length} 个目录`)
        const ignored = valid.length - accepted.length - duplicated
        if (ignored > 0) toast.warning(`已达上限，忽略 ${ignored} 个`)
      } catch {
        toast.error('解析目录失败')
      } finally {
        setDropping(false)
      }
    },
    [dirs],
  )

  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  const onDragEnter = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current += 1
    setDragActive(true)
  }

  const onDragOver = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (e: React.DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragActive(false)
  }

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      dragDepth.current = 0
      setDragActive(false)
      // 条目排序拖拽落在空白处：直接结束，不当作文件解析（否则会误报"无法解析"）
      if (isReorderDrag(e)) {
        clearReorder()
        return
      }
      if (dropping) return
      const files = Array.from(e.dataTransfer.files ?? [])
      const paths = files
        .map((file) => getDroppedFilePath(file))
        .filter((p): p is string => typeof p === 'string' && p.length > 0)
      if (paths.length === 0) {
        toast.warning('无法解析拖入的内容')
        return
      }
      await addPaths(paths)
    },
    [addPaths, clearReorder, dropping],
  )

  const atLimit = dirs.length >= MAX_QUICK_DIRECTORIES
  const showEmpty = !loading && dirs.length === 0 && !formOpen

  return (
    <Panel
      title="常用目录"
      icon={<NavIcon id="quick-dirs" />}
      help={`最多 ${MAX_QUICK_DIRECTORIES} 个目录，点击快速跳转；支持拖入文件夹添加、拖动条目排序（Alt+↑/↓）`}
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      actions={
        <>
          <ViewModeToggle mode={view} onChange={setView} />
          <AppButton
            variant="primary"
            size="sm"
            onClick={openAdd}
            disabled={atLimit}
            title={atLimit ? `已达上限 ${MAX_QUICK_DIRECTORIES} 个` : undefined}
          >
            <PlusIcon size={14} />
            添加目录
          </AppButton>
        </>
      }
    >
      <div
        className="relative"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {loading ? (
          <div className="text-xs text-foreground-tertiary py-2">加载中…</div>
        ) : showEmpty ? (
          <div className="flex flex-col items-start gap-1 py-3">
            <p className="text-[13px] text-foreground-secondary">暂无常用目录</p>
            <p className="text-xs text-foreground-tertiary">
              点击右上"添加目录"，或将文件夹拖拽到此处。
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {formOpen && (
              <EditRow
                formName={formName}
                formPath={formPath}
                formColor={formColor}
                formBadge={formBadge}
                editing={!!editingId}
                saving={saving}
                onName={setFormName}
                onPath={setFormPath}
                onColor={setFormColor}
                onBadge={setFormBadge}
                onPick={onPickPath}
                onSave={saveForm}
                onCancel={cancelForm}
              />
            )}
            {dirs.length > 0 &&
              (view === 'list' ? (
                <ListView
                  dirs={dirs}
                  openingId={openingId}
                  reorder={reorder}
                  dropIndex={dropIndex}
                  onOpen={openDir}
                  onEdit={openEdit}
                  onRemove={removeDir}
                />
              ) : (
                <CardView
                  dirs={dirs}
                  openingId={openingId}
                  reorder={reorder}
                  dropIndex={dropIndex}
                  onOpen={openDir}
                  onEdit={openEdit}
                  onRemove={removeDir}
                />
              ))}
          </div>
        )}

        {(dragActive || dropping) && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-primary bg-primary-bg/70">
            <span className="text-[13px] text-primary">
              {dropping ? '正在解析目录…' : atLimit ? `已达上限 ${MAX_QUICK_DIRECTORIES} 个` : '松开以添加目录'}
            </span>
          </div>
        )}
      </div>
    </Panel>
  )
}

/** 标识色圆点：小尺寸、纯色，用于在列表/卡片中快速识别目录 */
function ColorDot({ color, size = 8 }: { color: string; size?: number }) {
  return (
    <span
      className="inline-block rounded-full shrink-0"
      style={{ width: size, height: size, backgroundColor: color }}
      aria-hidden
    />
  )
}

/**
 * 目录徽标：替代原文件夹图标。
 * 背景为标识色，内容最多 2 个字符（缺省时按名称派生，派生结果默认大写），
 * 用户手填时保留原始大小写；无标识时回退为文件夹图形。
 */
function DirBadge({ dir, size = 22 }: { dir: QuickDirectory; size?: number }) {
  const color = resolveDirectoryColor(dir)
  const badge = resolveDirectoryBadge(dir)
  const fontSize = badge.length >= 2 ? Math.round(size * 0.42) : Math.round(size * 0.52)
  return (
    <span
      className="flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none"
      style={{ width: size, height: size, backgroundColor: color, fontSize }}
      title={badge ? `${dir.name}（${badge}）` : dir.name}
      aria-hidden
    >
      {badge ? badge : <FolderIcon size={Math.round(size * 0.58)} />}
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

interface ViewCommonProps {
  dirs: QuickDirectory[]
  openingId: string | null
  reorder: ReorderProps
  dropIndex: number | null
  onOpen: (dir: QuickDirectory) => void
  onEdit: (dir: QuickDirectory) => void
  onRemove: (id: string) => void
}

function edgeAt(index: number, dropIndex: number | null, total: number): DropEdge {
  if (dropIndex === null) return null
  if (dropIndex === index) return 'top'
  if (dropIndex === total && index === total - 1) return 'bottom'
  return null
}

function ListView({ dirs, openingId, reorder, dropIndex, onOpen, onEdit, onRemove }: ViewCommonProps) {
  return (
    // 列表视图按表格处理：外框 + 斑马纹（奇数行底色），行间不留缝以便条纹连续
    <div className="flex flex-col rounded-md border border-border-subtle overflow-hidden">
      {dirs.map((dir, index) => (
        <DirRow
          key={dir.id}
          dir={dir}
          index={index}
          striped={index % 2 === 1}
          dropEdge={edgeAt(index, dropIndex, dirs.length)}
          reorder={reorder}
          opening={openingId === dir.id}
          onOpen={() => onOpen(dir)}
          onEdit={() => onEdit(dir)}
          onRemove={() => onRemove(dir.id)}
        />
      ))}
    </div>
  )
}

function CardView({ dirs, openingId, reorder, dropIndex, onOpen, onEdit, onRemove }: ViewCommonProps) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {dirs.map((dir, index) => (
        <DirCard
          key={dir.id}
          dir={dir}
          index={index}
          dropEdge={edgeAt(index, dropIndex, dirs.length)}
          reorder={reorder}
          opening={openingId === dir.id}
          onOpen={() => onOpen(dir)}
          onEdit={() => onEdit(dir)}
          onRemove={() => onRemove(dir.id)}
        />
      ))}
    </div>
  )
}

/** 图标字母上限（与 electron/main/ipc.ts 的 MAX_BADGE_LENGTH 一致） */
const MAX_BADGE_LENGTH = 2

/**
 * 图标字母输入：草稿态 + 显式确认。
 * 输入过程中不做截断/派生（避免中文 IME 或长输入被打断），
 * 点击"确认"或按 Enter 才提交；超过上限时不提交并给出提示。
 */
function BadgeField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)

  // 打开编辑/重置表单时，外部值变化需要同步回草稿
  useEffect(() => {
    setDraft(value)
  }, [value])

  const trimmed = draft.trim()
  const tooLong = trimmed.length > MAX_BADGE_LENGTH
  const dirty = trimmed !== value

  const confirm = () => {
    if (tooLong) {
      toast.warning(`图标字母最多 ${MAX_BADGE_LENGTH} 个字符`)
      return
    }
    onCommit(trimmed)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-foreground-tertiary leading-4" htmlFor="dir-badge">
        图标字母（最多 {MAX_BADGE_LENGTH} 个，支持小写）
      </label>
      <div className="flex items-center gap-1.5">
        <AppInput
          id="dir-badge"
          block={false}
          className="w-20"
          placeholder="自动"
          value={draft}
          invalid={tooLong}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              confirm()
            }
          }}
          aria-label="图标字母"
        />
        <AppButton variant="default" size="sm" onClick={confirm} disabled={!dirty} title="应用图标字母">
          确认
        </AppButton>
      </div>
      {tooLong && (
        <span className="text-xs text-error leading-4">
          最多 {MAX_BADGE_LENGTH} 个字符，当前 {trimmed.length} 个
        </span>
      )}
    </div>
  )
}

function EditRow({
  formName,
  formPath,
  formColor,
  formBadge,
  editing,
  saving,
  onName,
  onPath,
  onColor,
  onBadge,
  onPick,
  onSave,
  onCancel,
}: {
  formName: string
  formPath: string
  formColor: string | null
  formBadge: string
  editing: boolean
  saving: boolean
  onName: (v: string) => void
  onPath: (v: string) => void
  onColor: (v: string | null) => void
  onBadge: (v: string) => void
  onPick: () => void
  onSave: () => void
  onCancel: () => void
}) {
  const previewColor = formColor ?? deriveDirectoryColor(formName || formPath || 'preview')
  const previewBadge = formBadge.trim().slice(0, 2) || deriveDirectoryBadge(formName || formPath)
  return (
    <div className="flex flex-col gap-1.5 p-2 rounded-md border border-primary/40 bg-surface-2">
      <AppInput
        placeholder="名称（可选，留空则用目录名）"
        value={formName}
        onChange={(e) => onName(e.target.value)}
        aria-label="目录名称"
      />
      <div className="flex gap-1.5">
        <AppInput
          placeholder="目录路径"
          value={formPath}
          onChange={(e) => onPath(e.target.value)}
          className="flex-1 min-w-0"
          aria-label="目录路径"
          invalid={!formPath.trim()}
        />
        <AppButton
          variant="default"
          size="md"
          onClick={onPick}
          className="shrink-0 whitespace-nowrap"
        >
          浏览
        </AppButton>
      </div>
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
          {previewBadge ? previewBadge : <FolderIcon size={16} />}
        </span>
        <BadgeField value={formBadge} onCommit={onBadge} />
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-tertiary leading-4">图标颜色</span>
          <ColorSwatches
            value={formColor}
            onChange={onColor}
            label="目录标识颜色"
            autoTitle="自动（按目录名分配）"
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

function DirRow({
  dir,
  index,
  striped = false,
  dropEdge = null,
  reorder,
  opening,
  onOpen,
  onEdit,
  onRemove,
}: {
  dir: QuickDirectory
  index: number
  /** 斑马纹：奇数行加深底色，仅在列表视图启用 */
  striped?: boolean
  dropEdge?: DropEdge
  reorder: ReorderProps
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const dragging = reorder.draggingId === dir.id
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
        // Alt + ↑/↓ 是拖放的键盘等价操作
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          reorder.onMove(dir.id, e.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(REORDER_MIME, dir.id)
        e.dataTransfer.setData('text/plain', dir.id)
        e.dataTransfer.effectAllowed = 'move'
        reorder.onDragStart(dir.id)
      }}
      onDragEnd={reorder.onDragEnd}
      onDragOver={(e) => reorder.onDragOverRow(index, e)}
      onDrop={(e) => reorder.onDropRow(index, e)}
      className={`group flex items-center gap-2 h-10 px-2.5 hover:bg-surface-hover focus:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
        striped ? 'bg-surface-2' : 'bg-surface-1'
      } ${dragging ? 'opacity-40' : ''} ${dropEdge ? DROP_EDGE_CLASS[dropEdge] : ''}`}
      title={`打开 ${dir.path}（拖动可排序，Alt+↑/↓ 亦可）`}
    >
      <DirBadge dir={dir} size={22} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[13px] text-foreground truncate leading-5">{dir.name}</span>
          <ColorDot color={resolveDirectoryColor(dir)} />
        </div>
        <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">{dir.path}</div>
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <AppButton
          variant="ghost"
          size="sm"
          loading={opening}
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          className="!px-1"
          aria-label="打开"
          title="打开"
        >
          <FolderOpenIcon size={14} />
        </AppButton>
        <AppButton
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="!px-1"
          aria-label="改名"
          title="编辑"
        >
          <PencilIcon size={14} />
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
          <TrashIcon size={14} />
        </AppButton>
      </div>
    </div>
  )
}

function DirCard({
  dir,
  index,
  dropEdge = null,
  reorder,
  opening,
  onOpen,
  onEdit,
  onRemove,
}: {
  dir: QuickDirectory
  index: number
  dropEdge?: DropEdge
  reorder: ReorderProps
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const dragging = reorder.draggingId === dir.id
  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault()
          reorder.onMove(dir.id, e.key === 'ArrowUp' ? -1 : 1)
        }
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(REORDER_MIME, dir.id)
        e.dataTransfer.setData('text/plain', dir.id)
        e.dataTransfer.effectAllowed = 'move'
        reorder.onDragStart(dir.id)
      }}
      onDragEnd={reorder.onDragEnd}
      onDragOver={(e) => reorder.onDragOverRow(index, e)}
      onDrop={(e) => reorder.onDropRow(index, e)}
      className={`group relative flex flex-col gap-1.5 p-3 rounded-md border border-border-subtle bg-surface-1 hover:border-primary hover:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors ${
        dragging ? 'opacity-40' : ''
      } ${dropEdge ? DROP_EDGE_CLASS[dropEdge] : ''}`}
      title={`打开 ${dir.path}（拖动可排序，Alt+↑/↓ 亦可）`}
    >
      <div className="flex items-start justify-between">
        <DirBadge dir={dir} size={26} />
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <AppButton
            variant="ghost"
            size="sm"
            loading={opening}
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            className="!px-1"
            aria-label="打开"
            title="打开"
          >
            <FolderOpenIcon size={13} />
          </AppButton>
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
            <PencilIcon size={13} />
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
            <TrashIcon size={13} />
          </AppButton>
        </div>
      </div>
      <div className="flex items-center gap-1.5 min-w-0">
        <ColorDot color={resolveDirectoryColor(dir)} size={8} />
        <span className="text-[13px] font-medium text-foreground truncate leading-5">{dir.name}</span>
      </div>
      <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">{dir.path}</div>
    </div>
  )
}
