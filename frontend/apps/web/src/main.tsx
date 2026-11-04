import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  LocaleProvider,
  PrimaryColorProvider,
  ThemeProvider,
  ToastProvider,
  applyDocumentLocale,
  applyPrimaryColor,
  applyTheme,
  initialLocale,
  initialPrimaryColor,
  initialThemeMode,
  type LocaleDictionaries
} from '@beecount/ui'

import { App } from './App'
import { APP_BASE, appUrl } from '@beecount/api-client'
import { WebConfigProvider } from './context/WebConfigContext'
import { baseDictionaries, loadDictionaries } from './i18n'
import { setupInstallPrompt } from './lib/pwa-install'
import { setupLaunchQueue } from './lib/pwa-launch'
import { setupServiceWorkerUpdates } from './lib/pwa-sw-update'
import './styles.css'

const bootLocale = initialLocale()

applyTheme(initialThemeMode())
applyDocumentLocale(bootLocale)
// 启动时立刻 apply primary color，避免 React hydration 前首屏闪烁默认金色。
applyPrimaryColor(initialPrimaryColor())

// File Handler:订阅 launchQueue,接住「双击 .csv 用蜜蜂记账打开」的文件
setupLaunchQueue()

// PWA install prompt:接住 beforeinstallprompt,延后到 engagement 达标再弹
setupInstallPrompt()

// 注册 PWA service worker：生产 + dev 都注册，dev 下 sw 只管静态资源不影响
// HMR（/api 被跳过）。原生 fetch API 里 MIME 不对 iOS 会拒绝，所以指定 scope。
// 注册成功后挂上 update lifecycle —— 检测到 waiting SW 时通过自定义事件
// 通知 React 层,弹「新版本可用」 banner（详见 pwa-sw-update.ts）。
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(appUrl('sw.js'), { scope: APP_BASE })
      .then((registration) => {
        setupServiceWorkerUpdates(registration)
      })
      .catch((err) => {
        // 不影响主流程，只在 dev 控制台留个记录。
        // eslint-disable-next-line no-console
        console.warn('[pwa] sw register failed', err)
      })
  })
}

function renderApp(dictionaries: LocaleDictionaries) {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LocaleProvider dictionaries={dictionaries} loadDictionaries={loadDictionaries}>
        <ThemeProvider>
          <PrimaryColorProvider>
            <ToastProvider>
              <WebConfigProvider>
                <App />
              </WebConfigProvider>
            </ToastProvider>
          </PrimaryColorProvider>
        </ThemeProvider>
      </LocaleProvider>
    </React.StrictMode>
  )
}

// zh-CN 语言包静态打进入口,直接渲染;en / zh-TW 先取回自己的语言包再挂首帧,
// 免得这两类用户先看到一屏简体中文再整体换语言。
loadDictionaries(bootLocale).then((extra) => {
  renderApp(extra ? { ...baseDictionaries, ...extra } : baseDictionaries)
})
