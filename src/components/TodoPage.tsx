import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, startOfDay, addDays, isFriday, startOfWeek, endOfWeek, subDays, isAfter, isBefore } from 'date-fns'
import { supabase } from '../lib/supabase'
import { playSaveSound } from '../lib/sounds'
import SmsLead from './SmsLead'

type TodoType =
  | 'lead_status'
  | 'unassigned_job'
  | 'mark_jobs_complete'
  | 'past_due_unpaid'
  | 'cleaner_payout'
  | 'manual'

interface Todo {
  id: string
  type: TodoType
  reference_id: string | null
  reference_type: string | null
  title: string
  description: string | null
  is_completed: boolean
  due_date: string | null
  auto_generated: boolean
  roll_over: boolean
  created_at: string
  completed_at: string | null
  dismissed_at: string | null
}

interface Lead {
  id: string
  name: string | null
  phone_number: string | null
  status: string | null
  last_text_date?: string | number | null
  last_text_body?: string | null
  created_at: string
}

interface JobOccurrence {
  id: string
  series_id: string
  start_at: string
  end_at: string
  status: string
  cleaner_id: string | null
  series?: {
    title: string
    lead?: { name: string | null }
    quote_id?: string
  }
}

interface CleanerPayout {
  id: string
  occurrence_id: string
  cleaner_id: string
  paid_at: string | null
  payout_amount: number
  cleaner?: { full_name: string }
  occurrence?: {
    start_at: string
    series?: { title: string }
  }
}

const TODO_TYPE_CONFIG: Record<TodoType, { label: string; color: string; bgColor: string; icon: string }> = {
  lead_status: {
    label: 'Lead Status',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10 border-amber-500/30',
    icon: '👤'
  },
  unassigned_job: {
    label: 'Unassigned Jobs',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-500/30',
    icon: '📋'
  },
  mark_jobs_complete: {
    label: 'Mark Jobs Complete',
    color: 'text-indigo-400',
    bgColor: 'bg-indigo-500/10 border-indigo-500/30',
    icon: '✅'
  },
  past_due_unpaid: {
    label: 'Past Due Unpaid',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/10 border-rose-500/30',
    icon: '💰'
  },
  cleaner_payout: {
    label: 'Cleaner Payout',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/30',
    icon: '💸'
  },
  manual: {
    label: 'Manual Todo',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10 border-cyan-500/30',
    icon: '✏️'
  }
}

const dialpadUserId = '6452247499866112'
const dialpadUrl = `https://dialpad.com/api/v2/users/${dialpadUserId}/initiate_call`
const dialpadToken =
  'NNRYnLXqJgkWXePcCG2SGCVzHfuB6kxAqQATPvnmn3x6k5RevHUCPdF8zF8jqXsssuyG67bEALxZH9TACsq4aARA46VL4yZ246Kf'

