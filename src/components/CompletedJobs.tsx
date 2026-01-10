import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { supabase } from '../lib/supabase'
import PaymentReminderSms from './PaymentReminderSms'
import ReviewReminderSms from './ReviewReminderSms'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://etiaoqskgplpfydblzne.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aWFvcXNrZ3BscGZ5ZGJsem5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzI0NzAsImV4cCI6MjA4MjgwODQ3MH0.c-AlsveEx_bxVgEivga3PRrBp5ylY3He9EJXbaa2N2c'

const dialpadUserId = '6452247499866112'
const dialpadToken =
  'NNRYnLXqJgkWXePcCG2SGCVzHfuB6kxAqQATPvnmn3x6k5RevHUCPdF8zF8jqXsssuyG67bEALxZH9TACsq4aARA46VL4yZ246Kf'
const dialpadCallUrl = `https://dialpad.com/api/v2/users/${dialpadUserId}/initiate_call`
const googleReviewUrl =
  import.meta.env.VITE_GOOGLE_REVIEW_URL ||
  'https://g.page/r/CleaningReview' // TODO: replace with the actual review link

const SCHEMA_MIGRATION_HINT =
  'Payment columns are missing on booking_occurrences. Please run the latest Supabase migrations (see supabase/migrations/20260108_booking_payments_patch2.sql) and refresh.'

function formatPaymentSchemaError(message?: string | null) {
  if (!message) return null
  if (message.toLowerCase().includes('payment_amount_cents') || message.toLowerCase().includes('schema cache')) {
    return `${message}. ${SCHEMA_MIGRATION_HINT}`
  }
  return message
}

type PaymentStatus = 'waiting_payment' | 'invoice_sent' | 'paid'

interface BookingSeries {
  id: string
  lead_id: string
  title: string
  timezone: string
  starts_at: string
  duration_minutes: number
  rrule: string | null
  status: string
  notes: string | null
  lead?: Lead | null
}

interface BookingOccurrence {
  id: string
  series_id: string
  start_at: string
  end_at: string
  status: string
  notes: string | null
  original_start_at: string | null
  payment_status?: PaymentStatus | null
  payment_link?: string | null
  payment_amount_cents?: number | null
  payment_notes?: string | null
  payment_paid_at?: string | null
}

interface Lead {
  id: string
  name: string | null
  email: string | null
  phone_number: string | null
  region_notes: string | null
}

interface QuoteRecord {
  id: string
  lead_id: string | null
  customer_name?: string | null
  customer_email?: string | null
  customer_phone?: string | null
  total_inc_gst?: number | null
  share_token?: string | null
  quote_number?: string | null
  service?: string | null
  accepted_payment_method?: string | null
}

type CompletedRow = {
  occurrence: BookingOccurrence
  series: BookingSeries
  lead: Lead | null
  quote?: QuoteRecord | null
}

type SmsTone = 'friendly' | 'neutral' | 'firm' | string

type PaymentSmsLog = {
  id: string
  occurrence_id: string
  template_id?: string | null
  body: string
  tone?: SmsTone | null
  amount_cents?: number | null
  sent_at: string
}


const PAYMENT_STYLES: Record<PaymentStatus, { label: string; badge: string; bg: string }> = {
  waiting_payment: {
    label: 'Waiting payment',
    badge: 'bg-amber-500/20 text-amber-100 border border-amber-400/40',
    bg: 'bg-amber-500/5',
  },
  invoice_sent: {
    label: 'Invoice sent',
    badge: 'bg-cyan-500/20 text-cyan-100 border border-cyan-400/40',
    bg: 'bg-cyan-500/5',
  },
  paid: {
    label: 'Paid',
    badge: 'bg-emerald-500/20 text-emerald-100 border border-emerald-400/50',
    bg: 'bg-emerald-500/5',
  },
}

