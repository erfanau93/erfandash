import { useEffect, useState, useMemo, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import {
  startOfMonth,
  endOfMonth,
  subMonths,
  format,
  eachDayOfInterval,
  differenceInDays,
  parseISO,
  startOfDay,
  endOfDay,
} from 'date-fns'

type QuoteRecord = {
  id: string
  lead_id: string | null
  total_inc_gst: number
  profit: number
  cleaner_pay: number
  margin: number
  accepted_payment_method: string | null
  created_at: string
  lead?: {
    status?: string | null
  }
}

type LeadRecord = {
  id: string
  status: string | null
  created_at: string
  first_contact: string | null
}

type BookingOccurrence = {
  id: string
  status: string
  payment_status: string
  payment_amount_cents: number | null
  start_at: string
  created_at: string
}

type MonthlyData = {
  month: string
  monthLabel: string
  leads: number
  quotes: number
  quotedLeads: number
  wonJobs: number
  paidJobs: number
  totalQuoteValue: number
  wonValue: number
  paidValue: number
  totalProfit: number
  avgQuoteValue: number
  avgLeadToCall: number
  conversionRate: number
  quoteToWonRate: number
  completedJobs: number
  completedRevenue: number
}

type ProjectionScenario = {
  label: string
  adSpend: number
  leads: number
  quotes: number
  wonJobs: number
  revenue: number
  profit: number
  roi: number
  cac: number
}

const MONTH_OPTIONS = Array.from({ length: 12 }, (_, i) => {
  const date = subMonths(new Date(), i)
  return {
    value: format(date, 'yyyy-MM'),
    label: format(date, 'MMMM yyyy'),
  }
})

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-AU').format(Math.round(value))
}

function getGrowthIndicator(current: number, previous: number) {
  if (!previous || previous === 0) return { value: 0, isUp: true, label: 'N/A' }
  const growth = ((current - previous) / previous) * 100
  return {
    value: Math.abs(growth),
    isUp: growth >= 0,
    label: `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}%`,
  }
}

