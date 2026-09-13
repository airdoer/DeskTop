import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import { EmptyState } from '@/components/layout/EmptyState'
import { Page, PageBody, PageHeader } from '@/components/layout/Page'
import { AppButton } from '@/components/ui/AppButton'
import { BrickIcon } from '@/components/ui/icons'
import {
  addHomeWidget,
  availableHomeWidgets,
  parseHomeLayout,
  removeHomeWidget,
  serializeHomeLayout,
} from '@/services/homeLayout'
import { moveItem } from '@/services/quickDirectories'
import { readHomeLayoutRaw, saveHomeLayoutRaw } from '@/services/uiPreferences'
import { AddWidgetMenu } from '@/features/home/AddWidgetMenu'
import { HomeWidgetFrame } from '@/features/home/HomeWidgetFrame'
import {
  DEFAULT_HOME_LAYOUT,
  HOME_WIDGET_IDS,
  findHomeWidget,
  type HomeWidget,
  type HomeWidgetId,
} from '@/features/home/homeWidgets'

/*
 * HomePage — 可拼装主页.
 *
 * 依据用户要求：主页由用户自行组合——添加 / 删除 / 拖动排序，布局持久化后下次打开自动恢复。
 * 可拼装的组件见 features/home/homeWidgets.tsx（= 除主页与设置外的全部功能页签）。
 *
 * 标题区：品牌语「随心拼接你的游戏工作平台」+ 积木图标走 PageHeader 的 titleAside，
 *   与标题同一行（不占第二行）；编辑态的操作说明才用 description 占第二行。
 *
 * 排布：单列纵排，每一项独占一行——即便窗口最大化也不并排，
 *   让每条信息保持完整宽度，便于阅读多列条目（P4 工作区路径、Redmine 表格等）。
 *
 * 编辑态（点「编辑布局」进入）：
 *   - 每个组件上方出现控制条（拖动把手 / 上移 / 下移 / 移除），外围虚线框标识槽位；
 *   - 拖动把手可跨组件排序，落点以 2px 主色横线提示；
 *   - ↑/↓ 按钮是拖放的键盘等价入口（无鼠标场景也能调序）。
 *
 * 布局持久化：只存一串组件 id（services/homeLayout.ts 解析，uiPreferences 落盘）。
 *   首帧用默认布局渲染，读回后纠正——与 Sidebar 折叠态同一取舍，避免首屏空白。
 */

