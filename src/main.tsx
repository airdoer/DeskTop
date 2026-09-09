import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

postMessage({ payload: 'removeLoading' }, '*')

/*
 * 拖拽兜底：Chromium 默认会把拖入窗口的文件当作导航目标（跳转到 file://），
 * 会直接把应用页面顶掉。业务区域（常用目录面板）自行处理 drop，
 * 这里仅阻止未处理区域的默认导航行为。
 */
window.addEventListener('dragover', (event) => {
  event.preventDefault()
})
window.addEventListener('drop', (event) => {
  event.preventDefault()
})
