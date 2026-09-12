/*
 * Cross Branch Merge — 纯逻辑模块（不依赖 Electron / IO）.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md：
 *   - §5  P4 CLI 基础能力统一封装
 *   - §10 Changelist File Model
 *   - §11 Branch / Depot Path 分析（不靠字符串替换，独立的 BranchMapping）
 *   - §19 Merge Tool 抽象 + §25 MergeToolRegistry
 *   - §30 Merge Preview（纯只读，不修改 Workspace）
 *   - §49 文件类型判断（P4 File Type > Extension > Configured Rule）
 *
 * 独立成纯函数模块便于单元测试（见 test/p4-merge.test.ts），
 * 与 electron/main/p4.ts 同构：electron 依赖部分留在 ipc.ts.
 */

/* ---------- P4 数据模型 ---------- */

export interface P4Changelist {
  change: number
  user: string
  client: string
  date: string
  description: string
  status: 'submitted' | 'pending'
}

export type P4ChangeAction = 'add' | 'edit' | 'delete' | 'move/add' | 'move/delete' | 'branch' | 'integrate'

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

/* ---------- Branch Mapping ---------- */

export interface BranchMapping {
  /** 源分支 depot 根，如 `//C7/Development/Mainline`（不含 `...`） */
  source: string
  /** 目标分支 depot 根，如 `//C7/Development/Weekly`（不含 `...`） */
  target: string
}

/**
 * 把源 depot 路径映射到目标 depot 路径.
 * 严格按 BranchMapping 的根前缀替换，不做模糊字符串匹配：
 *   //C7/Development/Mainline/Client/A.lua
 *      → //C7/Development/Weekly/Client/A.lua
 * 源路径不属于该分支根时返回 null，由调用方决定是否拒绝.
 */
export function mapSourceToTargetPath(source: string, mapping: BranchMapping): string | null {
  const src = normalizeDepotRoot(mapping.source)
  const tgt = normalizeDepotRoot(mapping.target)
  if (!source.startsWith(src + '/')) return null
  return tgt + source.slice(src.length)
}

/** 规范化分支根：去掉尾部 `/` 与 `/...`，统一为 `//depot/path` 形式 */
export function normalizeDepotRoot(root: string): string {
  let v = root.trim()
  while (v.endsWith('/...')) v = v.slice(0, -3)
  while (v.endsWith('/')) v = v.slice(0, -1)
  return v
}

/* ---------- Merge Tool Registry ---------- */

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

export interface MergeToolContext {
  baseFile: string
  sourceFile: string
  targetFile: string
  resultFile: string
  sourceDepotPath: string
  targetDepotPath: string
  sourceRevision?: number
  targetRevision?: number
}

/** 参数模板变量映射（spec §21）：禁止把原始 %x 直接交给 shell */
export const MERGE_TOOL_VARIABLES: Record<string, keyof MergeToolContext> = {
  '%b': 'baseFile',
  '%1': 'sourceFile',
  '%2': 'targetFile',
  '%r': 'resultFile',
}

/**
 * 把 MergeTool 的 arguments 模板解析为实际参数数组.
 *   "%b %1 %2 %r VCSTool=p4"  → ["/tmp/base", "/tmp/src", "/tmp/tgt", "/tmp/res", "VCSTool=p4"]
 * 已解析的变量用 context 字段替换；未知 token 原样保留（如 VCSTool=p4）.
 * 永远走 spawn(executable, args)，不拼 shell 字符串（spec §69.3/§69.4）.
 */
export function resolveMergeToolArgs(template: string, ctx: MergeToolContext): string[] {
  const tokens = template.split(/\s+/).filter((t) => t.length > 0)
  const out: string[] = []
  for (const token of tokens) {
    const field = MERGE_TOOL_VARIABLES[token]
    if (field) {
      const v = ctx[field]
      if (typeof v === 'string' && v.length > 0) out.push(v)
      continue
    }
    out.push(token)
  }
  return out
}

