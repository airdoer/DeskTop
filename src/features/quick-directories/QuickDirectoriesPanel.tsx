import { useCallback, useEffect, useRef, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import {
  FolderIcon,
  FolderOpenIcon,
  GridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import {
  deriveDirectoryBadge,
  deriveDirectoryColor,
  DIRECTORY_COLORS,
  getDroppedFilePath,
  listQuickDirectories,
  MAX_QUICK_DIRECTORIES,
  openDirectory,
  pickDirectory,
  resolveDirectoryBadge,
  resolveDirectoryColor,
  saveQuickDirectories,
  statPath,
  type QuickDirectory,
} from '@/services/quickDirectories'

/*
 * QuickDirectoriesPanel — Business Feature：管理最多 5 个常用 Windows 资源
 * 管理器目录，点击快速跳转。
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，shell.openPath / dialog / webUtils 经 IPC Service；
 * §21 Empty State 清晰、可操作；§11.1 操作反馈用 Toast。
 *
 * 三项能力：
 *   1. 拖拽解析：从资源管理器拖入文件夹即可解析绝对路径并添加（path:stat 校验目录）。
 *   2. 标识徽标：文件夹图标替换为可选颜色徽标，最多 2 个字母，缺省按名称派生。
 *   3. 颜色圆点：列表/卡片视图均展示标识色圆点。
 *
 * 支持两种视图模式：
 *   - list: 紧凑横向列表，适合信息密度优先（§7 Compact Desktop Density）
 *   - card: 卡片网格，适合视觉分组与可扫描性
 * 视图偏好为 UI 状态，使用 localStorage 持久化（非业务数据）。
 */

type ViewMode = 'list' | 'card'

const VIEW_STORAGE_KEY = 'c7-desktop.quick-dirs.view'

function readViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_STORAGE_KEY)
    return v === 'card' || v === 'list' ? v : 'list'
  } catch {
    return 'list'
  }
}

