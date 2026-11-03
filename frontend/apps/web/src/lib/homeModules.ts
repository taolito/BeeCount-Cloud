import type {
  WorkspaceAccount,
  WorkspaceAnalyticsCategoryRank,
  WorkspaceAnalyticsSeriesItem,
  WorkspaceAnalyticsSummary
} from '@beecount/api-client'

/**
 * 首页「扩展分析」各模块的有数据判定。
 *
 * 口径统一在这里，OverviewSection 只负责按结果排版：模块没有数据就不该占一张
 * 空卡片（原来每张空卡 128~192px 高，新用户首屏整屏是「暂无数据」）。
 *
 * 判定用的是「这个模块在这个账本里有没有东西可画」，而不是「当前视图刚好为 0」：
 * 例如月度分类环看的是全期收支总额，账本一旦有过支出，选到空闲月份仍然保留卡片
 * （连同月份步进器）显示空态 —— 否则月份一翻错，控件跟着卡片一起消失，翻不回来了。
 */

/** 与 HomeTopAccounts 一致：估值类账户不参与「活跃账户」排行。 */
const VALUATION_ACCOUNT_TYPES = new Set([
  'real_estate',
  'vehicle',
  'investment',
  'insurance',
  'social_fund',
  'loan'
])

/** 与 AssetCompositionDonut 的 TYPE_META.group 一致：负债不进资产扇区。 */
const LIABILITY_ACCOUNT_TYPES = new Set(['credit_card', 'loan'])

const hasAmount = (ranks: WorkspaceAnalyticsCategoryRank[]) =>
  ranks.some((r) => (r.total ?? 0) > 0)

const hasFlow = (series: WorkspaceAnalyticsSeriesItem[] | null | undefined) =>
  (series || []).some((s) => (s.income ?? 0) > 0 || (s.expense ?? 0) > 0)

export const homeModuleData = {
  /** 月度支出分类环：账本全期有过支出就认为模块有用。 */
  monthExpenseDonut(summary?: WorkspaceAnalyticsSummary | null) {
    return (summary?.expense_total ?? 0) > 0
  },
  monthIncomeDonut(summary?: WorkspaceAnalyticsSummary | null) {
    return (summary?.income_total ?? 0) > 0
  },
  yearHeatmap(yearSeries?: WorkspaceAnalyticsSeriesItem[] | null) {
    return hasFlow(yearSeries)
  },
  /** 资产构成环：至少有一个正余额的资产类账户才有扇区可画。 */
  assetComposition(accounts: WorkspaceAccount[]) {
    return accounts.some(
      (a) =>
        !LIABILITY_ACCOUNT_TYPES.has(a.account_type || '') &&
        (a.balance ?? a.initial_balance ?? 0) > 0
    )
  },
  trendBars(series?: WorkspaceAnalyticsSeriesItem[] | null) {
    return hasFlow(series)
  },
  topExpenseCategory(ranks?: WorkspaceAnalyticsCategoryRank[] | null) {
    return hasAmount(ranks || [])
  },
  topIncomeCategory(ranks?: WorkspaceAnalyticsCategoryRank[] | null) {
    return hasAmount(ranks || [])
  },
  topTags(tags: { tx_count?: number | null }[]) {
    return tags.some((tag) => (tag.tx_count ?? 0) > 0)
  },
  topAccounts(accounts: WorkspaceAccount[]) {
    return accounts.some(
      (a) => !VALUATION_ACCOUNT_TYPES.has(a.account_type || '') && (a.tx_count ?? 0) > 0
    )
  }
}