const parseDate = (value?: string | number | null) => {
  if (!value) return null
  const d = typeof value === 'number' ? new Date(value) : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

const formatDateTime = (value?: string | number | null) => {
  const parsed = parseDate(value)
  return parsed ? format(parsed, 'EEE, MMM d • h:mm a') : null
}

export default function TodoPage() {
  const [manualTodos, setManualTodos] = useState<Todo[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [todosTableUnavailable, setTodosTableUnavailable] = useState(false)
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null)
  const [lastCallsByLead, setLastCallsByLead] = useState<Record<string, string | null>>({})

  // Auto-generated todo data
  const [leadsWithoutStatus, setLeadsWithoutStatus] = useState<Lead[]>([])
  const [unassignedJobs, setUnassignedJobs] = useState<JobOccurrence[]>([])
  const [overdueUnmarkedJobs, setOverdueUnmarkedJobs] = useState<JobOccurrence[]>([])
  const [pastDueUnpaidJobs, setPastDueUnpaidJobs] = useState<JobOccurrence[]>([])
  const [unpaidCleanerPayouts, setUnpaidCleanerPayouts] = useState<CleanerPayout[]>([])

  // Dismissed items tracking (localStorage)
  const [dismissedItems, setDismissedItems] = useState<Record<string, boolean>>(() => {
    try {
      const stored = localStorage.getItem('todo-dismissed')
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  // New manual todo form
  const [newTodoTitle, setNewTodoTitle] = useState('')
  const [newTodoDescription, setNewTodoDescription] = useState('')
  const [isAddingTodo, setIsAddingTodo] = useState(false)

  // Filter
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending')

  const today = useMemo(() => startOfDay(new Date()), [])
  const isTodayFriday = isFriday(today)

  // Get start of current week (Monday)
  const weekStart = useMemo(() => startOfWeek(today, { weekStartsOn: 1 }), [today])
  const weekEnd = useMemo(() => endOfWeek(today, { weekStartsOn: 1 }), [today])

  const saveDismissed = useCallback((dismissed: Record<string, boolean>) => {
    setDismissedItems(dismissed)
    try {
      localStorage.setItem('todo-dismissed', JSON.stringify(dismissed))
    } catch {
      // Ignore storage errors
    }
  }, [])

  const loadLastCalls = useCallback(async (leads: Lead[]) => {
    try {
      const phoneNumbers = Array.from(new Set(leads.map((l) => l.phone_number).filter(Boolean))) as string[]
      if (!phoneNumbers.length) return

      const callsMap: Record<string, string | null> = {}
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

      const lastCallsByLeadId: Record<string, string | null> = {}
      leads.forEach((lead) => {
        if (lead.phone_number && callsMap[lead.phone_number]) {
          lastCallsByLeadId[lead.id] = callsMap[lead.phone_number]
        }
      })

      setLastCallsByLead((prev) => ({ ...prev, ...lastCallsByLeadId }))
    } catch (err) {
      console.error('Failed to load last calls', err)
    }
  }, [])

  const fetchData = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const fiveDaysFromNow = addDays(today, 5)
      const twoDaysAgo = subDays(today, 2)
      const now = new Date()

      // 1. Fetch all leads without status (rollover)
      const { data: leads, error: leadsErr } = await supabase
        .from('extracted_leads')
        .select('id, name, phone_number, status, created_at, last_text_date, last_text_body')
        .order('created_at', { ascending: false })
        .limit(1000)

      if (leadsErr) throw leadsErr

      const leadsNoStatus = (leads || []).filter((l: any) => !l.status || l.status === '')
      setLeadsWithoutStatus(leadsNoStatus)
      await loadLastCalls(leadsNoStatus)

      // 2. Fetch unassigned jobs for next 5 days
      const { data: unassignedData, error: unassignedErr } = await supabase
        .from('booking_occurrences')
        .select(`
          id, series_id, quote_id, start_at, end_at, status, cleaner_id,
          series:booking_series(title, lead:extracted_leads(name), quote_id)
        `)
        .gte('start_at', today.toISOString())
        .lt('start_at', fiveDaysFromNow.toISOString())
        .is('cleaner_id', null)
        .neq('status', 'cancelled')
        .order('start_at', { ascending: true })

      if (unassignedErr) throw unassignedErr
      setUnassignedJobs((unassignedData || []) as any)

      // 3. Fetch past jobs that are not marked completed
      const { data: overdueData, error: overdueErr } = await supabase
        .from('booking_occurrences')
        .select(`
          id, series_id, quote_id, start_at, end_at, status, cleaner_id,
          series:booking_series(title, lead:extracted_leads(name), quote_id)
        `)
        .lt('start_at', now.toISOString())
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .order('start_at', { ascending: false })
        .limit(1000)

      if (overdueErr) throw overdueErr
      setOverdueUnmarkedJobs((overdueData || []) as any)

      // 4. Fetch past due jobs (more than 2 days old) that are not paid
      // Payment is tracked on booking_occurrences via payment_status and payment_paid_at
      const { data: pastDueData, error: pastDueErr } = await supabase
        .from('booking_occurrences')
        .select(`
          id, series_id, quote_id, start_at, end_at, status, cleaner_id, payment_status, payment_paid_at,
          series:booking_series(title, lead:extracted_leads(name), quote_id)
        `)
        .lt('start_at', twoDaysAgo.toISOString())
        .in('status', ['completed', 'scheduled'])
        .order('start_at', { ascending: false })
        .limit(100)

      if (pastDueErr) throw pastDueErr

      // Filter to only unpaid jobs (payment_status !== 'paid' AND payment_paid_at IS NULL)
      // Also check if linked quote was paid via card
      const occurrenceIds = (pastDueData || []).map((o: any) => o.id)
      
      if (occurrenceIds.length > 0) {
        // Get quote payment status for these occurrences
        const quoteIds = (pastDueData || [])
          .map((o: any) => o.quote_id || o.series?.quote_id)
          .filter(Boolean)

        let paidQuoteIds = new Set<string>()
        
        if (quoteIds.length > 0) {
          const { data: paidQuotes, error: quotesErr } = await supabase
            .from('quotes')
            .select('id, accepted_payment_method')
            .in('id', quoteIds)

          if (!quotesErr && paidQuotes) {
            // Quote is paid if accepted_payment_method is 'card_paid' or 'direct_transfer'
            paidQuoteIds = new Set(
              (paidQuotes || [])
                .filter((q: any) => q.accepted_payment_method === 'card_paid' || q.accepted_payment_method === 'direct_transfer')
                .map((q: any) => q.id)
            )
          }
        }
        
        const unpaidPastDue = (pastDueData || []).filter((o: any) => {
          // Job is paid if:
          // 1. payment_status is 'paid', OR
          // 2. payment_paid_at is not null, OR
          // 3. linked quote has accepted_payment_method = 'card_paid' or 'direct_transfer'
          const isPaidOnOccurrence = o.payment_status === 'paid' || o.payment_paid_at !== null
          const quoteId = o.quote_id || o.series?.quote_id
          const isQuotePaid = quoteId && paidQuoteIds.has(quoteId)
          
          return !isPaidOnOccurrence && !isQuotePaid
        })

        setPastDueUnpaidJobs(unpaidPastDue as any)
      } else {
        setPastDueUnpaidJobs([])
      }

      // 5. Fetch unpaid cleaner payouts - show on Friday if jobs from the week aren't paid
      // This fetches payouts for jobs that occurred during the current week
      const { data: payoutsData, error: payoutsErr } = await supabase
        .from('cleaner_payouts')
        .select(`
          id, occurrence_id, cleaner_id, paid_at, payout_amount,
          cleaner:cleaners(full_name),
          occurrence:booking_occurrences(start_at, series:booking_series(title))
        `)
        .is('paid_at', null)
        .order('created_at', { ascending: false })
        .limit(200)

      if (payoutsErr) throw payoutsErr

      // Filter to only show payouts for jobs from the current week
      const weekPayouts = (payoutsData || []).filter((p: any) => {
        const jobDate = p.occurrence?.start_at ? new Date(p.occurrence.start_at) : null
        if (!jobDate) return false
        return isAfter(jobDate, weekStart) && isBefore(jobDate, addDays(weekEnd, 1))
      })

      setUnpaidCleanerPayouts(weekPayouts as any)

      // 6. Fetch manual todos
      const { data: todosData, error: todosErr } = await supabase
        .from('todos')
        .select('*')
        .eq('type', 'manual')
        .order('created_at', { ascending: false })

      // Handle PGRST205 (table not in schema cache) gracefully - table was just created
      if (todosErr) {
        if (todosErr.code === 'PGRST205') {
          console.warn('Todos table schema cache not yet refreshed. Manual todos temporarily unavailable.')
          setTodosTableUnavailable(true)
          setManualTodos([])
        } else {
          throw todosErr
        }
      } else {
        setTodosTableUnavailable(false)
        setManualTodos((todosData || []) as Todo[])
      }

    } catch (err: any) {
      console.error('Failed to load todo data:', err)
      setError(err?.message || 'Failed to load todo data')
    } finally {
      setIsLoading(false)
    }
  }, [today, weekStart, weekEnd, loadLastCalls])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Broadcast todo count for nav indicator
  useEffect(() => {
    const count = getTotalPendingCount()
    window.dispatchEvent(new CustomEvent('todo-count-update', { detail: { count } }))
  })

  const handleAddManualTodo = async () => {
    if (!newTodoTitle.trim()) {
      setError('Please enter a title for your todo')
      return
    }

    setIsAddingTodo(true)
    setError(null)

    try {
      const { data, error: insertErr } = await supabase
        .from('todos')
        .insert({
          type: 'manual',
          title: newTodoTitle.trim(),
          description: newTodoDescription.trim() || null,
          is_completed: false,
          auto_generated: false,
          roll_over: true,
          due_date: format(today, 'yyyy-MM-dd')
        })
        .select()
        .single()

      if (insertErr) {
        // Handle schema cache not refreshed error
        if (insertErr.code === 'PGRST205') {
          setError('Manual todos are temporarily unavailable. The database is syncing - please try again in a minute.')
          return
        }
        throw insertErr
      }

      setManualTodos(prev => [data as Todo, ...prev])
      setNewTodoTitle('')
      setNewTodoDescription('')
      setSuccessMessage('Todo added successfully!')
      playSaveSound()
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err: any) {
      console.error('Failed to add todo:', err)
      setError(err?.message || 'Failed to add todo')
    } finally {
      setIsAddingTodo(false)
    }
  }

  const handleToggleManualTodo = async (todo: Todo) => {
    try {
      const newCompleted = !todo.is_completed
      const { error: updateErr } = await supabase
        .from('todos')
        .update({
          is_completed: newCompleted,
          completed_at: newCompleted ? new Date().toISOString() : null
        })
        .eq('id', todo.id)

      if (updateErr) throw updateErr

      setManualTodos(prev => prev.map(t => 
        t.id === todo.id 
          ? { ...t, is_completed: newCompleted, completed_at: newCompleted ? new Date().toISOString() : null }
          : t
      ))
      playSaveSound()
    } catch (err: any) {
      console.error('Failed to update todo:', err)
      setError(err?.message || 'Failed to update todo')
    }
  }

  const handleDeleteManualTodo = async (todoId: string) => {
    if (!confirm('Are you sure you want to delete this todo?')) return

    try {
      const { error: deleteErr } = await supabase
        .from('todos')
        .delete()
        .eq('id', todoId)

      if (deleteErr) throw deleteErr

      setManualTodos(prev => prev.filter(t => t.id !== todoId))
      playSaveSound()
    } catch (err: any) {
      console.error('Failed to delete todo:', err)
      setError(err?.message || 'Failed to delete todo')
    }
  }

  const handleDismissItem = (key: string) => {
    const newDismissed = { ...dismissedItems, [key]: true }
    saveDismissed(newDismissed)
    playSaveSound()
  }

  const handleMarkLeadStatus = async (leadId: string, status: string) => {
    try {
      const { error: updateErr } = await supabase
        .from('extracted_leads')
        .update({ status })
        .eq('id', leadId)

      if (updateErr) throw updateErr

      setLeadsWithoutStatus(prev => prev.filter(l => l.id !== leadId))
      setSuccessMessage('Lead status updated!')
      playSaveSound()
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err: any) {
      console.error('Failed to update lead status:', err)
      setError(err?.message || 'Failed to update lead status')
    }
  }

  const handleCallLead = async (leadId: string, phoneNumber?: string | null) => {
    if (!phoneNumber) {
      setError('No phone number available for this lead.')
      return
    }

    setError(null)
    setCallingLeadId(leadId)
    try {
      const response = await fetch(dialpadUrl, {
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
        const details = result?.error || 'Failed to initiate call'
        throw new Error(details)
      }

      const nowIso = new Date().toISOString()
      setLastCallsByLead((prev) => ({ ...prev, [leadId]: nowIso }))
    } catch (err) {
      console.error('Error calling lead:', err)
      setError(err instanceof Error ? err.message : 'Failed to initiate call')
    } finally {
      setCallingLeadId(null)
    }
  }

  const handleMarkPayoutPaid = async (payoutId: string) => {
    try {
      const { error: updateErr } = await supabase
        .from('cleaner_payouts')
        .update({
          paid_at: new Date().toISOString(),
          paid_by: 'admin'
        })
        .eq('id', payoutId)

      if (updateErr) throw updateErr

      setUnpaidCleanerPayouts(prev => prev.filter(p => p.id !== payoutId))
      setSuccessMessage('Payout marked as paid!')
      playSaveSound()
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err: any) {
      console.error('Failed to update payout:', err)
      setError(err?.message || 'Failed to update payout')
    }
  }

  const handleMarkJobComplete = async (occurrenceId: string) => {
    try {
      const { error: updateErr } = await supabase
        .from('booking_occurrences')
        .update({ status: 'completed' })
        .eq('id', occurrenceId)

      if (updateErr) throw updateErr

      // Best-effort: reflect completion in the Sales Funnel
      try {
        const { data: occ, error: occErr } = await supabase
          .from('booking_occurrences')
          .select('series:booking_series(lead_id)')
          .eq('id', occurrenceId)
          .single()

        if (!occErr) {
          const leadId = (occ as any)?.series?.lead_id
          if (leadId) {
            await supabase.from('extracted_leads').update({ status: 'Jobs Completed' }).eq('id', leadId)
          }
        }
      } catch (leadErr) {
        console.warn('Failed to update lead status for completed job', leadErr)
      }

      setOverdueUnmarkedJobs(prev => prev.filter(j => j.id !== occurrenceId))
      setSuccessMessage('Job marked as completed!')
      playSaveSound()
      setTimeout(() => setSuccessMessage(null), 3000)
    } catch (err: any) {
      console.error('Failed to mark job as completed:', err)
      setError(err?.message || 'Failed to mark job as completed')
    }
  }

  const getTotalPendingCount = () => {
    let count = 0
    
    // Leads without status (not dismissed)
    count += leadsWithoutStatus.filter(l => !dismissedItems[`lead-${l.id}`]).length
    
    // Unassigned jobs (not dismissed)
    count += unassignedJobs.filter(j => !dismissedItems[`unassigned-${j.id}`]).length

    // Overdue unmarked jobs (not dismissed)
    count += overdueUnmarkedJobs.filter(j => !dismissedItems[`overdue-${j.id}`]).length
    
    // Past due unpaid (not dismissed)
    count += pastDueUnpaidJobs.filter(j => !dismissedItems[`pastdue-${j.id}`]).length
    
    // Cleaner payouts (show on Friday or if any exist, not dismissed)
    if (isTodayFriday || unpaidCleanerPayouts.length > 0) {
      count += unpaidCleanerPayouts.filter(p => !dismissedItems[`payout-${p.id}`]).length
    }
    
    // Manual todos (not completed)
    count += manualTodos.filter(t => !t.is_completed).length
    
    return count
  }

  const allLeadsHaveStatus = leadsWithoutStatus.filter(l => !dismissedItems[`lead-${l.id}`]).length === 0
  const allJobsAssigned = unassignedJobs.filter(j => !dismissedItems[`unassigned-${j.id}`]).length === 0
  const allOverdueMarked = overdueUnmarkedJobs.filter(j => !dismissedItems[`overdue-${j.id}`]).length === 0
  const allPastDuePaid = pastDueUnpaidJobs.filter(j => !dismissedItems[`pastdue-${j.id}`]).length === 0
  const allPayoutsPaid = unpaidCleanerPayouts.filter(p => !dismissedItems[`payout-${p.id}`]).length === 0

  const filteredManualTodos = useMemo(() => {
    if (filter === 'all') return manualTodos
    if (filter === 'completed') return manualTodos.filter(t => t.is_completed)
    return manualTodos.filter(t => !t.is_completed)
  }, [manualTodos, filter])

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <span className="text-4xl">📋</span>
              End of Day Checklist
            </h1>
            <p className="text-[var(--color-text-muted)] mt-1">
              {format(today, 'EEEE, MMMM d, yyyy')} • {getTotalPendingCount()} items pending
            </p>
          </div>
          <button
            onClick={fetchData}
            disabled={isLoading}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/40 flex items-center gap-2 disabled:opacity-50"
          >
            <svg className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </header>

        {error && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-200 text-sm">
            {successMessage}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <div className={`glass-card rounded-xl p-4 border ${allLeadsHaveStatus ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">👤</span>
              <p className="text-sm text-[var(--color-text-muted)]">Lead Status</p>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${allLeadsHaveStatus ? 'text-emerald-400' : 'text-amber-400'}`}>
                {leadsWithoutStatus.filter(l => !dismissedItems[`lead-${l.id}`]).length}
              </p>
              {allLeadsHaveStatus && <span className="text-emerald-400 text-lg">✓</span>}
            </div>
          </div>

          <div className={`glass-card rounded-xl p-4 border ${allJobsAssigned ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-orange-500/30 bg-orange-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">📋</span>
              <p className="text-sm text-[var(--color-text-muted)]">Unassigned</p>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${allJobsAssigned ? 'text-emerald-400' : 'text-orange-400'}`}>
                {unassignedJobs.filter(j => !dismissedItems[`unassigned-${j.id}`]).length}
              </p>
              {allJobsAssigned && <span className="text-emerald-400 text-lg">✓</span>}
            </div>
          </div>

          <div className={`glass-card rounded-xl p-4 border ${allOverdueMarked ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-indigo-500/30 bg-indigo-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">✅</span>
              <p className="text-sm text-[var(--color-text-muted)]">Mark Complete</p>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${allOverdueMarked ? 'text-emerald-400' : 'text-indigo-400'}`}>
                {overdueUnmarkedJobs.filter(j => !dismissedItems[`overdue-${j.id}`]).length}
              </p>
              {allOverdueMarked && <span className="text-emerald-400 text-lg">✓</span>}
            </div>
          </div>

          <div className={`glass-card rounded-xl p-4 border ${allPastDuePaid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">💰</span>
              <p className="text-sm text-[var(--color-text-muted)]">Past Due</p>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${allPastDuePaid ? 'text-emerald-400' : 'text-rose-400'}`}>
                {pastDueUnpaidJobs.filter(j => !dismissedItems[`pastdue-${j.id}`]).length}
              </p>
              {allPastDuePaid && <span className="text-emerald-400 text-lg">✓</span>}
            </div>
          </div>

          <div className={`glass-card rounded-xl p-4 border ${allPayoutsPaid ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-purple-500/30 bg-purple-500/5'}`}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">💸</span>
              <p className="text-sm text-[var(--color-text-muted)]">Payouts</p>
            </div>
            <div className="flex items-center justify-between">
              <p className={`text-2xl font-bold ${allPayoutsPaid ? 'text-emerald-400' : 'text-purple-400'}`}>
                {unpaidCleanerPayouts.filter(p => !dismissedItems[`payout-${p.id}`]).length}
              </p>
              {allPayoutsPaid && <span className="text-emerald-400 text-lg">✓</span>}
              {isTodayFriday && !allPayoutsPaid && (
                <span className="text-xs text-purple-300 animate-pulse">Friday!</span>
              )}
            </div>
          </div>

          <div className="glass-card rounded-xl p-4 border border-cyan-500/30 bg-cyan-500/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg">✏️</span>
              <p className="text-sm text-[var(--color-text-muted)]">Manual</p>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-2xl font-bold text-cyan-400">
                {manualTodos.filter(t => !t.is_completed).length}
              </p>
              {manualTodos.filter(t => !t.is_completed).length === 0 && <span className="text-emerald-400 text-lg">✓</span>}
            </div>
          </div>
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Auto-generated Todos */}
          <div className="space-y-4">
            {/* 1. Lead Status Section */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.lead_status.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.lead_status.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.lead_status.color}`}>
                      Set Status for Leads
                    </h2>
                  </div>
                  {allLeadsHaveStatus && (
                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">
                      ✓ Complete
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Leads with no status set (rolls over until updated)
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : leadsWithoutStatus.length === 0 ? (
                  <div className="text-sm text-emerald-300 flex items-center gap-2">
                    <span>✓</span> All leads have status set!
                  </div>
                ) : (
                  leadsWithoutStatus.map(lead => {
                    const key = `lead-${lead.id}`
                    if (dismissedItems[key]) return null
                    const lastCallText = formatDateTime(lastCallsByLead[lead.id])
                    const lastTextDate = formatDateTime(lead.last_text_date ?? null)
                    return (
                      <div key={lead.id} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">{lead.name || 'No name'}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{lead.phone_number || 'No phone'}</p>
                          {(lastCallText || lastTextDate || lead.last_text_body) && (
                            <div className="mt-2 space-y-0.5">
                              <p className="text-xs text-[var(--color-text-muted)]">
                                Last Call: {lastCallText || 'No recent calls'}
                              </p>
                              <p className="text-xs text-[var(--color-text-muted)]">
                                Last Text:{' '}
                                {lead.last_text_body ? `“${lead.last_text_body}”` : 'No recent texts'}
                                {lastTextDate ? ` • ${lastTextDate}` : ''}
                              </p>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <SmsLead
                            leadId={lead.id}
                            leadName={lead.name}
                            phoneNumber={lead.phone_number}
                            dialpadToken={dialpadToken}
                            dialpadUserId={dialpadUserId}
                            onSent={({ sentAt, message }) => {
                              setLeadsWithoutStatus((prev) =>
                                prev.map((l) =>
                                  l.id === lead.id ? { ...l, last_text_date: sentAt, last_text_body: message } : l
                                )
                              )
                            }}
                          />
                          <button
                            onClick={() => handleCallLead(lead.id, lead.phone_number)}
                            disabled={callingLeadId === lead.id}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 text-xs border border-emerald-500/30 disabled:opacity-60"
                          >
                            {callingLeadId === lead.id ? 'Calling…' : 'Call Lead'}
                          </button>
                          <select
                            onChange={(e) => handleMarkLeadStatus(lead.id, e.target.value)}
                            className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 text-white text-xs"
                            defaultValue=""
                          >
                            <option value="" disabled>Set status</option>
                            <option value="Marketing Loop">Marketing Loop</option>
                            <option value="Follow Up">Follow Up</option>
                            <option value="Quote Sent">Quote Sent</option>
                            <option value="Job Won">Job Won</option>
                            <option value="Not interested">Not interested</option>
                          </select>
                          <button
                            onClick={() => handleDismissItem(key)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 2. Unassigned Jobs Section */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.unassigned_job.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.unassigned_job.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.unassigned_job.color}`}>
                      Unassigned Jobs (Next 5 Days)
                    </h2>
                  </div>
                  {allJobsAssigned && (
                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">
                      ✓ Complete
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Jobs scheduled in the next 5 days that need a cleaner assigned
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : unassignedJobs.length === 0 ? (
                  <div className="text-sm text-emerald-300 flex items-center gap-2">
                    <span>✓</span> All jobs are assigned!
                  </div>
                ) : (
                  unassignedJobs.map(job => {
                    const key = `unassigned-${job.id}`
                    if (dismissedItems[key]) return null
                    return (
                      <div key={job.id} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">
                            {job.series?.lead?.name || 'Customer'} • {job.series?.title || 'Job'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {format(new Date(job.start_at), 'EEE, MMM d • h:mm a')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <a
                            href="/dispatch"
                            className="px-3 py-1.5 rounded-lg bg-orange-600/20 hover:bg-orange-600/30 text-orange-200 text-xs border border-orange-500/30"
                          >
                            Assign →
                          </a>
                          <button
                            onClick={() => handleDismissItem(key)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 3. Mark Jobs as Complete */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.mark_jobs_complete.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.mark_jobs_complete.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.mark_jobs_complete.color}`}>
                      Mark Jobs as Complete
                    </h2>
                  </div>
                  {allOverdueMarked && (
                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">
                      ✓ Complete
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Past jobs that have not been marked completed, skipped, cancelled, or scheduled
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : overdueUnmarkedJobs.length === 0 ? (
                  <div className="text-sm text-emerald-300 flex items-center gap-2">
                    <span>✓</span> No overdue unmarked jobs!
                  </div>
                ) : (
                  overdueUnmarkedJobs.map(job => {
                    const key = `overdue-${job.id}`
                    if (dismissedItems[key]) return null
                    return (
                      <div key={job.id} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">
                            {job.series?.lead?.name || 'Customer'} • {job.series?.title || 'Job'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {format(new Date(job.start_at), 'EEE, MMM d • h:mm a')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleMarkJobComplete(job.id)}
                            className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 text-xs border border-indigo-500/30"
                          >
                            Mark Complete ✓
                          </button>
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: job.id } }))}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs border border-white/10"
                          >
                            View
                          </button>
                          <button
                            onClick={() => handleDismissItem(key)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* 4. Past Due Unpaid Jobs */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.past_due_unpaid.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.past_due_unpaid.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.past_due_unpaid.color}`}>
                      Past Due Unpaid (&gt;2 Days)
                    </h2>
                  </div>
                  {allPastDuePaid && (
                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">
                      ✓ Complete
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Jobs completed more than 2 days ago that haven't been paid
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : pastDueUnpaidJobs.length === 0 ? (
                  <div className="text-sm text-emerald-300 flex items-center gap-2">
                    <span>✓</span> No past due unpaid jobs!
                  </div>
                ) : (
                  pastDueUnpaidJobs.map(job => {
                    const key = `pastdue-${job.id}`
                    if (dismissedItems[key]) return null
                    return (
                      <div key={job.id} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">
                            {job.series?.lead?.name || 'Customer'} • {job.series?.title || 'Job'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Due: {format(new Date(job.start_at), 'MMM d, yyyy')}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: job.id } }))}
                            className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-200 text-xs border border-rose-500/30"
                          >
                            View Job
                          </button>
                          <button
                            onClick={() => handleDismissItem(key)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column */}
          <div className="space-y-4">
            {/* 5. Cleaner Payouts Section */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.cleaner_payout.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.cleaner_payout.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.cleaner_payout.color}`}>
                      Cleaner Payouts
                    </h2>
                    {isTodayFriday && (
                      <span className="px-2 py-1 rounded-full bg-purple-500/30 text-purple-200 text-xs animate-pulse">
                        📅 Friday Payout Day!
                      </span>
                    )}
                  </div>
                  {allPayoutsPaid && (
                    <span className="px-2 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs">
                      ✓ Complete
                    </span>
                  )}
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Unpaid cleaner payouts for jobs this week (due every Friday)
                </p>
              </div>
              <div className="p-4 space-y-2 max-h-64 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : unpaidCleanerPayouts.length === 0 ? (
                  <div className="text-sm text-emerald-300 flex items-center gap-2">
                    <span>✓</span> All payouts are complete!
                  </div>
                ) : (
                  unpaidCleanerPayouts.map(payout => {
                    const key = `payout-${payout.id}`
                    if (dismissedItems[key]) return null
                    return (
                      <div key={payout.id} className="p-3 rounded-xl bg-black/20 border border-white/10 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-white font-medium truncate">
                            {(payout.cleaner as any)?.full_name || 'Cleaner'}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            {(payout.occurrence as any)?.series?.title || 'Job'} • ${payout.payout_amount.toFixed(2)}
                          </p>
                          <p className="text-xs text-[var(--color-text-muted)]">
                            Job date: {payout.occurrence?.start_at ? format(new Date(payout.occurrence.start_at), 'MMM d') : 'N/A'}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleMarkPayoutPaid(payout.id)}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-200 text-xs border border-emerald-500/30"
                          >
                            Mark Paid ✓
                          </button>
                          <button
                            onClick={() => handleDismissItem(key)}
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/50 hover:text-white/80 text-xs"
                            title="Dismiss"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              {unpaidCleanerPayouts.length > 0 && (
                <div className="p-3 border-t border-white/10 bg-black/20">
                  <a
                    href="/cleaners-payout"
                    className="block text-center text-sm text-purple-300 hover:text-purple-200"
                  >
                    View all payouts →
                  </a>
                </div>
              )}
            </div>

            {/* 6. Manual Todo Section */}
            <div className={`rounded-2xl border ${TODO_TYPE_CONFIG.manual.bgColor} overflow-hidden`}>
              <div className="p-4 border-b border-white/10">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{TODO_TYPE_CONFIG.manual.icon}</span>
                    <h2 className={`font-semibold ${TODO_TYPE_CONFIG.manual.color}`}>
                      Manual Todos
                    </h2>
                    {todosTableUnavailable && (
                      <span className="px-2 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs animate-pulse">
                        Syncing...
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setFilter('all')}
                      className={`px-2 py-1 text-xs rounded-lg ${filter === 'all' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setFilter('pending')}
                      className={`px-2 py-1 text-xs rounded-lg ${filter === 'pending' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
                    >
                      Pending
                    </button>
                    <button
                      onClick={() => setFilter('completed')}
                      className={`px-2 py-1 text-xs rounded-lg ${filter === 'completed' ? 'bg-cyan-600 text-white' : 'bg-white/5 text-white/60 hover:text-white'}`}
                    >
                      Done
                    </button>
                  </div>
                </div>
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Your personal task list - items roll over until completed
                </p>
              </div>

              {/* Add new todo form */}
              <div className="p-4 border-b border-white/10 bg-black/20">
                <div className="space-y-2">
                  <input
                    type="text"
                    value={newTodoTitle}
                    onChange={(e) => setNewTodoTitle(e.target.value)}
                    placeholder="What needs to be done?"
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleAddManualTodo()
                      }
                    }}
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTodoDescription}
                      onChange={(e) => setNewTodoDescription(e.target.value)}
                      placeholder="Description (optional)"
                      className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                    />
                    <button
                      onClick={handleAddManualTodo}
                      disabled={isAddingTodo || !newTodoTitle.trim()}
                      className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isAddingTodo ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Manual todos list */}
              <div className="p-4 space-y-2 max-h-72 overflow-y-auto">
                {isLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading...</div>
                ) : todosTableUnavailable ? (
                  <div className="text-sm text-amber-300 text-center py-4 space-y-2">
                    <p>⏳ Manual todos are syncing with the database...</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      This usually takes 1-2 minutes after new tables are created. Click Refresh to check again.
                    </p>
                  </div>
                ) : filteredManualTodos.length === 0 ? (
                  <div className="text-sm text-[var(--color-text-muted)] text-center py-4">
                    {filter === 'pending' ? 'No pending todos!' : filter === 'completed' ? 'No completed todos yet' : 'No todos yet - add one above!'}
                  </div>
                ) : (
                  filteredManualTodos.map(todo => (
                    <div
                      key={todo.id}
                      className={`p-3 rounded-xl border flex items-start gap-3 transition-all ${
                        todo.is_completed
                          ? 'bg-white/5 border-white/5 opacity-60'
                          : 'bg-black/20 border-white/10'
                      }`}
                    >
                      <button
                        onClick={() => handleToggleManualTodo(todo)}
                        className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                          todo.is_completed
                            ? 'bg-emerald-500 border-emerald-500 text-white'
                            : 'border-white/30 hover:border-cyan-400'
                        }`}
                      >
                        {todo.is_completed && (
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${todo.is_completed ? 'text-white/50 line-through' : 'text-white'}`}>
                          {todo.title}
                        </p>
                        {todo.description && (
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{todo.description}</p>
                        )}
                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                          Added {format(new Date(todo.created_at), 'MMM d, h:mm a')}
                          {todo.completed_at && ` • Completed ${format(new Date(todo.completed_at), 'MMM d')}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteManualTodo(todo.id)}
                        className="p-1.5 rounded-lg bg-white/5 hover:bg-red-500/20 text-white/50 hover:text-red-300 text-xs flex-shrink-0"
                        title="Delete"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* All Complete Banner */}
        {getTotalPendingCount() === 0 && !isLoading && (
          <div className="p-6 rounded-2xl bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 text-center">
            <div className="text-5xl mb-3">🎉</div>
            <h3 className="text-2xl font-bold text-white mb-2">All Done!</h3>
            <p className="text-emerald-200">
              Great work! You've completed all your end-of-day tasks.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// Export function to get pending count for nav indicator
export function useTodoCount() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const handleUpdate = (e: CustomEvent<{ count: number }>) => {
      setCount(e.detail.count)
    }

    window.addEventListener('todo-count-update', handleUpdate as any)
    return () => window.removeEventListener('todo-count-update', handleUpdate as any)
  }, [])

  return count
}
