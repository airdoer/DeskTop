import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from '@/components/layout/Panel'
import { AppButton } from '@/components/ui/AppButton'
import { AppInput } from '@/components/ui/AppInput'
import {
  ChevronDownIcon,
  FolderOpenIcon,
  RefreshIcon,
  VersionControlIcon,
} from '@/components/ui/icons'
import { PERFORCE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import { MergePipeline } from './MergePipeline'
import { MergeFileTable, MergePreviewSummary } from './MergeFileTable'
import { ChangelistList } from './ChangelistList'
import {
  cancelMerge,
  createInitialPipeline,
  describeChangelist,
  executeMerge,
  findWorkspaceByBranch,
  inferBranchMappingFromStreams,
  listChangelists,
  mapToTargetPath,
  previewMerge,
  recommendTargetBranch,
  sortWorkspacesByBranch,
  subscribeMergeProgress,
  type BranchMapping,
  type ExecuteMergeParams,
  type MergePreview,
  type P4Changelist,
  type P4ChangeFile,
  type PipelineStepState,
} from '@/services/p4Merge'
import {
  getP4Workspaces,
  resolveWorkspaceColor,
  type P4VConnection,
  type P4Workspace,
  type P4WorkspaceSnapshot,
} from '@/services/p4Workspaces'
import { usePanelCollapsed } from '@/hooks/usePanelCollapsed'
import { PANEL_COLLAPSED_KEYS } from '@/services/uiPreferences'

/*
 * P4MergePanel — 跨分支 Perforce Merge 业务面板.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md：
 *   - §52 Manual Merge Wizard（8 步，这里压缩为：填参 → 选 CL → 预览 → 执行 → 管线）
 *   - §30/§64 Preview 纯只读，不修改 Workspace
 *   - §66 MVP 不自动 Submit；§44 不自动 revert/clean
 *   - §58 P4V 跳转作为辅助能力（Result 成功后出现）
 *
 * 用户核心诉求：填入参数后，下方从左到右渲染各流程执行情况与状态，
 *   最终提供跳转 P4V 的快捷操作（Result 步骤右侧的 P4V 跳转区）.
 *
 * 推荐方向：Mainline → Preonline → Online（业务惯例）.
 *   Source 默认选当前用户的 Mainline（标注「猜你想选」）；
 *   Target 的推荐**跟随 Source 的分支**：Source 选 Mainline → 推荐 Preonline，
 *   Source 选 Preonline → 推荐 Online；Source 已到末端（Online 等）则不推荐.
 *   推荐是「默认态」的辅助：用户手动选过 Source 之后，Source 自身不再展示
 *   「猜你想选」（推荐只在自动默认时有意义），改为由 Target 承接推荐.
 *
 * Sync 模式固定为 file（只同步 CL 涉及文件），不作为用户选项 ——
 *   Sync 范围由所选 Changelist 的文件列表决定（spec §13/§14）.
 */

export function P4MergePanel() {
  const { collapsed, toggle } = usePanelCollapsed(PANEL_COLLAPSED_KEYS.p4Merge)
  const [snapshot, setSnapshot] = useState<P4WorkspaceSnapshot | null>(null)
  const [loadingWs, setLoadingWs] = useState(true)

  // 表单参数
  const [sourceClient, setSourceClient] = useState('')
  const [targetClient, setTargetClient] = useState('')
  /**
   * 「猜你想选」的生命周期：推荐只是默认态的辅助，一旦用户手动选过该字段，
   * 就不再对该字段展示推荐（避免推荐停留在旧分支上误导用户）.
   *   sourceTouched：用户手动改过 Source → Source 不再显示「猜你想选」；
   *   targetTouched：用户手动改过 Target → 不再跟随 Source 自动重推.
   */
  const [sourceTouched, setSourceTouched] = useState(false)
  const [targetTouched, setTargetTouched] = useState(false)
  /**
   * Sync 模式固定为 file（只同步 CL 涉及的目标文件）.
   * 不再作为用户选项 —— Sync 范围由所选 Changelist 的文件列表决定（spec §13/§14）.
   */
  const syncMode: 'file' = 'file'
  const [mapping, setMapping] = useState<BranchMapping | null>(null)

  /**
   * 生效的 P4 用户名：默认取 P4USER（snapshot.user），用户可手动改写以帮别人 merge.
   * 切换 source workspace / 刷新工作区时会重置回 P4USER，避免脏值残留.
   */
  const [effectiveUser, setEffectiveUser] = useState('')
  /** 用户名内联编辑态：点击「默认按...」文案后展开输入框 */
  const [userEditing, setUserEditing] = useState(false)
  const [userDraft, setUserDraft] = useState('')
  useEffect(() => {
    if (snapshot?.user) setEffectiveUser(snapshot.user)
  }, [snapshot?.user])

  // Changelist 列表
  const [changes, setChanges] = useState<P4Changelist[]>([])
  const [loadingChanges, setLoadingChanges] = useState(false)
  const [selectedChange, setSelectedChange] = useState<number | null>(null)

  // Describe + Preview
  const [describe, setDescribe] = useState<{ change: number; description: string; files: P4ChangeFile[] } | null>(null)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)

  // 管线执行
  const [pipeline, setPipeline] = useState<PipelineStepState[]>(createInitialPipeline)
  const [executing, setExecuting] = useState(false)
  const [transactionId, setTransactionId] = useState<string | null>(null)
  const [targetChange, setTargetChange] = useState<number | undefined>(undefined)

  // 进度事件订阅：主进程每步状态变更推送 patch，按 transactionId 过滤
  useEffect(() => {
    const unsub = subscribeMergeProgress((payload) => {
      if (transactionId && payload.transactionId !== transactionId) return
      setPipeline((prev) => prev.map((s) => (s.id === payload.step ? payload.patch : s)))
    })
    return unsub
  }, [transactionId])

  // 加载本机 P4 工作区列表（复用既有 p4Workspaces Service）
  const loadWorkspaces = useCallback(async () => {
    setLoadingWs(true)
    try {
      setSnapshot(await getP4Workspaces())
    } finally {
      setLoadingWs(false)
    }
  }, [])

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  const workspaces = snapshot?.workspaces ?? []
  const sortedWorkspaces = useMemo(() => sortWorkspacesByBranch(workspaces), [workspaces])
  const connection: P4VConnection = useMemo(
    () => ({ port: snapshot?.port, user: snapshot?.user, charset: snapshot?.charset }),
    [snapshot],
  )

  /** 选 source/target workspace 后，自动用 stream 推断 Branch Mapping */
  const sourceWs = workspaces.find((w) => w.name === sourceClient)
  const targetWs = workspaces.find((w) => w.name === targetClient)

  /** 推荐的 Source workspace 名（当前用户的 Mainline）；用户手动选过 Source 后不再推荐 */
  const recommendedSourceName = useMemo(
    () => (sourceTouched ? '' : (findWorkspaceByBranch(workspaces, 'mainline')?.name ?? '')),
    [workspaces, sourceTouched],
  )
  /** 推荐的 Target workspace 名（跟随 Source 分支：Mainline→Preonline、Preonline→Online） */
  const recommendedTargetName = useMemo(
    () => findWorkspaceByBranch(workspaces, recommendTargetBranch(sourceWs))?.name ?? '',
    [workspaces, sourceWs],
  )

  /**
   * 工作区快照加载后自动填入默认 Source（当前用户的 Mainline，标注「猜你想选」）.
   * Target 不在这里填 —— 统一由下面的「跟随推荐」effect 处理，避免两处逻辑各写一份.
   */
  const autoSelected = useRef(false)
  useEffect(() => {
    if (autoSelected.current || !snapshot?.available || workspaces.length === 0) return
    const mainlineWs = findWorkspaceByBranch(workspaces, 'mainline')
    if (!mainlineWs) return
    if (!sourceClient) setSourceClient(mainlineWs.name)
    autoSelected.current = true
  }, [snapshot, workspaces, sourceClient])

  /**
   * Target 跟随 Source 的推荐自动更新（用户未手动改 Target 时）.
   * Source 从 Mainline 改成 Preonline → Target 由 Preonline 变为 Online 并打上「猜你想选」.
   * 无推荐（Source 已在末端）时保持当前值不动，不静默清空用户已有选择.
   */
  useEffect(() => {
    if (targetTouched) return
    if (!recommendedTargetName) return
    if (targetClient !== recommendedTargetName) setTargetClient(recommendedTargetName)
  }, [recommendedTargetName, targetClient, targetTouched])

  useEffect(() => {
    const inferred = inferBranchMappingFromStreams(sourceWs?.stream, targetWs?.stream)
    if (inferred) setMapping(inferred)
    else if (sourceWs && targetWs && !sourceWs.stream && !targetWs.stream) {
      setMapping(null)
    }
  }, [sourceWs, targetWs])

  /** 加载 source workspace 的已提交 changelist（spec §8） */
  const loadChangelists = useCallback(async () => {
    if (!sourceClient) {
      toast.warning('请先选择 Source Workspace')
      return
    }
    setLoadingChanges(true)
    setChanges([])
    setSelectedChange(null)
    setDescribe(null)
    setPreview(null)
    try {
      // 用 effectiveUser 过滤（帮别人 merge 时可手动改写）；为空时不加 -u，返回该 client 全部 CL
      const res = await listChangelists({
        client: sourceClient,
        user: effectiveUser || undefined,
        limit: 50,
      })
      if (!res.ok || !res.changes) {
        toast.error(`加载 Changelist 失败：${res.error ?? '未知错误'}`)
        return
      }
      setChanges(res.changes)
      if (res.changes.length === 0) {
        toast.info(`该 Workspace 没有匹配 ${effectiveUser || '全部用户'} 的已提交 Changelist`)
      }
    } finally {
      setLoadingChanges(false)
    }
  }, [sourceClient, effectiveUser])

  /** 选择 changelist 后自动 describe + 计算 preview（spec §9/§30/§64 纯只读） */
  const selectChange = useCallback(
    async (change: number) => {
      setSelectedChange(change)
      setDescribe(null)
      setPreview(null)
      setLoadingPreview(true)
      try {
        const desc = await describeChangelist({ change, client: sourceClient })
        if (!desc.ok || !desc.files) {
          toast.error(`p4 describe 失败：${desc.error ?? '未知错误'}`)
          return
        }
        const rawDescription = desc.description ?? ''
        // describe 返回的描述可能含 \n（多行），统一合并为单行空格分隔，
        //   与 -ztag changes -L 的单行 desc 保持一致，避免回填后行高跳动 / Redmine 单号数量变化.
        const fullDescription = rawDescription.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
        setDescribe({ change: desc.change ?? change, description: fullDescription, files: desc.files })
        // 回填完整描述到 changes 列表（与列表加载时 -ztag changes -L 同样单行）
        setChanges((prev) =>
          prev.map((c) => (c.change === change ? { ...c, description: fullDescription || c.description } : c)),
        )
        if (!mapping) {
          toast.warning('未推断出 Branch Mapping，无法计算 Preview')
          return
        }
        const prev = await previewMerge({
          sourceWorkspace: sourceClient,
          targetWorkspace: targetClient,
          sourceChange: change,
          mapping,
          changeFiles: desc.files,
        })
        if (!prev.ok || !prev.preview) {
          toast.error(`Preview 失败：${prev.error ?? '未知错误'}`)
          return
        }
        setPreview(prev.preview)
      } finally {
        setLoadingPreview(false)
      }
    },
    [sourceClient, targetClient, mapping],
  )

  /** 执行 Merge：reset pipeline → 调 executeMerge → 进度事件驱动管线更新 */
  const runExecute = useCallback(async () => {
    if (!sourceClient || !targetClient) {
      toast.warning('请先选择 Source / Target Workspace')
      return
    }
    if (sourceClient === targetClient) {
      toast.error('源 Workspace 与目标 Workspace 相同，无法执行跨分支 Merge')
      return
    }
    if (!selectedChange || !describe || !mapping) {
      toast.warning('请先选择一个 Changelist')
      return
    }
    setPipeline(createInitialPipeline())
    setExecuting(true)
    setTargetChange(undefined)
    try {
      const files = describe.files.map((f) => ({
        sourcePath: f.depotPath,
        targetPath: mapToTargetPath(f.depotPath, mapping) ?? f.depotPath,
        sourceRevision: f.revision,
      }))
      const params: ExecuteMergeParams = {
        sourceClient,
        targetClient,
        sourceChange: selectedChange,
        sourceDescription: describe.description,
        mapping,
        user: effectiveUser || snapshot?.user || '',
        files,
        syncMode,
      }
      const res = await executeMerge(params)
      if (res.transactionId) setTransactionId(res.transactionId)
      if (res.targetChange) setTargetChange(res.targetChange)
      if (!res.ok) {
        toast.error(`Merge 失败：${res.error ?? '未知错误'}`)
      } else {
        toast.success(`Merge 完成，Pending CL #${res.targetChange} 已就绪（未自动提交）`)
      }
    } finally {
      setExecuting(false)
    }
  }, [sourceClient, targetClient, selectedChange, describe, mapping, effectiveUser, snapshot?.user])

  const cancelExecuting = useCallback(async () => {
    if (!transactionId) return
    const res = await cancelMerge(transactionId)
    if (res.ok) toast.info('已发送取消请求')
    else toast.error('取消失败（事务可能已结束）')
  }, [transactionId])

  const canExecute = !!sourceClient && !!targetClient && !!selectedChange && !!mapping && !executing
  const sourceIsTarget = sourceClient && targetClient && sourceClient === targetClient

  // 预览表文件（preview 为 null 时回退到 describe.files 的本地映射）
  const previewFiles = preview?.files ?? []
  const p4vActions = sourceClient && targetClient
    ? { sourceClient, targetClient, targetChange, connection }
    : undefined

  return (
    <Panel
      title="Cross Branch Merge"
      icon={<VersionControlIcon size={14} style={{ color: PERFORCE_BLUE }} />}
      help={
        <div className="text-xs leading-5">
          <div>选择源/目标 Workspace → 加载 Changelist → 预览文件映射 → 执行 Merge（不自动 Submit）。</div>
          <div>核心流程仅依赖 p4.exe / p4merge.exe，不依赖 P4V；P4V 跳转为辅助能力。</div>
          <div>Source 默认选 Mainline（猜你想选）；Target 跟随 Source 推荐（Mainline→Preonline、Preonline→Online）。</div>
          <div>手动改过 Source 后，Source 不再显示「猜你想选」，推荐改由 Target 承接。</div>
          <div>支持手动改用户名帮别人 merge。</div>
          <div>Sync 范围由所选 Changelist 的文件列表决定，自动同步目标文件。</div>
        </div>
      }
      collapsible
      collapsed={collapsed}
      onToggleCollapsed={toggle}
      actions={
        <AppButton variant="ghost" size="sm" onClick={() => void loadWorkspaces()} loading={loadingWs} aria-label="刷新工作区">
          <RefreshIcon size={14} />
          刷新工作区
        </AppButton>
      }
    >
      <div className="flex flex-col gap-3">
        {/* ---------- 参数表单：Source → 流动箭头 → Target ---------- */}
        {/* items-start：顶部 label 对齐；两侧 helperText 始终占位保证底部也齐 */}
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <WorkspaceSelectField
              label="Source Workspace"
              value={sourceClient}
              onChange={(v) => {
                if (v === sourceClient) return
                // 用户手动切 Source = 重新表达 Merge 方向：
                //   Source 自身不再展示「猜你想选」，Target 交回自动推荐（跟随新 Source）
                setSourceTouched(true)
                setTargetTouched(false)
                setSourceClient(v)
              }}
              workspaces={sortedWorkspaces}
              loading={loadingWs}
              placeholder="选择源分支工作区"
              streamHint={sourceWs?.stream}
              recommendedName={recommendedSourceName}
              invalid={!!sourceIsTarget}
              helperText={sourceIsTarget ? '源与目标相同，无法跨分支 Merge' : ''}
            />
          </div>
          <div className="flex flex-col items-center gap-0.5 shrink-0 pt-5" aria-hidden>
            <FlowArrow
              fromColor={sourceWs ? resolveWorkspaceColor(sourceWs.name) : '#d9d9d9'}
              toColor={targetWs ? resolveWorkspaceColor(targetWs.name) : '#d9d9d9'}
              active={!!sourceWs && !!targetWs && !sourceIsTarget}
            />
            {/* 占位行：与两侧 helperText 行高度对齐，保证底部对齐 */}
            <div className="text-[11px] leading-3 min-h-3 text-transparent">占</div>
          </div>
          <div className="flex-1 min-w-0">
            <WorkspaceSelectField
              label="Target Workspace"
              value={targetClient}
              onChange={(v) => {
                if (v === targetClient) return
                setTargetTouched(true)
                setTargetClient(v)
              }}
              workspaces={sortedWorkspaces}
              loading={loadingWs}
              placeholder="选择目标分支工作区"
              streamHint={targetWs?.stream}
              recommendedName={recommendedTargetName}
              invalid={!!sourceIsTarget}
              helperText={sourceIsTarget ? '源与目标相同，无法跨分支 Merge' : ''}
            />
          </div>
        </div>

        {/* ---------- 加载 Source Changelist 按钮 + 用户筛选 ---------- */}
        <div className="flex items-center gap-3 flex-wrap">
          <AppButton
            variant="default"
            size="md"
            onClick={() => void loadChangelists()}
            loading={loadingChanges}
            disabled={!sourceClient}
          >
            <FolderOpenIcon size={14} />
            加载 Source Changelist
          </AppButton>
          {changes.length > 0 && (
            <span className="text-[12px] text-foreground-tertiary">
              共 {changes.length} 个已提交 CL
            </span>
          )}
          <UserFilterControl
            effectiveUser={effectiveUser}
            defaultUser={snapshot?.user ?? ''}
            onDraftChange={setUserDraft}
            editing={userEditing}
            draft={userDraft}
            onStartEdit={() => {
              setUserDraft(effectiveUser)
              setUserEditing(true)
            }}
            onCancel={() => setUserEditing(false)}
            onConfirm={() => {
              setEffectiveUser(userDraft.trim())
              setUserEditing(false)
            }}
            onReset={() => setEffectiveUser(snapshot?.user ?? '')}
          />
        </div>

        {/* ---------- Changelist 列表 ---------- */}
        {changes.length > 0 && (
          <ChangelistList
            changes={changes}
            selected={selectedChange}
            onSelect={(c) => void selectChange(c)}
            loading={loadingPreview}
            sourceClient={sourceClient}
            connection={connection}
          />
        )}

        {/* ---------- Preview ---------- */}
        {preview && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-semibold text-foreground">Merge Preview</div>
              <MergePreviewSummary preview={preview} />
            </div>
            <MergeFileTable
              files={previewFiles}
              sourceClient={sourceClient}
              targetClient={targetClient}
              connection={connection}
            />
            {preview.warnings.length > 0 && (
              <div className="text-[12px] text-warning">
                ⚠ {preview.warnings.length} 条警告：{preview.warnings[0]}
              </div>
            )}
          </div>
        )}

        {/* ---------- 执行 / 取消 ---------- */}
        <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border-subtle">
          {!executing ? (
            <AppButton variant="primary" size="md" onClick={() => void runExecute()} disabled={!canExecute}>
              <RefreshIcon size={14} />
              执行 Merge
            </AppButton>
          ) : (
            <AppButton variant="danger" size="md" onClick={() => void cancelExecuting()}>
              取消 Merge
            </AppButton>
          )}
          {targetChange && !executing && (
            <span className="text-[12px] text-success">
              ✓ Pending CL #{targetChange} 已就绪（未自动提交）
            </span>
          )}
        </div>

        {/* ---------- 从左到右流程管线 ---------- */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-border-subtle">
          <div className="text-[12px] font-semibold text-foreground-secondary">Merge Pipeline</div>
          <MergePipeline
            steps={pipeline}
            p4vActions={p4vActions}
            running={executing}
          />
        </div>
      </div>
    </Panel>
  )
}

