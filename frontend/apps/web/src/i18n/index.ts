import type { Locale, LocaleDictionaries } from '@beecount/ui'

import zhCN from './zh-CN'

/**
 * 三份语言包共 ~280 kB,全塞进入口 chunk 会直接压首屏(入口是渲染阻塞的)。
 * 主用户群是 zh-CN,所以只有它静态留在入口,en / zh-TW 各自落到自己的 lazy chunk:
 * 首帧由 [main.tsx] 取当前语言,运行期切换语言由 LocaleProvider 补取。
 */
export const baseDictionaries: LocaleDictionaries = {
  'zh-CN': zhCN
}

const lazyLoaders: Partial<Record<Locale, () => Promise<LocaleDictionaries>>> = {
  en: () => import('./en').then((m) => ({ en: m.default })),
  // 繁体按维护偏好允许暂缺翻译,t() 要靠 en 兜底,所以两份一起取。
  'zh-TW': () =>
    Promise.all([import('./zh-TW'), import('./en')]).then(([tw, en]) => ({
      'zh-TW': tw.default,
      en: en.default
    }))
}

/** 返回该语言所需的额外词条包;入口已带的语言返回 undefined。 */
export function loadDictionaries(locale: Locale): Promise<LocaleDictionaries | undefined> {
  const loader = lazyLoaders[locale]
  return loader ? loader() : Promise.resolve(undefined)
}