/** 内置 P4Merge（文本）与 KeyExcelMerge（Excel）默认配置，用户可在配置文件覆盖 */
export const DEFAULT_MERGE_TOOLS: MergeTool[] = [
  {
    id: 'p4merge',
    name: 'P4Merge',
    executable: '',
    extensions: ['.lua', '.json', '.ini', '.cfg', '.xml', '.txt', '.md', '.csv', '.ts', '.js'],
    arguments: '%b %1 %2 %r',
    priority: 10,
    successExitCodes: [0],
    cancelExitCodes: [1],
  },
  {
    id: 'key-excel-merge',
    name: 'KeyExcelMerge',
    executable: 'Design/Tool/KeyExcelMergeTool/KeyExcelMerge/KeyExcelMerge.exe',
    extensions: ['.xlsx', '.xlsm', '.xls'],
    arguments: '%b %1 %2 %r VCSTool=p4',
    priority: 5,
    successExitCodes: [0],
    cancelExitCodes: [1],
  },
]

/** 不支持自动 merge 的二进制后缀（spec §22 Binary） */
export const BINARY_EXTENSIONS = new Set(['.uasset', '.umap', '.pak', '.png', '.jpg', '.jpeg', '.bmp', '.tga', '.psd', '.mp3', '.wav', '.ogg'])

/**
 * Merge Tool 注册中心（spec §25）.
 *   resolve(file) 优先按扩展名匹配；多个匹配按 priority 升序（数字小优先）.
 *   找不到匹配且非二进制 → 回退 p4merge；二进制 → null（Manual Resolution）.
 */
export class MergeToolRegistry {
  private tools = new Map<string, MergeTool>()

  constructor(initial: MergeTool[] = []) {
    for (const t of initial) this.register(t)
  }

  register(tool: MergeTool): void {
    this.tools.set(tool.id, { ...tool })
  }

  list(): MergeTool[] {
    return [...this.tools.values()].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100))
  }

  resolve(extension: string): MergeTool | null {
    const ext = extension.toLowerCase()
    const matched = this.list().filter((t) => t.extensions.some((e) => e.toLowerCase() === ext))
    if (matched.length > 0) return matched[0]
    if (BINARY_EXTENSIONS.has(ext)) return null
    // 回退默认 p4merge（若注册表里没有，返回 null 由调用方做 Manual）
    return this.tools.get('p4merge') ?? null
  }
}

/* ---------- Changelist 解析 ---------- */

/**
 * 解析 `p4 -ztag changes -s submitted -u <user> -c <client>` 输出.
 * 实际字段名（用本机 p4 验证）：
 *   ... change 2137156
 *   ... time 1789129232          ← unix 秒，需格式化为可读日期
 *   ... user chenzhixu
 *   ... client chenzhixu_C7_Mainline
 *   ... status submitted
 *   ... desc 测试merge功能 ...   ← 注意是 desc 不是 description（单行，完整描述需 p4 describe）
 *   ... path //C7/.../*
 * 注意：desc 在 -ztag changes 下只有首行；多行描述需 p4 describe.
 */
export function parseTaggedChanges(output: string): P4Changelist[] {
  const records: P4Changelist[] = []
  let current:
    | (Partial<P4Changelist> & { time?: number })
    | null = null
  const flush = () => {
    if (current && current.change !== undefined && current.user !== undefined) {
      records.push({
        change: current.change,
        user: current.user,
        client: current.client ?? '',
        date:
          current.time !== undefined
            ? formatTimestamp(current.time)
            : (current.date ?? ''),
        description: current.description ?? '',
        status: current.status ?? 'submitted',
      })
    }
    current = null
  }
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line.startsWith('...')) {
      if (line === '' && current) flush()
      continue
    }
    const body = line.replace(/^\.\.\.\s*/, '')
    const sp = body.indexOf(' ')
    if (sp < 0) continue
    const key = body.slice(0, sp)
    const value = body.slice(sp + 1).trim()
    if (key === 'change') {
      if (current) flush()
      current = { change: Number(value), user: '', status: 'submitted' }
    } else if (!current) {
      continue
    } else if (key === 'user') {
      current.user = value
    } else if (key === 'client') {
      current.client = value
    } else if (key === 'time') {
      current.time = Number(value)
    } else if (key === 'date') {
      // 兼容旧版本直接给日期字符串的字段名
      current.date = value
    } else if (key === 'status') {
      current.status = value === 'pending' ? 'pending' : 'submitted'
    } else if (key === 'desc') {
      current.description = value
    } else if (key === 'description' && current.description === undefined) {
      // 兼容个别 p4 版本用 description 字段名
      current.description = value
    }
  }
  flush()
  return records
}

