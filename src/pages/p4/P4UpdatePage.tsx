import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { EmptyState } from '@/components/layout/EmptyState'

export function P4UpdatePage() {
  return (
    <Page>
      <PageHeader title="p4更新" description="Perforce 提交与更新工具" />
      <PageBody>
        <EmptyState
          title="p4更新 规划中"
          hint="后续在此集成 p4 submit / p4 update 等常用提交流程，支持模板与批量操作。"
        />
      </PageBody>
    </Page>
  )
}