function StatusPill({ status }: { status: PaymentStatus }) {
  const style = PAYMENT_STYLES[status]
  return (
    <span className={`inline-flex items-center px-2.5 py-1 text-xs rounded-full ${style.badge}`}>
      {style.label}
    </span>
  )
}

type PaymentFilter = 'all' | 'paid' | 'awaiting_payment'

type SortOption = 'date_desc' | 'date_asc' | 'name_asc' | 'name_desc' | 'amount_desc' | 'amount_asc'

export default function CompletedJobs() {
  const [rows, setRows] = useState<CompletedRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({})
  const [infoMessage, setInfoMessage] = useState<string | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [callingId, setCallingId] = useState<string | null>(null)
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('date_desc')

  const [paymentLogs, setPaymentLogs] = useState<Record<string, PaymentSmsLog | null>>({})
  const [lastCalls, setLastCalls] = useState<Record<string, string | null>>({})
  const [notesInputs, setNotesInputs] = useState<Record<string, string>>({})
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null)

  // SMS templates are handled inside PaymentReminderSms / ReviewReminderSms components.

  const getAmountCentsForRow = useCallback(
    (row: CompletedRow) => {
      const manualInput = amountInputs[row.occurrence.id]
      if (manualInput) {
        const parsed = Number.parseFloat(manualInput)
        if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed * 100)
      }
      if (
        row.occurrence.payment_amount_cents !== undefined &&
        row.occurrence.payment_amount_cents !== null &&
        Number.isFinite(row.occurrence.payment_amount_cents)
      ) {
        return row.occurrence.payment_amount_cents
      }
      if (row.quote?.total_inc_gst !== undefined && row.quote?.total_inc_gst !== null) {
        const value = Number(row.quote.total_inc_gst)
        if (Number.isFinite(value)) return Math.round(value * 100)
      }
      return null
    },
    [amountInputs]
  )

  const getDisplayStatus = useCallback(
    (row: CompletedRow): PaymentStatus => {
      const quotePaid = row.quote?.accepted_payment_method === 'card_paid'
      if (row.occurrence.payment_status === 'paid' || quotePaid) return 'paid'
      const status = (row.occurrence.payment_status as PaymentStatus) || 'waiting_payment'
      return status
    },
    []
  )

  const loadSmsMetadata = useCallback(
    async (occurrenceIds: string[]) => {
      if (!occurrenceIds.length) return
      try {
        const { data: payLogs, error: payLogsErr } = await supabase
          .from('payment_sms_logs')
          .select('*')
          .in('occurrence_id', occurrenceIds)
          .order('sent_at', { ascending: false })

        if (payLogsErr) throw payLogsErr

        const payLatest: Record<string, PaymentSmsLog | null> = {}
        for (const log of (payLogs || []) as PaymentSmsLog[]) {
          if (!payLatest[log.occurrence_id]) {
            payLatest[log.occurrence_id] = log
          }
        }
        setPaymentLogs(payLatest)
      } catch (err: any) {
        console.error('Failed to load SMS templates/logs', err)
        setError(err?.message || 'Could not load SMS templates')
      }
    },
    []
  )

  const loadLastCalls = useCallback(async (rows: CompletedRow[]) => {
    try {
      const phoneNumbers = Array.from(
        new Set(rows.map((r) => r.lead?.phone_number).filter(Boolean))
      ) as string[]

      if (!phoneNumbers.length) return

      const callsMap: Record<string, string | null> = {}
      
      // Query dialpad_calls for each phone number
      const callPromises = phoneNumbers.map(async (phone) => {
        const { data: calls } = await supabase
          .from('dialpad_calls')
          .select('created_at, external_number')
          .or(`external_number.eq.${phone},external_number.eq.+${phone}`)
          .order('created_at', { ascending: false })
          .limit(1)

        if (calls && calls.length > 0) {
          callsMap[phone] = calls[0].created_at
        }
      })

      await Promise.all(callPromises)

      // Map phone numbers to occurrence IDs
      const lastCallsByOccurrence: Record<string, string | null> = {}
      rows.forEach((row) => {
        if (row.lead?.phone_number && callsMap[row.lead.phone_number]) {
          lastCallsByOccurrence[row.occurrence.id] = callsMap[row.lead.phone_number]
        }
      })

      setLastCalls((prev) => ({ ...prev, ...lastCallsByOccurrence }))
    } catch (err) {
      console.error('Failed to load last calls', err)
    }
  }, [])

  const fetchCompleted = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: occError } = await supabase
        .from('booking_occurrences')
        .select(`*, series:booking_series(*, lead:extracted_leads(*))`)
        .eq('status', 'completed')
        .order('start_at', { ascending: false })
        .limit(200)

      if (occError) throw occError

      const occurrences = (data || []) as any[]
      const leadIds = Array.from(
        new Set(
          occurrences
            .map((occ) => occ?.series?.lead?.id)
            .filter(Boolean)
        )
      )

      let latestQuotes: Record<string, QuoteRecord> = {}
      if (leadIds.length) {
        const { data: quotes, error: quotesError } = await supabase
          .from('quotes')
          .select(
            'id, lead_id, customer_name, customer_email, customer_phone, total_inc_gst, share_token, quote_number, service, accepted_payment_method'
          )
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false })

        if (!quotesError && quotes) {
          for (const quote of quotes as QuoteRecord[]) {
            if (quote.lead_id && !latestQuotes[quote.lead_id]) {
              latestQuotes[quote.lead_id] = quote
            }
          }
        }
      }

      const mapped: CompletedRow[] = occurrences.map((occ) => {
        const series = occ.series as BookingSeries
        const lead = (series?.lead as Lead) || null
        const quote = lead?.id ? latestQuotes[lead.id] : null
        return {
          occurrence: occ as BookingOccurrence,
          series,
          lead,
          quote,
        }
      })

      setRows(mapped)
      
      // Initialize notes inputs from occurrence notes
      const notesMap: Record<string, string> = {}
      mapped.forEach((row) => {
        if (row.occurrence.notes) {
          notesMap[row.occurrence.id] = row.occurrence.notes
        }
      })
      setNotesInputs((prev) => ({ ...prev, ...notesMap }))

      const occurrenceIds = mapped.map((m) => m.occurrence.id)
      if (occurrenceIds.length) {
        await loadSmsMetadata(occurrenceIds)
        await loadLastCalls(mapped)
      }
    } catch (err: any) {
      console.error('Failed to load completed jobs', err)
      setError(err?.message || 'Failed to load completed jobs')
    } finally {
      setIsLoading(false)
    }
  }, [loadSmsMetadata, loadLastCalls])

  useEffect(() => {
    fetchCompleted()
  }, [fetchCompleted])

  const handleCallCustomer = async (row: CompletedRow) => {
    const phoneNumber = row.lead?.phone_number
    if (!phoneNumber) {
      setCallError('No phone number available for this booking.')
      return
    }
    setCallError(null)
    setInfoMessage(null)
    setCallingId(row.occurrence.id)
    try {
      const response = await fetch(dialpadCallUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${dialpadToken}`,
        },
        body: JSON.stringify({ phone_number: phoneNumber }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.error) {
        const details = result?.error || `Failed to initiate call (status ${response.status})`
        throw new Error(details)
      }
      setInfoMessage(`Calling ${phoneNumber}...`)
      // Update last call time optimistically
      setLastCalls((prev) => ({ ...prev, [row.occurrence.id]: new Date().toISOString() }))
    } catch (err: any) {
      console.error('Call error', err)
      setCallError(err?.message || 'Failed to initiate call')
    } finally {
      setCallingId(null)
    }
  }

  const handleSaveNotes = async (occurrenceId: string, notes: string) => {
    setSavingNotesId(occurrenceId)
    try {
      const { error: updateError } = await supabase
        .from('booking_occurrences')
        .update({ notes: notes.trim() || null })
        .eq('id', occurrenceId)

      if (updateError) throw updateError

      setRows((prev) =>
        prev.map((r) =>
          r.occurrence.id === occurrenceId
            ? { ...r, occurrence: { ...r.occurrence, notes: notes.trim() || null } }
            : r
        )
      )
      setInfoMessage('Notes saved')
    } catch (err: any) {
      console.error('Failed to save notes', err)
      setError(err?.message || 'Could not save notes')
    } finally {
      setSavingNotesId(null)
    }
  }

  const handlePaymentStatus = async (id: string, status: PaymentStatus) => {
    setUpdatingId(id)
    setInfoMessage(null)
    const row = rows.find((r) => r.occurrence.id === id)
    const amountCents = row ? getAmountCentsForRow(row) : null
    const payload: Record<string, any> = { payment_status: status }
    if (amountCents) payload.payment_amount_cents = amountCents
    if (status === 'paid') {
      payload.payment_paid_at = new Date().toISOString()
      payload.payment_notes = `Marked paid manually on ${new Date().toLocaleString()}`
    }

    try {
      const { error: updateError } = await supabase
        .from('booking_occurrences')
        .update(payload)
        .eq('id', id)

      if (updateError) throw updateError

      setRows((prev) =>
        prev.map((row) =>
          row.occurrence.id === id
            ? { ...row, occurrence: { ...row.occurrence, payment_status: status } }
            : row
        )
      )
      setInfoMessage(status === 'paid' ? 'Marked as paid (manual)' : 'Payment status updated')
    } catch (err: any) {
      console.error('Failed to update payment status', err)
      setError(formatPaymentSchemaError(err?.message) || err?.message || 'Could not update payment status')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleCreatePaymentLink = async (row: CompletedRow) => {
    const { occurrence, series, lead, quote } = row
    const amountValue =
      amountInputs[occurrence.id] ||
      (quote?.total_inc_gst ? quote.total_inc_gst.toString() : '') ||
      ''

    const parsed = Number.parseFloat(amountValue)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount to generate a link')
      return
    }
    const amountCents = Math.round(parsed * 100)

    setUpdatingId(occurrence.id)
    setError(null)
    setInfoMessage(null)

    try {
      const description =
        series.title || quote?.service || `Cleaning for ${lead?.name || 'customer'}`
      const response = await fetch(`${supabaseUrl}/functions/v1/create-payment-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({
          amount_cents: amountCents,
          currency: 'aud',
          customerName: lead?.name || '',
          customerEmail: lead?.email || '',
          description,
          success_url: `${window.location.origin}/payment-success`,
          cancel_url: `${window.location.origin}/payment-cancel`,
        }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok || !data?.url) {
        throw new Error(data?.error || 'Failed to create Stripe link')
      }

      const { error: updateError } = await supabase
        .from('booking_occurrences')
        .update({
          payment_link: data.url,
          payment_status: 'invoice_sent',
          payment_amount_cents: amountCents,
        })
        .eq('id', occurrence.id)

      if (updateError) throw updateError

      setRows((prev) =>
        prev.map((r) =>
          r.occurrence.id === occurrence.id
            ? {
                ...r,
                occurrence: {
                  ...r.occurrence,
                  payment_link: data.url,
                  payment_status: 'invoice_sent',
                  payment_amount_cents: amountCents,
                },
              }
            : r
        )
      )
      setInfoMessage('Payment link created')
    } catch (err: any) {
      console.error('Stripe link error', err)
      setError(formatPaymentSchemaError(err?.message) || err?.message || 'Could not create payment link')
    } finally {
      setUpdatingId(null)
    }
  }

  const handleCopyLink = async (link?: string | null) => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setInfoMessage('Payment link copied to clipboard')
    } catch (err) {
      console.error('Copy failed', err)
      setError('Could not copy link, copy manually instead.')
    }
  }

  const shareUrlForQuote = useCallback((quote?: QuoteRecord | null) => {
    if (!quote?.share_token) return null
    const url = new URL(window.location.href)
    url.searchParams.set('quote', quote.share_token)
    return url.toString()
  }, [])

  const totalPaid = useMemo(
    () => rows.filter((r) => getDisplayStatus(r) === 'paid').length,
    [rows, getDisplayStatus]
  )
  const totalAwaiting = useMemo(
    () =>
      rows.filter((r) => {
        const status = getDisplayStatus(r)
        return status === 'waiting_payment'
      }).length,
    [rows, getDisplayStatus]
  )

  const filteredAndSortedRows = useMemo(() => {
    let filtered = rows

    // Apply payment status filter
    if (paymentFilter === 'paid') {
      filtered = filtered.filter((r) => getDisplayStatus(r) === 'paid')
    } else if (paymentFilter === 'awaiting_payment') {
      filtered = filtered.filter((r) => {
        const status = getDisplayStatus(r)
        return status === 'waiting_payment'
      })
    }

    // Apply sorting
    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case 'date_desc':
          return new Date(b.occurrence.start_at).getTime() - new Date(a.occurrence.start_at).getTime()
        case 'date_asc':
          return new Date(a.occurrence.start_at).getTime() - new Date(b.occurrence.start_at).getTime()
        case 'name_asc':
          return (a.lead?.name || '').localeCompare(b.lead?.name || '')
        case 'name_desc':
          return (b.lead?.name || '').localeCompare(a.lead?.name || '')
        case 'amount_desc': {
          const aAmount = getAmountCentsForRow(a) || 0
          const bAmount = getAmountCentsForRow(b) || 0
          return bAmount - aAmount
        }
        case 'amount_asc': {
          const aAmount = getAmountCentsForRow(a) || 0
          const bAmount = getAmountCentsForRow(b) || 0
          return aAmount - bAmount
        }
        default:
          return 0
      }
    })

    return sorted
  }, [rows, paymentFilter, sortBy, getAmountCentsForRow])

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white">Completed jobs</h1>
            <p className="text-[var(--color-text-muted)] mt-1">
              Track completed bookings, payments, and invoices.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={fetchCompleted}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/40"
            >
              Refresh
            </button>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            onClick={() => setPaymentFilter('all')}
            className={`glass-card rounded-xl p-4 border transition-colors text-left ${
              paymentFilter === 'all'
                ? 'border-emerald-400/50 bg-emerald-500/10'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <p className="text-sm text-[var(--color-text-muted)]">Total completed</p>
            <p className="text-3xl font-bold text-white">{rows.length}</p>
          </button>
          <button
            onClick={() => setPaymentFilter('paid')}
            className={`glass-card rounded-xl p-4 border transition-colors text-left ${
              paymentFilter === 'paid'
                ? 'border-emerald-400/50 bg-emerald-500/10'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <p className="text-sm text-[var(--color-text-muted)]">Paid</p>
            <p className="text-3xl font-bold text-white">{totalPaid}</p>
          </button>
          <button
            onClick={() => setPaymentFilter('awaiting_payment')}
            className={`glass-card rounded-xl p-4 border transition-colors text-left ${
              paymentFilter === 'awaiting_payment'
                ? 'border-amber-400/50 bg-amber-500/10'
                : 'border-white/10 hover:border-white/20'
            }`}
          >
            <p className="text-sm text-[var(--color-text-muted)]">Awaiting payment</p>
            <p className="text-3xl font-bold text-white">{totalAwaiting}</p>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-[var(--color-text-muted)]">Sort by:</label>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
          >
            <option value="date_desc">Date (newest first)</option>
            <option value="date_asc">Date (oldest first)</option>
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
            <option value="amount_desc">Amount (high to low)</option>
            <option value="amount_asc">Amount (low to high)</option>
          </select>
          {paymentFilter !== 'all' && (
            <button
              onClick={() => setPaymentFilter('all')}
              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
            >
              Clear filter
            </button>
          )}
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}
        {callError && (
          <div className="p-4 rounded-xl bg-orange-500/10 border border-orange-500/20 text-orange-200 text-sm">
            {callError}
          </div>
        )}
        {infoMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">
            {infoMessage}
          </div>
        )}

        {isLoading ? (
          <div className="glass-card rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            Loading completed jobs...
          </div>
        ) : rows.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            No completed jobs yet.
          </div>
        ) : filteredAndSortedRows.length === 0 ? (
          <div className="glass-card rounded-2xl p-8 text-center text-[var(--color-text-muted)]">
            No jobs match the current filter.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredAndSortedRows.map((row) => {
              const { occurrence, series, lead, quote } = row
              const paymentStatus: PaymentStatus = getDisplayStatus(row)
              const quoteShareUrl = shareUrlForQuote(quote)
              const amountCents = getAmountCentsForRow(row)

              return (
                <div
                  key={occurrence.id}
                  className="glass-card rounded-2xl p-4 md:p-5 border border-white/10"
                >
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-white">
                          {lead?.name || 'Customer'} — {series.title}
                        </h3>
                        <StatusPill status={paymentStatus} />
                        {quote?.accepted_payment_method === 'card_paid' && (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-400/50">
                            Payment made on DB (Stripe)
                          </span>
                        )}
                        {quote?.accepted_payment_method === 'direct_transfer' && (
                          <span className="inline-flex items-center px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-100 border border-emerald-400/50">
                            Payment made on DB (Direct)
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        {format(new Date(occurrence.start_at), 'EEE, MMM d • h:mm a')} –{' '}
                        {format(new Date(occurrence.end_at), 'h:mm a')}
                      </p>
                      {quote?.accepted_payment_method === 'card_paid' && (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-full bg-emerald-600/20 text-emerald-50 border border-emerald-400/40">
                            Quote paid
                          </span>
                        </div>
                      )}
                      {lead?.phone_number && (
                        <p className="text-sm text-[var(--color-text-muted)]">
                          {lead.phone_number}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => handlePaymentStatus(occurrence.id, 'waiting_payment')}
                        disabled={updatingId === occurrence.id}
                        className="px-3 py-1.5 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-white border border-white/10"
                      >
                        Waiting
                      </button>
                      <button
                        onClick={() => handlePaymentStatus(occurrence.id, 'invoice_sent')}
                        disabled={updatingId === occurrence.id}
                        className="px-3 py-1.5 text-xs rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-100 border border-cyan-400/40"
                      >
                        Invoice sent
                      </button>
                      <button
                        onClick={() => handlePaymentStatus(occurrence.id, 'paid')}
                        disabled={updatingId === occurrence.id}
                        className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-100 border border-emerald-400/40"
                      >
                        Mark paid
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
                    <div className="flex-1 space-y-2">
                      <label className="text-xs text-[var(--color-text-muted)]">
                        Invoice amount (AUD)
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={
                            amountInputs[occurrence.id] ||
                            (occurrence.payment_amount_cents
                              ? (occurrence.payment_amount_cents / 100).toFixed(2)
                              : quote?.total_inc_gst?.toString() || '')
                          }
                          onChange={(e) =>
                            setAmountInputs((prev) => ({ ...prev, [occurrence.id]: e.target.value }))
                          }
                          className="w-40 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                        />
                        <button
                          onClick={() => handleCreatePaymentLink(row)}
                          disabled={updatingId === occurrence.id}
                          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm border border-emerald-500/40 disabled:opacity-60"
                        >
                          {updatingId === occurrence.id ? 'Working...' : 'Create payment link'}
                        </button>
                        {occurrence.payment_link && (
                          <>
                            <button
                              onClick={() => handleCopyLink(occurrence.payment_link)}
                              className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
                            >
                              Copy link
                            </button>
                            <a
                              href={occurrence.payment_link}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-2 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-100 text-sm border border-cyan-400/40"
                            >
                              Open link
                            </a>
                          </>
                        )}
                      </div>
                    </div>

                  <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleCallCustomer(row)}
                        disabled={callingId === occurrence.id || !lead?.phone_number}
                        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm border border-emerald-500/40 disabled:opacity-60"
                      >
                        {callingId === occurrence.id ? 'Calling…' : 'Call'}
                      </button>
                      <PaymentReminderSms
                        occurrenceId={occurrence.id}
                        leadName={lead?.name}
                        phoneNumber={lead?.phone_number || undefined}
                        dialpadToken={dialpadToken}
                        dialpadUserId={dialpadUserId}
                        paymentLink={occurrence.payment_link || undefined}
                        quoteLink={quoteShareUrl || undefined}
                        amountCents={amountCents}
                        onSent={() => {
                          setInfoMessage('Payment reminder sent')
                          fetchCompleted()
                        }}
                      />
                      <ReviewReminderSms
                        occurrenceId={occurrence.id}
                        leadName={lead?.name}
                        phoneNumber={lead?.phone_number || undefined}
                        dialpadToken={dialpadToken}
                        dialpadUserId={dialpadUserId}
                        reviewLink={googleReviewUrl}
                        onSent={() => {
                          setInfoMessage('Review reminder sent')
                          fetchCompleted()
                        }}
                      />
                      {quoteShareUrl && (
                        <>
                          <a
                            href={quoteShareUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white text-sm border border-white/10"
                          >
                            View quote
                          </a>
                          {quote?.id && lead?.id && (
                            <a
                              href={`/?lead=${lead.id}&editQuote=${quote.id}`}
                              className="px-3 py-2 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-100 text-sm border border-blue-400/40"
                            >
                              Edit quote
                            </a>
                          )}
                        </>
                      )}
                    </div>

                  </div>

                  {/* Last call and payment reminder info */}
                  <div className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--color-text-muted)]">
                    {lastCalls[occurrence.id] && (
                      <span>
                        Last call: {formatDistanceToNow(new Date(lastCalls[occurrence.id]!), { addSuffix: true })}
                      </span>
                    )}
                    {paymentLogs[occurrence.id] && (
                      <span>
                        Last payment reminder: {formatDistanceToNow(new Date(paymentLogs[occurrence.id]!.sent_at), { addSuffix: true })}
                      </span>
                    )}
                  </div>

                  {/* Notes section */}
                  <div className="mt-3 space-y-2">
                    <label className="text-xs text-[var(--color-text-muted)]">Notes</label>
                    <div className="flex gap-2">
                      <textarea
                        value={notesInputs[occurrence.id] || occurrence.notes || ''}
                        onChange={(e) =>
                          setNotesInputs((prev) => ({ ...prev, [occurrence.id]: e.target.value }))
                        }
                        onBlur={() => {
                          const currentNotes = notesInputs[occurrence.id] || occurrence.notes || ''
                          if (currentNotes !== (occurrence.notes || '')) {
                            handleSaveNotes(occurrence.id, currentNotes)
                          }
                        }}
                        placeholder="Add notes about this job..."
                        className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 resize-none"
                        rows={2}
                      />
                      {savingNotesId === occurrence.id && (
                        <div className="flex items-center px-2 text-xs text-[var(--color-text-muted)]">
                          Saving...
                        </div>
                      )}
                    </div>
                  </div>

                  {quote && (
                    <div className="mt-3 text-xs text-[var(--color-text-muted)] flex flex-wrap gap-3">
                      <span>Quote #: {quote.quote_number || quote.id}</span>
                      {quote.total_inc_gst ? (
                        <span>Total: ${quote.total_inc_gst.toFixed(2)}</span>
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

