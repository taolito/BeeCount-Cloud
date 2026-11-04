import type { FC } from 'react'

import * as CountryFlags from 'country-flag-icons/react/3x2'

export type FlagComponent = FC<{ className?: string; title?: string }>
export type FlagMap = Record<string, FlagComponent | undefined>

/** 全量国旗 SVG 组件表（country code → 组件），只在按需加载的 lazy chunk 里。 */
export const flagMap: FlagMap = CountryFlags as unknown as FlagMap
