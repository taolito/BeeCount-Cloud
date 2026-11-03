import type {
  ReadBudget,
  WorkspaceAccount,
  WorkspaceAnalytics,
  WorkspaceAnalyticsSeriesItem,
  WorkspaceAnalyticsSummary,
  WorkspaceLedgerCounts,
  WorkspaceTag
} from '@beecount/api-client'
import { Children, type ReactNode } from 'react'
import { useT } from '@beecount/ui'
import type { BudgetUsage } from '@beecount/web-features'

import { useLedgers } from '../../context/LedgersContext'
import { homeModuleData } from '../../lib/homeModules'
import {
  dispatchOpenDetailAccount,
  dispatchOpenDetailTag,
} from '../../lib/txDialogEvents'
import { HomeHero } from '../dashboard/HomeHero'
import { HomeHabitStats } from '../dashboard/HomeHabitStats'
import { HomeYearHeatmap } from '../dashboard/HomeYearHeatmap'
import { HomeMonthCategoryDonuts } from '../dashboard/HomeMonthCategoryDonuts'
import { HomeTopTags } from '../dashboard/HomeTopTags'
import { HomeTopAccounts } from '../dashboard/HomeTopAccounts'
import { AssetCompositionDonut } from '../dashboard/AssetCompositionDonut'
import { MonthlyTrendBars } from '../dashboard/MonthlyTrendBars'
import { TopCategoriesList } from '../dashboard/TopCategoriesList'

interface Props {
  accounts: WorkspaceAccount[]
  tags: WorkspaceTag[]
  currentMonthSummary: WorkspaceAnalyticsSummary | null
  currentMonthSeries: WorkspaceAnalyticsSeriesItem[]
  /** 月度收支分类双环 —— 月份由 monthDonutPeriod 控制，收支共用。 */
  monthExpenseRanks: WorkspaceAnalytics['category_ranks']
  monthIncomeRanks: WorkspaceAnalytics['category_ranks']
  monthDonutPeriod: string
  monthDonutLoading: boolean
  onMonthDonutPeriodChange: (period: string) => void
  currentYearSummary: WorkspaceAnalyticsSummary | null
  currentYearSeries: WorkspaceAnalyticsSeriesItem[]
  allTimeSummary: WorkspaceAnalyticsSummary | null
  allTimeSeries: WorkspaceAnalyticsSeriesItem[]
  analyticsData: WorkspaceAnalytics | null
  analyticsIncomeRanks: WorkspaceAnalytics['category_ranks']
  ledgerCounts: WorkspaceLedgerCounts | null
  /** 当前账本预算 + 各 budget 当周期 used。空数组 → BudgetUsagePanel 不显示。 */
  budgets: ReadBudget[]
  budgetUsageById: Record<string, BudgetUsage>
  onJumpToTransactionsWithQuery: (query: string) => void
  /** Top 卡片点击分类名时的钩子 — page 端反查 WorkspaceCategory 后派发详情。
   *  没传则 Top 卡片回退到 onJumpToTransactionsWithQuery。 */
  onCategoryClickFromTop?: (name: string, kind: 'expense' | 'income') => void
}

/**
 * 首页 overview dashboard —— 从 AppPage.tsx 抽出独立组件。
 *
 * 渲染顺序对应 mobile 首页对标 + Web 独有扩展分析:
 *   - HomeHero:核心指标(本月/本年/全期)+ 账本列表 hero
 *   - HomeHabitStats:习惯画像(连续记账天数等)
 *   - [扩展分析分割线 —— 下面这些模块全部没数据时整组(含分割线)不渲染]
 *   - HomeMonthCategoryDonuts(月度收支分类：一张卡里支出环 + 收入环，共用月份步进器)
 *   - HomeYearHeatmap 整行
 *   - AssetCompositionDonut + MonthlyTrendBars 并排
 *   - TopCategoriesList(支出 + 收入)并排
 *   - HomeTopTags + HomeTopAccounts 并排
 *   同一行里只剩一张卡时它铺满整行,不留半宽空位。
 */