/** 把 unix 秒格式化为 `YYYY/MM/DD HH:MM:SS`（本地时区，与 P4V 显示一致） */
export function formatTimestamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`
}

/**
 * 解析 `p4 describe -s <change>` 输出（非 -ztag 形式，最常见）.
 * 典型片段：
 *   Change 2132162 by chenzhixu@chenzhixu_C7_Mainline on 2026/09/11 18:00:00
 *
 *       增加ksbc table级别的lua化
 *
 *   Affected files ...
 *
 *   ... //C7/Development/Mainline/Client/A.lua#1 edit
 *   ... //C7/Development/Mainline/Client/B.xlsx#1 add
 *
 * 区块以空行 + "Affected files ..." 分隔，文件行格式：... <depotPath>#<rev> <action>
 */
export function parseDescribeOutput(output: string): { change: number; description: string; files: P4ChangeFile[] } {
  const lines = output.split(/\r?\n/)
  let change = 0
  let description = ''
  const files: P4ChangeFile[] = []

  let inFiles = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!inFiles) {
      // Change 2132162 by chenzhixu@client on 2026/09/11 18:00:00
      const m = line.match(/^Change\s+(\d+)\s+by\b/)
      if (m && change === 0) change = Number(m[1])
      if (line.startsWith('Affected files')) {
        inFiles = true
        continue
      }
      // 描述行：跳过 "Change ... by ..." 后的空行与缩进行
      if (change !== 0 && line.trim().length > 0 && !line.startsWith('Change ') && !line.startsWith('Affected')) {
        // 取首段非空缩进行作为 description（多段用 \n 连接）
        const text = line.trim()
        if (description.length === 0) description = text
        else if (!line.startsWith('...')) description += `\n${text}`
      }
    } else {
      if (!line.startsWith('... ')) {
        if (line.trim() === '') continue
        // 其它 "... " 开头之外的行（如 "Differences ..."）结束文件区块
        if (line.startsWith('Differences') || line.startsWith('Jobs ') || line.startsWith('Change ')) {
          inFiles = false
        }
        continue
      }
      // ... //depot/path#rev action
      const body = line.slice(4).trim()
      const hash = body.lastIndexOf('#')
      if (hash < 0) continue
      const depotPath = body.slice(0, hash)
      const rest = body.slice(hash + 1)
      const sp = rest.indexOf(' ')
      const revision = sp < 0 ? Number(rest) : Number(rest.slice(0, sp))
      const action = (sp < 0 ? rest : rest.slice(sp + 1)).trim() as P4ChangeAction
      if (depotPath && Number.isFinite(revision)) {
        files.push({ depotPath, revision, action })
      }
    }
  }
  return { change, description: description.trim(), files }
}

/**
 * 解析 `p4 opened -c <change>` / `p4 opened -a <files>` 输出.
 * 行格式：//depot/path#rev action change <change> (type) by user@client
 * 例：//C7/Weekly/Client/A.lua#2 edit default (text) by chenzhixu@chenzhixu_C7_Weekly
 * (type) 可能在 "by ..." 之前，所以 fileType 正则不锚定行尾.
 */
export function parseOpenedOutput(output: string): P4OpenedFile[] {
  const result: P4OpenedFile[] = []
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || !line.startsWith('//')) continue
    const hash = line.indexOf('#')
    if (hash < 0) continue
    const depotPath = line.slice(0, hash)
    const rest = line.slice(hash + 1)
    // revision
    const sp1 = rest.indexOf(' ')
    const revision = sp1 < 0 ? rest : rest.slice(0, sp1)
    const tail = sp1 < 0 ? '' : rest.slice(sp1 + 1)
    // action
    const sp2 = tail.indexOf(' ')
    const action = sp2 < 0 ? tail : tail.slice(0, sp2)
    const after = sp2 < 0 ? '' : tail.slice(sp2 + 1)
    // change（default 或 数字）
    const sp3 = after.indexOf(' ')
    const change = sp3 < 0 ? after : after.slice(0, sp3)
    // type：(type) 在 change 之后、by 之前；取第一个括号组
    const typeMatch = after.match(/\(([^)]+)\)/)
    const fileType = typeMatch ? typeMatch[1] : undefined
    // client：行尾 "by user@client"
    const clientMatch = after.match(/by\s+\S+@(\S+)/)
    result.push({
      depotPath,
      revision,
      action,
      change,
      fileType,
      client: clientMatch ? clientMatch[1] : undefined,
    })
  }
  return result
}

/* ---------- 文件分类与 Preview ---------- */

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
  /** 命中的 Merge Tool id（spec §25）；null 表示无工具（二进制走覆盖策略） */
  mergeTool?: string | null
  /** Merge Tool 显示名，供 UI 直接展示 */
  mergeToolName?: string
  status: MergeFileStatus
}

/** 从 depot 路径取扩展名（小写，含 `.`） */
export function getExtension(depotPath: string): string {
  const base = depotPath.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  return base.slice(dot).toLowerCase()
}

export interface MergePreview {
  sourceWorkspace: string
  targetWorkspace: string
  sourceChange: number
  mapping: BranchMapping
  files: MergeFile[]
  /** 自动 merge 数量（有命中 MergeTool 且非二进制） */
  autoCount: number
  /** 需要手动 resolve 数量（工具执行后仍冲突） */
  manualCount: number
  /** 二进制覆盖数量（accept source，用源版本覆盖目标） */
  overrideCount: number
  /** 不支持自动 merge 数量（保留字段，当前二进制均走覆盖策略，此处恒为 0） */
  unsupportedCount: number
  warnings: string[]
}

/**
 * 计算 Merge Preview（纯只读，spec §64：不修改 Workspace/Pending CL/Opened Files）.
 *   - 逐文件计算目标路径（BranchMapping）
 *   - 命中 Merge Tool（按扩展名 + Registry 优先级）
 *   - 预测 status：
 *       有工具 → pending（执行后由 Resolve 阶段更新）
 *       二进制且无工具 → override（accept source，用源版本覆盖目标，spec §22 Binary 调整为覆盖策略）
 *   - 不调用任何 P4 命令，纯本地推导
 */
export function computeMergePreview(params: {
  sourceWorkspace: string
  targetWorkspace: string
  sourceChange: number
  mapping: BranchMapping
  changeFiles: P4ChangeFile[]
  registry: MergeToolRegistry
}): MergePreview {
  const files: MergeFile[] = []
  let autoCount = 0
  let manualCount = 0
  let overrideCount = 0
  const warnings: string[] = []

  for (const f of params.changeFiles) {
    const targetPath = mapSourceToTargetPath(f.depotPath, params.mapping)
    if (!targetPath) {
      warnings.push(`无法映射源路径：${f.depotPath}（不在 ${params.mapping.source} 下）`)
      continue
    }
    const extension = getExtension(f.depotPath)
    const tool = params.registry.resolve(extension)
    if (!tool) {
      // 二进制且无匹配工具：走覆盖策略（accept source），用源版本覆盖目标
      overrideCount += 1
      files.push({
        sourcePath: f.depotPath,
        targetPath,
        sourceRevision: f.revision,
        action: f.action,
        extension,
        mergeTool: 'binary-override',
        mergeToolName: '覆盖(Accept Source)',
        status: 'override',
      })
    } else {
      autoCount += 1
      files.push({
        sourcePath: f.depotPath,
        targetPath,
        sourceRevision: f.revision,
        action: f.action,
        extension,
        mergeTool: tool.id,
        mergeToolName: tool.name,
        status: 'pending',
      })
    }
  }

  return {
    sourceWorkspace: params.sourceWorkspace,
    targetWorkspace: params.targetWorkspace,
    sourceChange: params.sourceChange,
    mapping: params.mapping,
    files,
    autoCount,
    manualCount,
    overrideCount,
    unsupportedCount: 0,
    warnings,
  }
}

/* ---------- 命令构造 ---------- */

/**
 * 构造 `p4 -c <targetClient> integrate -c <targetChange> -o <source>#<rev> <target>` 参数.
 * spec §17：优先 `p4 integrate -c <targetPendingChange> ...` 让结果直接进入 Pending CL.
 * 这里只构造参数数组，executable 与环境变量由 P4Service 注入.
 */
