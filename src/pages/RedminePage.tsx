import { Page, PageBody } from '@/components/layout/Page'
import { RedmineIssuesPanel } from '@/features/redmine-issues/RedmineIssuesPanel'

/*
 * RedminePage — Redmine 单子（独立页签）.
 * 原为主页面板之一，现提升为平级页签（导航见 src/shell/navigation.ts）。
 *
 * 不加 PageHeader：面板自带标题、说明气泡与筛选/刷新操作，再套一层页面标题会重复。
 */

export function RedminePage() {
  return (
    <Page>
      <PageBody>
        <RedmineIssuesPanel />
      </PageBody>
    </Page>
  )
}
