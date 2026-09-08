import { Page, PageBody } from '@/components/layout/Page'
import { EmptyState } from '@/components/layout/EmptyState'
import { SystemInfoPanel } from '@/features/system-info/SystemInfoPanel'
import { QuickDirectoriesPanel } from '@/features/quick-directories/QuickDirectoriesPanel'

/*
 * HomePage — 主页.
 * 内容：本机系统信息（主机名 / IPv4）+ 常用目录快速跳转。
 * 依据 docs/UI_DESIGN_SYSTEM.md §8 Page Layout、§17 Panel（独立功能区域）。
 */

export function HomePage() {
  return (
    <Page>
      {/* 主页不显示页面标题栏：左侧导航已标明当前位置，内容区直接铺开 */}
      <PageBody>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          <SystemInfoPanel />
          <QuickDirectoriesPanel />
        </div>
      </PageBody>
    </Page>
  )
}