export function buildIntegrateArgs(params: {
  targetClient: string
  targetChange: string
  files: { sourcePath: string; targetPath: string; sourceRevision?: number }[]
}): string[] {
  const args = ['-c', params.targetClient, 'integrate', '-c', params.targetChange]
  for (const f of params.files) {
    const revSuffix = f.sourceRevision ? `#${f.sourceRevision}` : ''
    args.push(`${f.sourcePath}${revSuffix}`, f.targetPath)
  }
  return args
}

/**
 * 构造 `p4 -c <targetClient> resolve -am` 参数（auto merge，spec §26）.
 * 若传入 file 列表则只 resolve 这些文件；否则 resolve 全部已 integrate 的文件.
 */
export function buildResolveArgs(params: { targetClient: string; files?: string[]; mode: 'auto' | 'manual' | 'preview' }): string[] {
  const flag = params.mode === 'auto' ? '-am' : params.mode === 'preview' ? '-n' : ''
  const args = ['-c', params.targetClient, 'resolve']
  if (flag) args.push(flag)
  if (params.files && params.files.length > 0) args.push(...params.files)
  return args
}

/**
 * 构造 `p4 -c <targetClient> resolve -as` 参数（accept source，二进制覆盖策略）.
 * `-as` 强制采用源版本解决冲突，用于二进制文件等无法三路合并的情况（spec §22 Binary 调整为覆盖）.
 * 若传入 file 列表则只 resolve 这些文件.
 */
