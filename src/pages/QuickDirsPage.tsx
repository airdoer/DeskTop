import { Page, PageBody } from '@/components/layout/Page'
import { QuickDirectoriesPanel } from '@/features/quick-directories/QuickDirectoriesPanel'

/*
 * QuickDirsPage — 常用目录（独立页签）.
 * 原为主页面板之一，现提升为平级页签（导航见 src/shell/navigation.ts）。
 *
 * 不加 PageHeader：面板自带标题、说明气泡与新增/视图切换操作，再套一层页面标题会重复。
 */

export function QuickDirsPage() {
  return (
    <Page>
      <PageBody>
        <QuickDirectoriesPanel />
      </PageBody>
    </Page>
  )
}
