/*
 * p4Merge Service — 跨分支 Perforce Merge 的渲染层 IPC 桥接.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md §4.1：Renderer 禁止直接执行系统命令，
 *   所有 P4 调用经此 Service → IPC → Main Process P4Service.
 *
 * 类型与主进程 electron/main/p4Merge.ts 镜像（保持同名同结构，便于后续抽 shared 层）；
 *   纯本地辅助（Branch Mapping 推断、路径映射）在此重实现，不跨 electron 边界 import.
 *   与 src/services/p4Workspaces.ts 同构：类型在 renderer 侧独立定义，主进程侧独立定义.
 *
 * 进度事件：主进程通过 webContents.send('p4-merge:progress', payload) 推送，
 *   渲染层用 subscribeMergeProgress 注册监听器，返回取消订阅函数.
 */

/* ---------- 类型定义（镜像 electron/main/p4Merge.ts，保持同名同结构）---------- */

export type P4ChangeAction = 'add' | 'edit' | 'delete' | 'move/add' | 'move/delete' | 'branch' | 'integrate'

export interface P4Changelist {
  change: number
  user: string
  client: string
  date: string
  description: string
  status: 'submitted' | 'pending'
}

export interface P4ChangeFile {
  depotPath: string
  revision: number
  action: P4ChangeAction
  fileType?: string
}

export interface P4OpenedFile {
  depotPath: string
  revision: string
  action: string
  change: string
  fileType?: string
  client?: string
}

export interface BranchMapping {
  /** 源分支 depot 根，如 `//C7/Development/Mainline`（不含 `...`） */
  source: string
  /** 目标分支 depot 根，如 `//C7/Development/Weekly`（不含 `...`） */
  target: string
}

export interface MergeTool {
  id: string
  name: string
  executable: string
  arguments: string
  extensions: string[]
  priority?: number
  successExitCodes?: number[]
  cancelExitCodes?: number[]
}

export type MergeFileStatus =
  | 'pending'
  | 'syncing'
  | 'integrated'
  | 'auto-resolved'
  | 'conflict'
  | 'resolved'
  | 'skipped'
  | 'failed'
  | 'unsupported'
  | 'override'

export interface MergeFile {
  sourcePath: string
  targetPath: string
  sourceRevision?: number
  targetRevision?: number
  baseRevision?: number
  action: P4ChangeAction
  extension: string
  mergeTool?: string | null
  mergeToolName?: string
  status: MergeFileStatus
}

export interface MergePreview {
  sourceWorkspace: string
  targetWorkspace: string
  sourceChange: number
  mapping: BranchMapping
  files: MergeFile[]
  autoCount: number
  manualCount: number
  /** 二进制覆盖数量（accept source） */
  overrideCount: number
  unsupportedCount: number
  warnings: string[]
}

export type PipelineStepId = 'preflight' | 'sync' | 'pending' | 'integrate' | 'resolve' | 'result'
export type PipelineStepStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

export interface PipelineStepState {
  id: PipelineStepId
  label: string
  status: PipelineStepStatus
  logs: string[]
  startedAt?: number
  endedAt?: number
  error?: string
}

/* ---------- IPC 响应类型 ---------- */

export interface ChangesResult {
  ok: boolean
  changes?: P4Changelist[]
  error?: string
}

export interface DescribeResult {
  ok: boolean
  change?: number
  description?: string
  files?: P4ChangeFile[]
  error?: string
}

export interface OpenedResult {
  ok: boolean
  opened?: P4OpenedFile[]
  error?: string
}

export interface PreviewResult {
  ok: boolean
  preview?: MergePreview
  error?: string
}

export interface ExecuteMergeParams {
  sourceClient: string
  targetClient: string
  sourceChange: number
  sourceDescription: string
  mapping: BranchMapping
  user: string
  files: { sourcePath: string; targetPath: string; sourceRevision?: number }[]
  /** Sync 模式：file（默认）= 只 sync CL 涉及文件；directory = sync 共同父目录 /... */
  syncMode: 'file' | 'directory'
}

