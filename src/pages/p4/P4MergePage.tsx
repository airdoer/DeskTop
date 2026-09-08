import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { EmptyState } from '@/components/layout/EmptyState'

export function P4MergePage() {
  return (
    <Page>
      <PageHeader title="p4merge" description="Perforce 合并冲突解决工具" />
      <PageBody>
        <EmptyState
          title="p4merge 规划中"
          hint="后续在此集成 p4 merge 冲突解决与可视化 diff 流程。"
        />
      </PageBody>
    </Page>
  )
}