export function OverviewSection({
  accounts,
  tags,
  currentMonthSummary,
  currentMonthSeries,
  monthExpenseRanks,
  monthIncomeRanks,
  monthDonutPeriod,
  monthDonutLoading,
  onMonthDonutPeriodChange,
  currentYearSummary,
  currentYearSeries,
  allTimeSummary,
  allTimeSeries,
  analyticsData,
  analyticsIncomeRanks,
  ledgerCounts,
  budgets,
  budgetUsageById,
  onJumpToTransactionsWithQuery,
  onCategoryClickFromTop,
}: Props) {
  const t = useT()
  const { ledgers, activeLedgerId, currency } = useLedgers()

  // 预算 + 异常归因被合并进 HomeHero 顶部 chip(hover 出详情),不再独占
  // 卡片占首页空间。月份够算 baseline 的判定跟 server 算法一致(已发生月份 ≥ 3)。
  const yearOccurredMonths = (analyticsData?.series || []).filter(
    (s) => s.expense > 0,
  ).length

  // 扩展分析每张卡「有没有东西可画」—— 判定口径集中在 lib/homeModules.ts。
  // 没数据的模块直接不渲染，首页不再摆一排「暂无数据」空卡。
  const show = {
    monthExpenseDonut: homeModuleData.monthExpenseDonut(allTimeSummary),
    monthIncomeDonut: homeModuleData.monthIncomeDonut(allTimeSummary),
    yearHeatmap: homeModuleData.yearHeatmap(currentYearSeries),
    assetComposition: homeModuleData.assetComposition(accounts),
    trendBars: homeModuleData.trendBars(analyticsData?.series),
    topExpenseCategory: homeModuleData.topExpenseCategory(analyticsData?.category_ranks),
    topIncomeCategory: homeModuleData.topIncomeCategory(analyticsIncomeRanks),
    topTags: homeModuleData.topTags(tags),
    topAccounts: homeModuleData.topAccounts(accounts),
  }
  const hasAnyAnalytics = Object.values(show).some(Boolean)

  return (
    <div className="space-y-4">
      <HomeHero
        ledgers={ledgers}
        currentLedgerId={activeLedgerId || undefined}
        monthSummary={currentMonthSummary || undefined}
        monthSeries={currentMonthSeries}
        yearSummary={currentYearSummary || undefined}
        yearSeries={currentYearSeries}
        allSummary={allTimeSummary || undefined}
        allSeries={allTimeSeries}
        ledgerCounts={ledgerCounts || undefined}
        budgets={budgets}
        budgetUsageById={budgetUsageById}
        anomalyMonths={analyticsData?.anomaly_months || []}
        hasEnoughMonthsForAnomaly={yearOccurredMonths >= 3}
      />

      <HomeHabitStats
        monthSummary={currentMonthSummary || undefined}
        ledgerCounts={ledgerCounts || undefined}
        currency={currency}
      />

      {/* 扩展分析:Web 端独有的加强仪表,不属于 mobile 首页对标范围 */}
      {hasAnyAnalytics ? (
        <div className="flex items-center gap-2 pt-2">
          <span className="h-px flex-1 bg-border/60" aria-hidden />
          <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            {t('analytics.ext.title')}
          </span>
          <span className="h-px flex-1 bg-border/60" aria-hidden />
        </div>
      ) : null}

      {show.monthExpenseDonut || show.monthIncomeDonut ? (
        <HomeMonthCategoryDonuts
          expenseRanks={monthExpenseRanks}
          incomeRanks={monthIncomeRanks}
          currency={currency}
          period={monthDonutPeriod}
          loading={monthDonutLoading}
          showExpense={show.monthExpenseDonut}
          showIncome={show.monthIncomeDonut}
          onPeriodChange={onMonthDonutPeriodChange}
        />
      ) : null}

      {show.yearHeatmap ? <HomeYearHeatmap yearSeries={currentYearSeries} currency={currency} /> : null}

      <ModuleRow cols="lg:grid-cols-[1.1fr_1fr]">
        {show.assetComposition ? <AssetCompositionDonut key="asset" accounts={accounts} /> : null}
        {show.trendBars ? <MonthlyTrendBars key="trend" data={analyticsData?.series || []} /> : null}
      </ModuleRow>

      <ModuleRow cols="md:grid-cols-2">
        {show.topExpenseCategory ? (
          <TopCategoriesList
            key="top-expense"
            ranks={analyticsData?.category_ranks || []}
            variant="expense"
            title={t('analytics.expenseTop5')}
            onClickCategory={
              onCategoryClickFromTop
                ? (name) => onCategoryClickFromTop(name, 'expense')
                : onJumpToTransactionsWithQuery
            }
          />
        ) : null}
        {show.topIncomeCategory ? (
          <TopCategoriesList
            key="top-income"
            ranks={analyticsIncomeRanks}
            variant="income"
            title={t('analytics.incomeTop5')}
            onClickCategory={
              onCategoryClickFromTop
                ? (name) => onCategoryClickFromTop(name, 'income')
                : onJumpToTransactionsWithQuery
            }
          />
        ) : null}
      </ModuleRow>

      <ModuleRow cols="md:grid-cols-2">
        {show.topTags ? (
          <HomeTopTags
            key="tags"
            tags={tags}
            currency={currency}
            onSelectTag={(tag) => dispatchOpenDetailTag(tag, { defaultScope: 'current' })}
          />
        ) : null}
        {show.topAccounts ? (
          <HomeTopAccounts
            key="accounts"
            accounts={accounts}
            currency={currency}
            onSelectAccount={(acc) =>
              dispatchOpenDetailAccount(acc, { defaultScope: 'current' })
            }
          />
        ) : null}
      </ModuleRow>
    </div>
  )
}

/**
 * 扩展分析的一行。`Children.toArray` 会把 null/false 子节点直接丢掉，所以这里
 * 拿到的就是「真正要显示的那几张卡」：0 张 → 整行不渲染（避免 space-y 留下空隙），
 * 1 张 → 铺满整行（半宽孤卡看起来比整行更空），2 张 → 按 cols 分栏。
 */
function ModuleRow({ cols, children }: { cols: string; children: ReactNode }) {
  const items = Children.toArray(children)
  if (items.length === 0) return null
  return (
    <div className={items.length === 1 ? 'grid gap-4' : `grid gap-4 ${cols}`}>{items}</div>
  )
}
