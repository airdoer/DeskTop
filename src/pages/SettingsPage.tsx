import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { EmptyState } from '@/components/layout/EmptyState'

export function SettingsPage() {
  return (
    <Page>
      <PageHeader title="设置" description="应用偏好与配置" />
      <PageBody>
        <EmptyState
          title="设置页规划中"
          hint="后续在此提供应用偏好、主题、快捷键、通知等配置。"
        />
      </PageBody>
    </Page>
  )
}