export function buildResolveOverrideArgs(params: { targetClient: string; files?: string[] }): string[] {
  const args = ['-c', params.targetClient, 'resolve', '-as']
  if (params.files && params.files.length > 0) args.push(...params.files)
  return args
}

/**
 * 构造 `p4 -c <targetClient> sync` 参数（spec §13/§14 最小范围 Sync）.
 *   - mode='file'：只 sync changelist 涉及的目标文件（默认，最小流量）
 *   - mode='directory'：计算文件共同的最小父目录，sync <dir>/...（同步范围略大但更稳妥）
 * 不再支持 manual（不 sync）—— Merge 前必须确保目标文件最新，否则 Integrate 结果不可控.
 */
export function buildSyncArgs(params: {
  targetClient: string
  files: string[]
  mode?: 'file' | 'directory'
}): string[] {
  const mode = params.mode ?? 'file'
  if (mode === 'file') {
    return ['-c', params.targetClient, 'sync', ...params.files]
  }
  // directory 模式：对 depot 路径取共同父目录，追加 /... 做 目录级 sync
  const dirs = dedupeCommonParentDirs(params.files)
  const targets = dirs.length > 0 ? dirs.map((d) => `${d}/...`) : params.files
  return ['-c', params.targetClient, 'sync', ...targets]
}

/**
 * 对一组 depot 路径计算共同父目录，去重后返回最小目录集合.
 *   ['//C7/Dev/Weekly/Client/A.lua', '//C7/Dev/Weekly/Server/B.json']
 *     → ['//C7/Dev/Weekly/Client', '//C7/Dev/Weekly/Server']
 * 同一目录的多个文件合并为该目录；不同分支根路径各自保留父目录.
 */
export function dedupeCommonParentDirs(paths: string[]): string[] {
  const dirs = new Set<string>()
  for (const p of paths) {
    const slash = p.lastIndexOf('/')
    if (slash > 0) dirs.add(p.slice(0, slash))
    else dirs.add(p)
  }
  return [...dirs]
}

/**
 * 构造 `p4 -c <targetClient> change -o` 输入模板（spec §18 Pending CL 描述模板）.
 * 返回描述文本，主进程用 stdin 写给 `p4 change -i`.
 */
export function buildPendingChangeDescription(params: {
  sourceBranch: string
  sourceChange: number
  targetBranch: string
  user: string
  sourceDescription: string
}): string {
  return [
    '[Cross Branch Merge]',
    `Source: ${params.sourceBranch}`,
    `Source Change: ${params.sourceChange}`,
    `Target: ${params.targetBranch}`,
    `User: ${params.user}`,
    '',
    'Original Description:',
    params.sourceDescription,
  ].join('\n')
}

/* ---------- Pipeline 状态模型 ---------- */

export type PipelineStepId = 'preflight' | 'sync' | 'pending' | 'integrate' | 'resolve' | 'result'
export type PipelineStepStatus = 'idle' | 'running' | 'success' | 'failed' | 'skipped'

export interface PipelineStepState {
  id: PipelineStepId
  label: string
  status: PipelineStepStatus
  /** 该步骤产出的日志行（命令、stdout/stderr 摘要、耗时等） */
  logs: string[]
  /** 该步骤开始时间（ms），用于计算耗时 */
  startedAt?: number
  /** 该步骤结束时间（ms） */
  endedAt?: number
  /** 失败原因（status=failed 时） */
  error?: string
}

/** 流程管线状态：按固定顺序排列，UI 从左到右渲染 */
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

/** 生成 Merge Transaction ID（spec §40）：MERGE-YYYYMMDD-NNNNN */
export function generateTransactionId(date: Date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  const seq = String(date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds())
    .padStart(5, '0')
  return `MERGE-${y}${m}${d}-${seq}`
}
