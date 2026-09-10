import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { WebsitesPanel } from '@/features/websites/WebsitesPanel'

/*
 * WebsitesPage — 常用网站.
 * 与主页的区别：主页是「本机资源」概览（系统信息 / 常用目录 / P4 工作区 / Redmine），
 * 本页只承载站点入口，因此独立成页，避免主页面板越堆越长。
 */

export function WebsitesPage() {
  return (
    <Page>
      <PageHeader
        title="常用网站"
        description="内置站点 + 自定义站点，点击在系统默认浏览器中打开"
      />
      <PageBody>
        <WebsitesPanel />
      </PageBody>
    </Page>
  )
}