// Mini sparkline component
function Sparkline({ data, color = 'emerald' }: { data: number[]; color?: string }) {
  if (!data.length) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1
  const width = 120
  const height = 40
  const padding = 4

  const points = data
    .map((val, i) => {
      const x = padding + (i / (data.length - 1 || 1)) * (width - padding * 2)
      const y = height - padding - ((val - min) / range) * (height - padding * 2)
      return `${x},${y}`
    })
    .join(' ')

  const colorMap: Record<string, string> = {
    emerald: 'stroke-emerald-400',
    cyan: 'stroke-cyan-400',
    violet: 'stroke-violet-400',
    amber: 'stroke-amber-400',
    rose: 'stroke-rose-400',
  }

  return (
    <svg width={width} height={height} className="opacity-80">
      <polyline
        points={points}
        fill="none"
        className={colorMap[color] || 'stroke-emerald-400'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Metric card with growth indicator
function MetricCardLarge({
  title,
  value,
  subtitle,
  growth,
  sparkData,
  color = 'emerald',
  icon,
}: {
  title: string
  value: string
  subtitle?: string
  growth?: { value: number; isUp: boolean; label: string }
  sparkData?: number[]
  color?: string
  icon?: React.ReactNode
}) {
  const bgMap: Record<string, string> = {
    emerald: 'from-emerald-900/40 to-emerald-950/40 border-emerald-500/30',
    cyan: 'from-cyan-900/40 to-cyan-950/40 border-cyan-500/30',
    violet: 'from-violet-900/40 to-violet-950/40 border-violet-500/30',
    amber: 'from-amber-900/40 to-amber-950/40 border-amber-500/30',
    rose: 'from-rose-900/40 to-rose-950/40 border-rose-500/30',
    sky: 'from-sky-900/40 to-sky-950/40 border-sky-500/30',
    teal: 'from-teal-900/40 to-teal-950/40 border-teal-500/30',
  }

  const textMap: Record<string, string> = {
    emerald: 'text-emerald-200',
    cyan: 'text-cyan-200',
    violet: 'text-violet-200',
    amber: 'text-amber-200',
    rose: 'text-rose-200',
    sky: 'text-sky-200',
    teal: 'text-teal-200',
  }

  return (
    <div
      className={`rounded-2xl bg-gradient-to-br ${bgMap[color]} border p-5 flex flex-col justify-between min-h-[140px]`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {icon && <span className="text-white/70">{icon}</span>}
          <p className="text-xs text-white/60 uppercase tracking-wider font-medium">{title}</p>
        </div>
        {growth && (
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
              growth.isUp ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
            }`}
          >
            {growth.label}
          </span>
        )}
      </div>
      <div className="flex items-end justify-between mt-2">
        <div>
          <p className={`text-3xl font-bold ${textMap[color]}`}>{value}</p>
          {subtitle && <p className="text-xs text-white/50 mt-1">{subtitle}</p>}
        </div>
        {sparkData && sparkData.length > 1 && <Sparkline data={sparkData} color={color} />}
      </div>
    </div>
  )
}

// Funnel visualization
function FunnelChart({
  stages,
}: {
  stages: { label: string; value: number; color: string; rate?: string }[]
}) {
  const maxValue = Math.max(...stages.map((s) => s.value), 1)

  return (
    <div className="space-y-3">
      {stages.map((stage, i) => {
        const widthPercent = (stage.value / maxValue) * 100
        return (
          <div key={stage.label} className="relative">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm text-white/80 font-medium">{stage.label}</span>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold text-white">{formatNumber(stage.value)}</span>
                {stage.rate && (
                  <span className="text-xs text-white/50 bg-white/5 px-2 py-0.5 rounded">
                    {stage.rate}
                  </span>
                )}
              </div>
            </div>
            <div className="h-8 rounded-lg bg-white/5 overflow-hidden">
              <div
                className={`h-full ${stage.color} transition-all duration-700 ease-out rounded-lg flex items-center justify-end pr-3`}
                style={{ width: `${widthPercent}%` }}
              >
                {widthPercent > 20 && (
                  <span className="text-xs font-semibold text-white/90">
                    {formatPercent(widthPercent)}
                  </span>
                )}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className="flex justify-center my-1">
                <svg className="w-4 h-4 text-white/20" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Bar chart for MoM comparison
function BarChart({
  data,
  valueKey,
  labelKey,
  color = 'emerald',
  formatValue = formatNumber,
}: {
  data: { [key: string]: any }[]
  valueKey: string
  labelKey: string
  color?: string
  formatValue?: (v: number) => string
}) {
  const maxValue = Math.max(...data.map((d) => d[valueKey] || 0), 1)

  const colorMap: Record<string, { bar: string; text: string }> = {
    emerald: { bar: 'bg-emerald-500', text: 'text-emerald-300' },
    cyan: { bar: 'bg-cyan-500', text: 'text-cyan-300' },
    violet: { bar: 'bg-violet-500', text: 'text-violet-300' },
    amber: { bar: 'bg-amber-500', text: 'text-amber-300' },
  }

  const colors = colorMap[color] || colorMap.emerald

  return (
    <div className="flex items-end gap-2 h-40">
      {data.map((item, i) => {
        const heightPercent = ((item[valueKey] || 0) / maxValue) * 100
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className={`text-xs font-semibold ${colors.text}`}>
              {formatValue(item[valueKey] || 0)}
            </span>
            <div className="w-full bg-white/5 rounded-t-lg overflow-hidden flex-1 flex items-end">
              <div
                className={`w-full ${colors.bar} rounded-t-lg transition-all duration-500`}
                style={{ height: `${heightPercent}%` }}
              />
            </div>
            <span className="text-[10px] text-white/50 truncate max-w-full">{item[labelKey]}</span>
          </div>
        )
      })}
    </div>
  )
}

export default function BusinessAnalytics() {
  const [selectedMonth, setSelectedMonth] = useState(MONTH_OPTIONS[0].value)
  const [compareMonth, setCompareMonth] = useState(MONTH_OPTIONS[1]?.value || MONTH_OPTIONS[0].value)
  const [adSpend, setAdSpend] = useState(1000)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Raw data
  const [quotes, setQuotes] = useState<QuoteRecord[]>([])
  const [leads, setLeads] = useState<LeadRecord[]>([])
  const [occurrences, setOccurrences] = useState<BookingOccurrence[]>([])

  // Calculated monthly data
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([])

  // Fetch all data
  const fetchData = useCallback(async () => {
    try {
      setError(null)
      setIsLoading(true)

      // Get data for last 12 months
      const lookbackStart = startOfMonth(subMonths(new Date(), 11))

      const [quotesRes, leadsRes, occurrencesRes] = await Promise.all([
        supabase
          .from('quotes')
          .select(
            `
            id, lead_id, total_inc_gst, profit, cleaner_pay, margin,
            accepted_payment_method, created_at,
            lead:extracted_leads (status)
          `
          )
          .gte('created_at', lookbackStart.toISOString())
          .is('base_quote_id', null)
          .order('created_at', { ascending: false }),

        supabase
          .from('extracted_leads')
          .select('id, status, created_at, first_contact')
          .gte('created_at', lookbackStart.toISOString())
          .order('created_at', { ascending: false }),

        supabase
          .from('booking_occurrences')
          .select('id, status, payment_status, payment_amount_cents, start_at, created_at')
          .gte('start_at', lookbackStart.toISOString())
          .order('start_at', { ascending: false }),
      ])

      if (quotesRes.error) throw quotesRes.error
      if (leadsRes.error) throw leadsRes.error
      if (occurrencesRes.error) throw occurrencesRes.error

      setQuotes((quotesRes.data || []) as QuoteRecord[])
      setLeads((leadsRes.data || []) as LeadRecord[])
      setOccurrences((occurrencesRes.data || []) as BookingOccurrence[])
    } catch (err) {
      console.error('Error fetching analytics data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load analytics data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Calculate monthly breakdowns
  useEffect(() => {
    const monthlyMap = new Map<string, MonthlyData>()

    // Initialize months
    MONTH_OPTIONS.forEach((opt) => {
      monthlyMap.set(opt.value, {
        month: opt.value,
        monthLabel: opt.label,
        leads: 0,
        quotes: 0,
        quotedLeads: 0,
        wonJobs: 0,
        paidJobs: 0,
        totalQuoteValue: 0,
        wonValue: 0,
        paidValue: 0,
        totalProfit: 0,
        avgQuoteValue: 0,
        avgLeadToCall: 0,
        conversionRate: 0,
        quoteToWonRate: 0,
        completedJobs: 0,
        completedRevenue: 0,
      })
    })

    // Process leads
    leads.forEach((lead) => {
      const monthKey = format(parseISO(lead.created_at), 'yyyy-MM')
      const data = monthlyMap.get(monthKey)
      if (data) {
        data.leads++
        if (lead.first_contact) {
          const leadTime = parseISO(lead.created_at)
          const contactTime = parseISO(lead.first_contact)
          const diffMinutes = (contactTime.getTime() - leadTime.getTime()) / (1000 * 60)
          if (diffMinutes >= 0 && diffMinutes < 60 * 24) {
            // Within 24h
            data.avgLeadToCall =
              (data.avgLeadToCall * (data.leads - 1) + diffMinutes) / data.leads
          }
        }
      }
    })

    // Process quotes
    const quotedLeadsByMonth = new Map<string, Set<string>>()
    quotes.forEach((quote) => {
      const monthKey = format(parseISO(quote.created_at), 'yyyy-MM')
      const data = monthlyMap.get(monthKey)
      if (data) {
        data.quotes++
        data.totalQuoteValue += quote.total_inc_gst || 0
        data.totalProfit += quote.profit || 0

        if (quote.lead_id) {
          if (!quotedLeadsByMonth.has(monthKey)) {
            quotedLeadsByMonth.set(monthKey, new Set())
          }
          quotedLeadsByMonth.get(monthKey)!.add(quote.lead_id)
        }

        const isWon =
          quote.accepted_payment_method === 'card_paid' || quote.lead?.status === 'Job Won'
        const isPaid = quote.accepted_payment_method === 'card_paid'

        if (isWon) {
          data.wonJobs++
          data.wonValue += quote.total_inc_gst || 0
        }
        if (isPaid) {
          data.paidJobs++
          data.paidValue += quote.total_inc_gst || 0
        }
      }
    })

    // Set quoted leads count
    quotedLeadsByMonth.forEach((leadSet, monthKey) => {
      const data = monthlyMap.get(monthKey)
      if (data) {
        data.quotedLeads = leadSet.size
      }
    })

    // Process occurrences for completed jobs
    occurrences.forEach((occ) => {
      const monthKey = format(parseISO(occ.start_at), 'yyyy-MM')
      const data = monthlyMap.get(monthKey)
      if (data && occ.status === 'completed') {
        data.completedJobs++
        data.completedRevenue += (occ.payment_amount_cents || 0) / 100
      }
    })

    // Calculate derived metrics
    monthlyMap.forEach((data) => {
      if (data.quotes > 0) {
        data.avgQuoteValue = data.totalQuoteValue / data.quotes
      }
      if (data.leads > 0) {
        data.conversionRate = (data.wonJobs / data.leads) * 100
      }
      if (data.quotedLeads > 0) {
        data.quoteToWonRate = (data.wonJobs / data.quotedLeads) * 100
      }
    })

    setMonthlyData(Array.from(monthlyMap.values()))
  }, [quotes, leads, occurrences])

  // Get current and previous month data
  const currentMonthData = useMemo(
    () => monthlyData.find((d) => d.month === selectedMonth),
    [monthlyData, selectedMonth]
  )
  const compareMonthData = useMemo(
    () => monthlyData.find((d) => d.month === compareMonth),
    [monthlyData, compareMonth]
  )

  // Calculate unit economics
  const unitEconomics = useMemo(() => {
    if (!currentMonthData || currentMonthData.leads === 0) {
      return {
        cac: 0,
        revenuePerLead: 0,
        profitPerLead: 0,
        ltv: 0,
        ltvCacRatio: 0,
      }
    }

    const cac = adSpend / currentMonthData.wonJobs || 0
    const revenuePerLead = currentMonthData.wonValue / currentMonthData.leads || 0
    const profitPerLead = currentMonthData.totalProfit / currentMonthData.leads || 0
    // Estimate LTV as 3x average job value (assuming repeat customers)
    const avgJobValue = currentMonthData.wonValue / currentMonthData.wonJobs || 0
    const ltv = avgJobValue * 3
    const ltvCacRatio = cac > 0 ? ltv / cac : 0

    return { cac, revenuePerLead, profitPerLead, ltv, ltvCacRatio }
  }, [currentMonthData, adSpend])

  // Calculate projections based on ad spend scaling
  const projections = useMemo((): ProjectionScenario[] => {
    if (!currentMonthData || currentMonthData.leads === 0) return []

    // Calculate current cost per lead
    const costPerLead = adSpend / currentMonthData.leads
    const leadToWonRate = currentMonthData.wonJobs / currentMonthData.leads
    const avgJobValue = currentMonthData.wonValue / currentMonthData.wonJobs || 0
    const avgProfitPerJob = currentMonthData.totalProfit / currentMonthData.wonJobs || 0
    const quoteRate = currentMonthData.quotedLeads / currentMonthData.leads

    const scenarios = [0.5, 1, 1.5, 2, 3, 5].map((multiplier) => {
      const projectedSpend = adSpend * multiplier
      const projectedLeads = Math.round(projectedSpend / costPerLead)
      const projectedQuotes = Math.round(projectedLeads * quoteRate)
      const projectedWon = Math.round(projectedLeads * leadToWonRate)
      const projectedRevenue = projectedWon * avgJobValue
      const projectedProfit = projectedWon * avgProfitPerJob - projectedSpend
      const roi = projectedSpend > 0 ? ((projectedProfit / projectedSpend) * 100) : 0
      const cac = projectedWon > 0 ? projectedSpend / projectedWon : 0

      return {
        label:
          multiplier === 1
            ? 'Current'
            : multiplier < 1
            ? `${(multiplier * 100).toFixed(0)}% Spend`
            : `${multiplier}x Spend`,
        adSpend: projectedSpend,
        leads: projectedLeads,
        quotes: projectedQuotes,
        wonJobs: projectedWon,
        revenue: projectedRevenue,
        profit: projectedProfit,
        roi,
        cac,
      }
    })

    return scenarios
  }, [currentMonthData, adSpend])

  // Funnel stages
  const funnelStages = useMemo(() => {
    if (!currentMonthData) return []
    return [
      {
        label: 'Total Leads',
        value: currentMonthData.leads,
        color: 'bg-gradient-to-r from-violet-500 to-violet-600',
      },
      {
        label: 'Quoted Leads',
        value: currentMonthData.quotedLeads,
        color: 'bg-gradient-to-r from-sky-500 to-sky-600',
        rate: currentMonthData.leads > 0 ? `${((currentMonthData.quotedLeads / currentMonthData.leads) * 100).toFixed(1)}% quoted` : '',
      },
      {
        label: 'Jobs Won',
        value: currentMonthData.wonJobs,
        color: 'bg-gradient-to-r from-emerald-500 to-emerald-600',
        rate: currentMonthData.quotedLeads > 0 ? `${((currentMonthData.wonJobs / currentMonthData.quotedLeads) * 100).toFixed(1)}% close rate` : '',
      },
      {
        label: 'Paid',
        value: currentMonthData.paidJobs,
        color: 'bg-gradient-to-r from-amber-500 to-amber-600',
        rate: currentMonthData.wonJobs > 0 ? `${((currentMonthData.paidJobs / currentMonthData.wonJobs) * 100).toFixed(1)}% paid` : '',
      },
    ]
  }, [currentMonthData])

  // Spark data for trends (last 6 months reversed for proper visualization)
  const sparkDataLeads = useMemo(
    () => monthlyData.slice(0, 6).reverse().map((d) => d.leads),
    [monthlyData]
  )
  const sparkDataRevenue = useMemo(
    () => monthlyData.slice(0, 6).reverse().map((d) => d.wonValue),
    [monthlyData]
  )
  const sparkDataProfit = useMemo(
    () => monthlyData.slice(0, 6).reverse().map((d) => d.totalProfit),
    [monthlyData]
  )
  const sparkDataConversion = useMemo(
    () => monthlyData.slice(0, 6).reverse().map((d) => d.conversionRate),
    [monthlyData]
  )

  if (isLoading) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center">
        <div className="flex items-center gap-3 text-white/60">
          <svg className="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-lg">Loading business analytics...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-4 md:p-6 lg:p-8">
      <div className="max-w-[1600px] mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/40 to-violet-500/40 border border-indigo-400/40 flex items-center justify-center">
                <svg className="w-6 h-6 text-indigo-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                </svg>
              </div>
              Business Analytics
            </h1>
            <p className="text-white/50 mt-1 text-sm">
              Deep-dive into your business performance with projections and scaling analysis
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Month selector */}
            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 uppercase tracking-wider">Primary</label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500/50"
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-xs text-white/50 uppercase tracking-wider">Compare</label>
              <select
                value={compareMonth}
                onChange={(e) => setCompareMonth(e.target.value)}
                className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-indigo-500/50"
              >
                {MONTH_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={fetchData}
              className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium flex items-center gap-2 transition"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </header>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Key Metrics Grid */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Key Performance Indicators
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCardLarge
              title="Total Leads"
              value={formatNumber(currentMonthData?.leads || 0)}
              subtitle={`${formatNumber(compareMonthData?.leads || 0)} prev month`}
              growth={getGrowthIndicator(currentMonthData?.leads || 0, compareMonthData?.leads || 0)}
              sparkData={sparkDataLeads}
              color="violet"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              }
            />
            <MetricCardLarge
              title="Revenue (Won)"
              value={formatCurrency(currentMonthData?.wonValue || 0)}
              subtitle={`${formatCurrency(compareMonthData?.wonValue || 0)} prev month`}
              growth={getGrowthIndicator(currentMonthData?.wonValue || 0, compareMonthData?.wonValue || 0)}
              sparkData={sparkDataRevenue}
              color="emerald"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            />
            <MetricCardLarge
              title="Gross Profit"
              value={formatCurrency(currentMonthData?.totalProfit || 0)}
              subtitle={`${formatCurrency(compareMonthData?.totalProfit || 0)} prev month`}
              growth={getGrowthIndicator(currentMonthData?.totalProfit || 0, compareMonthData?.totalProfit || 0)}
              sparkData={sparkDataProfit}
              color="teal"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              }
            />
            <MetricCardLarge
              title="Conversion Rate"
              value={formatPercent(currentMonthData?.conversionRate || 0)}
              subtitle={`${formatPercent(compareMonthData?.conversionRate || 0)} prev month`}
              growth={getGrowthIndicator(currentMonthData?.conversionRate || 0, compareMonthData?.conversionRate || 0)}
              sparkData={sparkDataConversion}
              color="cyan"
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
            />
          </div>
        </section>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sales Funnel */}
          <section className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400" />
              Sales Funnel Analysis
            </h2>
            <FunnelChart stages={funnelStages} />
            <div className="mt-6 pt-4 border-t border-white/10 grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider">Quote Rate</p>
                <p className="text-2xl font-bold text-white">
                  {currentMonthData && currentMonthData.leads > 0
                    ? formatPercent((currentMonthData.quotedLeads / currentMonthData.leads) * 100)
                    : '0%'}
                </p>
              </div>
              <div>
                <p className="text-xs text-white/50 uppercase tracking-wider">Close Rate</p>
                <p className="text-2xl font-bold text-white">
                  {formatPercent(currentMonthData?.quoteToWonRate || 0)}
                </p>
              </div>
            </div>
          </section>

          {/* Unit Economics */}
          <section className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-white/10 p-6">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              Unit Economics
            </h2>

            {/* Ad Spend Input */}
            <div className="mb-6 p-4 rounded-xl bg-white/5 border border-white/10">
              <label className="flex items-center justify-between text-sm text-white/70 mb-2">
                <span>Monthly Ad Spend</span>
                <span className="text-lg font-bold text-amber-300">{formatCurrency(adSpend)}</span>
              </label>
              <input
                type="range"
                min="0"
                max="10000"
                step="100"
                value={adSpend}
                onChange={(e) => setAdSpend(Number(e.target.value))}
                className="w-full h-2 rounded-full bg-white/10 appearance-none cursor-pointer accent-amber-500"
              />
              <div className="flex justify-between text-xs text-white/40 mt-1">
                <span>$0</span>
                <span>$5,000</span>
                <span>$10,000</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-xl bg-white/5">
                <p className="text-xs text-white/50 uppercase tracking-wider">CAC</p>
                <p className="text-2xl font-bold text-amber-200">{formatCurrency(unitEconomics.cac)}</p>
                <p className="text-xs text-white/40 mt-1">Cost to acquire customer</p>
              </div>
              <div className="p-4 rounded-xl bg-white/5">
                <p className="text-xs text-white/50 uppercase tracking-wider">LTV (Est.)</p>
                <p className="text-2xl font-bold text-emerald-200">{formatCurrency(unitEconomics.ltv)}</p>
                <p className="text-xs text-white/40 mt-1">Lifetime value (3x avg)</p>
              </div>
              <div className="p-4 rounded-xl bg-white/5">
                <p className="text-xs text-white/50 uppercase tracking-wider">LTV:CAC Ratio</p>
                <p className={`text-2xl font-bold ${unitEconomics.ltvCacRatio >= 3 ? 'text-emerald-200' : unitEconomics.ltvCacRatio >= 1 ? 'text-amber-200' : 'text-rose-200'}`}>
                  {unitEconomics.ltvCacRatio.toFixed(1)}x
                </p>
                <p className="text-xs text-white/40 mt-1">{unitEconomics.ltvCacRatio >= 3 ? 'Healthy' : unitEconomics.ltvCacRatio >= 1 ? 'Break-even' : 'Needs work'}</p>
              </div>
              <div className="p-4 rounded-xl bg-white/5">
                <p className="text-xs text-white/50 uppercase tracking-wider">Profit/Lead</p>
                <p className="text-2xl font-bold text-teal-200">{formatCurrency(unitEconomics.profitPerLead)}</p>
                <p className="text-xs text-white/40 mt-1">Avg profit per lead</p>
              </div>
            </div>
          </section>
        </div>

        {/* Scaling Projections */}
        <section className="rounded-2xl bg-gradient-to-br from-indigo-900/30 to-violet-900/30 border border-indigo-500/20 p-6">
          <h2 className="text-lg font-semibold text-white mb-2 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
            Scaling Projections
          </h2>
          <p className="text-sm text-white/50 mb-6">
            What happens when you scale your ad spend? Based on current conversion rates.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px]">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Scenario</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Ad Spend</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Est. Leads</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Est. Quotes</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Est. Won</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Est. Revenue</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">Est. Profit</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">ROI</th>
                  <th className="text-right py-3 px-4 text-xs text-white/50 uppercase tracking-wider font-medium">CAC</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((proj, i) => (
                  <tr
                    key={proj.label}
                    className={`border-b border-white/5 ${proj.label === 'Current' ? 'bg-indigo-500/10' : 'hover:bg-white/5'}`}
                  >
                    <td className="py-3 px-4">
                      <span className={`text-sm font-medium ${proj.label === 'Current' ? 'text-indigo-300' : 'text-white'}`}>
                        {proj.label}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-white/80">{formatCurrency(proj.adSpend)}</td>
                    <td className="py-3 px-4 text-right text-sm text-white/80">{formatNumber(proj.leads)}</td>
                    <td className="py-3 px-4 text-right text-sm text-white/80">{formatNumber(proj.quotes)}</td>
                    <td className="py-3 px-4 text-right text-sm text-white/80">{formatNumber(proj.wonJobs)}</td>
                    <td className="py-3 px-4 text-right text-sm text-emerald-300 font-medium">{formatCurrency(proj.revenue)}</td>
                    <td className={`py-3 px-4 text-right text-sm font-medium ${proj.profit >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {formatCurrency(proj.profit)}
                    </td>
                    <td className={`py-3 px-4 text-right text-sm font-medium ${proj.roi >= 100 ? 'text-emerald-300' : proj.roi >= 0 ? 'text-amber-300' : 'text-rose-300'}`}>
                      {formatPercent(proj.roi)}
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-white/80">{formatCurrency(proj.cac)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Month over Month Comparison */}
        <section className="rounded-2xl bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-white/10 p-6">
          <h2 className="text-lg font-semibold text-white mb-6 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            Month-over-Month Trends
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Leads Trend</p>
              <BarChart
                data={monthlyData.slice(0, 6).reverse()}
                valueKey="leads"
                labelKey="monthLabel"
                color="violet"
              />
            </div>
            <div>
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Revenue Trend</p>
              <BarChart
                data={monthlyData.slice(0, 6).reverse()}
                valueKey="wonValue"
                labelKey="monthLabel"
                color="emerald"
                formatValue={formatCurrency}
              />
            </div>
            <div>
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Jobs Won Trend</p>
              <BarChart
                data={monthlyData.slice(0, 6).reverse()}
                valueKey="wonJobs"
                labelKey="monthLabel"
                color="cyan"
              />
            </div>
            <div>
              <p className="text-xs text-white/50 uppercase tracking-wider mb-3">Conversion Rate Trend</p>
              <BarChart
                data={monthlyData.slice(0, 6).reverse()}
                valueKey="conversionRate"
                labelKey="monthLabel"
                color="amber"
                formatValue={(v) => `${v.toFixed(1)}%`}
              />
            </div>
          </div>
        </section>

        {/* Detailed Metrics Grid */}
        <section>
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
            Detailed Monthly Metrics
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Total Quotes</p>
              <p className="text-2xl font-bold text-white mt-1">{currentMonthData?.quotes || 0}</p>
              <p className="text-xs text-white/40 mt-1">Sent this month</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Quote Value</p>
              <p className="text-2xl font-bold text-sky-200 mt-1">{formatCurrency(currentMonthData?.totalQuoteValue || 0)}</p>
              <p className="text-xs text-white/40 mt-1">Total pipeline</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Avg Quote</p>
              <p className="text-2xl font-bold text-white mt-1">{formatCurrency(currentMonthData?.avgQuoteValue || 0)}</p>
              <p className="text-xs text-white/40 mt-1">Per quote</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Won Jobs</p>
              <p className="text-2xl font-bold text-emerald-200 mt-1">{currentMonthData?.wonJobs || 0}</p>
              <p className="text-xs text-white/40 mt-1">Closed deals</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Completed</p>
              <p className="text-2xl font-bold text-teal-200 mt-1">{currentMonthData?.completedJobs || 0}</p>
              <p className="text-xs text-white/40 mt-1">Jobs finished</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-white/50 uppercase tracking-wider">Avg Lead→Call</p>
              <p className="text-2xl font-bold text-amber-200 mt-1">
                {currentMonthData?.avgLeadToCall ? `${currentMonthData.avgLeadToCall.toFixed(0)}m` : 'N/A'}
              </p>
              <p className="text-xs text-white/40 mt-1">Response time</p>
            </div>
          </div>
        </section>

        {/* Performance Summary */}
        <section className="rounded-2xl bg-gradient-to-br from-emerald-900/20 to-teal-900/20 border border-emerald-500/20 p-6">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Performance Summary
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-emerald-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Revenue Performance</p>
                <p className="text-xs text-white/50 mt-1">
                  {currentMonthData && compareMonthData
                    ? currentMonthData.wonValue >= compareMonthData.wonValue
                      ? `Up ${formatCurrency(currentMonthData.wonValue - compareMonthData.wonValue)} vs last period`
                      : `Down ${formatCurrency(compareMonthData.wonValue - currentMonthData.wonValue)} vs last period`
                    : 'Comparing month data...'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-cyan-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Lead Quality</p>
                <p className="text-xs text-white/50 mt-1">
                  {currentMonthData
                    ? `${formatPercent(currentMonthData.conversionRate)} of leads convert to won jobs`
                    : 'Calculating...'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-amber-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Profitability</p>
                <p className="text-xs text-white/50 mt-1">
                  {currentMonthData && currentMonthData.wonValue > 0
                    ? `${formatPercent((currentMonthData.totalProfit / currentMonthData.wonValue) * 100)} profit margin on won jobs`
                    : 'Calculating...'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="text-center text-white/40 text-sm pt-8 border-t border-white/5">
          <p>
            Business Analytics Dashboard • Data refreshed in real-time from Supabase
          </p>
        </footer>
      </div>
    </div>
  )
}