/* ---------- 子组件：Workspace 下拉选择（含颜色圆点 + 推荐标注在按钮/选项内）---------- */

function WorkspaceSelectField({
  label,
  value,
  onChange,
  workspaces,
  loading,
  placeholder,
  streamHint,
  recommendedName,
  invalid,
  helperText,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  workspaces: P4Workspace[]
  loading: boolean
  placeholder: string
  streamHint?: string
  /**
   * 推荐的 workspace 名（「猜你想选」）；空字符串表示该字段当前没有推荐，
   * 此时选中项与下拉项都不打标（例如用户已手动选过 Source）.
   */
  recommendedName?: string
  invalid?: boolean
  helperText?: string
}) {
  const [open, setOpen] = useState(false)
  const [kw, setKw] = useState('')
  const selectedWs = workspaces.find((w) => w.name === value)
  const isRecommendedSelected = !!recommendedName && value === recommendedName

  // 过滤：client 名 / stream 包含关键字（大小写不敏感）
  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase()
    if (!k) return workspaces
    return workspaces.filter((w) =>
      `${w.name} ${w.stream ?? ''}`.toLowerCase().includes(k),
    )
  }, [workspaces, kw])

  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1.5 text-[12px] font-medium text-foreground-secondary">
        {label}
        {streamHint && (
          <span className="text-foreground-tertiary font-normal ml-1 font-mono" title={streamHint}>
            ({streamHint})
          </span>
        )}
      </label>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={loading}
          className={`h-8 w-full flex items-center gap-2 rounded-md border bg-surface-1 px-2 pr-7 text-[13px] text-left focus:outline-2 focus:-outline-offset-2 outline-primary disabled:opacity-60 disabled:cursor-not-allowed ${
            invalid ? 'border-error' : 'border-border focus:border-primary'
          } ${open ? 'border-primary' : ''}`}
        >
          {selectedWs ? (
            <>
              <span
                className="shrink-0 w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: resolveWorkspaceColor(selectedWs.name) }}
                aria-hidden
              />
              <span className="flex-1 min-w-0 truncate">{selectedWs.name}</span>
              {isRecommendedSelected && (
                <span
                  className="shrink-0 inline-flex items-center px-1.5 h-4 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300"
                  title="猜你想选"
                >
                  猜你想选
                </span>
              )}
            </>
          ) : (
            <span className="flex-1 min-w-0 text-foreground-quaternary">{placeholder}</span>
          )}
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-foreground-tertiary" aria-hidden>
            <ChevronDownIcon size={14} />
          </span>
        </button>
        {open && (
          <>
            {/* 点击遮罩关闭下拉 */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
            <div className="absolute z-20 top-9 left-0 right-0 max-h-72 flex flex-col rounded-md border border-border bg-surface-1 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.15)] overflow-hidden">
              <div className="p-2 border-b border-border-subtle">
                <AppInput
                  value={kw}
                  onChange={(e) => setKw((e.target as HTMLInputElement).value)}
                  placeholder="搜索 workspace…"
                  autoFocus
                />
              </div>
              <div className="flex-1 overflow-y-auto">
                {filtered.length === 0 ? (
                  <div className="px-2 py-3 text-[12px] text-foreground-tertiary">
                    没有匹配 「{kw}」 的 workspace
                  </div>
                ) : (
                  filtered.map((ws) => {
                    const active = ws.name === value
                    const isRec = !!recommendedName && ws.name === recommendedName
                    return (
                      <button
                        key={ws.name}
                        type="button"
                        onClick={() => {
                          onChange(ws.name)
                          setOpen(false)
                          setKw('')
                        }}
                        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          active
                            ? 'bg-surface-active text-primary'
                            : 'hover:bg-surface-hover text-foreground'
                        }`}
                        title={ws.stream ?? ws.name}
                      >
                        <span
                          className="shrink-0 w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: resolveWorkspaceColor(ws.name) }}
                          aria-hidden
                        />
                        <span className="flex-1 min-w-0 truncate font-mono">{ws.name}</span>
                        {isRec && (
                          <span
                            className="shrink-0 inline-flex items-center px-1.5 h-4 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-300"
                            title="猜你想选"
                          >
                            猜你想选
                          </span>
                        )}
                        {ws.stream && !isRec && (
                          <span className="shrink-0 text-[10px] text-foreground-tertiary font-mono truncate max-w-32">
                            {ws.stream}
                          </span>
                        )}
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          </>
        )}
      </div>
      {helperText !== undefined && (
        <div className={`text-[11px] leading-3 min-h-3 ${helperText ? 'text-error' : 'text-transparent'}`}>
          {helperText || '占位'}
        </div>
      )}
    </div>
  )
}

/* ---------- 用户筛选控件：默认文案 + 点击内联编辑 ---------- */

function UserFilterControl({
  effectiveUser,
  defaultUser,
  editing,
  draft,
  onStartEdit,
  onCancel,
  onConfirm,
  onReset,
  onDraftChange,
}: {
  effectiveUser: string
  defaultUser: string
  editing: boolean
  draft: string
  onStartEdit: () => void
  onCancel: () => void
  onConfirm: () => void
  onReset: () => void
  /** 编辑态草稿更新（写入 draft，不直接改 effectiveUser） */
  onDraftChange: (v: string) => void
}) {
  const isDefault = !effectiveUser || effectiveUser === defaultUser
  const displayUser = isDefault ? defaultUser : effectiveUser

  if (editing) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="text-[12px] text-foreground-secondary">当前按用户选择</span>
        <div className="w-32">
          <AppInput
            value={draft}
            onChange={(e) => onDraftChange((e.target as HTMLInputElement).value)}
            placeholder={defaultUser || '用户名'}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConfirm()
              else if (e.key === 'Escape') onCancel()
            }}
          />
        </div>
        <span className="text-[12px] text-foreground-secondary">进行筛选</span>
        <AppButton size="sm" variant="primary" onClick={onConfirm}>
          确定
        </AppButton>
        <AppButton size="sm" variant="ghost" onClick={onCancel}>
          取消
        </AppButton>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onStartEdit}
        className="text-[12px] text-foreground-secondary hover:text-primary transition-colors"
        title="点击修改筛选用户（帮别人 merge）"
      >
        {isDefault ? (
          <>
            默认按「<span className="text-primary font-medium">{displayUser || '未登录'}</span>」进行筛选
          </>
        ) : (
          <>
            当前按用户选择 <span className="text-primary font-medium">{effectiveUser}</span> 进行筛选
          </>
        )}
        <span className="text-foreground-tertiary ml-1">（点击修改）</span>
      </button>
      {!isDefault && (
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] text-foreground-tertiary hover:text-primary transition-colors"
          title={`恢复为默认 ${defaultUser}`}
        >
          重置
        </button>
      )}
    </div>
  )
}

/* ---------- 流动箭头：从左到右动画，颜色随两端 workspace ---------- */

function FlowArrow({
  fromColor,
  toColor,
  active,
}: {
  fromColor: string
  toColor: string
  active: boolean
}) {
  // 用线性渐变 + dasharray 流动动画：从 fromColor 流向 toColor
  return (
    <div className="flex flex-col items-center gap-1" title={active ? 'Merge 方向：源 → 目标' : '选择两端 workspace'}>
      <svg width="64" height="14" viewBox="0 0 64 14" fill="none" aria-hidden>
        <defs>
          <linearGradient id="flow-grad" x1="0" y1="0" x2="64" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={fromColor} />
            <stop offset="1" stopColor={toColor} />
          </linearGradient>
        </defs>
        {/* 底层静态轨道 */}
        <line
          x1="2"
          y1="7"
          x2="56"
          y2="7"
          stroke="var(--color-border)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        {/* 上层流动线：dashoffset 动画从左到右 */}
        <line
          x1="2"
          y1="7"
          x2="56"
          y2="7"
          stroke="url(#flow-grad)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="8 6"
          className={active ? 'p4-merge-flow-dash' : ''}
          opacity={active ? 1 : 0.3}
        />
        {/* 箭头头部 */}
        <path
          d="M58 7 L52 3.5 L52 10.5 Z"
          fill={active ? toColor : 'var(--color-border)'}
        />
      </svg>
      <span className={`text-[10px] leading-3 ${active ? 'text-foreground' : 'text-foreground-quaternary'}`}>
        Merge
      </span>
    </div>
  )
}
