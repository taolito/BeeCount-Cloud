import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  applyDocumentLocale,
  initialLocale,
  persistLocale,
  type Locale
} from './locale-script'

export type LocaleMessages = Record<string, string>
/** 语言包可以只带其中几门 —— 缺的那几门由 [LocaleProvider] 的 loadDictionaries 补齐。 */
export type LocaleDictionaries = Partial<Record<Locale, LocaleMessages>>
export type TranslateParams = Record<string, string | number>

type LocaleContextValue = {
  locale: Locale
  setLocale: (next: Locale) => void
  t: (key: string, params?: TranslateParams) => string
}

type LocaleProviderProps = PropsWithChildren<{
  dictionaries: LocaleDictionaries
  /**
   * 语言包按需加载。入口 chunk 只带首屏那一门语言,切语言时由这里补齐 ——
   * 返回值是要并进来的语言包集合(一门语言可能连带它的兜底语言)。
   * 解析为 undefined 表示没有更多可加载的,继续用已加载的词典兜底。
   */
  loadDictionaries?: (locale: Locale) => Promise<LocaleDictionaries | undefined>
}>

const LocaleContext = createContext<LocaleContextValue | null>(null)

const EMPTY_MESSAGES: LocaleMessages = {}

function applyTemplate(template: string, params?: TranslateParams): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (_match, token: string) => {
    const value = params[token]
    if (value === undefined || value === null) return ''
    return String(value)
  })
}

export function LocaleProvider({
  children,
  dictionaries,
  loadDictionaries
}: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(() => initialLocale())
  const [lazyDictionaries, setLazyDictionaries] = useState<Partial<LocaleDictionaries>>({})
  const loadingRef = useRef<Set<Locale>>(new Set())

  const allDictionaries = useMemo<Partial<LocaleDictionaries>>(
    () => ({ ...dictionaries, ...lazyDictionaries }),
    [dictionaries, lazyDictionaries]
  )

  const messages = useMemo<LocaleMessages>(() => {
    const dict = allDictionaries[locale]
    if (dict) return dict
    // 语言包还在路上(或这份语言压根没有):先用 en,再用任意一份已加载的,
    // 保证界面显示的是"另一种语言的文案"而不是一屏 `{key}`。
    return allDictionaries.en || Object.values(allDictionaries)[0] || EMPTY_MESSAGES
  }, [allDictionaries, locale])

  useEffect(() => {
    if (!loadDictionaries || allDictionaries[locale] || loadingRef.current.has(locale)) return
    loadingRef.current.add(locale)
    loadDictionaries(locale).then((loaded) => {
      loadingRef.current.delete(locale)
      if (!loaded) return
      setLazyDictionaries((prev) => ({ ...prev, ...loaded }))
    })
  }, [allDictionaries, loadDictionaries, locale])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    persistLocale(next)
    applyDocumentLocale(next)
  }, [])

  useEffect(() => {
    applyDocumentLocale(locale)
  }, [locale])

  const t = useCallback(
    (key: string, params?: TranslateParams) => {
      // en 仍是缺词条时的兜底源(繁体允许暂缺翻译就靠它),所以取合并后的那份。
      const fallback = allDictionaries.en || EMPTY_MESSAGES
      const template = messages[key] || fallback[key] || key
      return applyTemplate(template, params)
    },
    [allDictionaries, messages]
  )

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t
    }),
    [locale, setLocale, t]
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) {
    throw new Error('useLocale must be used within LocaleProvider')
  }
  return ctx
}

export function useT(): LocaleContextValue['t'] {
  return useLocale().t
}
