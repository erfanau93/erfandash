import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfDay,
  endOfDay,
  startOfMonth,
  endOfMonth,
  isWithinInterval,
  subDays,
  subWeeks,
  subMonths,
} from 'date-fns'
import { supabase } from '../lib/supabase'
import { playSaveSound } from '../lib/sounds'

interface BookingOccurrence {
  id: string
  series_id: string
  quote_id?: string | null
  start_at: string
  end_at: string
  status: string
  cleaner_id: string | null
}

interface BookingSeries {
  id: string
  lead_id?: string | null
  quote_id: string | null
  title: string
}

interface Cleaner {
  id: string
  full_name: string
}

interface Quote {
  id: string
  total_inc_gst: number | null
  customer_name: string | null
  cleaner_pay: number | null
  share_token?: string | null
}

interface CleanerPayout {
  id: string
  occurrence_id: string
  cleaner_id: string
  job_total: number
  payout_amount: number
  profit: number
  paid_at: string | null
  paid_by: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

type PayoutRow = {
  occurrence: BookingOccurrence
  series: BookingSeries
  quote: Quote | null
  cleaner: Cleaner | null
  payout: CleanerPayout | null
}

type FilterOption = 'all' | 'paid' | 'unpaid'
type PeriodType = 'day' | 'week' | 'month'

export default function CleanersPayout() {
  const [rows, setRows] = useState<PayoutRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<FilterOption>('all')
  const [payoutInputs, setPayoutInputs] = useState<Record<string, string>>({})
  const [periodType, setPeriodType] = useState<PeriodType>('week')
  const [periodStart, setPeriodStart] = useState<Date>(startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [selectedCleanerId, setSelectedCleanerId] = useState<string | null>(null)
  const [cleanerSearch, setCleanerSearch] = useState<string>('')

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const nowIso = new Date().toISOString()

      // Fetch completed occurrences with cleaners assigned
      const { data: occurrences, error: occError } = await supabase
        .from('booking_occurrences')
        .select(`*, series:booking_series(id, lead_id, quote_id, title)`)
        .eq('status', 'completed')
        .not('cleaner_id', 'is', null)
        .order('start_at', { ascending: false })
        .limit(500)

      if (occError) throw occError

      // Fetch past due occurrences (scheduled/skipped jobs that have passed their start date)
      const { data: overdueData, error: overdueErr } = await supabase
        .from('booking_occurrences')
        .select(`*, series:booking_series!inner(id, lead_id, quote_id, title)`)
        .lt('start_at', nowIso)
        .in('status', ['scheduled', 'skipped'])
        .not('cleaner_id', 'is', null)
        .order('start_at', { ascending: false })
        .limit(500)

      if (overdueErr) throw overdueErr

      const allOccurrences = [...(occurrences || []), ...(overdueData || [])]

      if (allOccurrences.length === 0) {
        setRows([])
        setIsLoading(false)
        return
      }

      // Get unique cleaner IDs and quote IDs
      const cleanerIds = Array.from(
        new Set(allOccurrences.map((occ) => occ.cleaner_id).filter(Boolean))
      ) as string[]
      const quoteIds = Array.from(
        new Set(allOccurrences.map((occ) => occ.quote_id || occ.series?.quote_id).filter(Boolean))
      ) as string[]

      // Fetch cleaners
      const cleanersById: Record<string, Cleaner> = {}
      if (cleanerIds.length) {
        const { data: cleaners, error: cleanersError } = await supabase
          .from('cleaners')
          .select('id, full_name')
          .in('id', cleanerIds)

        if (cleanersError) throw cleanersError
        if (cleaners) {
          cleaners.forEach((c) => {
            cleanersById[c.id] = c
          })
        }
      }

      // Fetch quotes
      const quotesById: Record<string, Quote> = {}
      if (quoteIds.length) {
        const { data: quotes, error: quotesError } = await supabase
          .from('quotes')
          .select('id, total_inc_gst, customer_name, cleaner_pay, share_token')
          .in('id', quoteIds)

        if (quotesError) throw quotesError
        if (quotes) {
          quotes.forEach((q) => {
            quotesById[q.id] = q
          })
        }
      }

      // Fetch existing payouts
      const occurrenceIds = allOccurrences.map((occ) => occ.id)
      const { data: payouts, error: payoutsError } = await supabase
        .from('cleaner_payouts')
        .select('*')
        .in('occurrence_id', occurrenceIds)

      if (payoutsError) throw payoutsError

      const payoutsByOccurrence: Record<string, CleanerPayout> = {}
      if (payouts) {
        payouts.forEach((p) => {
          payoutsByOccurrence[p.occurrence_id] = p
        })
      }

      // Create rows and ensure payouts exist
      const rowsToCreate: Array<{
        occurrence_id: string
        cleaner_id: string
        job_total: number
        payout_amount: number
      }> = []

      const mappedRows: PayoutRow[] = allOccurrences.map((occ: any) => {
        const cleanerId = occ.cleaner_id
        const cleaner = cleanerId ? cleanersById[cleanerId] || null : null
        const quoteId = occ.quote_id || occ.series?.quote_id
        const quote = quoteId ? quotesById[quoteId] || null : null
        const jobTotal = quote?.total_inc_gst || 0
        const existingPayout = payoutsByOccurrence[occ.id]

        // If no payout exists, prepare to create one
        if (!existingPayout && cleanerId) {
          // Default payout amount: use cleaner_pay from quote if available, otherwise 0
          const defaultPayout = quote?.cleaner_pay || 0
          rowsToCreate.push({
            occurrence_id: occ.id,
            cleaner_id: cleanerId,
            job_total: jobTotal,
            payout_amount: defaultPayout,
          })
        }

        return {
          occurrence: occ as BookingOccurrence,
          series: occ.series as BookingSeries,
          quote,
          cleaner,
          payout: existingPayout || null,
        }
      })

      // Create missing payouts
      if (rowsToCreate.length > 0) {
        const { error: createError } = await supabase.from('cleaner_payouts').insert(rowsToCreate)
        if (createError) {
          console.error('Error creating payouts:', createError)
          // Continue anyway - we'll fetch them next time
        } else {
          // Refetch payouts after creation
          const { data: newPayouts, error: refetchError } = await supabase
            .from('cleaner_payouts')
            .select('*')
            .in('occurrence_id', rowsToCreate.map((r) => r.occurrence_id))

          if (!refetchError && newPayouts) {
            newPayouts.forEach((p) => {
              payoutsByOccurrence[p.occurrence_id] = p
            })
            // Update rows with new payouts
            mappedRows.forEach((row) => {
              const payout = payoutsByOccurrence[row.occurrence.id]
              if (payout) {
                row.payout = payout
              }
            })
          }
        }
      }

      // Initialize payout inputs from existing payouts or quote cleaner_pay
      const inputs: Record<string, string> = {}
      mappedRows.forEach((row) => {
        if (row.payout) {
          inputs[row.occurrence.id] = row.payout.payout_amount.toString()
        } else if (row.quote?.cleaner_pay !== null && row.quote?.cleaner_pay !== undefined) {
          // Initialize with quote cleaner_pay if payout doesn't exist yet
          inputs[row.occurrence.id] = row.quote.cleaner_pay.toString()
        }
      })
      setPayoutInputs((prev) => ({ ...prev, ...inputs }))

      setRows(mappedRows)
    } catch (err: any) {
      console.error('Failed to load cleaner payouts', err)
      setError(err?.message || 'Failed to load cleaner payouts')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const handleUpdatePayout = async (occurrenceId: string, payoutAmount: number) => {
    setSavingId(occurrenceId)
    setError(null)
    setInfoMessage(null)

    try {
      const row = rows.find((r) => r.occurrence.id === occurrenceId)
      if (!row || !row.payout) {
        throw new Error('Payout record not found')
      }

      const { error: updateError } = await supabase
        .from('cleaner_payouts')
        .update({ payout_amount: payoutAmount })
        .eq('id', row.payout.id)

      if (updateError) throw updateError

      // Update local state
      setRows((prev) =>
        prev.map((r) =>
          r.occurrence.id === occurrenceId && r.payout
            ? {
                ...r,
                payout: {
                  ...r.payout,
                  payout_amount: payoutAmount,
                  profit: r.payout.job_total - payoutAmount,
                },
              }
            : r
        )
      )

      setInfoMessage('Payout amount updated')
      playSaveSound()
    } catch (err: any) {
      console.error('Failed to update payout', err)
      setError(err?.message || 'Failed to update payout amount')
    } finally {
      setSavingId(null)
    }
  }

  const handleMarkPaid = async (occurrenceId: string) => {
    setSavingId(occurrenceId)
    setError(null)
    setInfoMessage(null)

    try {
      const row = rows.find((r) => r.occurrence.id === occurrenceId)
      if (!row || !row.payout) {
        throw new Error('Payout record not found')
      }

      const isPaid = row.payout.paid_at !== null
      const { error: updateError } = await supabase
        .from('cleaner_payouts')
        .update({
          paid_at: isPaid ? null : new Date().toISOString(),
          paid_by: isPaid ? null : 'admin',
        })
        .eq('id', row.payout.id)

      if (updateError) throw updateError

      // Update local state
      setRows((prev) =>
        prev.map((r) =>
          r.occurrence.id === occurrenceId && r.payout
            ? {
                ...r,
                payout: {
                  ...r.payout,
                  paid_at: isPaid ? null : new Date().toISOString(),
                  paid_by: isPaid ? null : 'admin',
                },
              }
            : r
        )
      )

      setInfoMessage(isPaid ? 'Marked as unpaid' : 'Marked as paid')
      playSaveSound()
    } catch (err: any) {
      console.error('Failed to update paid status', err)
      setError(err?.message || 'Failed to update paid status')
    } finally {
      setSavingId(null)
    }
  }

  const filteredRows = useMemo(() => {
    let filtered = rows

    // Filter by payment status
    if (filter === 'paid') {
      filtered = filtered.filter((r) => r.payout?.paid_at !== null)
    } else if (filter === 'unpaid') {
      filtered = filtered.filter((r) => r.payout?.paid_at === null)
    }

    // Filter by cleaner
    if (selectedCleanerId) {
      filtered = filtered.filter((r) => r.cleaner?.id === selectedCleanerId)
    }

    // Filter by period
    let periodStartDate: Date
    let periodEndDate: Date

    if (periodType === 'day') {
      periodStartDate = startOfDay(periodStart)
      periodEndDate = endOfDay(periodStart)
    } else if (periodType === 'week') {
      periodStartDate = startOfWeek(periodStart, { weekStartsOn: 1 })
      periodEndDate = endOfWeek(periodStart, { weekStartsOn: 1 })
    } else {
      // month
      periodStartDate = startOfMonth(periodStart)
      periodEndDate = endOfMonth(periodStart)
    }

    filtered = filtered.filter((r) => {
      const jobDate = new Date(r.occurrence.start_at)
      return isWithinInterval(jobDate, { start: periodStartDate, end: periodEndDate })
    })

    return filtered.sort((a, b) => {
      return new Date(b.occurrence.start_at).getTime() - new Date(a.occurrence.start_at).getTime()
    })
  }, [rows, filter, periodType, periodStart, selectedCleanerId])

  const totals = useMemo(() => {
    const total = filteredRows.reduce((sum, r) => {
      const jobTotal = r.payout?.job_total || r.quote?.total_inc_gst || 0
      return sum + jobTotal
    }, 0)

    const totalPayouts = filteredRows.reduce((sum, r) => {
      // Use payout_amount if set, otherwise use cleaner_pay from quote, otherwise 0
      const payoutAmount = r.payout?.payout_amount ?? r.quote?.cleaner_pay ?? 0
      return sum + payoutAmount
    }, 0)

    const totalProfit = filteredRows.reduce((sum, r) => {
      return sum + (r.payout?.profit || 0)
    }, 0)

    const paidCount = filteredRows.filter((r) => r.payout?.paid_at !== null).length
    const unpaidCount = filteredRows.filter((r) => r.payout?.paid_at === null).length

    return {
      total,
      totalPayouts,
      totalProfit,
      paidCount,
      unpaidCount,
      margin: total > 0 ? (totalProfit / total) * 100 : 0,
    }
  }, [filteredRows])

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
    }).format(amount)
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Cleaners Payout</h1>
            <p className="text-[var(--color-text-muted)] mt-1">
              Track cleaner payments, margins, and payouts for completed jobs.
            </p>
          </div>
          <button
            onClick={fetchData}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/40"
          >
            Refresh
          </button>
        </header>