function genId(): string {
  return `dir-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function QuickDirectoriesPanel() {
  const [dirs, setDirs] = useState<QuickDirectory[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [view, setView] = useState<ViewMode>(readViewMode)

  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formPath, setFormPath] = useState('')
  const [formColor, setFormColor] = useState<string | null>(null)
  const [formBadge, setFormBadge] = useState('')

  const [dragActive, setDragActive] = useState(false)
  const [dropping, setDropping] = useState(false)
  // dragenter/dragleave 会在子元素间反复触发，用深度计数避免高亮闪烁
  const dragDepth = useRef(0)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view)
    } catch {
      /* ignore quota / disabled storage */
    }
  }, [view])

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
    [addPaths, dropping],
  )

  const atLimit = dirs.length >= MAX_QUICK_DIRECTORIES
  const showEmpty = !loading && dirs.length === 0 && !formOpen

  return (
    <Panel
      title="常用目录"
      description={`最多 ${MAX_QUICK_DIRECTORIES} 个目录，点击快速跳转，支持拖入文件夹添加`}
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
                  onOpen={openDir}
                  onEdit={openEdit}
                  onRemove={removeDir}
                />
              ) : (
                <CardView
                  dirs={dirs}
                  openingId={openingId}
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

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const baseBtn =
    'inline-flex items-center justify-center w-7 h-7 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary'
  const activeCls = 'bg-surface-3 text-primary'
  const inactiveCls = 'text-foreground-tertiary hover:bg-surface-hover hover:text-foreground'
  return (
    <div
      className="inline-flex items-center rounded-md border border-border overflow-hidden"
      role="group"
      aria-label="视图模式"
    >
      <button
        type="button"
        onClick={() => onChange('list')}
        className={`${baseBtn} ${mode === 'list' ? activeCls : inactiveCls}`}
        aria-pressed={mode === 'list'}
        title="列表视图"
      >
        <ListIcon size={14} />
      </button>
      <button
        type="button"
        onClick={() => onChange('card')}
        className={`${baseBtn} ${mode === 'card' ? activeCls : inactiveCls}`}
        aria-pressed={mode === 'card'}
        title="卡片视图"
      >
        <GridIcon size={14} />
      </button>
    </div>
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
 * 背景为标识色，内容最多 2 个字母（缺省时按名称派生），无标识时回退为文件夹图形。
 */
function DirBadge({ dir, size = 22 }: { dir: QuickDirectory; size?: number }) {
  const color = resolveDirectoryColor(dir)
  const badge = resolveDirectoryBadge(dir)
  const fontSize = badge.length >= 2 ? Math.round(size * 0.42) : Math.round(size * 0.52)
  return (
    <span
      className="flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none"
      style={{ width: size, height: size, backgroundColor: color, fontSize }}
      title={badge ? `${dir.name}（${badge.toUpperCase()}）` : dir.name}
      aria-hidden
    >
      {badge ? badge.toUpperCase() : <FolderIcon size={Math.round(size * 0.58)} />}
    </span>
  )
}

interface ViewCommonProps {
  dirs: QuickDirectory[]
  openingId: string | null
  onOpen: (dir: QuickDirectory) => void
  onEdit: (dir: QuickDirectory) => void
  onRemove: (id: string) => void
}

function ListView({ dirs, openingId, onOpen, onEdit, onRemove }: ViewCommonProps) {
  return (
    <div className="flex flex-col gap-1">
      {dirs.map((dir) => (
        <DirRow
          key={dir.id}
          dir={dir}
          opening={openingId === dir.id}
          onOpen={() => onOpen(dir)}
          onEdit={() => onEdit(dir)}
          onRemove={() => onRemove(dir.id)}
        />
      ))}
    </div>
  )
}

function CardView({ dirs, openingId, onOpen, onEdit, onRemove }: ViewCommonProps) {
  return (
    <div className="grid gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
      {dirs.map((dir) => (
        <DirCard
          key={dir.id}
          dir={dir}
          opening={openingId === dir.id}
          onOpen={() => onOpen(dir)}
          onEdit={() => onEdit(dir)}
          onRemove={() => onRemove(dir.id)}
        />
      ))}
    </div>
  )
}

function ColorSwatches({
  value,
  onChange,
}: {
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="标识颜色">
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        title="自动（按目录名分配）"
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full border text-[9px] leading-none ${
          value === null
            ? 'border-primary text-primary ring-2 ring-primary/25'
            : 'border-border text-foreground-tertiary hover:border-primary-hover'
        }`}
      >
        A
      </button>
      {DIRECTORY_COLORS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          aria-pressed={value === c.value}
          title={`${c.label} ${c.value}`}
          className={`w-5 h-5 rounded-full transition-transform focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary ${
            value === c.value ? 'ring-2 ring-primary/40 scale-110' : 'hover:scale-110'
          }`}
          style={{ backgroundColor: c.value }}
        />
      ))}
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
          {previewBadge ? previewBadge.toUpperCase() : <FolderIcon size={16} />}
        </span>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-foreground-tertiary leading-4" htmlFor="dir-badge">
            图标字母（最多 2 个）
          </label>
          <AppInput
            id="dir-badge"
            block={false}
            className="w-20"
            placeholder="自动"
            value={formBadge}
            maxLength={2}
            onChange={(e) => onBadge(e.target.value.slice(0, 2))}
            aria-label="图标字母"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs text-foreground-tertiary leading-4">图标颜色</span>
          <ColorSwatches value={formColor} onChange={onColor} />
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
  opening,
  onOpen,
  onEdit,
  onRemove,
}: {
  dir: QuickDirectory
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group flex items-center gap-2 h-10 px-2 rounded-md hover:bg-surface-hover focus:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors"
      title={`打开 ${dir.path}`}
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
  opening,
  onOpen,
  onEdit,
  onRemove,
}: {
  dir: QuickDirectory
  opening: boolean
  onOpen: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="group relative flex flex-col gap-1.5 p-3 rounded-md border border-border-subtle bg-surface-1 hover:border-primary hover:bg-surface-hover focus:outline-2 focus-visible:outline-2 focus-visible:-outline-offset-2 outline-primary cursor-pointer transition-colors"
      title={`打开 ${dir.path}`}
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
