import { Page, PageBody } from '@/components/layout/Page'
import { SystemInfoPanel } from '@/features/system-info/SystemInfoPanel'

/*
 * SystemInfoPage — 系统信息（独立页签）.
 * 原为主页面板之一，现提升为平级页签（导航见 src/shell/navigation.ts）。
 *
 * 不加 PageHeader：面板自带标题、说明气泡与刷新操作，再套一层页面标题会重复。
 */

export function SystemInfoPage() {
  return (
    <Page>
      <PageBody>
        <SystemInfoPanel />
      </PageBody>
    </Page>
  )
}