        {/* Period selector */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--color-text-muted)]">Period:</label>
          <select
            value={periodType}
            onChange={(e) => {
              const newType = e.target.value as PeriodType
              setPeriodType(newType)
              const now = new Date()
              if (newType === 'day') {
                setPeriodStart(startOfDay(now))
              } else if (newType === 'week') {
                setPeriodStart(startOfWeek(now, { weekStartsOn: 1 }))
              } else {
                setPeriodStart(startOfMonth(now))
              }
            }}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="day">Daily</option>
            <option value="week">Weekly</option>
            <option value="month">Monthly</option>
          </select>

          {periodType === 'day' && (
            <>
              <input
                type="date"
                value={format(periodStart, 'yyyy-MM-dd')}
                onChange={(e) => {
                  const date = new Date(e.target.value)
                  if (!isNaN(date.getTime())) {
                    setPeriodStart(startOfDay(date))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                onClick={() => setPeriodStart(startOfDay(new Date()))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                Today
              </button>
              <button
                onClick={() => setPeriodStart(startOfDay(subDays(new Date(), 1)))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                Yesterday
              </button>
            </>
          )}

          {periodType === 'week' && (
            <>
              <input
                type="date"
                value={format(periodStart, 'yyyy-MM-dd')}
                onChange={(e) => {
                  const date = new Date(e.target.value)
                  if (!isNaN(date.getTime())) {
                    setPeriodStart(startOfWeek(date, { weekStartsOn: 1 }))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                onClick={() => setPeriodStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                This Week
              </button>
              <button
                onClick={() => setPeriodStart(startOfWeek(subWeeks(new Date(), 1), { weekStartsOn: 1 }))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                Last Week
              </button>
              <span className="text-sm text-[var(--color-text-muted)]">
                ({format(periodStart, 'MMM d')} - {format(endOfWeek(periodStart, { weekStartsOn: 1 }), 'MMM d, yyyy')})
              </span>
            </>
          )}

          {periodType === 'month' && (
            <>
              <input
                type="month"
                value={format(periodStart, 'yyyy-MM')}
                onChange={(e) => {
                  const date = new Date(e.target.value + '-01')
                  if (!isNaN(date.getTime())) {
                    setPeriodStart(startOfMonth(date))
                  }
                }}
                className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
              />
              <button
                onClick={() => setPeriodStart(startOfMonth(new Date()))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                This Month
              </button>
              <button
                onClick={() => setPeriodStart(startOfMonth(subMonths(new Date(), 1)))}
                className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
              >
                Last Month
              </button>
              <span className="text-sm text-[var(--color-text-muted)]">
                {format(periodStart, 'MMMM yyyy')}
              </span>
            </>
          )}
        </div>

        {/* Cleaner filter */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--color-text-muted)]">Filter by cleaner:</label>
          <input
            type="text"
            placeholder="Search cleaner..."
            value={cleanerSearch}
            onChange={(e) => {
              setCleanerSearch(e.target.value)
              if (!e.target.value.trim()) {
                setSelectedCleanerId(null)
              }
            }}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          {cleanerSearch && (
            <div className="flex flex-wrap gap-2">
              {rows
                .map((r) => r.cleaner)
                .filter((c, idx, arr) => c && arr.findIndex((x) => x?.id === c.id) === idx)
                .filter((c) => c && c.full_name.toLowerCase().includes(cleanerSearch.toLowerCase()))
                .map((c) => (
                  <button
                    key={c!.id}
                    onClick={() => {
                      setSelectedCleanerId(c!.id)
                      setCleanerSearch(c!.full_name)
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      selectedCleanerId === c!.id
                        ? 'bg-cyan-500/20 text-cyan-100 border-cyan-400/50'
                        : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
                    }`}
                  >
                    {c!.full_name}
                  </button>
                ))}
            </div>
          )}
          {selectedCleanerId && (
            <button
              onClick={() => {
                setSelectedCleanerId(null)
                setCleanerSearch('')
              }}
              className="px-3 py-1.5 rounded-lg text-sm bg-red-500/20 hover:bg-red-500/30 text-red-100 border border-red-400/50"
            >
              Clear
            </button>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="glass-card rounded-xl p-4 border border-white/10">
            <p className="text-sm text-[var(--color-text-muted)]">Total Revenue</p>
            <p className="text-3xl font-bold text-white">{formatCurrency(totals.total)}</p>
          </div>
          <div className="glass-card rounded-xl p-4 border border-white/10">
            <p className="text-sm text-[var(--color-text-muted)]">Total Payouts</p>
            <p className="text-3xl font-bold text-white">{formatCurrency(totals.totalPayouts)}</p>
          </div>
          <div className="glass-card rounded-xl p-4 border border-white/10">
            <p className="text-sm text-[var(--color-text-muted)]">Total Profit</p>
            <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totals.totalProfit)}</p>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">
              Margin: {totals.margin.toFixed(1)}%
            </p>
          </div>
          <div className="glass-card rounded-xl p-4 border border-white/10">
            <p className="text-sm text-[var(--color-text-muted)]">Status</p>
            <p className="text-lg font-semibold text-white">
              {totals.paidCount} paid / {totals.unpaidCount} unpaid
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--color-text-muted)]">Filter:</label>
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              filter === 'all'
                ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/50'
                : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
            }`}
          >
            All ({rows.length})
          </button>
          <button
            onClick={() => setFilter('paid')}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              filter === 'paid'
                ? 'bg-emerald-500/20 text-emerald-100 border-emerald-400/50'
                : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
            }`}
          >
            Paid ({totals.paidCount})
          </button>
          <button
            onClick={() => setFilter('unpaid')}
            className={`px-3 py-2 rounded-lg text-sm border transition-colors ${
              filter === 'unpaid'
                ? 'bg-amber-500/20 text-amber-100 border-amber-400/50'
                : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
            }`}
          >
            Unpaid ({totals.unpaidCount})
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}
        {infoMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">
            {infoMessage}
          </div>
        )}

        {/* Cleaner-specific summary */}
        {selectedCleanerId && filteredRows.length > 0 && (
          <div className="glass-card rounded-xl p-4 border border-cyan-500/30 bg-cyan-500/5">
            <p className="text-sm text-[var(--color-text-muted)] mb-2">
              Summary for {filteredRows[0]?.cleaner?.full_name || 'Selected Cleaner'}
            </p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Total Payout</p>
                <p className="text-2xl font-bold text-white">{formatCurrency(totals.totalPayouts)}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Jobs Count</p>
                <p className="text-2xl font-bold text-white">{filteredRows.length}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">Paid/Unpaid</p>
                <p className="text-lg font-semibold text-white">
                  {totals.paidCount} / {totals.unpaidCount}
                </p>
              </div>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="glass-card rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            Loading cleaner payouts...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            {selectedCleanerId
              ? 'No jobs found for selected cleaner in this period.'
              : `No completed jobs with cleaners assigned for this ${periodType}.`}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredRows.map((row) => {
              const { occurrence, series, quote, cleaner, payout } = row
              const jobTotal = payout?.job_total || quote?.total_inc_gst || 0
              // Use payout_amount if exists, otherwise use cleaner_pay from quote, otherwise 0
              const payoutAmount = payout?.payout_amount ?? quote?.cleaner_pay ?? 0
              const profit = payout?.profit ?? (jobTotal - payoutAmount)
              const isPaid = payout?.paid_at !== null
              const payoutInput = payoutInputs[occurrence.id] ?? payoutAmount.toString()

              return (
                <div
                  key={occurrence.id}
                  className={`glass-card rounded-2xl p-4 md:p-5 border ${
                    isPaid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-white/10'
                  }`}
                >
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    {/* Job Info */}
                    <div className="md:col-span-4 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-white">
                          {quote?.customer_name || 'Customer'} — {series.title}
                        </h3>
                        {isPaid && (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-400/50">
                            Paid
                          </span>
                        )}
                        {occurrence.status !== 'completed' && (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-amber-500/20 text-amber-100 border border-amber-400/50">
                            Past Due ({occurrence.status})
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {format(new Date(occurrence.start_at), 'EEE, MMM d • h:mm a')}
                      </p>
                      {cleaner && (
                        <p className="text-sm font-medium text-cyan-300">{cleaner.full_name}</p>
                      )}
                    </div>

                    {/* Financials */}
                    <div className="md:col-span-6 grid grid-cols-3 gap-3">
                      <div>
                        <p className="text-xs text-[var(--color-text-muted)] mb-1">Job Total</p>
                        <p className="text-lg font-semibold text-white">{formatCurrency(jobTotal)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-text-muted)] mb-1">Payout Amount</p>
                        <div className="flex items-center gap-2">
                          <span className="text-lg">$</span>
                          <input
                            type="number"
                            step="0.01"
                            value={payoutInput}
                            onChange={(e) => {
                              setPayoutInputs((prev) => ({ ...prev, [occurrence.id]: e.target.value }))
                            }}
                            onBlur={() => {
                              const parsed = parseFloat(payoutInput)
                              if (!isNaN(parsed) && parsed >= 0 && parsed !== payoutAmount) {
                                handleUpdatePayout(occurrence.id, parsed)
                              } else {
                                // Reset to current value if invalid
                                setPayoutInputs((prev) => ({
                                  ...prev,
                                  [occurrence.id]: payoutAmount.toString(),
                                }))
                              }
                            }}
                            disabled={savingId === occurrence.id}
                            className="w-full px-2 py-1 rounded bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-50"
                          />
                        </div>
                        {quote?.cleaner_pay !== null && quote?.cleaner_pay !== undefined && (
                          <p className="text-xs text-[var(--color-text-muted)] mt-1">
                            Guide: {formatCurrency(quote.cleaner_pay)}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-[var(--color-text-muted)] mb-1">Profit</p>
                        <p className={`text-lg font-semibold ${profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatCurrency(profit)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="md:col-span-2 flex flex-col gap-2">
                      <button
                        onClick={() => handleMarkPaid(occurrence.id)}
                        disabled={savingId === occurrence.id || !payout}
                        className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                          isPaid
                            ? 'bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-100 border-emerald-400/50'
                            : 'bg-amber-600/20 hover:bg-amber-600/30 text-amber-100 border-amber-400/50'
                        } disabled:opacity-50`}
                      >
                        {isPaid ? 'Mark Unpaid' : 'Mark Paid'}
                      </button>
                      {isPaid && payout?.paid_at && (
                        <p className="text-xs text-[var(--color-text-muted)]">
                          Paid: {format(new Date(payout.paid_at), 'MMM d, h:mm a')}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-2 pt-2">
                        {quote?.share_token && (
                          <a
                            href={`${window.location.origin}?quote=${quote.share_token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
                          >
                            View quote
                          </a>
                        )}
                        {quote?.id && (series.lead_id || series.lead_id === null || series.lead_id === undefined) && (
                          <a
                            href={`/?lead=${series.lead_id ?? ''}&editQuote=${quote.id}&return=/cleaners-payout`}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-100 text-sm border border-blue-400/40"
                          >
                            Edit quote
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