export interface ExecuteResult {
  ok: boolean
  transactionId?: string
  targetChange?: number
  error?: string
}

export interface ProgressPayload {
  transactionId: string
  step: PipelineStepId
  patch: PipelineStepState
}

/* ---------- IPC 包装 ---------- */

export async function listChangelists(params: {
  client: string
  user?: string
  limit?: number
}): Promise<ChangesResult> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:changes', params)) as ChangesResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function describeChangelist(params: { change: number; client?: string }): Promise<DescribeResult> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:describe', params)) as DescribeResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function checkOpened(params: { client: string; files?: string[] }): Promise<OpenedResult> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:opened', params)) as OpenedResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getMergeTools(): Promise<MergeTool[]> {
  try {
    const r = (await window.ipcRenderer.invoke('p4-merge:merge-tools')) as { tools: MergeTool[] }
    return r?.tools ?? []
  } catch {
    return []
  }
}

export async function previewMerge(params: {
  sourceWorkspace: string
  targetWorkspace: string
  sourceChange: number
  mapping: BranchMapping
  changeFiles: P4ChangeFile[]
}): Promise<PreviewResult> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:preview', params)) as PreviewResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function executeMerge(params: ExecuteMergeParams): Promise<ExecuteResult> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:execute', params)) as ExecuteResult
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function cancelMerge(transactionId: string): Promise<{ ok: boolean }> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:cancel', transactionId)) as { ok: boolean }
  } catch {
    return { ok: false }
  }
}

