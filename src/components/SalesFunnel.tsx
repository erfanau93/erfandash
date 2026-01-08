import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import SmsLead from './SmsLead'
import QuoteTool from './QuoteTool'

type ExtractedLead = {
  id: string
  email_id?: string
  name?: string | null
  phone_number?: string | null
  email?: string | null
  region_notes?: string | null
  extracted_at?: string | null
  created_at?: string | null
  status?: string | null
  first_contact?: string | number | null
  last_text_date?: string | number | null
  last_text_body?: string | null
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://etiaoqskgplpfydblzne.supabase.co'
const supabaseAnonKey =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aWFvcXNrZ3BscGZ5ZGJsem5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzI0NzAsImV4cCI6MjA4MjgwODQ3MH0.c-AlsveEx_bxVgEivga3PRrBp5ylY3He9EJXbaa2N2c'

const dialpadUserId = '6452247499866112'
const dialpadUrl = `https://dialpad.com/api/v2/users/${dialpadUserId}/initiate_call`
const dialpadToken = 'NNRYnLXqJgkWXePcCG2SGCVzHfuB6kxAqQATPvnmn3x6k5RevHUCPdF8zF8jqXsssuyG67bEALxZH9TACsq4aARA46VL4yZ246Kf'

const STATUSES = ['Unanswered', 'Follow Up', 'Quote Sent', 'Job Won', 'Not interested', 'Jobs Completed']

const STATUS_COLORS: Record<string, { bg: string; border: string; header: string; dot: string }> = {
  '': { bg: 'bg-slate-800/40', border: 'border-slate-600/30', header: 'bg-slate-700/50', dot: 'bg-slate-400' },
  Unanswered: { bg: 'bg-amber-950/30', border: 'border-amber-500/30', header: 'bg-amber-600/20', dot: 'bg-amber-400' },
  'Follow Up': { bg: 'bg-purple-950/30', border: 'border-purple-500/30', header: 'bg-purple-600/20', dot: 'bg-purple-400' },
  'Quote Sent': { bg: 'bg-sky-950/30', border: 'border-sky-500/30', header: 'bg-sky-600/20', dot: 'bg-sky-400' },
  'Job Won': { bg: 'bg-emerald-950/30', border: 'border-emerald-500/30', header: 'bg-emerald-600/20', dot: 'bg-emerald-400' },
  'Not interested': { bg: 'bg-rose-950/30', border: 'border-rose-500/30', header: 'bg-rose-600/20', dot: 'bg-rose-400' },
  'Jobs Completed': { bg: 'bg-teal-950/30', border: 'border-teal-500/30', header: 'bg-teal-600/20', dot: 'bg-teal-400' },
}

function formatDate(val: string | number | null | undefined): string | null {
  if (!val) return null
  const d = typeof val === 'number' ? new Date(val) : new Date(val)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

export default function SalesFunnel() {
  const [leads, setLeads] = useState<ExtractedLead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [activeColumn, setActiveColumn] = useState<string>('')
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null)
  const [callError, setCallError] = useState<string | null>(null)
  const [quoteLead, setQuoteLead] = useState<ExtractedLead | null>(null)

  const fetchLeads = async () => {
    try {
      setError(null)
      setIsLoading(true)
      const { data, error: leadsError } = await supabase
        .from('extracted_leads')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)

      if (leadsError) throw leadsError
      setLeads(data || [])
    } catch (err) {
      console.error('Error fetching leads for sales funnel:', err)
      setError(err instanceof Error ? err.message : 'Failed to load leads')
    } finally {
      setIsLoading(false)
    }
  }

  const updateStatus = async (leadId: string, status: string) => {
    try {
      setSavingId(leadId)
      setError(null)

      // Optimistic update
      setLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status: status || null } : lead)))

      const response = await fetch(`${supabaseUrl}/functions/v1/update-lead-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ leadId, status }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.error) {
        throw new Error(result?.error || 'Failed to update lead status')
      }
    } catch (err) {
      console.error('Error updating lead status:', err)
      setError(err instanceof Error ? err.message : 'Failed to update status')
      fetchLeads() // Revert on error
    } finally {
      setSavingId(null)
      setDraggingId(null)
      setActiveColumn('')
    }
  }

  const handleCallLead = async (lead: ExtractedLead) => {
    if (!lead.phone_number) {
      setCallError('No phone number available for this lead.')
      return
    }

    setCallError(null)
    setCallingLeadId(lead.id)
    try {
      const response = await fetch(dialpadUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${dialpadToken}`,
        },
        body: JSON.stringify({ phone_number: lead.phone_number }),
      })

      const result = await response.json().catch(() => ({}))
      if (!response.ok || result?.error) {
        throw new Error(result?.error || 'Failed to initiate call')
      }

      // Record first contact time if not already set
      if (!lead.first_contact) {
        const nowMs = Date.now()
        const { error: updateError } = await supabase
          .from('extracted_leads')
          .update({ first_contact: nowMs })
          .eq('id', lead.id)
          .is('first_contact', null)

        if (!updateError) {
          setLeads((prev) =>
            prev.map((l) => (l.id === lead.id ? { ...l, first_contact: nowMs } : l))
          )
        }
      }
    } catch (err) {
      console.error('Error calling lead:', err)
      setCallError(err instanceof Error ? err.message : 'Failed to initiate call')
    } finally {
      setCallingLeadId(null)
    }
  }

  useEffect(() => {
    fetchLeads()
    const channel = supabase
      .channel('extracted_leads_funnel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extracted_leads' }, () => fetchLeads())
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return leads
    return leads.filter((lead) => {
      const haystack = [lead.name, lead.email, lead.phone_number, lead.region_notes, lead.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(term)
    })
  }, [leads, search])

  const columns = [{ key: '', label: 'No Status' }, ...STATUSES.map((s) => ({ key: s, label: s }))]

  const handleDrop = (columnKey: string) => {
    if (!draggingId) return
    const lead = leads.find((l) => l.id === draggingId)
    if (!lead || (lead.status || '') === columnKey) {
      setDraggingId(null)
      setActiveColumn('')
      return
    }
    updateStatus(draggingId, columnKey)
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Compact Header */}
      <header className="flex-shrink-0 px-4 py-2 border-b border-white/10 bg-black/20 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => (window.location.href = '/')}
              className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition"
              title="Back to dashboard"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-lg font-bold text-white flex items-center gap-2">
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Sales Funnel
              </h1>
              <p className="text-[10px] text-white/50">{filteredLeads.length} leads · Drag to change status</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white text-xs w-32 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={fetchLeads}
              disabled={isLoading}
              className="p-1.5 rounded-lg bg-emerald-600/80 hover:bg-emerald-600 text-white disabled:opacity-50 transition"
              title="Refresh"
            >
              <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {(error || callError) && (
          <div className="mt-1.5 px-2 py-1 rounded bg-red-500/20 border border-red-500/30 text-red-200 text-[10px]">
            {error || callError}
          </div>
        )}
      </header>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden p-2">
        <div className="flex gap-2 h-full min-w-max">
          {columns.map((column) => {
            const items = filteredLeads.filter((lead) => (column.key ? lead.status === column.key : !lead.status))
            const colors = STATUS_COLORS[column.key] || STATUS_COLORS['']
            const isActive = activeColumn === column.key && draggingId

            return (
              <div
                key={column.key || 'no-status'}
                onDragOver={(e) => {
                  e.preventDefault()
                  setActiveColumn(column.key)
                }}
                onDragLeave={() => setActiveColumn('')}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDrop(column.key)
                }}
                className={`w-48 flex-shrink-0 rounded-lg border flex flex-col h-full transition-all duration-200 ${colors.bg} ${
                  isActive ? 'border-emerald-400 shadow-lg shadow-emerald-500/20 scale-[1.02]' : colors.border
                }`}
              >
                {/* Column Header */}
                <div className={`flex-shrink-0 px-2 py-1.5 rounded-t-lg ${colors.header} border-b ${colors.border}`}>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                    <span className="text-white text-xs font-medium truncate">{column.label}</span>
                    <span className="ml-auto text-[10px] text-white/60 bg-black/20 px-1 py-0.5 rounded">
                      {items.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 overflow-y-auto p-1.5 space-y-1.5">
                  {isLoading ? (
                    <div className="flex items-center justify-center h-16 text-white/40 text-[10px]">Loading…</div>
                  ) : items.length === 0 ? (
                    <div className="flex items-center justify-center h-16 text-white/30 text-[10px] text-center px-1">
                      Drop leads here
                    </div>
                  ) : (
                    items.map((lead) => {
                      const lastCalled = formatDate(lead.first_contact)
                      const lastTexted = formatDate(lead.last_text_date)

                      return (
                        <div
                          key={lead.id}
                          draggable
                          onDragStart={() => setDraggingId(lead.id)}
                          onDragEnd={() => {
                            setDraggingId(null)
                            setActiveColumn('')
                          }}
                          className={`rounded-lg border border-white/10 bg-black/30 p-2 cursor-grab active:cursor-grabbing transition-all hover:border-white/20 hover:bg-black/40 ${
                            draggingId === lead.id ? 'opacity-50 scale-95' : ''
                          } ${savingId === lead.id ? 'animate-pulse' : ''}`}
                        >
                          <p className="text-white text-xs font-medium truncate">{lead.name || 'No name'}</p>
                          <p className="text-white/50 text-[10px] truncate">
                            {lead.phone_number || lead.email || '—'}
                          </p>

                          {/* Last Called / Last Texted */}
                          <div className="mt-1 space-y-0.5 text-[9px]">
                            <div className="flex items-center gap-1">
                              <span className="text-white/40">Called:</span>
                              <span className={lastCalled ? 'text-emerald-300' : 'text-white/30'}>
                                {lastCalled || 'Never'}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-white/40">Texted:</span>
                              <span className={lastTexted ? 'text-violet-300' : 'text-white/30'}>
                                {lastTexted || 'Never'}
                              </span>
                            </div>
                            {lead.last_text_body && (
                              <p className="text-white/30 truncate" title={lead.last_text_body}>
                                "{lead.last_text_body}"
                              </p>
                            )}
                          </div>

                          {/* Action buttons */}
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                handleCallLead(lead)
                              }}
                              disabled={callingLeadId === lead.id || !lead.phone_number}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition"
                              title="Call Lead"
                            >
                              {callingLeadId === lead.id ? (
                                <svg className="w-2.5 h-2.5 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                </svg>
                              ) : (
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                </svg>
                              )}
                              Call
                            </button>

                            <SmsLead
                              leadId={lead.id}
                              leadName={lead.name}
                              phoneNumber={lead.phone_number}
                              dialpadToken={dialpadToken}
                              dialpadUserId={dialpadUserId}
                              onSent={({ sentAt, message }) => {
                                setLeads((prev) =>
                                  prev.map((l) =>
                                    l.id === lead.id ? { ...l, last_text_date: sentAt, last_text_body: message } : l
                                  )
                                )
                              }}
                            />

                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                setQuoteLead(lead)
                              }}
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] rounded bg-white/10 hover:bg-white/20 text-white transition"
                              title="Create Quote"
                            >
                              <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                              </svg>
                              Quote
                            </button>
                          </div>

                          <div className="flex items-center justify-between mt-1.5 pt-1 border-t border-white/5">
                            <span className="text-[8px] text-white/40">
                              {lead.extracted_at ? new Date(lead.extracted_at).toLocaleDateString() : '—'}
                            </span>
                            {savingId === lead.id && (
                              <span className="text-[8px] text-emerald-400">Saving…</span>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Quote Modal */}
      {quoteLead && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
          onClick={() => setQuoteLead(null)}
        >
          <div
            className="bg-[var(--color-surface)] border border-white/10 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <div>
                <p className="text-xs uppercase text-[var(--color-text-muted)] tracking-wider">Create Quote</p>
                <h3 className="text-white font-semibold">
                  {quoteLead.name || 'Lead'} · {quoteLead.email || quoteLead.phone_number || ''}
                </h3>
              </div>
              <button
                onClick={() => setQuoteLead(null)}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4">
              <QuoteTool lead={quoteLead} emailId={quoteLead.email_id ?? null} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
