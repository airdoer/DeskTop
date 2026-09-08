import { useCallback, useEffect, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import {
  FolderOpenIcon,
  GridIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import {
  listQuickDirectories,
  MAX_QUICK_DIRECTORIES,
  openDirectory,
  pickDirectory,
  saveQuickDirectories,
  type QuickDirectory,
} from '@/services/quickDirectories'

/*
 * QuickDirectoriesPanel — Business Feature：管理最多 5 个常用 Windows 资源
 * 管理器目录，点击快速跳转.
 * 依据 docs/UI_DESIGN_SYSTEM.md §25/§26，shell.openPath / dialog 经 IPC Service。
 * §21 Empty State 清晰、可操作；§11.1 操作反馈用 Toast。
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
    setFormOpen(true)
  }

  const openEdit = (dir: QuickDirectory) => {
    setEditingId(dir.id)
    setFormName(dir.name)
    setFormPath(dir.path)
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
    setSaving(true)
    try {
      const next = editingId
        ? dirs.map((d) => (d.id === editingId ? { ...d, name, path } : d))
        : [...dirs, { id: genId(), name, path }]
      const saved = await saveQuickDirectories(next)
      setDirs(saved)
      setFormOpen(false)
      toast.success(editingId ? '目录已更新' : '目录已添加')
    } catch {
      toast.error('保存失败')
    } finally {
      setSaving(false)
    }
  }, [dirs, editingId, formName, formPath])

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

  const atLimit = dirs.length >= MAX_QUICK_DIRECTORIES
  const showEmpty = !loading && dirs.length === 0 && !formOpen

  return (
    <Panel
      title="常用目录"
      description={`最多 ${MAX_QUICK_DIRECTORIES} 个 Windows 资源管理器目录，点击快速跳转`}
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
      {loading ? (
        <div className="text-xs text-foreground-tertiary py-2">加载中…</div>
      ) : showEmpty ? (
        <div className="flex flex-col items-start gap-1 py-3">
          <p className="text-[13px] text-foreground-secondary">暂无常用目录</p>
          <p className="text-xs text-foreground-tertiary">点击右上"添加目录"创建你的第一个快速跳转项。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {formOpen && (
            <EditRow
              formName={formName}
              formPath={formPath}
              editing={!!editingId}
              saving={saving}
              onName={setFormName}
              onPath={setFormPath}
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

function EditRow({
  formName,
  formPath,
  editing,
  saving,
  onName,
  onPath,
  onPick,
  onSave,
  onCancel,
}: {
  formName: string
  formPath: string
  editing: boolean
  saving: boolean
  onName: (v: string) => void
  onPath: (v: string) => void
  onPick: () => void
  onSave: () => void
  onCancel: () => void
}) {
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
      <FolderOpenIcon size={16} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-foreground truncate leading-5">{dir.name}</div>
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
          title="改名"
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
        <FolderOpenIcon size={18} />
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
            aria-label="改名"
            title="改名"
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
      <div className="text-[13px] font-medium text-foreground truncate leading-5">{dir.name}</div>
      <div className="text-xs text-foreground-tertiary truncate leading-4 font-mono">{dir.path}</div>
    </div>
  )
}
