import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { P4MergePanel } from '@/features/p4-merge/P4MergePanel'

export function P4MergePage() {
  return (
    <Page>
      <PageHeader
        title="p4merge"
        description="跨分支 Perforce Merge：Source Changelist → Target Workspace（不自动 Submit）"
      />
      <PageBody>
        <P4MergePanel />
      </PageBody>
    </Page>
  )
}
