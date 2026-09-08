import { Page, PageBody, PageHeader } from '@/components/layout/Page'
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
      <PageHeader title="主页" description="本机信息与常用目录" />
      <PageBody>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
          <SystemInfoPanel />
          <QuickDirectoriesPanel />
        </div>
      </PageBody>
    </Page>
  )
}
