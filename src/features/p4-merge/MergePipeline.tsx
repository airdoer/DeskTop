import { useEffect, useState } from 'react'
import { AppButton } from '@/components/ui/AppButton'
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CloseIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  P4VWindowIcon,
  RefreshIcon,
} from '@/components/ui/icons'
import { PERFORCE_BLUE } from '@/components/ui/brandColors'
import { toast } from '@/components/feedback/Toast'
import {
  openMergeResultInP4V,
  type PipelineStepId,
  type PipelineStepState,
  type PipelineStepStatus,
} from '@/services/p4Merge'
import { openPath } from '@/services/paths'
import type { P4VConnection } from '@/services/p4Workspaces'

/*
 * MergePipeline — 从左到右的 Merge 流程管线可视化.
 * 依据 docs/CROSS_BRANCH_MERGE_TOOL_SPEC.md §16（Merge 两阶段）+ §71（最终业务模型）：
 *   Preflight → Minimal Sync → Pending CL → P4 Integrate → P4 Resolve → Result
 *
 * 每步状态：idle / running / success / failed / skipped.
 *   - running 用旋转 Refresh 图标
 *   - success 用 Check 图标 + 绿色
 *   - failed 用 Close 图标 + 红色
 *   - skipped 用横线 + 灰色
 *   - idle 用数字编号 + 灰色
 *
 * 点击任意步骤节点弹出 Modal 显示完整执行详情（日志、耗时、错误、备份目录按钮），
 *   避免日志过多时需要手动展开+横向拖动.
 *
 * Result 步骤成功后，右侧渲染 P4V 跳转快捷操作（spec §57/§58：辅助能力，非核心依赖）：
 *   - 打开源 Workspace
 *   - 打开目标 Workspace
 *   - 打开目标 Pending Changelist
 *
 * Resolve 步骤含 xlsx 文件时，step.backupDir 填充，节点内显示「📁 备份」按钮一键打开.
 */

const STATUS_STYLES: Record<PipelineStepStatus, { dot: string; ring: string; text: string; label: string; bg: string }> = {
  idle: {
    dot: 'bg-foreground-secondary',
    ring: 'border-border',
    text: 'text-foreground-secondary',
    label: '待执行',
    bg: 'bg-surface-1',
  },
  running: {
    dot: 'bg-primary',
    ring: 'border-primary',
    text: 'text-primary',
    label: '执行中',
    bg: 'bg-surface-1',
  },
  success: {
    dot: 'bg-success',
    ring: 'border-success',
    text: 'text-success',
    label: '已完成',
    bg: 'bg-surface-1',
  },
  failed: {
    dot: 'bg-error',
    ring: 'border-error',
    text: 'text-error',
    label: '失败',
    bg: 'bg-surface-1',
  },
  skipped: {
    dot: 'bg-foreground-quaternary',
    ring: 'border-border',
    text: 'text-foreground-tertiary',
    label: '跳过',
    bg: 'bg-surface-2',
  },
}

function StepIcon({ status, index }: { status: PipelineStepStatus; index: number }) {
  if (status === 'running') {
    return <RefreshIcon size={13} className="animate-spin" />
  }
  if (status === 'success') {
    return <CheckIcon size={13} />
  }
  if (status === 'failed') {
    return <CloseIcon size={13} />
  }
  if (status === 'skipped') {
    return <span className="text-[12px] font-semibold leading-none">—</span>
  }
  return <span className="text-[12px] font-semibold leading-none">{index + 1}</span>
}

