import { Page, PageBody } from '@/components/layout/Page'
import { EmptyState } from '@/components/layout/EmptyState'
import { SystemInfoPanel } from '@/features/system-info/SystemInfoPanel'
import { QuickDirectoriesPanel } from '@/features/quick-directories/QuickDirectoriesPanel'
import { P4WorkspacesPanel } from '@/features/p4-workspaces/P4WorkspacesPanel'
import { RedmineIssuesPanel } from '@/features/redmine-issues/RedmineIssuesPanel'

/*
 * HomePage — 主页.
 * 内容：本机系统信息（主机名 / IPv4）+ 常用目录快速跳转 + 本机 P4 工作区 + Redmine 单子。
 * 依据 docs/UI_DESIGN_SYSTEM.md §8 Page Layout、§17 Panel（独立功能区域）。
 *
 * 布局：所有面板单列纵排，每一项独占一行——即便窗口最大化也不并排，
 * 让每条信息保持完整宽度，便于阅读多列条目（P4 工作区路径、Redmine 表格等）。
 */

export function HomePage() {
  return (
    <Page>
      {/* 主页不显示页面标题栏：左侧导航已标明当前位置，内容区直接铺开 */}
      <PageBody>
        <div className="flex flex-col gap-3">
          <SystemInfoPanel />
          <QuickDirectoriesPanel />
          <P4WorkspacesPanel />
          <RedmineIssuesPanel />
        </div>
      </PageBody>
    </Page>
  )
}
