import { describe, expect, it } from 'vitest'

import type {
  WorkspaceAccount,
  WorkspaceAnalyticsCategoryRank,
  WorkspaceAnalyticsSummary
} from '@beecount/api-client'

import { homeModuleData } from './homeModules'

const summary = (patch: Partial<WorkspaceAnalyticsSummary> = {}): WorkspaceAnalyticsSummary => ({
  transaction_count: 0,
  income_total: 0,
  expense_total: 0,
  balance: 0,
  ...patch
})

const rank = (total: number): WorkspaceAnalyticsCategoryRank => ({
  category_name: '餐饮',
  total,
  tx_count: 1
})

const account = (patch: Partial<WorkspaceAccount> = {}): WorkspaceAccount =>
  ({
    id: 'a1',
    name: '招行储蓄卡',
    account_type: 'bank_card',
    balance: 100,
    initial_balance: 0,
    tx_count: 1,
    ...patch
  }) as WorkspaceAccount

describe('homeModuleData 空数据判定', () => {
  it('月度双环按全期收支总额判定，与选中月份无关', () => {
    expect(homeModuleData.monthExpenseDonut(summary({ expense_total: 1 }))).toBe(true)
    expect(homeModuleData.monthExpenseDonut(summary({ expense_total: 0 }))).toBe(false)
    expect(homeModuleData.monthIncomeDonut(null)).toBe(false)
    expect(homeModuleData.monthIncomeDonut(summary({ income_total: 0.5 }))).toBe(true)
  })

  it('热力 / 走势只要有非零收入或支出即算有数据', () => {
    const series = [{ bucket: '2026-11', income: 0, expense: 120, balance: -120 }]
    expect(homeModuleData.yearHeatmap(series)).toBe(true)
    expect(homeModuleData.trendBars([])).toBe(false)
    expect(homeModuleData.trendBars(null)).toBe(false)
    expect(
      homeModuleData.yearHeatmap([{ bucket: '2026-11', income: 0, expense: 0, balance: 0 }])
    ).toBe(false)
  })

  it('分类排行 total 全 0 视为无数据', () => {
    expect(homeModuleData.topExpenseCategory([rank(0), rank(0)])).toBe(false)
    expect(homeModuleData.topIncomeCategory([rank(0), rank(3)])).toBe(true)
    expect(homeModuleData.topExpenseCategory(undefined)).toBe(false)
  })

  it('资产构成只看正余额资产账户，负债与透支账户不算', () => {
    expect(homeModuleData.assetComposition([account({ account_type: 'credit_card' })])).toBe(false)
    expect(homeModuleData.assetComposition([account({ balance: 0 })])).toBe(false)
    expect(homeModuleData.assetComposition([account({ balance: -50 })])).toBe(false)
    expect(homeModuleData.assetComposition([account({ balance: 12 })])).toBe(true)
  })

  it('Top 标签 / 账户按笔数判定，账户排除估值类', () => {
    expect(homeModuleData.topTags([{ tx_count: 0 }, { tx_count: 2 }])).toBe(true)
    expect(homeModuleData.topTags([{ tx_count: 0 }])).toBe(false)
    // 房产只有估值、不参与日常记账，即使 tx_count 有值也不算「活跃账户」
    expect(
      homeModuleData.topAccounts([account({ account_type: 'real_estate', tx_count: 4 })])
    ).toBe(false)
    expect(homeModuleData.topAccounts([account({ tx_count: 0 })])).toBe(false)
    expect(homeModuleData.topAccounts([account({ tx_count: 1 })])).toBe(true)
  })
})