export function HomePage() {
  const [ids, setIds] = useState<string[]>(DEFAULT_HOME_LAYOUT)
  const [editing, setEditing] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  /*
   * dragId 用 ref 同步持有：onDragStart 的 setState 是异步的，
   * 若在 onDragOver 里读 state，首次会读到 null 从而漏掉 preventDefault，
   * drop 事件就不会派发，排序静默失败（与 P4WorkspacesPanel 的排序同一个坑）。
   */
  const dragIdRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    void readHomeLayoutRaw().then((raw) => {
      if (!alive) return
      setIds(parseHomeLayout(raw, HOME_WIDGET_IDS, DEFAULT_HOME_LAYOUT))
    })
    return () => {
      alive = false
    }
  }, [])

  /**
   * 落盘新布局。写失败只影响下次启动能否恢复，本次会话内的改动照常生效
   * （uiPreferences 的既有契约：持久化失败不打断交互），故不额外提示。
   */
  const persist = useCallback(async (next: string[]) => {
    setIds(next)
    await saveHomeLayoutRaw(serializeHomeLayout(next))
  }, [])

  const clearDrag = useCallback(() => {
    dragIdRef.current = null
    setDragId(null)
    setDropIndex(null)
  }, [])

  /** 由落点（组件上/下半区）推导插入位置 */
  const insertIndexAt = (index: number, event: ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY > rect.top + rect.height / 2 ? index + 1 : index
  }

  const commitReorder = useCallback(
    (to: number) => {
      const id = dragIdRef.current
      if (!id) return
      const from = ids.findIndex((item) => item === id)
      clearDrag()
      if (from < 0) return
      const next = moveItem(ids, from, to)
      if (next.every((item, i) => item === ids[i])) return
      void persist(next)
    },
    [clearDrag, ids, persist],
  )

  const moveByKeyboard = useCallback(
    (id: string, delta: number) => {
      const from = ids.findIndex((item) => item === id)
      if (from < 0) return
      const to = delta > 0 ? from + delta + 1 : from + delta
      if (to < 0 || to > ids.length) return
      void persist(moveItem(ids, from, to))
    },
    [ids, persist],
  )

  const handleAdd = useCallback((id: HomeWidgetId) => void persist(addHomeWidget(ids, id)), [ids, persist])
  const handleRemove = useCallback((id: string) => void persist(removeHomeWidget(ids, id)), [ids, persist])

  const widgets: HomeWidget[] = ids.flatMap((id) => {
    const widget = findHomeWidget(id)
    return widget ? [widget] : []
  })
  const availableWidgets: HomeWidget[] = availableHomeWidgets(ids, HOME_WIDGET_IDS).flatMap((id) => {
    const widget = findHomeWidget(id)
    return widget ? [widget] : []
  })

  return (
    <Page>
      <PageHeader
        title="主页"
        /*
         * 标语走 titleAside（标题同一行右侧）而不是 description（第二行）：
         * 它是常驻的品牌语，不占操作说明的行；编辑态才用 description 显示操作提示。
         */
        titleAside={
          <span className="inline-flex items-center gap-1.5">
            <BrickIcon size={13} />
            随心拼接你的游戏工作平台
          </span>
        }
        description={
          editing ? '拖动把手调整顺序，或用 ↑/↓ 按钮移动；不需要的组件可直接移除' : undefined
        }
        actions={
          <>
            {editing && <AddWidgetMenu available={availableWidgets} onAdd={handleAdd} />}
            <AppButton
              size="sm"
              variant={editing ? 'primary' : 'default'}
              onClick={() => {
                clearDrag()
                setEditing((value) => !value)
              }}
            >
              {editing ? '完成' : '编辑布局'}
            </AppButton>
          </>
        }
      />

      <PageBody>
        {widgets.length === 0 ? (
          <EmptyState
            title="主页还没有组件"
            hint={
              editing
                ? '点击右上角「添加组件」，选择需要展示的模块。'
                : '点击「编辑布局」，再通过「添加组件」选择需要展示的模块。'
            }
            action={
              editing ? undefined : (
                <AppButton size="sm" onClick={() => setEditing(true)}>
                  编辑布局
                </AppButton>
              )
            }
          />
        ) : (
          <div className="flex flex-col gap-3">
            {widgets.map((widget, index) => (
              <Fragment key={widget.id}>
                {editing && dropIndex === index && <DropIndicator />}
                <HomeWidgetFrame
                  widget={widget}
                  index={index}
                  total={widgets.length}
                  editing={editing}
                  dragging={dragId === widget.id}
                  onDragStart={(id) => {
                    dragIdRef.current = id
                    setDragId(id)
                  }}
                  onDragEnd={clearDrag}
                  onDragOver={(targetIndex, event) => {
                    // 只响应「拖动组件控制条」发起的拖拽；面板内部的排序拖拽会冒泡到这里，需放行
                    if (!dragIdRef.current) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    setDropIndex(insertIndexAt(targetIndex, event))
                  }}
                  onDrop={(targetIndex, event) => {
                    if (!dragIdRef.current) return
                    event.preventDefault()
                    event.stopPropagation()
                    commitReorder(insertIndexAt(targetIndex, event))
                  }}
                  onMove={moveByKeyboard}
                  onRemove={handleRemove}
                >
                  {widget.render()}
                </HomeWidgetFrame>
              </Fragment>
            ))}
            {editing && dropIndex === widgets.length && <DropIndicator />}
          </div>
        )}
      </PageBody>
    </Page>
  )
}

/** 拖拽落点提示：2px 主色横线 */
function DropIndicator() {
  return <div className="h-0.5 rounded-full bg-primary" aria-hidden />
}
