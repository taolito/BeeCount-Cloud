import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, useT } from '@beecount/ui'

import type { WorkspaceAnalyticsSeriesItem } from '@beecount/api-client'
import { Amount } from '@beecount/web-features'

interface Props {
  /** year scope 的 series，bucket 是 YYYY-MM。 */
  yearSeries?: WorkspaceAnalyticsSeriesItem[]
  currency?: string
}

/**
 * 12 个月结余热力条：按当月结余(income - expense)的正负染色 —— 结余为正走
 * income token(绿)、为负走 expense token(红),深浅按 |结余| 相对全年最大 |结余|
 * 线性递增。对比之下 MonthlyTrendBars 只展示最近 6 期，这里补齐整年。
 */
export function HomeYearHeatmap({ yearSeries, currency = 'CNY' }: Props) {
  const t = useT()
  const data = useMemo(() => {
    const year = new Date().getFullYear()
    const byBucket = new Map<string, { income: number; expense: number }>()
    for (const it of yearSeries || []) {
      byBucket.set(it.bucket, { income: it.income || 0, expense: it.expense || 0 })
    }
    const rows = []
    let maxAbsBalance = 0
    for (let m = 0; m < 12; m += 1) {
      const key = `${year}-${String(m + 1).padStart(2, '0')}`
      const rec = byBucket.get(key) || { income: 0, expense: 0 }
      const balance = rec.income - rec.expense
      if (Math.abs(balance) > maxAbsBalance) maxAbsBalance = Math.abs(balance)
      rows.push({
        monthIndex: m,
        monthLabel: t('home.heatmap.monthLabel').replace('{month}', String(m + 1)),
        income: rec.income,
        expense: rec.expense,
        hasData: rec.income > 0 || rec.expense > 0,
        balance
      })
    }
    return { rows, maxAbsBalance, year }
  }, [yearSeries, t])

  // 格子里显示结余;负数由 toLocaleString 自带符号,正数补 '+' 让"赚/亏"一眼分得开。
  const fmtSigned = (v: number) =>
    `${v > 0 ? '+' : ''}${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  return (
    // overflow-visible:tooltip 通过 -translate-y-full 向上展开会越出 Card 边界,
    // overflow-hidden 会把顶行(1-6 月)的 tooltip clip 掉,只剩底边像被截断的卡片
    // 漂出来(2026-05-16 用户上报)。bc-panel 圆角靠 border-radius,跟 overflow
    // 无关,改 visible 不破圆角。
    // bc-income-green:这张图的颜色语义固定「绿=有结余 / 红=入不敷出」,不跟
    // 用户的 收支配色 偏好走(偏好一翻会把"亏"显示成绿色,读起来正好反)。
    <Card className="bc-panel bc-income-green overflow-visible">
      <CardHeader className="flex flex-row items-end justify-between">
        <CardTitle className="text-base">
          {t('home.heatmap.title').replace('{year}', String(data.year))}
        </CardTitle>
        <span className="text-[11px] text-muted-foreground">{t('home.heatmap.hint')}</span>
      </CardHeader>
      <CardContent>
        {/* 12 格月度热力 —— 改成 **永远 2 排**(sm 4 列 × 3 行,md+ 6 列 × 2 行)。
             之前试过 lg:12 列挤一排,桌面 13 寸仍然窄得金额 truncate 成 "9,..."
             视觉上更糟。两排布局让每格有 120px+ 宽度,月名 + 完整金额都舒展,
             代价是卡片高度翻倍 —— 但首页下方本来就空着,换个立体感反而好看。 */}
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
          {data.rows.map((row) => {
            // 深浅 = |结余| 占全年最大 |结余| 的比例;0.18 是下限,保证最小的月份
            // 也看得出颜色(跟旧版支出热力的读法一致)。
            const ratio =
              data.maxAbsBalance > 0 ? Math.abs(row.balance) / data.maxAbsBalance : 0
            const varName = row.balance >= 0 ? '--income-rgb' : '--expense-rgb'
            const bg =
              ratio === 0
                ? 'rgba(148,163,184,0.12)'
                : `rgb(var(${varName}) / ${Math.max(0.18, ratio).toFixed(2)})`
            const isCurrent =
              row.monthIndex === new Date().getMonth() &&
              data.year === new Date().getFullYear()
            return (
              <div
                key={row.monthIndex}
                className={`group relative flex min-w-0 flex-col gap-0.5 rounded-lg border px-2 py-2 ${
                  isCurrent ? 'border-primary ring-1 ring-primary/40' : 'border-border/40'
                }`}
                style={{ background: bg }}
              >
                {/* 之前还挂了 title={...} 做 native 兜底,但 native tooltip + CSS
                    tooltip 同时出现会重叠两个气泡,视觉很乱(用户上报)。CSS 已经
                    显示完整 4 行(月名 + 收入 + 支出 + 结余),native title 是冗余,
                    去掉。 */}
                <span
                  className={`text-[11px] font-semibold leading-tight ${
                    ratio > 0.5 ? 'text-white' : 'text-foreground'
                  }`}
                >
                  {row.monthLabel}
                </span>
                {row.hasData ? (
                  <span
                    className={`truncate font-mono text-[11px] leading-tight tabular-nums ${
                      ratio > 0.5 ? 'text-white/90' : 'text-muted-foreground'
                    }`}
                  >
                    {fmtSigned(row.balance)}
                  </span>
                ) : (
                  <span className="text-[11px] leading-tight text-muted-foreground">—</span>
                )}

                {/* hover 详情 tooltip(纯 CSS,避免额外依赖)。z-30 保证 Card 间
                    并排时 tooltip 在另一张 Card 之上(默认 z 时被旁边 donut card
                    的内容遮)。 */}
                <div className="pointer-events-none absolute -top-1 left-1/2 z-30 hidden w-max -translate-x-1/2 -translate-y-full rounded-md border border-border/60 bg-popover px-2 py-1 text-[11px] shadow-lg group-hover:block">
                  <div className="font-semibold">{row.monthLabel}</div>
                  <div className="text-income">
                    {t('home.heatmap.tooltipIncome').replace('{value}', row.income.toFixed(2))}
                  </div>
                  <div className="text-expense">
                    {t('home.heatmap.tooltipExpense').replace('{value}', row.expense.toFixed(2))}
                  </div>
                  <div>
                    <span
                      className={row.balance >= 0 ? 'text-income' : 'text-expense'}
                    >
                      {t('home.heatmap.tooltipBalance').replace('{value}', row.balance.toFixed(2))}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
