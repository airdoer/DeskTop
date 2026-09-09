/// <reference types="vite/client" />

interface Window {
  // expose in the `electron/preload/index.ts`
  ipcRenderer: import('electron').IpcRenderer & {
    /** preload 暴露：File → 磁盘绝对路径（webUtils.getPathForFile） */
    getPathForFile(file: File): string
  }
}
