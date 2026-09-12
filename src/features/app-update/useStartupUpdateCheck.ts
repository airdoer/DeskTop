import { useEffect } from 'react'
import { toast } from '@/components/feedback/Toast'
import { checkAppUpdate, getAppInfo, onUpdateAvailability } from '@/services/appUpdate'

/*
 * useStartupUpdateCheck — 启动后静默检查一次更新，发现新版本用 Toast 告知用户.
 *
 * 为什么放 Shell 层而不是设置页：用户不一定会主动进设置页，
 *   需求是「能感知到最新版本」，所以检查必须与页面无关地发生。
 *
 * 时序要点：必须先订阅 onUpdateAvailability 再触发 checkAppUpdate()，
 *   否则本次检查结果会早于订阅到达而丢失（见 services/appUpdate.ts 的说明）。
 *
 * 延迟 5s 触发：让启动期的同步 IPC（SSO、系统信息、网卡预热）先跑完，
 *   避免与首屏渲染抢主进程，也让用户先看到界面再看到更新提示。
 */

const STARTUP_CHECK_DELAY_MS = 5000

export function useStartupUpdateCheck(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return

    const off = onUpdateAvailability((payload) => {
      if (payload.update && payload.newVersion) {
        toast.info(`发现新版本 v${payload.newVersion}，可在「设置 → 软件更新」中安装`, 6000)
      }
    })

    const timer = window.setTimeout(() => {
      void getAppInfo().then((info) => {
        // 开发态没有 resources/app-update.yml，检查必然失败，直接跳过
        if (!info.packaged) return
        void checkAppUpdate()
      })
    }, STARTUP_CHECK_DELAY_MS)

    return () => {
      off()
      window.clearTimeout(timer)
    }
  }, [enabled])
}
