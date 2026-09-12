import { Page, PageBody } from '@/components/layout/Page'
import { P4WorkspacesPanel } from '@/features/p4-workspaces/P4WorkspacesPanel'

/*
 * P4WorkspacesPage — P4 工作区（独立页签）.
 * 原为主页面板之一，现提升为平级页签（导航见 src/shell/navigation.ts）。
 *
 * 不加 PageHeader：面板自带标题、说明气泡与筛选/视图切换操作，再套一层页面标题会重复。
 */

export function P4WorkspacesPage() {
  return (
    <Page>
      <PageBody>
        <P4WorkspacesPanel />
      </PageBody>
    </Page>
  )
}
