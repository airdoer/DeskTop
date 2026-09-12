import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Panel } from '@/components/layout/Panel'
import { NavIcon } from '@/shell/NavIcon'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import {
  CopyIcon,
  FolderOpenIcon,
  FolderSolidIcon,
  P4VWindowIcon,
  RefreshIcon,
  VersionControlIcon,
} from '@/components/ui/icons'
import { FOLDER_YELLOW, PERFORCE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import { openPath } from '@/services/paths'
import {
  getP4WorkspaceLabels,
  getP4Workspaces,
  openInP4V,
  resolveWorkspaceBadge,
  resolveWorkspaceColor,
  type P4WorkspaceSnapshot,
  type WorkspaceLabels,
} from '@/services/p4Workspaces'
import { resolveP4Path, type PathEntry, type ResolvedPaths } from '@/services/p4Paths'

/*
 * PathConvertPanel — Business Feature：本地路径 ↔ P4 路径互转.
 *
 * 依据主页「P4 工作区」快照（client / Root / Stream）推导：
 *   输入任意一个路径 → 归约为「分支 + 相对路径」→ 输出 Mainline / Preonline / Online
 *   三条分支各自的 P4 路径与本地路径（共 6 条）。
 * 换算逻辑是纯函数，见 src/services/p4Paths.ts（test/p4-paths.test.ts 覆盖）。
 *
 * 展示：分支徽标沿用主页工作区的颜色与图标（含用户自定义 labels）；
 *   某分支在本机没有工作区时，只给 P4 路径，本地路径与跳转按钮置灰禁用。
 */

export function PathConvertPanel() {
  const [snapshot, setSnapshot] = useState<P4WorkspaceSnapshot | null>(null)
  const [labels, setLabels] = useState<WorkspaceLabels>(() => ({}))
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  /** 正在执行打开动作的条目 key，用于按钮内 loading */
  const [busyKey, setBusyKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [next, nextLabels] = await Promise.all([getP4Workspaces(), getP4WorkspaceLabels()])
      setSnapshot(next)
      setLabels(nextLabels)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const workspaces = useMemo(() => snapshot?.workspaces ?? [], [snapshot])

  // 输入即时换算：纯函数开销可忽略，不需要额外触发按钮
  const result = useMemo(() => resolveP4Path(input, workspaces), [input, workspaces])

  const copy = useCallback(async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label}已复制`)
    } catch {
      toast.error('复制失败')
    }
  }, [])

  const openLocal = useCallback(async (key: string, target: string) => {
    setBusyKey(key)
    try {
      const res = await openPath(target)
      if (!res.ok) toast.error(`打开失败：${res.error ?? '目标不存在或无权限'}`)
    } finally {
      setBusyKey(null)
    }
  }, [])

  /**
   * 在 P4V 中定位到该文件：p4vc -c <client> workspacewindow -s <path>
   * 优先传本地路径（p4vc 的 -s 对本地路径定位最稳），本机无工作区时退回 depot 路径。
   */
  const openP4V = useCallback(
    async (key: string, client: string, target: string) => {
      if (!snapshot) return
      setBusyKey(key)
      try {
        const res = await openInP4V(
          client,
          {
            port: snapshot.port,
            user: snapshot.user,
            charset: snapshot.charset,
          },
          target,
        )
        if (res.ok) toast.success(`已在 P4V 中定位 ${client}`)
        else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
      } finally {
        setBusyKey(null)
      }
    },
    [snapshot],
  )

  /*
   * 气泡宽度上限 320px（见 ui/InfoTip），示例路径 60~70 字符且无空格，
   * 因此单独成行 + font-mono + break-all，避免在半角字符处撑破气泡。
   */
  const help = (
    <div className="space-y-1.5">
      <div>
        粘贴 6 个路径中的任意一个（Mainline / Preonline / Online 的本地路径或 P4 路径），
        自动换算出其余全部路径。
      </div>
      <div className="space-y-0.5">
        <div className="text-foreground-tertiary">示例：</div>
        <div className="break-all font-mono text-[11px] leading-4 text-foreground">
          E:\Project\C7_project\Server\config\local\c7_dev.generated.json
        </div>
        <div className="break-all font-mono text-[11px] leading-4 text-foreground">
          //C7/Development/Mainline/Server/config/local/c7_dev.generated.json
        </div>
      </div>
    </div>
  )

  return (
    <Panel
      title="路径转换"
      icon={<NavIcon id="p4-path" />}
      help={help}
      actions={
        <AppButton
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          loading={loading}
          aria-label="刷新工作区"
        >
          <RefreshIcon size={14} />
          刷新
        </AppButton>
      }
    >
      <div className="flex flex-col gap-3">
        <AppInput
          placeholder="粘贴本地路径或 P4 路径，如 E:\\Project\\C7_project\\Server 或 //C7/Development/Mainline/Server"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          aria-label="待转换的路径"
        />

        {loading && !snapshot ? (
          <div className="text-xs text-foreground-tertiary py-1">正在读取 P4 工作区…</div>
        ) : !snapshot || !snapshot.available ? (
          <div className="flex flex-col items-start gap-1 py-1">
            <p className="text-[13px] text-foreground-secondary">
              {snapshot?.error ?? '未能获取 P4 工作区'}
            </p>
            <p className="text-xs text-foreground-tertiary">
              路径转换依赖 P4 工作区的 Root 与 Stream 映射，请确认 p4 命令行可用且已配置
              P4PORT / P4USER。
            </p>
          </div>
        ) : workspaces.length === 0 ? (
          <div className="text-[13px] text-foreground-secondary py-1">
            本机没有 P4 工作区，无法换算路径
          </div>
        ) : !input.trim() ? (
          <div className="text-xs text-foreground-tertiary py-1">
            粘贴路径后自动换算，输出三条分支的 P4 路径与本地路径。
          </div>
        ) : !result.ok ? (
          <div className="text-[13px] text-error py-1">{result.error}</div>
        ) : (
          <ResultList
            value={result.value}
            labels={labels}
            busyKey={busyKey}
            onCopy={copy}
            onOpenLocal={openLocal}
            onOpenP4V={openP4V}
          />
        )}
      </div>
    </Panel>
  )
}

function ResultList({
  value,
  labels,
  busyKey,
  onCopy,
  onOpenLocal,
  onOpenP4V,
}: {
  value: ResolvedPaths
  labels: WorkspaceLabels
  busyKey: string | null
  onCopy: (text: string, label: string) => void
  onOpenLocal: (key: string, target: string) => void
  onOpenP4V: (key: string, client: string, target: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-foreground-tertiary leading-5">
        <span className="shrink-0">所属分支</span>
        {/* 分支用成功色标签：一眼区分当前输入落在哪条分支 */}
        <span className="shrink-0 px-1.5 py-0.5 rounded bg-success/10 text-success font-medium leading-4">
          {value.mapping.label}
        </span>
        <span className="shrink-0">相对路径</span>
        <code className="min-w-0 font-mono text-[12px] text-foreground-secondary bg-surface-2 border border-border-subtle rounded px-1 py-0.5 break-all">
          {value.relative ? value.relative : '（分支根目录）'}
        </code>
        {value.workspace && (
          <>
            <span className="shrink-0">工作区</span>
            <code className="min-w-0 font-mono text-[12px] text-foreground-secondary bg-surface-2 border border-border-subtle rounded px-1 py-0.5 break-all">
              {value.workspace.name}
            </code>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {value.entries.map((entry) => (
          <BranchCard
            key={entry.key}
            entry={entry}
            labels={labels}
            busyKey={busyKey}
            onCopy={onCopy}
            onOpenLocal={onOpenLocal}
            onOpenP4V={onOpenP4V}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * 单条分支的卡片：P4 路径 + 本地路径两行。
 * 徽标沿用主页工作区的颜色与图标（有工作区时按 client 名解析，否则按分支名派生）。
 */
function BranchCard({
  entry,
  labels,
  busyKey,
  onCopy,
  onOpenLocal,
  onOpenP4V,
}: {
  entry: PathEntry
  labels: WorkspaceLabels
  busyKey: string | null
  onCopy: (text: string, label: string) => void
  onOpenLocal: (key: string, target: string) => void
  onOpenP4V: (key: string, client: string, target: string) => void
}) {
  const badgeSeed = entry.workspaceName ?? entry.label
  const color = resolveWorkspaceColor(badgeSeed, labels)
  const badge = resolveWorkspaceBadge(badgeSeed, labels)
  const p4vKey = `p4v-${entry.key}`
  const localKey = `local-${entry.key}`

  return (
    <div className="flex flex-col gap-1 p-2 rounded-md border border-border-subtle bg-surface-2">
      <div className="flex items-center gap-2 min-w-0">
        <span
          className="flex items-center justify-center rounded-md shrink-0 select-none text-white font-medium leading-none"
          style={{ width: 22, height: 22, backgroundColor: color, fontSize: 10 }}
          aria-hidden
        >
          {badge}
        </span>
        <span className="text-[13px] font-medium text-foreground leading-5 shrink-0">
          {entry.label}
        </span>
        {entry.workspaceName ? (
          <code className="min-w-0 font-mono text-[12px] text-foreground-secondary bg-surface-1 border border-border-subtle rounded px-1 py-0.5 truncate">
            {entry.workspaceName}
          </code>
        ) : (
          <span className="text-xs text-foreground-tertiary truncate leading-4">
            本机无此分支工作区
          </span>
        )}
      </div>

      <PathLine
        kind="P4"
        value={entry.depotPath}
        icon={<VersionControlIcon size={14} style={{ color: PERFORCE_BLUE }} />}
        onCopy={() => onCopy(entry.depotPath, `${entry.label} P4 路径`)}
        actions={
          <AppButton
            variant="ghost"
            size="sm"
            loading={busyKey === p4vKey}
            disabled={!entry.workspaceName}
            onClick={(e) => {
              e.stopPropagation()
              if (!entry.workspaceName) return
              onOpenP4V(p4vKey, entry.workspaceName, entry.localPath ?? entry.depotPath)
            }}
            className="!px-1"
            aria-label="在 P4V 中定位到此文件"
            title={
              entry.workspaceName
                ? `在 P4V 中定位到：${entry.localPath ?? entry.depotPath}`
                : '本机没有该分支的工作区'
            }
          >
            <P4VWindowIcon size={14} style={{ color: PERFORCE_BLUE }} />
          </AppButton>
        }
      />

      <PathLine
        kind="本地"
        value={entry.localPath}
        icon={<FolderSolidIcon size={14} style={{ color: FOLDER_YELLOW }} />}
        onCopy={() => entry.localPath && onCopy(entry.localPath, `${entry.label} 本地路径`)}
        actions={
          <AppButton
            variant="ghost"
            size="sm"
            loading={busyKey === localKey}
            disabled={!entry.localPath}
            onClick={(e) => {
              e.stopPropagation()
              if (entry.localPath) onOpenLocal(localKey, entry.localPath)
            }}
            className="!px-1"
            aria-label="在资源管理器中打开"
            title={entry.localPath ? '在资源管理器中打开' : '本机没有该分支的工作区'}
          >
            <FolderOpenIcon size={14} style={{ color: FOLDER_YELLOW }} />
          </AppButton>
        }
      />
    </div>
  )
}

/** 单行路径：点击复制，右侧挂操作按钮（hover 显隐，与主页列表一致） */
function PathLine({
  kind,
  value,
  icon,
  onCopy,
  actions,
}: {
  kind: string
  value?: string
  icon: ReactNode
  onCopy: () => void
  actions: ReactNode
}) {
  if (!value) {
    return (
      <div className="flex items-center gap-2 h-8 px-2 rounded-md">
        <span className="shrink-0 flex items-center text-foreground-quaternary" aria-hidden>
          {icon}
        </span>
        <span className="shrink-0 text-xs text-foreground-tertiary w-8">{kind}</span>
        <span className="flex-1 min-w-0 text-[12px] text-foreground-tertiary truncate">
          本机无此分支工作区
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 h-8 px-2 rounded-md hover:bg-surface-hover transition-colors">
      <span className="shrink-0 flex items-center" aria-hidden>
        {icon}
      </span>
      <span className="shrink-0 text-xs text-foreground-tertiary w-8">{kind}</span>
      <button
        type="button"
        onClick={onCopy}
        className="flex-1 min-w-0 text-left font-mono text-[12px] text-foreground truncate cursor-pointer"
        title={`点击复制：${value}`}
      >
        {value}
      </button>
      {/* 复制 / 跳转是主操作，常驻显示：hover 才出现会让用户以为没有入口 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <AppButton
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            onCopy()
          }}
          className="!px-1"
          aria-label={`复制${kind}路径`}
          title="复制"
        >
          <CopyIcon size={13} />
        </AppButton>
        {actions}
      </div>
    </div>
  )
}
