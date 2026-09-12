import { useMemo } from 'react'
import { CopyIcon, P4VWindowIcon } from '@/components/ui/icons'
import { PERFORCE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import type { MergeFile, MergePreview } from '@/services/p4Merge'
import { openMergeResultInP4V } from '@/services/p4Merge'
import type { P4VConnection } from '@/services/p4Workspaces'

/*
 * MergeFileTable — Merge Preview 的文件列表表格.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md §30（Preview）+ §56（Preview 页面表格）：
 *   File | Action | Source Path | Target Path | Tool | Status
 *
 * Source / Target Depot Path 单元格内嵌：
 *   - 复制按钮：灰色图标，复制完整 depot 路径到剪贴板
 *   - P4V 按钮：Perforce 蓝边框 + P4V 图标 + "P4V" 文字，在 P4V 中定位到该文件
 *     （source 用 sourceClient，target 用 targetClient；与 ChangelistList 的 Change 号按钮同款样式）
 * 状态列：
 *   - pending：灰色（待执行）
 *   - override：橙色（二进制覆盖，accept source）
 *   - unsupported：红色（保留字段，当前二进制均走 override）
 *   - 其它状态在执行阶段由主进程回推
 */

const STATUS_LABEL: Record<MergeFile['status'], { text: string; cls: string }> = {
  pending: { text: '待执行', cls: 'text-foreground-tertiary' },
  syncing: { text: '同步中', cls: 'text-primary' },
  integrated: { text: '已 Integrate', cls: 'text-info' },
  'auto-resolved': { text: '自动解决', cls: 'text-success' },
  conflict: { text: '冲突', cls: 'text-warning' },
  resolved: { text: '已解决', cls: 'text-success' },
  skipped: { text: '跳过', cls: 'text-foreground-tertiary' },
  failed: { text: '失败', cls: 'text-error' },
  unsupported: { text: '不支持', cls: 'text-error' },
  override: { text: '覆盖', cls: 'text-warning' },
}

function shortName(depotPath: string): string {
  const parts = depotPath.split('/')
  return parts[parts.length - 1] || depotPath
}

interface MergeFileTableProps {
  files: MergeFile[]
  /** Source / Target workspace client 名 + 连接信息，用于 P4V 跳转定位 */
  sourceClient?: string
  targetClient?: string
  connection?: P4VConnection
}

export function MergeFileTable({ files, sourceClient, targetClient, connection }: MergeFileTableProps) {
  const rows = useMemo(() => files, [files])

  if (rows.length === 0) {
    return <div className="text-xs text-foreground-tertiary py-2">没有需要 merge 的文件</div>
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border-subtle">
      <table className="min-w-full text-[12px]" style={{ borderCollapse: 'collapse' }}>
        <colgroup>
          <col style={{ width: 140 }} />
          <col style={{ width: 72 }} />
          <col />
          <col />
          <col style={{ width: 140 }} />
          <col style={{ width: 72 }} />
        </colgroup>
        <thead className="bg-surface-header">
          <tr className="text-left text-foreground-secondary">
            <th className="px-2 py-1.5 font-medium">文件</th>
            <th className="px-2 py-1.5 font-medium">Action</th>
            <th className="px-2 py-1.5 font-medium">Source Depot Path</th>
            <th className="px-2 py-1.5 font-medium">Target Depot Path</th>
            <th className="px-2 py-1.5 font-medium">Merge Tool</th>
            <th className="px-2 py-1.5 font-medium">状态</th>
          </tr>
        </thead>
        <tbody className="bg-surface-1">
          {rows.map((f, i) => {
            const status = STATUS_LABEL[f.status]
            return (
              <tr key={i} className={`border-t border-border-subtle align-top ${i % 2 === 1 ? 'bg-surface-2' : ''}`}>
                <td className="px-2 py-1.5 text-foreground font-medium truncate max-w-40" title={f.sourcePath}>
                  {shortName(f.sourcePath)}
                </td>
                <td className="px-2 py-1.5 text-foreground-secondary font-mono whitespace-nowrap">{f.action}</td>
                <td className="px-2 py-1.5">
                  <PathCell
                    path={f.sourcePath}
                    revision={f.sourceRevision}
                    client={sourceClient}
                    connection={connection}
                    kind="source"
                  />
                </td>
                <td className="px-2 py-1.5">
                  <PathCell
                    path={f.targetPath}
                    client={targetClient}
                    connection={connection}
                    kind="target"
                  />
                </td>
                <td className="px-2 py-1.5 text-foreground-secondary whitespace-nowrap">
                  {f.mergeToolName ?? (f.mergeTool === null ? 'Manual' : '—')}
                </td>
                <td className={`px-2 py-1.5 font-medium ${status.cls} whitespace-nowrap`}>{status.text}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- 路径单元格：文本 + 复制 + 跳转 P4V ---------- */

function PathCell({
  path,
  revision,
  client,
  connection,
  kind,
}: {
  path: string
  revision?: number
  client?: string
  connection?: P4VConnection
  kind: 'source' | 'target'
}) {
  const full = revision ? `${path}#${revision}` : path

  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await navigator.clipboard.writeText(path)
      toast.success(`已复制${kind === 'source' ? '源' : '目标'}路径`)
    } catch {
      toast.error('复制失败')
    }
  }

  const openInP4V = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!client) {
      toast.warning('未选择 workspace，无法跳转 P4V')
      return
    }
    const res = await openMergeResultInP4V({
      client,
      port: connection?.port,
      user: connection?.user,
      charset: connection?.charset,
      target: path,
    })
    if (res.ok) toast.success(`已在 P4V 中定位 ${kind === 'source' ? '源' : '目标'}文件`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const copyBtn =
    'inline-flex items-center justify-center w-5 h-5 rounded text-foreground-tertiary hover:text-primary hover:bg-surface-hover transition-colors shrink-0'

  // P4V 按钮：Perforce 蓝色边框 + P4V 图标，与 ChangelistList 的 Change 号按钮风格一致
  const p4vBtn =
    'inline-flex items-center gap-0.5 px-1 h-5 rounded text-[10px] font-medium transition-colors hover:bg-surface-hover shrink-0'

  return (
    <div className="flex items-center gap-1 min-w-0">
      <span
        className="flex-1 min-w-0 text-foreground-secondary font-mono truncate"
        title={full}
      >
        {full}
      </span>
      <button type="button" className={copyBtn} onClick={copy} title="复制路径" aria-label="复制路径">
        <CopyIcon size={12} />
      </button>
      <button
        type="button"
        className={p4vBtn}
        style={{ color: PERFORCE_BLUE, border: `1px solid ${PERFORCE_BLUE}55` }}
        onClick={openInP4V}
        title={`在 P4V 中定位${kind === 'source' ? '源' : '目标'}文件`}
        aria-label={`在 P4V 中定位${kind === 'source' ? '源' : '目标'}文件`}
      >
        <P4VWindowIcon size={11} style={{ color: PERFORCE_BLUE }} />
        P4V
      </button>
    </div>
  )
}

export function MergePreviewSummary({ preview }: { preview: MergePreview }) {
  return (
    <div className="flex items-center gap-4 text-[12px] text-foreground-secondary flex-wrap">
      <span>
        文件 <span className="font-semibold text-foreground">{preview.files.length}</span>
      </span>
      <span className="text-success">
        自动 <span className="font-semibold">{preview.autoCount}</span>
      </span>
      <span className="text-warning">
        覆盖 <span className="font-semibold">{preview.overrideCount}</span>
      </span>
      <span className="text-foreground-tertiary">
        手动 <span className="font-semibold">{preview.manualCount}</span>
      </span>
      {preview.unsupportedCount > 0 && (
        <span className="text-error">
          不支持 <span className="font-semibold">{preview.unsupportedCount}</span>
        </span>
      )}
      {preview.warnings.length > 0 && (
        <span className="text-warning" title={preview.warnings.join('\n')}>
          ⚠ {preview.warnings.length} 条警告
        </span>
      )}
    </div>
  )
}
