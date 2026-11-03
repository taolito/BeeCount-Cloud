import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
  useLocale,
  useT
} from '@beecount/ui'

import type { WorkspaceAnalyticsCategoryRank } from '@beecount/api-client'
import { Amount } from '@beecount/web-features'

type Metric = 'expense' | 'income'

interface Props {
  /** scope=month&metric=expense&period=<period> 返回的 category_ranks。 */
  expenseRanks: WorkspaceAnalyticsCategoryRank[]
  /** scope=month&metric=income&period=<period> 返回的 category_ranks。 */
  incomeRanks: WorkspaceAnalyticsCategoryRank[]
  currency?: string
  /** YYYY-MM —— 收支两个环共用同一个月份。 */
  period: string
  onPeriodChange: (period: string) => void
  /** 换月份 / 换账本时后台重拉，用半透明遮罩盖住当前数据，加载完成后撤掉。 */
  loading?: boolean
  /** 账本全期没有收入（或没有支出）时，对应那个环整块不渲染。 */
  showExpense?: boolean
  showIncome?: boolean
}

const monthKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

function parsePeriod(period: string): [number, number] {
  const [y, m] = `${period}`.split('-').map(Number)
  return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12
    ? [y, m]
    : [new Date().getFullYear(), new Date().getMonth() + 1]
}

// 配色：前 5 用 BeeCount mobile 常用调色盘，"其他"用中性灰
const PALETTE = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#a855f7']
const OTHER_COLOR = '#94a3b8'

interface BlockProps {
  metric: Metric
  ranks: WorkspaceAnalyticsCategoryRank[]
  currency: string
}

/**
 * 单个月度分类环（conic-gradient 分段，Top 5 + "其他"），只负责环 + 图例，
 * 卡片外壳和月份步进器由外层统一提供。参考 `AccountsPanel.AssetsCompositionMini`
 * 的同款做法，避免为分段饼图引入 recharts。
 */