export async function openMergeResultInP4V(params: {
  client: string
  port?: string
  user?: string
  charset?: string
  pendingChange?: number
  /** 已提交 changelist 编号（用 p4vc change <num> 打开详情） */
  change?: number
  /** 要定位的文件/目录（depot 路径或本地路径，对应 p4vc -s） */
  target?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    return (await window.ipcRenderer.invoke('p4-merge:open-in-p4v', params)) as { ok: boolean; error?: string }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 订阅 Merge 进度事件. 主进程每步状态变更时推送 patch，
 *   渲染层用它驱动从左到右的管线状态更新.
 * 返回取消订阅函数（组件卸载时调用，避免内存泄漏）.
 */
export function subscribeMergeProgress(listener: (payload: ProgressPayload) => void): () => void {
  const handler = (_event: unknown, payload: ProgressPayload) => listener(payload)
  window.ipcRenderer.on('p4-merge:progress', handler)
  return () => window.ipcRenderer.off('p4-merge:progress', handler)
}

/* ---------- 本地辅助：Branch Mapping 推断（纯函数，镜像主进程逻辑）---------- */

/** 规范化分支根：去掉尾部 `/` 与 `/...`，统一为 `//depot/path` 形式 */
export function normalizeDepotRoot(root: string): string {
  let v = root.trim()
  while (v.endsWith('/...')) v = v.slice(0, -3)
  while (v.endsWith('/')) v = v.slice(0, -1)
  return v
}

/**
 * 把源 depot 路径映射到目标 depot 路径.
 * 严格按 BranchMapping 的根前缀替换，不做模糊字符串匹配（spec §11）：
 *   //C7/Development/Mainline/Client/A.lua → //C7/Development/Weekly/Client/A.lua
 * 源路径不属于该分支根时返回 null.
 */
export function mapToTargetPath(sourcePath: string, mapping: BranchMapping): string | null {
  const src = normalizeDepotRoot(mapping.source)
  const tgt = normalizeDepotRoot(mapping.target)
  if (!sourcePath.startsWith(src + '/')) return null
  return tgt + sourcePath.slice(src.length)
}

/**
 * 从源 / 目标 workspace 的 stream 字段推断 Branch Mapping.
 * spec §11：第一阶段支持配置，后续可从 Stream 自动获取.
 * 例：source stream //C7/Development/Mainline + target stream //C7/Development/Weekly
 *      → { source: //C7/Development/Mainline, target: //C7/Development/Weekly }
 */
export function inferBranchMappingFromStreams(sourceStream?: string, targetStream?: string): BranchMapping | null {
  if (!sourceStream || !targetStream) return null
  return {
    source: normalizeDepotRoot(sourceStream),
    target: normalizeDepotRoot(targetStream),
  }
}

/** 从 depot 路径取扩展名（小写，含 `.`） */
export function getExtension(depotPath: string): string {
  const base = depotPath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return base.slice(dot).toLowerCase()
}

/* ---------- Redmine 单号解析（描述里的 #361226 → Redmine issue URL）---------- */

/** Redmine issue 页 URL 模板（与 src/services/redmineIssues.ts 的 REDMINE_FILTER_WEB_URL 同源） */
export const REDMINE_ISSUE_URL_TEMPLATE =
  'https://gamecloud-redmine.corp.kuaishou.com/1007/projects/c7/issues/{id}'

/**
 * 从文本中提取 Redmine 单号（#数字 形式，数字 4-7 位）.
 * 用于把 changelist 描述里的 `#361226` 渲染为可点击链接跳转 Redmine issue 页.
 * 返回 [{ match: '#361226', id: '361226' }] 形式，便于渲染层分段渲染.
 */
export interface RedmineRef {
  /** 完整匹配文本，如 `#361226` */
  match: string
  /** 单号数字字符串，如 `361226` */
  id: string
}

export function parseRedmineRefs(text: string): RedmineRef[] {
  const result: RedmineRef[] = []
  // # 后跟 4-7 位数字；避免匹配 #fix 这类非单号
  const re = /#(\d{4,7})/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    result.push({ match: m[0], id: m[1] })
  }
  return result
}

/** 构造 Redmine issue 页 URL */
export function buildRedmineIssueUrl(id: string | number): string {
  return REDMINE_ISSUE_URL_TEMPLATE.replace('{id}', String(id))
}

/* ---------- human 相对时间 ---------- */

/**
 * 把 `YYYY/MM/DD HH:MM:SS`（parseTaggedChanges 的 date 字段）转相对时间文案.
 *   几秒前 / 几分钟前 / 几小时前 / 一天前 / N 天前.
 * 超过 4 天返回空字符串（调用方据此隐藏标签，避免老旧 CL 噪声）.
 * 与 c.date 同源，输入非法时回退空串.
 */
export function humanizeDate(dateStr: string, now: Date = new Date()): string {
  if (!dateStr) return ''
  const m = dateStr.match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return ''
  const [, y, mo, d, h, mi, s] = m
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  if (Number.isNaN(date.getTime())) return ''
  const diffMs = Math.max(0, now.getTime() - date.getTime())
  const sec = Math.floor(diffMs / 1000)
  if (sec < 60) return `${sec} 秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '一天前'
  if (day <= 4) return `${day} 天前`
  // 超过 4 天返回空，调用方不显示标签
  return ''
}

/* ---------- Pipeline 初始状态 ---------- */

export const PIPELINE_STEP_ORDER: PipelineStepId[] = ['preflight', 'sync', 'pending', 'integrate', 'resolve', 'result']

export const PIPELINE_STEP_LABELS: Record<PipelineStepId, string> = {
  preflight: 'Preflight',
  sync: 'Minimal Sync',
  pending: 'Pending CL',
  integrate: 'P4 Integrate',
  resolve: 'P4 Resolve',
  result: 'Result',
}

export function createInitialPipeline(): PipelineStepState[] {
  return PIPELINE_STEP_ORDER.map((id) => ({
    id,
    label: PIPELINE_STEP_LABELS[id],
    status: 'idle',
    logs: [],
  }))
}
