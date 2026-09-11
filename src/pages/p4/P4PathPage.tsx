import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { PathConvertPanel } from '@/features/p4-paths/PathConvertPanel'

/*
 * P4PathPage — p4工具 / 路径转换.
 * 输入任意一个路径，输出 Mainline / Preonline / Online 三条分支的 P4 路径与本地路径。
 * 换算逻辑在 src/services/p4Paths.ts（纯函数），UI 在 features/p4-paths/PathConvertPanel.tsx。
 */

export function P4PathPage() {
  return (
    <Page>
      <PageHeader
        title="路径转换"
        description="本地路径 ↔ P4 路径，在 Mainline / Preonline / Online 之间换算"
      />
      <PageBody>
        <div className="flex flex-col gap-3">
          <PathConvertPanel />
        </div>
      </PageBody>
    </Page>
  )
}
