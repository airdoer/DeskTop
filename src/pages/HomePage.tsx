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
 * 布局：系统信息与常用目录并排；P4 工作区与 Redmine 单子各独占一整行——
 * 其条目含多列信息，宽屏下横向空间更能容纳信息。
 */

export function HomePage() {
  return (
    <Page>
      {/* 主页不显示页面标题栏：左侧导航已标明当前位置，内容区直接铺开 */}
      <PageBody>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          <SystemInfoPanel />
          <QuickDirectoriesPanel />
          <div className="xl:col-span-2">
            <P4WorkspacesPanel />
          </div>
          <div className="xl:col-span-2">
            <RedmineIssuesPanel />
          </div>
        </div>
      </PageBody>
    </Page>
  )
}
