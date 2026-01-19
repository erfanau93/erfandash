import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../lib/supabase'

type QuoteRecord = {
  id: string
  lead_id: string | null
  email_id: string | null
  quote_number?: string | null
  address?: string | null
  description?: string | null
  service: string
  bedrooms: number
  bathrooms: number
  addons: string[]
  hourly_rate: number
  cleaner_rate: number
  main_service_hours: number
  add_on_hours: number
  total_hours: number
  subtotal: number
  discount_amount: number
  discount_percentage: number
  net_revenue: number
  gst: number
  total_inc_gst: number
  cleaner_pay: number
  profit: number
  margin: number
  deposit_percentage: number
  deposit_amount: number
  remaining_balance: number
  notes?: string | null
  accepted_at?: string | null
  accepted_payment_method?: string | null
  customer_name?: string | null
  customer_phone?: string | null
  customer_email?: string | null
  share_token?: string | null
  created_at?: string
  // Joined lead data
  lead?: {
    name?: string | null
    phone_number?: string | null
    email?: string | null
    status?: string | null
  }
}

const STATUS_FILTERS = ['All', 'Pending', 'Paid', 'Won'] as const
type StatusFilter = (typeof STATUS_FILTERS)[number]

export default function QuotesSent() {
  const [quotes, setQuotes] = useState<QuoteRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('All')
  const [sortBy, setSortBy] = useState<'date' | 'amount' | 'customer'>('date')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')

  const fetchQuotes = async () => {
    try {
      setError(null)
      setIsLoading(true)

      const { data, error: quotesError } = await supabase
        .from('quotes')
        .select(`
          *,
          lead:extracted_leads (
            name,
            phone_number,
            email,
            status
          )
        `)
        .order('created_at', { ascending: false })

      if (quotesError) throw quotesError
      setQuotes((data || []) as QuoteRecord[])
    } catch (err) {
      console.error('Error fetching quotes:', err)
      setError(err instanceof Error ? err.message : 'Failed to load quotes')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchQuotes()

    const channel = supabase
      .channel('quotes_sent_realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quotes' }, () => fetchQuotes())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const filteredQuotes = useMemo(() => {
    let result = quotes

    // Apply status filter
    if (statusFilter !== 'All') {
      result = result.filter((q) => {
        if (statusFilter === 'Paid') return q.accepted_payment_method === 'card_paid'
        if (statusFilter === 'Pending') return !q.accepted_payment_method || q.accepted_payment_method !== 'card_paid'
        if (statusFilter === 'Won') return q.lead?.status === 'Job Won'
        return true
      })
    }

    // Apply search
    if (search.trim()) {
      const term = search.toLowerCase()
      result = result.filter((q) => {
        const haystack = [
          q.customer_name,
          q.customer_email,
          q.customer_phone,
          q.quote_number,
          q.address,
          q.service,
          q.lead?.name,
          q.lead?.email,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(term)
      })
    }

    // Apply sorting
    result = [...result].sort((a, b) => {
      let comparison = 0
      if (sortBy === 'date') {
        comparison = new Date(a.created_at || '').getTime() - new Date(b.created_at || '').getTime()
      } else if (sortBy === 'amount') {
        comparison = (a.total_inc_gst || 0) - (b.total_inc_gst || 0)
      } else if (sortBy === 'customer') {
        const nameA = (a.customer_name || a.lead?.name || '').toLowerCase()
        const nameB = (b.customer_name || b.lead?.name || '').toLowerCase()
        comparison = nameA.localeCompare(nameB)
      }
      return sortOrder === 'asc' ? comparison : -comparison
    })

    return result
  }, [quotes, search, statusFilter, sortBy, sortOrder])

  const totals = useMemo(() => {
    const totalValue = filteredQuotes.reduce((sum, q) => sum + (q.total_inc_gst || 0), 0)
    const paidValue = filteredQuotes
      .filter((q) => q.accepted_payment_method === 'card_paid')
      .reduce((sum, q) => sum + (q.total_inc_gst || 0), 0)
    const pendingValue = totalValue - paidValue
    return { totalValue, paidValue, pendingValue, count: filteredQuotes.length }
  }, [filteredQuotes])

  const getQuoteStatus = (quote: QuoteRecord) => {
    if (quote.accepted_payment_method === 'card_paid') {
      return { label: 'Paid', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' }
    }
    if (quote.lead?.status === 'Job Won') {
      return { label: 'Won', color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' }
    }
    return { label: 'Pending', color: 'bg-amber-500/20 text-amber-300 border-amber-500/40' }
  }

  return (
    <div className="min-h-screen p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500/30 to-indigo-500/30 border border-sky-400/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-sky-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              Quotes Sent
            </h1>
            <p className="text-sm text-white/60 mt-1 ml-13">All saved and sent quotes in one place</p>
          </div>

          <button
            onClick={fetchQuotes}
            disabled={isLoading}
            className="self-start md:self-auto px-4 py-2 rounded-xl bg-sky-600/80 hover:bg-sky-600 text-white text-sm font-medium disabled:opacity-50 transition flex items-center gap-2"
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl bg-gradient-to-br from-slate-800/60 to-slate-900/60 border border-white/10 p-4">
            <p className="text-xs text-white/50 uppercase tracking-wider">Total Quotes</p>
            <p className="text-2xl font-bold text-white mt-1">{totals.count}</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-sky-900/40 to-sky-950/40 border border-sky-500/20 p-4">
            <p className="text-xs text-sky-300/70 uppercase tracking-wider">Total Value</p>
            <p className="text-2xl font-bold text-sky-200 mt-1">${totals.totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-emerald-900/40 to-emerald-950/40 border border-emerald-500/20 p-4">
            <p className="text-xs text-emerald-300/70 uppercase tracking-wider">Paid</p>
            <p className="text-2xl font-bold text-emerald-200 mt-1">${totals.paidValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <div className="rounded-xl bg-gradient-to-br from-amber-900/40 to-amber-950/40 border border-amber-500/20 p-4">
            <p className="text-xs text-amber-300/70 uppercase tracking-wider">Pending</p>
            <p className="text-2xl font-bold text-amber-200 mt-1">${totals.pendingValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3 p-3 rounded-xl bg-black/20 border border-white/10">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search quotes..."
            className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-sky-500/50"
          />

          <div className="flex items-center gap-2">
            {STATUS_FILTERS.map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-2 rounded-lg text-xs font-medium transition ${
                  statusFilter === status
                    ? 'bg-sky-500/30 text-sky-200 border border-sky-400/40'
                    : 'bg-white/5 text-white/70 border border-white/10 hover:bg-white/10'
                }`}
              >
                {status}
              </button>
            ))}
          </div>

          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [by, order] = e.target.value.split('-') as ['date' | 'amount' | 'customer', 'asc' | 'desc']
              setSortBy(by)
              setSortOrder(order)
            }}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none"
          >
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
            <option value="customer-asc">Customer A-Z</option>
            <option value="customer-desc">Customer Z-A</option>
          </select>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/20 border border-red-500/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Quotes List */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-white/50">
            <svg className="w-6 h-6 animate-spin mr-3" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading quotes...
          </div>
        ) : filteredQuotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/50">
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p>No quotes found</p>
            <p className="text-xs mt-1">Try adjusting your filters</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredQuotes.map((quote) => {
              const status = getQuoteStatus(quote)
              const customerName = quote.customer_name || quote.lead?.name || 'Unknown'
              const customerContact = quote.customer_email || quote.lead?.email || quote.customer_phone || quote.lead?.phone_number || ''

              return (
                <div
                  key={quote.id}
                  className="rounded-xl bg-gradient-to-r from-slate-800/50 to-slate-900/50 border border-white/10 p-4 hover:border-white/20 transition group"
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-white font-semibold truncate">
                          {customerName}
                        </h3>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${status.color}`}>
                          {status.label}
                        </span>
                        {quote.quote_number && (
                          <span className="text-xs text-white/40 font-mono">#{quote.quote_number}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm text-white/50 flex-wrap">
                        {customerContact && <span>{customerContact}</span>}
                        <span className="capitalize">{quote.service} clean</span>
                        <span>{quote.bedrooms} bed / {quote.bathrooms} bath</span>
                        {quote.address && (
                          <span className="truncate max-w-[200px]" title={quote.address}>
                            📍 {quote.address}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-xl font-bold text-white">
                          ${quote.total_inc_gst?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                        <p className="text-xs text-white/40">
                          {quote.created_at ? new Date(quote.created_at).toLocaleDateString() : '—'}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        {quote.share_token && (
                          <a
                            href={`${window.location.origin}?quote=${quote.share_token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition"
                            title="View public quote"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}
                        <button
                          onClick={async () => {
                            if (!quote.share_token) return
                            const url = `${window.location.origin}?quote=${quote.share_token}`
                            try {
                              await navigator.clipboard.writeText(url)
                            } catch {
                              // Fallback - just select text
                            }
                          }}
                          className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/60 hover:text-white transition"
                          title="Copy link"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded details on hover */}
                  <div className="hidden group-hover:block mt-3 pt-3 border-t border-white/10">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
                      <div>
                        <span className="text-white/40">Subtotal</span>
                        <p className="text-white font-medium">${quote.subtotal?.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-white/40">Discount</span>
                        <p className="text-white font-medium">${quote.discount_amount?.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-white/40">GST</span>
                        <p className="text-white font-medium">${quote.gst?.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-white/40">Deposit</span>
                        <p className="text-white font-medium">${quote.deposit_amount?.toFixed(2)}</p>
                      </div>
                      <div>
                        <span className="text-white/40">Profit</span>
                        <p className="text-emerald-300 font-medium">${quote.profit?.toFixed(2)} ({quote.margin?.toFixed(1)}%)</p>
                      </div>
                    </div>
                    {quote.notes && (
                      <p className="mt-2 text-xs text-white/50 italic">Notes: {quote.notes}</p>
                    )}
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