function DonutBlock({ metric, ranks, currency }: BlockProps) {
  const t = useT()
  const isExpense = metric === 'expense'
  const otherLabel = t('home.monthDonut.other')
  const { slices, total } = useMemo(() => {
    const sorted = ranks
      .slice()
      .sort((a, b) => b.total - a.total)
      .filter((r) => r.total > 0)
    const top = sorted.slice(0, 5)
    const rest = sorted.slice(5)
    const restTotal = rest.reduce((s, r) => s + r.total, 0)
    const restCount = rest.reduce((s, r) => s + r.tx_count, 0)
    const all = top.map((r) => ({
      name: r.category_name || t('home.monthDonut.uncategorized'),
      total: r.total,
      count: r.tx_count
    }))
    if (restTotal > 0) {
      all.push({ name: otherLabel, total: restTotal, count: restCount })
    }
    const sum = all.reduce((s, r) => s + r.total, 0)
    return { slices: all, total: sum }
  }, [ranks, otherLabel, t])

  const conic = useMemo(() => {
    if (total <= 0) return 'hsl(var(--muted))'
    let acc = 0
    const stops: string[] = []
    slices.forEach((s, i) => {
      const color = s.name === otherLabel ? OTHER_COLOR : PALETTE[i % PALETTE.length]
      const start = (acc / total) * 100
      acc += s.total
      const end = (acc / total) * 100
      stops.push(`${color} ${start.toFixed(3)}% ${end.toFixed(3)}%`)
    })
    return `conic-gradient(from -90deg, ${stops.join(',')})`
  }, [slices, total, otherLabel])

  if (slices.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        {t(isExpense ? 'home.monthDonut.emptyExpense' : 'home.monthDonut.emptyIncome')}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-36 w-36 shrink-0">
        <div className="absolute inset-0 rounded-full" style={{ background: conic }} aria-hidden />
        <div className="absolute inset-[18%] rounded-full bg-card" aria-hidden />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t(isExpense ? 'home.monthDonut.expenseCenter' : 'home.monthDonut.incomeCenter')}
          </div>
          <Amount
            value={total}
            currency={currency}
            size="sm"
            bold
            tone={isExpense ? 'negative' : 'positive'}
            className="mt-0.5"
          />
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {t('home.monthDonut.categoryCount').replace('{count}', String(slices.length))}
          </div>
        </div>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {slices.map((s, i) => {
          const color = s.name === otherLabel ? OTHER_COLOR : PALETTE[i % PALETTE.length]
          const pct = total > 0 ? (s.total / total) * 100 : 0
          return (
            <li key={`${s.name}-${i}`} className="flex items-center gap-2 text-xs">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ background: color }}
                aria-hidden
              />
              <span className="flex-1 truncate">{s.name}</span>
              <span className="text-muted-foreground font-mono tabular-nums">
                {pct.toFixed(1)}%
              </span>
              <Amount value={s.total} currency={currency} size="xs" className="w-20 text-right" />
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/**
 * 月度收支分类 —— 一张卡里并排支出环 + 收入环，共用一个月份步进器，
 * 翻月份时两个环一起换（数据由首页按同一 period 一次拉两侧）。
 */
export function HomeMonthCategoryDonuts({
  expenseRanks,
  incomeRanks,
  currency = 'CNY',
  period,
  onPeriodChange,
  loading = false,
  showExpense = true,
  showIncome = true
}: Props) {
  const t = useT()
  const { locale } = useLocale()

  const [year, monthNum] = parsePeriod(period)
  const periodText = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short'
  }).format(new Date(year, monthNum - 1, 1))
  const shiftMonth = (delta: number) =>
    onPeriodChange(monthKey(new Date(year, monthNum - 1 + delta, 1)))
  // YYYY-MM 定宽零填充，字典序即时间序；未来月份没数据，不给往后翻。
  const atCurrentMonth = period >= monthKey(new Date())

  const blocks = [
    showExpense ? (
      <DonutBlock key="expense" metric="expense" ranks={expenseRanks} currency={currency} />
    ) : null,
    showIncome ? (
      <DonutBlock key="income" metric="income" ranks={incomeRanks} currency={currency} />
    ) : null
  ].filter(Boolean)

  return (
    <Card className="bc-panel overflow-hidden">
      <CardHeader className="flex flex-row items-end justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="shrink-0 text-base">{t('home.monthDonut.title')}</CardTitle>
          <div className="flex shrink-0 items-center rounded-md border border-border/60 bg-muted/30 px-0.5">
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('home.monthDonut.prevMonth')}
              onClick={() => shiftMonth(-1)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-[4.75rem] text-center text-[11px] font-medium tabular-nums">
              {periodText}
            </span>
            <button
              type="button"
              disabled={atCurrentMonth}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={t('home.monthDonut.nextMonth')}
              onClick={() => shiftMonth(1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative" aria-busy={loading}>
        <div
          className={
            blocks.length === 1 ? 'space-y-5' : 'grid gap-5 md:grid-cols-[1fr_1fr]'
          }
        >
          {blocks}
        </div>
        {/* 半透明遮罩常驻，只切 opacity —— 翻月份重拉时淡入盖住旧数据，落地后淡出，
            环和图例位置全程不跳。隐藏时 pointer-events-none 放行点击，转圈也停掉。 */}
        <div
          className={cn(
            'absolute inset-0 z-10 flex items-center justify-center gap-2 bg-card/70 text-xs',
            'text-muted-foreground backdrop-blur-[2px] transition-opacity duration-200 ease-out',
            loading ? 'opacity-100' : 'pointer-events-none opacity-0'
          )}
          aria-hidden={!loading}
        >
          <Loader2
            className={cn('h-4 w-4', loading && 'animate-spin')}
            aria-hidden
          />
          {t('home.monthDonut.loading')}
        </div>
      </CardContent>
    </Card>
  )
}
