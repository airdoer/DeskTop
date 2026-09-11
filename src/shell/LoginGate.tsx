import { useCallback } from 'react'
import { AppButton } from '@/components/ui/AppButton'
import { UserIcon } from '@/components/ui/icons'
import { toast } from '@/components/feedback/Toast'
import { useSsoSession } from './ssoSessionContext'

/*
 * LoginGate — 未登录时的主内容区拦截.
 * 依据用户要求：未登录前禁止使用相关功能，故在未登录时主区不渲染任何业务页面，
 *   而是显示本组件：居中卡片 + 红色未登录标识 + 「登录」按钮。
 * 登录成功后 AppShell 会自动切换为正常页面内容（session 变化触发重渲染）。
 *
 * Toast 反馈：登录成功提示通用文案，用户名由标题栏 UserMenu 同步显示；
 *   失败给通用提示，具体错误原因由 UserMenu 的登录入口展示。
 */

export function LoginGate() {
  const { login, loggingIn } = useSsoSession()

  const handleLogin = useCallback(async () => {
    if (loggingIn) return
    const ok = await login()
    if (ok) {
      toast.success('登录成功')
    } else {
      // 用户主动取消不报错；此处对失败给通用提示，UserMenu 登录入口会展示更具体原因
      toast.error('登录失败，请重试')
    }
  }, [login, loggingIn])

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-6 overflow-auto">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        {/* 未登录红色标识 */}
        <div
          className="flex items-center justify-center w-14 h-14 rounded-full bg-error/10 text-error"
          aria-hidden
        >
          <UserIcon size={28} />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-foreground">请先登录</h2>
          <p className="text-sm text-foreground-secondary leading-6">
            登录快手 SSO 后即可使用 C7 DeskTop 的全部功能，
            <br />
            包括 Redmine 单子、P4 工作区、常用目录等。
          </p>
        </div>
        <AppButton variant="primary" size="md" loading={loggingIn} onClick={() => void handleLogin()}>
          <UserIcon size={14} />
          {loggingIn ? '登录中…' : '登录'}
        </AppButton>
      </div>
    </div>
  )
}