function formatDuration(startedAt?: number, endedAt?: number): string {
  if (!startedAt) return ''
  const end = endedAt ?? Date.now()
  const ms = Math.max(0, end - startedAt)
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

interface MergePipelineProps {
  steps: PipelineStepState[]
  /** Result 步骤成功后展示 P4V 跳转所需信息 */
  p4vActions?: {
    sourceClient: string
    targetClient: string
    targetChange?: number
    connection: P4VConnection
  }
  /** 是否正在执行（用于禁用 P4V 按钮避免执行中跳转） */
  running: boolean
}

export function MergePipeline({ steps, p4vActions, running }: MergePipelineProps) {
  // 当前展开详情的步骤（null = 关闭）。点击步骤节点打开 Modal 显示完整日志.
  const [activeStep, setActiveStep] = useState<PipelineStepState | null>(null)

  // 当 activeStep 对应的 steps 数组项更新时（进度事件推送），同步刷新 modal 内容.
  // 用 id 匹配避免对象引用变化导致 modal 闪烁关闭.
  const [activeStepId, setActiveStepId] = useState<PipelineStepId | null>(null)
  const syncedActive = activeStepId ? steps.find((s) => s.id === activeStepId) ?? null : null

  const openStepDetail = (step: PipelineStepState) => {
    setActiveStepId(step.id)
    setActiveStep(step)
  }
  const closeStepDetail = () => {
    setActiveStepId(null)
    setActiveStep(null)
  }

  // Esc 关闭 modal
  useEffect(() => {
    if (!activeStepId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeStepDetail()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeStepId])

  const resultStep = steps.find((s) => s.id === 'result')
  const showP4VActions =
    !!p4vActions && resultStep?.status === 'success'

  const openSource = async () => {
    if (!p4vActions) return
    const res = await openMergeResultInP4V({
      client: p4vActions.sourceClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
    })
    if (res.ok) toast.success(`已在 P4V 中打开源 Workspace`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const openTarget = async () => {
    if (!p4vActions) return
    const res = await openMergeResultInP4V({
      client: p4vActions.targetClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
    })
    if (res.ok) toast.success(`已在 P4V 中打开目标 Workspace`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const openPendingCL = async () => {
    if (!p4vActions || !p4vActions.targetChange) return
    const res = await openMergeResultInP4V({
      client: p4vActions.targetClient,
      port: p4vActions.connection.port,
      user: p4vActions.connection.user,
      charset: p4vActions.connection.charset,
      pendingChange: p4vActions.targetChange,
    })
    if (res.ok) toast.success(`已在 P4V 中打开 Pending CL #${p4vActions.targetChange}`)
    else toast.error(`P4V 打开失败：${res.error ?? '未知错误'}`)
  }

  const openBackupDir = async (dir: string) => {
    const r = await openPath(dir)
    if (!r.ok) toast.error(`打开备份目录失败：${r.error ?? '未知错误'}`)
  }

  // modal 展示的步骤（优先用实时同步的，回退到点击时的快照）
  const modalStep = syncedActive ?? activeStep

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {steps.map((step, idx) => {
          const style = STATUS_STYLES[step.status]
          const hasLogs = step.logs.length > 0 || !!step.error
          const lastLog = step.logs.length > 0 ? step.logs[step.logs.length - 1] : step.error ?? ''
          const hasBackup = !!step.backupDir
          // 可点击：有日志或有备份目录或执行中（可查看实时日志）
          const clickable = hasLogs || hasBackup || step.status === 'running'
          return (
            <div key={step.id} className="flex items-stretch gap-1 shrink-0">
              <div
                className={`flex flex-col w-36 rounded-md border ${style.ring} ${style.bg} overflow-hidden`}
              >
                <button
                  type="button"
                  onClick={() => clickable && openStepDetail(step)}
                  className={`flex items-center gap-1.5 px-2 h-14 text-left ${clickable ? 'cursor-pointer hover:bg-surface-hover' : 'cursor-default'} transition-colors`}
                  aria-label={`${step.label} 详情`}
                >
                  <span
                    className={`shrink-0 flex items-center justify-center w-5 h-5 rounded-full text-white ${style.dot}`}
                    aria-hidden
                  >
                    <StepIcon status={step.status} index={idx} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-foreground leading-4 truncate">
                      {step.label}
                    </div>
                    <div className={`text-[10px] leading-3 truncate ${style.text}`}>
                      {style.label}
                      {step.startedAt && (
                        <span className="text-foreground-quaternary ml-1" title="耗时">
                          {formatDuration(step.startedAt, step.endedAt)}
                        </span>
                      )}
                    </div>
                  </div>
                  {hasBackup && (
                    <span
                      role="button"
                      tabIndex={0}
                      className="shrink-0 text-primary hover:text-primary-strong"
                      aria-label="打开 Excel 备份目录"
                      title="打开 Excel 备份目录"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (step.backupDir) void openBackupDir(step.backupDir)
                      }}
                      onKeyDown={(e) => {
                        if ((e.key === 'Enter' || e.key === ' ') && step.backupDir) {
                          e.stopPropagation()
                          void openBackupDir(step.backupDir)
                        }
                      }}
                    >
                      <FolderOpenIcon size={13} />
                    </span>
                  )}
                </button>
                {!hasBackup && lastLog && (
                  <div className="px-2 pb-1.5 text-[10px] text-foreground-tertiary leading-3 truncate" title={lastLog}>
                    {lastLog}
                  </div>
                )}
                {hasBackup && step.backupDir && (
                  <button
                    type="button"
                    onClick={() => void openBackupDir(step.backupDir!)}
                    className="px-2 pb-1.5 pt-0.5 text-left text-[10px] text-primary hover:underline truncate"
                    title={step.backupDir}
                  >
                    📁 打开备份目录
                  </button>
                )}
              </div>
              {idx < steps.length - 1 && (
                <div className="flex items-center text-foreground-quaternary shrink-0" aria-hidden>
                  <ChevronRightIcon size={12} />
                </div>
              )}
            </div>
          )
        })}

        {/* Result 成功后：P4V 跳转快捷操作区（spec §57/§58） */}
        {showP4VActions && (
          <>
            <div className="flex items-center text-foreground-quaternary shrink-0" aria-hidden>
              <ChevronRightIcon size={12} />
            </div>
            <div className="flex flex-col justify-center gap-1.5 shrink-0 rounded-md border border-primary/40 bg-primary-bg px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-[12px] font-semibold text-primary leading-4">
                <P4VWindowIcon size={14} style={{ color: PERFORCE_BLUE }} />
                P4V 跳转
              </div>
              <div className="flex items-center gap-1">
                <AppButton size="sm" variant="default" onClick={openSource} disabled={running}>
                  <ExternalLinkIcon size={12} />
                  源 WS
                </AppButton>
                <AppButton size="sm" variant="default" onClick={openTarget} disabled={running}>
                  <ExternalLinkIcon size={12} />
                  目标 WS
                </AppButton>
                <AppButton
                  size="sm"
                  variant="primary"
                  onClick={openPendingCL}
                  disabled={running || !p4vActions.targetChange}
                  title={p4vActions.targetChange ? `打开 Pending CL #${p4vActions.targetChange}` : '未创建 Pending CL'}
                >
                  <ExternalLinkIcon size={12} />
                  Pending CL
                </AppButton>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 步骤详情 Modal：点击步骤节点弹出，显示完整日志（避免横向拖动 + 手动展开） */}
      {modalStep && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          onClick={closeStepDetail}
        >
          <div
            className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-border bg-surface-1 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border-subtle">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`shrink-0 flex items-center justify-center w-6 h-6 rounded-full text-white ${STATUS_STYLES[modalStep.status].dot}`}
                  aria-hidden
                >
                  <StepIcon status={modalStep.status} index={0} />
                </span>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-foreground truncate">
                    {modalStep.label}
                  </div>
                  <div className={`text-[11px] ${STATUS_STYLES[modalStep.status].text}`}>
                    {STATUS_STYLES[modalStep.status].label}
                    {modalStep.startedAt && (
                      <span className="text-foreground-quaternary ml-1">
                        耗时 {formatDuration(modalStep.startedAt, modalStep.endedAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={closeStepDetail}
                className="shrink-0 p-1 rounded text-foreground-tertiary hover:bg-surface-hover hover:text-foreground"
                aria-label="关闭"
              >
                <CloseIcon size={16} />
              </button>
            </div>

            {/* Modal Body：日志区（可滚动） */}
            <div className="flex-1 overflow-auto px-4 py-3 bg-surface-2">
              {modalStep.error && (
                <div className="text-[12px] text-error font-mono leading-5 mb-2 whitespace-pre-wrap break-all">
                  {modalStep.error}
                </div>
              )}
              {modalStep.logs.length === 0 && !modalStep.error ? (
                <div className="text-[12px] text-foreground-tertiary">暂无执行日志</div>
              ) : (
                modalStep.logs.map((line, i) => (
                  <div
                    key={i}
                    className="text-[11.5px] text-foreground-secondary font-mono leading-5 whitespace-pre-wrap break-all"
                  >
                    {line}
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer：备份目录一键打开 */}
            {modalStep.backupDir && (
              <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-border-subtle bg-surface-1">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] text-foreground-tertiary mb-0.5">Excel 三路合并备份目录</div>
                  <div className="text-[11.5px] text-foreground-secondary font-mono truncate" title={modalStep.backupDir}>
                    {modalStep.backupDir}
                  </div>
                </div>
                <AppButton
                  size="sm"
                  variant="primary"
                  onClick={() => void openBackupDir(modalStep.backupDir!)}
                >
                  <FolderOpenIcon size={13} />
                  在资源管理器打开
                </AppButton>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
