import type { LocaleDictionaries } from '@beecount/ui'

import en from './en'
import zhCN from './zh-CN'
import zhTW from './zh-TW'

/**
 * 三份语言包的全量合集 —— 只给测试和词条一致性校验用。
 * 运行期走 [./index.ts] 的按需加载,别把它 import 回入口。
 */
export const dictionaries = {
  en,
  'zh-CN': zhCN,
  'zh-TW': zhTW
} satisfies LocaleDictionaries

export type TranslationKey = keyof typeof en
