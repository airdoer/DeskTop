import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { AppConfigPanel } from '@/features/app-config/AppConfigPanel'
import { AppUpdatePanel } from '@/features/app-update/AppUpdatePanel'

/*
 * SettingsPage — 设置（入口固定在侧边栏底部，不属于 NAV_ITEMS）.
 * 保留 PageHeader：设置页是面板汇总页，后续继续追加偏好类面板，
 *   与只承载单个面板的功能页（如 QuickDirsPage 不加 PageHeader）不同。
 *
 * 面板顺序：本地配置（本机数据）在前，软件更新（对外版本）在后。
 */
export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="设置" description="应用偏好与配置" />
      <PageBody>
        <div className="flex flex-col gap-3">
          <AppConfigPanel />
          <AppUpdatePanel />
        </div>
      </PageBody>
    </Page>
  )
}
