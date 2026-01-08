import { useEffect, useState, useCallback } from 'react'
import { supabase, type DialpadCall, type DialpadSms, type DialpadEmail } from '../lib/supabase'
import DatePicker from './DatePicker'
import DayComparisonChart from './DayComparisonChart'
import HourlyActivity from './HourlyActivity'
import CommunicationsLog from './CommunicationsLog'
import QuoteTool from './QuoteTool'
import Lead from './Lead'
import SmsLead from './SmsLead'
import { subDays } from 'date-fns'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://etiaoqskgplpfydblzne.supabase.co'
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aWFvcXNrZ3BscGZ5ZGJsem5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzI0NzAsImV4cCI6MjA4MjgwODQ3MH0.c-AlsveEx_bxVgEivga3PRrBp5ylY3He9EJXbaa2N2c'
const dialpadUserId = '6452247499866112'
const dialpadUrl = `https://dialpad.com/api/v2/users/${dialpadUserId}/initiate_call`
const dialpadToken =
  'NNRYnLXqJgkWXePcCG2SGCVzHfuB6kxAqQATPvnmn3x6k5RevHUCPdF8zF8jqXsssuyG67bEALxZH9TACsq4aARA46VL4yZ246Kf'

interface Metrics {
  uniqueCalls: number
  outboundCalls: number
  inboundCalls: number
  callsOver30s: number
  smsSent: number
  smsReceived: number
  emailsSent: number
  emailsReceived: number
  leads: number
  quotesForUniqueLeads: number
  averageLeadToCallMinutes: number
  medianLeadToCallMinutes: number
}

interface ExtractedLead {
  id: string
  email_id: string
  name?: string | null
  phone_number?: string | null
  email?: string | null
  region_notes?: string | null
  extracted_at?: string | null
  created_at?: string | null
  email_subject?: string | null
  email_created_at?: string | null
  status?: string | null
  first_contact?: string | number | null
  lead_to_call_minutes?: number | null
  last_text_date?: string | number | null
  last_text_body?: string | null
}

const LEAD_STATUS_OPTIONS = ['Unanswered', 'Quote Sent', 'Job Won', 'Not interested', 'Follow Up']

const LEAD_STATUS_STYLES: Record<
  string,
  { bg: string; border: string; pillBg: string; pillText: string }
> = {
  Unanswered: {
    bg: 'bg-amber-500/5',
    border: 'border-amber-400/40',
    pillBg: 'bg-amber-500/20',
    pillText: 'text-amber-100',
  },
  'Quote Sent': {
    bg: 'bg-sky-500/5',
    border: 'border-sky-400/40',
    pillBg: 'bg-sky-500/20',
    pillText: 'text-sky-100',
  },
  'Job Won': {
    bg: 'bg-emerald-500/5',
    border: 'border-emerald-400/40',
    pillBg: 'bg-emerald-500/20',
    pillText: 'text-emerald-100',
  },
  'Not interested': {
    bg: 'bg-slate-500/5',
    border: 'border-slate-400/40',
    pillBg: 'bg-slate-500/20',
    pillText: 'text-slate-100',
  },
  'Follow Up': {
    bg: 'bg-purple-500/5',
    border: 'border-purple-400/40',
    pillBg: 'bg-purple-500/20',
    pillText: 'text-purple-100',
  },
}

function calculateLeadToCallMinutes(lead: ExtractedLead): number | null {
  if (!lead.first_contact) return null
  const startDate = lead.email_created_at || lead.extracted_at || lead.created_at
  if (!startDate) return null

  const start = new Date(startDate).getTime()
  const end =
    typeof lead.first_contact === 'number'
      ? lead.first_contact
      : new Date(lead.first_contact).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null

  const diffMinutes = (end - start) / (1000 * 60)
  return Number.isFinite(diffMinutes) && diffMinutes >= 0
    ? Number(diffMinutes.toFixed(1))
    : null
}

function formatLeadToCallText(minutes: number | null | undefined) {
  if (minutes === null || minutes === undefined) return 'Not contacted yet'
  if (minutes < 1) return '<1 min'
  if (minutes < 60) return `${minutes.toFixed(1)} min`
  const hours = minutes / 60
  return `${hours.toFixed(1)} hr`
}

function isNewLead(lead: ExtractedLead) {
  return !lead.status && !lead.first_contact
}

function getStatusStyle(status?: string | null) {
  if (!status) {
    return {
      bg: 'bg-[var(--color-surface)]',
      border: 'border-emerald-500/20',
      pillBg: 'bg-white/10',
      pillText: 'text-white',
    }
  }
  return (
    LEAD_STATUS_STYLES[status] || {
      bg: 'bg-[var(--color-surface)]',
      border: 'border-emerald-500/20',
      pillBg: 'bg-white/10',
      pillText: 'text-white',
    }
  )
}

function getFirstContactDate(lead: ExtractedLead): Date | null {
  if (!lead.first_contact) return null
  if (typeof lead.first_contact === 'number') {
    const d = new Date(lead.first_contact)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(lead.first_contact)
  return Number.isNaN(d.getTime()) ? null : d
}

function getLastTextDate(lead: ExtractedLead): Date | null {
  if (!lead.last_text_date) return null
  if (typeof lead.last_text_date === 'number') {
    const d = new Date(lead.last_text_date)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(lead.last_text_date)
  return Number.isNaN(d.getTime()) ? null : d
}

function isValidAusPhone(phone: string) {
  const cleaned = phone.trim()
  return /^\+61\d{8,9}$/.test(cleaned)
}

function isValidEmail(email: string) {
  const cleaned = email.trim()
  // Basic email structure validation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)
}

function generateUuid() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  const rand = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).substring(1)
  return `${rand()}${rand()}-${rand()}-${rand()}-${rand()}-${rand()}${rand()}${rand()}`
}

function MetricCard({
  title,
  value,
  icon,
  color,
  isLoading,
}: {
  title: string
  value: number
  icon: React.ReactNode
  color: string
  isLoading: boolean
}) {
  const colorClasses: Record<string, string> = {
    cyan: 'from-cyan-500 to-cyan-600 shadow-cyan-500/20',
    orange: 'from-orange-500 to-orange-600 shadow-orange-500/20',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-500/20',
    violet: 'from-violet-500 to-violet-600 shadow-violet-500/20',
    blue: 'from-blue-500 to-blue-600 shadow-blue-500/20',
    green: 'from-green-500 to-green-600 shadow-green-500/20',
  }

  return (
    <div className="metric-card glass-card rounded-xl p-3 relative overflow-hidden group">
      {/* Background gradient accent */}
      <div
        className={`absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300 bg-gradient-to-br ${colorClasses[color]}`}
      />

      <div className="relative z-10 space-y-2">
        {/* Icon */}
        <div
          className={`w-9 h-9 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center shadow-md`}
        >
          {icon}
        </div>

        {/* Title */}
        <h3 className="text-[var(--color-text-muted)] text-[11px] font-medium uppercase tracking-wider">
          {title}
        </h3>

        {/* Value */}
        {isLoading ? (
          <div className="shimmer h-10 w-20 rounded-lg" />
        ) : (
          <p className="text-3xl font-bold text-white font-mono count-animate">
            {value.toLocaleString()}
          </p>
        )}
      </div>
    </div>
  )
}

function LiveIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="relative w-3 h-3">
        <div className="absolute inset-0 rounded-full bg-emerald-500 pulse-ring" />
        <div className="absolute inset-0 rounded-full bg-emerald-500" />
      </div>
      <span className="text-emerald-400 text-sm font-medium">Live</span>
    </div>
  )
}

export default function Dashboard() {
  const [metrics, setMetrics] = useState<Metrics>({
    uniqueCalls: 0,
    outboundCalls: 0,
    inboundCalls: 0,
    callsOver30s: 0,
    smsSent: 0,
    smsReceived: 0,
    emailsSent: 0,
    emailsReceived: 0,
    leads: 0,
    quotesForUniqueLeads: 0,
    averageLeadToCallMinutes: 0,
    medianLeadToCallMinutes: 0,
  })
  const [extractedLeads, setExtractedLeads] = useState<ExtractedLead[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [leadStatusError, setLeadStatusError] = useState<string | null>(null)
  const [leadCallError, setLeadCallError] = useState<string | null>(null)
  const [callingLeadId, setCallingLeadId] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [allCalls, setAllCalls] = useState<DialpadCall[]>([])
  const [allSms, setAllSms] = useState<DialpadSms[]>([])
  const [allEmails, setAllEmails] = useState<DialpadEmail[]>([])
  const [savingStatusId, setSavingStatusId] = useState<string | null>(null)
  const [quoteLead, setQuoteLead] = useState<ExtractedLead | null>(null)
  const [showManualLeadForm, setShowManualLeadForm] = useState(false)
  const [manualLead, setManualLead] = useState({
    name: '',
    phone_number: '',
    email: '',
    region_notes: '',
  })
  const [manualLeadError, setManualLeadError] = useState<string | null>(null)
  const [savingManualLead, setSavingManualLead] = useState(false)

  // Get start of today in UTC (to match database timestamps)
  const getStartOfToday = useCallback(() => {
    const now = new Date()
    // Get start of today in UTC, not local time
    const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0))
    return todayUTC.toISOString()
  }, [])

  // Fetch all metrics
  const fetchMetrics = useCallback(async () => {
    try {
      setError(null)
      const todayStart = getStartOfToday()
      
      // For comparison chart, fetch last 3 days of data
      const threeDaysAgo = subDays(new Date(), 3)
      const threeDaysAgoUTC = new Date(Date.UTC(
        threeDaysAgo.getUTCFullYear(),
        threeDaysAgo.getUTCMonth(),
        threeDaysAgo.getUTCDate(),
        0, 0, 0, 0
      )).toISOString()

      // Determine date range based on selected date
      let dateStart = todayStart
      let dateEnd = new Date().toISOString()
      
      if (selectedDate) {
        const selectedStart = new Date(Date.UTC(
          selectedDate.getUTCFullYear(),
          selectedDate.getUTCMonth(),
          selectedDate.getUTCDate(),
          0, 0, 0, 0
        ))
        const selectedEnd = new Date(Date.UTC(
          selectedDate.getUTCFullYear(),
          selectedDate.getUTCMonth(),
          selectedDate.getUTCDate(),
          23, 59, 59, 999
        ))
        dateStart = selectedStart.toISOString()
        dateEnd = selectedEnd.toISOString()
      }

      // Fetch calls for date range (and last 3 days for comparison)
      const { data: calls, error: callsError } = await supabase
        .from('dialpad_calls')
        .select('*')
        .gte('created_at', threeDaysAgoUTC)
        .order('created_at', { ascending: false })

      if (callsError) throw callsError

      // Fetch SMS for date range (and last 3 days for comparison)
      const { data: sms, error: smsError } = await supabase
        .from('dialpad_sms')
        .select('*')
        .gte('created_at', threeDaysAgoUTC)
        .order('created_at', { ascending: false })

      if (smsError) throw smsError

      // Fetch emails for date range (and last 3 days for comparison)
      const { data: emails, error: emailsError } = await supabase
        .from('dialpad_emails')
        .select('*')
        .gte('created_at', threeDaysAgoUTC)
        .order('created_at', { ascending: false })

      if (emailsError) throw emailsError

      const typedCalls = (calls || []) as DialpadCall[]
      const typedSms = (sms || []) as DialpadSms[]
      const typedEmails = (emails || []) as DialpadEmail[]
      
      // Store all data for charts
      setAllCalls(typedCalls)
      setAllSms(typedSms)
      setAllEmails(typedEmails)

      // Filter data for selected date (or today if none selected)
      const filteredCalls = typedCalls.filter(c => {
        const callDate = new Date(c.created_at)
        return callDate >= new Date(dateStart) && callDate <= new Date(dateEnd)
      })
      
      const filteredSms = typedSms.filter(s => {
        const smsDate = new Date(s.created_at)
        return smsDate >= new Date(dateStart) && smsDate <= new Date(dateEnd)
      })

      const filteredEmails = typedEmails.filter(e => {
        const emailDate = new Date(e.created_at)
        return emailDate >= new Date(dateStart) && emailDate <= new Date(dateEnd)
      })

      // Calculate metrics for selected date
      const uniqueCalls = filteredCalls.length
      const outboundCalls = filteredCalls.filter((c) => c.direction === 'outbound').length
      const inboundCalls = filteredCalls.filter((c) => c.direction === 'inbound').length
      const callsOver30s = filteredCalls.filter((c) => c.duration > 30).length
      const smsSent = filteredSms.filter((s) => s.direction === 'outbound').length
      const smsReceived = filteredSms.filter((s) => s.direction === 'inbound').length
      const emailsSent = filteredEmails.filter((e) => e.direction === 'outbound').length
      const emailsReceived = filteredEmails.filter((e) => e.direction === 'inbound').length

      // Helper function to check if an email is a lead email
      const isLeadEmail = (subject: string | null): boolean => {
        if (!subject) return false
        const normalizedSubject = subject
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&#39;/g, "'")
          .trim()
        const leadPatterns = [
          /^New message from\s+"[^"]+"$/i,
          /^New message from\s+'[^']+'$/i,
          /^New Meta Lead$/i,
          /^New Entry - Lead Form$/i,
        ]
        return leadPatterns.some(pattern => pattern.test(normalizedSubject))
      }

      // Build filters for extracted leads:
      // - Leads linked to filtered lead emails
      // - Leads created/extracted inside the selected date window (to include manual adds)
      const leadEmailIds = filteredEmails
        .filter((e) => isLeadEmail(e.subject))
        .map((e) => e.id)

      const leadFilters = [
        `and(created_at.gte.${dateStart},created_at.lte.${dateEnd})`,
        `and(extracted_at.gte.${dateStart},extracted_at.lte.${dateEnd})`,
      ]

      if (leadEmailIds.length > 0) {
        const quotedIds = leadEmailIds.map((id) => `"${id}"`).join(',')
        leadFilters.push(`email_id.in.(${quotedIds})`)
      }

      let extractedLeadsData: ExtractedLead[] = []
      try {
        const leadQuery = supabase
          .from('extracted_leads')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(100)

        const finalQuery = leadFilters.length > 0 ? leadQuery.or(leadFilters.join(',')) : leadQuery

        const { data: extractedLeads, error: extractedLeadsError } = await finalQuery

        if (extractedLeadsError) {
          console.error('Error fetching extracted leads:', extractedLeadsError)
        } else if (extractedLeads) {
          const emailMap = new Map(filteredEmails.map((e) => [e.id, e]))
          extractedLeadsData = extractedLeads.map((lead: any) => {
            const email = emailMap.get(lead.email_id)
            const combinedLead: ExtractedLead = {
              ...lead,
              email_subject: email?.subject,
              email_created_at: email?.created_at,
            }
            return {
              ...combinedLead,
              lead_to_call_minutes: calculateLeadToCallMinutes(combinedLead),
            }
          })
        }
      } catch (extractedLeadsErr) {
        console.error('Error fetching extracted leads:', extractedLeadsErr)
        // Don't fail the whole function if extracted leads query fails
      }

      // Fetch quotes to count unique leads quoted during the window
      let quotesForUniqueLeads = 0
      try {
        const { data: quotesData, error: quotesError } = await supabase
          .from('quotes')
          .select('lead_id, created_at')
          .gte('created_at', dateStart)
          .lte('created_at', dateEnd)

        if (quotesError) {
          console.error('Error fetching quotes for metrics:', quotesError)
        } else if (quotesData) {
          const unique = new Set(
            (quotesData as any[])
              .map((q) => q.lead_id)
              .filter((id): id is string => Boolean(id))
          )
          quotesForUniqueLeads = unique.size
        }
      } catch (quotesErr) {
        console.error('Error fetching quotes for metrics:', quotesErr)
      }

      setMetrics({
        uniqueCalls,
        outboundCalls,
        inboundCalls,
        callsOver30s,
        smsSent,
        smsReceived,
        emailsSent,
        emailsReceived,
        leads: extractedLeadsData.length,
        quotesForUniqueLeads,
        averageLeadToCallMinutes: (() => {
          const leadDurations = extractedLeadsData
            .map((lead) => lead.lead_to_call_minutes)
            .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))
          if (leadDurations.length === 0) return 0
          const sum = leadDurations.reduce((acc, val) => acc + val, 0)
          return Number((sum / leadDurations.length).toFixed(1))
        })(),
        medianLeadToCallMinutes: (() => {
          const leadDurations = extractedLeadsData
            .map((lead) => lead.lead_to_call_minutes)
            .filter((value): value is number => typeof value === 'number' && !Number.isNaN(value))
          if (leadDurations.length === 0) return 0
          const sorted = [...leadDurations].sort((a, b) => a - b)
          const mid = Math.floor(sorted.length / 2)
          const median =
            sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
          return Number(median.toFixed(1))
        })(),
      })
      setExtractedLeads(extractedLeadsData)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Error fetching metrics:', err)
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics')
    } finally {
      setIsLoading(false)
    }
  }, [getStartOfToday, selectedDate])

  // Initial fetch and realtime subscription
  useEffect(() => {
    fetchMetrics()

    // Subscribe to realtime changes on dialpad_calls
    const callsChannel = supabase
      .channel('dialpad_calls_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dialpad_calls',
        },
        () => {
          console.log('Call data changed, refreshing...')
          fetchMetrics()
        }
      )
      .subscribe()

    // Subscribe to realtime changes on dialpad_sms
    const smsChannel = supabase
      .channel('dialpad_sms_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dialpad_sms',
        },
        () => {
          console.log('SMS data changed, refreshing...')
          fetchMetrics()
        }
      )
      .subscribe()

    // Subscribe to realtime changes on dialpad_emails
    const emailsChannel = supabase
      .channel('dialpad_emails_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dialpad_emails',
        },
        () => {
          console.log('Email data changed, refreshing...')
          fetchMetrics()
        }
      )
      .subscribe()

    // Subscribe to realtime changes on extracted_leads
    const extractedLeadsChannel = supabase
      .channel('extracted_leads_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'extracted_leads',
        },
        () => {
          console.log('Extracted leads changed, refreshing...')
          fetchMetrics()
        }
      )
      .subscribe()

    // Cleanup subscriptions on unmount
    return () => {
      supabase.removeChannel(callsChannel)
      supabase.removeChannel(smsChannel)
      supabase.removeChannel(emailsChannel)
      supabase.removeChannel(extractedLeadsChannel)
    }
  }, [fetchMetrics])

  const handleRefresh = () => {
    setIsLoading(true)
    fetchMetrics()
  }

  const handleSyncEmails = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(
        'https://etiaoqskgplpfydblzne.supabase.co/functions/v1/outlook-email-sync',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
      
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.details || 'Failed to sync emails')
      }
      
      const result = await response.json()
      console.log('Email sync result:', result)
      
      // Refresh metrics after sync
      setTimeout(() => {
        fetchMetrics()
      }, 1000)
    } catch (err) {
      console.error('Error syncing emails:', err)
      setError(err instanceof Error ? err.message : 'Failed to sync emails')
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpdateLeadStatus = async (leadId: string, status: string) => {
    try {
      setLeadStatusError(null)
      setSavingStatusId(leadId)

      const response = await fetch(`${supabaseUrl}/functions/v1/update-lead-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify({ leadId, status }),
      })

      const result = await response.json()
      if (!response.ok || result?.error) {
        const details = result?.error || 'Failed to update lead status'
        throw new Error(details)
      }

      setExtractedLeads((prev) => prev.map((lead) => (lead.id === leadId ? { ...lead, status } : lead)))
    } catch (err) {
      console.error('Error updating lead status:', err)
      setLeadStatusError(err instanceof Error ? err.message : 'Failed to update lead status')
    } finally {
      setSavingStatusId(null)
    }
  }

  const handleCallLead = async (leadId: string, phoneNumber?: string | null) => {
    if (!phoneNumber) {
      setLeadCallError('No phone number available for this lead.')
      return
    }

    const leadRecord = extractedLeads.find((lead) => lead.id === leadId)
    const hasFirstContact = Boolean(leadRecord?.first_contact)

    setLeadCallError(null)
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

      // Record the first contact time the first time "Call Lead" is pressed
      if (!hasFirstContact) {
        // Persist as epoch milliseconds to match numeric column type
        const nowMs = Date.now()
        const { data: updatedLead, error: updateError } = await supabase
          .from('extracted_leads')
          .update({ first_contact: nowMs })
          .eq('id', leadId)
          .is('first_contact', null)
          .select('*')
          .maybeSingle()

        if (updateError) {
          console.error('Error recording first contact time:', updateError)
          setLeadCallError(updateError.message || 'Failed to record first contact time')
        } else {
          const firstContactValue = updatedLead?.first_contact ?? nowMs
          setExtractedLeads((prev) =>
            prev.map((lead) => {
              if (lead.id !== leadId) return lead
              const nextFirstContact = lead.first_contact || firstContactValue
              return {
                ...lead,
                first_contact: nextFirstContact,
                lead_to_call_minutes: calculateLeadToCallMinutes({
                  ...lead,
                  first_contact: nextFirstContact,
                }),
              }
            })
          )
        }
      }
    } catch (err) {
      console.error('Error calling lead:', err)
      setLeadCallError(err instanceof Error ? err.message : 'Failed to initiate call')
    } finally {
      setCallingLeadId(null)
    }
  }

  const resetManualLeadForm = () => {
    setManualLead({
      name: '',
      phone_number: '',
      email: '',
      region_notes: '',
    })
    setManualLeadError(null)
    setShowManualLeadForm(false)
  }

  const handleSaveManualLead = async () => {
    const name = manualLead.name.trim()
    const phone = manualLead.phone_number.trim()
    const email = manualLead.email.trim()
    const notes = manualLead.region_notes.trim()

    if (!name || !phone || !email) {
      setManualLeadError('Name, phone, and email are required.')
      return
    }

    if (!isValidAusPhone(phone)) {
      setManualLeadError('Phone must be Australian format: +61 followed by 8–9 digits.')
      return
    }

    if (!isValidEmail(email)) {
      setManualLeadError('Email looks invalid. Please use a standard email format.')
      return
    }

    setSavingManualLead(true)
    setManualLeadError(null)

    try {
      const now = new Date().toISOString()
      const emailId = generateUuid()

      // Insert a minimal synthetic email row to satisfy FK and allow traceability
      const { error: emailInsertError } = await supabase
        .from('dialpad_emails')
        .insert({
          id: emailId,
          message_id: `manual-${emailId}`,
          direction: 'inbound',
          subject: 'Manual lead entry',
          from_email: email,
          to_email: 'manual-entry@local',
          created_at: now,
          body: notes || null,
          summary: null,
        })

      if (emailInsertError) {
        console.error('Error inserting synthetic email for manual lead:', emailInsertError)
        setManualLeadError(emailInsertError.message || 'Failed to create lead email link.')
        return
      }

      const payload = {
        email_id: emailId,
        name,
        phone_number: phone,
        email,
        region_notes: notes || null,
        extracted_at: now,
        created_at: now,
        status: null,
      }

      const { data, error: insertError } = await supabase
        .from('extracted_leads')
        .insert(payload)
        .select('*')
        .single()

      if (insertError) {
        console.error('Error saving manual lead:', insertError)
        setManualLeadError(insertError.message || 'Failed to save lead. Try again.')
        return
      }

      const insertedLead: ExtractedLead = {
        ...payload,
        ...(data || {}),
      }

      const leadWithTiming = {
        ...insertedLead,
        lead_to_call_minutes: calculateLeadToCallMinutes(insertedLead),
      }

      setExtractedLeads((prev) => [leadWithTiming, ...prev])
      resetManualLeadForm()
    } catch (err) {
      console.error('Error saving manual lead:', err)
      setManualLeadError(err instanceof Error ? err.message : 'Failed to save lead. Try again.')
    } finally {
      setSavingManualLead(false)
    }
  }

  return (
    <div className="min-h-screen p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-white mb-2 flex items-center gap-3">
                <svg
                  className="w-10 h-10 text-cyan-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                  />
                </svg>
                Dialpad Dashboard
              </h1>
              <p className="text-[var(--color-text-muted)]">
                Real-time communication metrics
              </p>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <DatePicker selectedDate={selectedDate} onDateChange={setSelectedDate} />
              <LiveIndicator />

              <button
                onClick={() => (window.location.href = '/salesfunnel')}
                className="flex items-center gap-2 px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white rounded-xl transition-all duration-200 border border-white/10"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 7h18M6 12h12M9 17h6"
                  />
                </svg>
                Sales funnel
              </button>

              <button
                onClick={handleSyncEmails}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Sync emails from Outlook"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                  />
                </svg>
                Sync Emails
              </button>

              <button
                onClick={handleRefresh}
                disabled={isLoading}
                className="flex items-center gap-2 px-4 py-2.5 bg-[var(--color-surface-light)] hover:bg-[var(--color-surface-lighter)] text-white rounded-xl transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed border border-white/10"
              >
                <svg
                  className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Refresh
              </button>
            </div>
          </div>

          {/* Last updated timestamp */}
          <div className="mt-4 text-sm text-[var(--color-text-muted)]">
            Last updated:{' '}
            <span className="font-mono text-cyan-400">
              {lastUpdated.toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </span>
          </div>
        </header>

        {/* Error state */}
        {error && (
          <div className="mb-8 p-4 glass-card rounded-xl border border-red-500/20 bg-red-500/10">
            <div className="flex items-center gap-3">
              <svg
                className="w-6 h-6 text-red-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className="text-red-400 font-medium">Error loading metrics</p>
                <p className="text-red-300/70 text-sm">{error}</p>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start mb-8">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Key Activity</h2>
              <span className="text-xs text-[var(--color-text-muted)]">Compact view</span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {/* Unique Calls */}
              <MetricCard
                title={selectedDate ? "Unique Calls" : "Unique Calls Today"}
                value={metrics.uniqueCalls}
                color="cyan"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                }
              />

              {/* Outbound Calls */}
              <MetricCard
                title="Outbound Calls"
                value={metrics.outboundCalls}
                color="orange"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16 3h5m0 0v5m0-5l-6 6M5 3a2 2 0 00-2 2v1c0 8.284 6.716 15 15 15h1a2 2 0 002-2v-3.28a1 1 0 00-.684-.948l-4.493-1.498a1 1 0 00-1.21.502l-1.13 2.257a11.042 11.042 0 01-5.516-5.517l2.257-1.128a1 1 0 00.502-1.21L9.228 3.683A1 1 0 008.279 3H5z"
                    />
                  </svg>
                }
              />

              {/* Inbound Calls */}
              <MetricCard
                title="Inbound Calls"
                value={metrics.inboundCalls}
                color="green"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                }
              />

              {/* Calls >30s */}
              <MetricCard
                title="Calls >30 Seconds"
                value={metrics.callsOver30s}
                color="emerald"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
              />

              {/* SMS Sent */}
              <MetricCard
                title="SMS Sent"
                value={metrics.smsSent}
                color="violet"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                }
              />

              {/* SMS Received */}
              <MetricCard
                title="SMS Received"
                value={metrics.smsReceived}
                color="violet"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                }
              />

              {/* Emails Sent */}
              <MetricCard
                title={selectedDate ? "Emails Sent" : "Emails Sent Today"}
                value={metrics.emailsSent}
                color="blue"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                }
              />

              {/* Emails Received */}
              <MetricCard
                title={selectedDate ? "Emails Received" : "Emails Received Today"}
                value={metrics.emailsReceived}
                color="blue"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                    />
                  </svg>
                }
              />

              {/* Leads */}
              <MetricCard
                title={selectedDate ? "Leads" : "Leads Today"}
                value={metrics.leads}
                color="emerald"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                }
              />
              <MetricCard
                title="Quotes (Unique Leads)"
                value={metrics.quotesForUniqueLeads}
                color="blue"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v8m-4-4h8M4 6h16v12H4z" />
                  </svg>
                }
              />
              <MetricCard
                title="Lead → Call Avg (min)"
                value={metrics.averageLeadToCallMinutes}
                color="emerald"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m5-3a8 8 0 11-16 0 8 8 0 0116 0z"
                    />
                  </svg>
                }
              />
              <MetricCard
                title="Lead → Call Median (min)"
                value={metrics.medianLeadToCallMinutes}
                color="emerald"
                isLoading={isLoading}
                icon={
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 6v6l4 2m-9.97 2.757a9 9 0 1116.97-5.757"
                    />
                  </svg>
                }
              />
            </div>
          </div>

          <div
            className="glass-card rounded-xl overflow-hidden flex flex-col h-full"
            style={{ maxHeight: '62vh' }}
          >
            <div className="p-3 border-b border-white/10 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-emerald-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h2 className="text-base font-semibold text-white">Extracted Lead Information</h2>
                    <p className="text-[11px] text-[var(--color-text-muted)]">Compact, scrollable lead info with quick status updates.</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowManualLeadForm(true)
                    setManualLeadError(null)
                    setManualLead({
                      name: '',
                      phone_number: '',
                      email: '',
                      region_notes: '',
                    })
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Add lead
                </button>
              </div>
              <span className="text-[10px] text-[var(--color-text-muted)]">Status changes write back to the leads table.</span>
            </div>

            {leadStatusError && (
              <div className="mx-4 mt-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                {leadStatusError}
              </div>
            )}
            {leadCallError && (
              <div className="mx-4 mt-2 p-2 bg-orange-500/10 border border-orange-500/20 rounded text-orange-300 text-xs">
                {leadCallError}
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {showManualLeadForm && (
                <div className="p-3 rounded-lg shadow-sm flex flex-col gap-2 border border-emerald-500/40 bg-[var(--color-surface)] new-lead-border">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">New lead from phone</div>
                    <button
                      onClick={resetManualLeadForm}
                      className="text-[10px] text-[var(--color-text-muted)] hover:text-white"
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase text-[var(--color-text-muted)]">Name</label>
                      <input
                        value={manualLead.name}
                        onChange={(e) => setManualLead((prev) => ({ ...prev, name: e.target.value }))}
                        className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-2 py-1.5 text-sm text-white"
                        placeholder="Customer name"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase text-[var(--color-text-muted)]">Phone (+61…)</label>
                      <input
                        value={manualLead.phone_number}
                        onChange={(e) => setManualLead((prev) => ({ ...prev, phone_number: e.target.value }))}
                        className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-2 py-1.5 text-sm text-white"
                        placeholder="+614xxxxxxxx"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] uppercase text-[var(--color-text-muted)]">Email</label>
                      <input
                        type="email"
                        value={manualLead.email}
                        onChange={(e) => setManualLead((prev) => ({ ...prev, email: e.target.value }))}
                        className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-2 py-1.5 text-sm text-white"
                        placeholder="name@example.com"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[10px] uppercase text-[var(--color-text-muted)]">Region / Notes</label>
                      <textarea
                        rows={2}
                        value={manualLead.region_notes}
                        onChange={(e) => setManualLead((prev) => ({ ...prev, region_notes: e.target.value }))}
                        className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-2 py-1.5 text-sm text-white"
                        placeholder="Suburb or quick notes from the call"
                      />
                    </div>
                  </div>

                  {manualLeadError && (
                    <div className="p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300 text-xs">{manualLeadError}</div>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      onClick={handleSaveManualLead}
                      disabled={savingManualLead}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60"
                      type="button"
                    >
                      {savingManualLead ? (
                        <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                      )}
                      {savingManualLead ? 'Saving…' : 'Save lead'}
                    </button>
                    <span className="text-[10px] text-[var(--color-text-muted)]">
                      Must be +61 with 8–9 digits; email must be valid.
                    </span>
                  </div>
                </div>
              )}
              {extractedLeads.length > 0 ? (
                extractedLeads.map((lead) => {
                  const statusStyle = getStatusStyle(lead.status)
                  const newLead = isNewLead(lead)
                  const isPaid = lead.status?.toLowerCase() === 'paid'

                  return (
                    <div
                      key={lead.id}
                      className={`relative p-3 rounded-lg shadow-sm flex flex-col gap-2 border ${statusStyle.border} ${statusStyle.bg} ${
                        newLead ? 'new-lead-border' : ''
                      } ${isPaid ? 'opacity-85' : ''}`}
                    >
                      {isPaid && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/25 text-emerald-100 border border-emerald-400/40">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Paid
                        </span>
                      )}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1 text-xs">
                          {lead.name && (
                            <div>
                              <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">Name</span>
                              <p className="text-white font-medium mt-0.5">{lead.name}</p>
                            </div>
                          )}
                          {lead.phone_number && (
                            <div>
                              <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">Phone</span>
                              <p className="text-white font-medium mt-0.5">{lead.phone_number}</p>
                            </div>
                          )}
                          {lead.email && (
                            <div>
                              <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">Email</span>
                              <p className="text-white font-medium mt-0.5 truncate">{lead.email}</p>
                            </div>
                          )}
                          {lead.region_notes && (
                            <div>
                              <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">Region/Notes</span>
                              <p className="text-white text-sm mt-0.5">{lead.region_notes}</p>
                            </div>
                          )}
                          {(lead.last_text_date || lead.last_text_body) && (
                            <div>
                              <span className="text-[var(--color-text-muted)] uppercase tracking-wider text-[10px]">Last Text</span>
                              {getLastTextDate(lead) && (
                                <p className="text-white font-medium mt-0.5">
                                  {getLastTextDate(lead)?.toLocaleString()}
                                </p>
                              )}
                              {lead.last_text_body && (
                                <p
                                  className="text-[var(--color-text-muted)] text-xs mt-0.5 truncate"
                                  title={lead.last_text_body}
                                >
                                  “{lead.last_text_body}”
                                </p>
                              )}
                            </div>
                          )}
                          <div className="text-[var(--color-text-muted)] text-[10px] pt-1 border-t border-white/5 mt-1">
                            {lead.email_created_at
                              ? new Date(lead.email_created_at).toLocaleString()
                              : new Date(lead.extracted_at || lead.created_at || '').toLocaleString()}
                          </div>
                          <div className="flex items-center gap-2 text-[10px] pt-1">
                            <span className="text-[var(--color-text-muted)] uppercase tracking-wider">Lead → Call</span>
                            <span className={lead.first_contact ? 'text-emerald-200 font-semibold' : 'text-amber-300 font-semibold'}>
                              {formatLeadToCallText(lead.lead_to_call_minutes)}
                            </span>
                            {getFirstContactDate(lead) && (
                              <span className="text-[var(--color-text-muted)]">
                                at {getFirstContactDate(lead)?.toLocaleTimeString()}
                              </span>
                            )}
                            {newLead && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-100 font-semibold">
                                New
                              </span>
                            )}
                          </div>
                        </div>
                        {lead.status && (
                          <span className={`px-2 py-1 text-[11px] rounded-full font-medium ${statusStyle.pillBg} ${statusStyle.pillText}`}>
                            {lead.status}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider">Status</span>
                        <select
                          value={lead.status || ''}
                          onChange={(e) => handleUpdateLeadStatus(lead.id, e.target.value)}
                          disabled={savingStatusId === lead.id}
                          className="bg-[var(--color-surface-light)] text-white text-xs rounded-lg px-2 py-1 border border-white/10 focus:outline-none focus:ring-1 focus:ring-emerald-400"
                        >
                          <option value="">Select status</option>
                          {LEAD_STATUS_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        {savingStatusId === lead.id && (
                          <svg className="w-4 h-4 animate-spin text-emerald-300" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        )}
                        <SmsLead
                          leadId={lead.id}
                          leadName={lead.name}
                          phoneNumber={lead.phone_number}
                          dialpadToken={dialpadToken}
                          dialpadUserId={dialpadUserId}
                          onSent={({ sentAt, message }) => {
                            setExtractedLeads((prev) =>
                              prev.map((l) =>
                                l.id === lead.id ? { ...l, last_text_date: sentAt, last_text_body: message } : l
                              )
                            )
                          }}
                        />
                        <button
                          onClick={() => setQuoteLead(lead)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                          </svg>
                          Create Quote
                        </button>
                        <button
                          onClick={() => handleCallLead(lead.id, lead.phone_number)}
                          disabled={callingLeadId === lead.id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors disabled:opacity-60"
                        >
                          {callingLeadId === lead.id ? (
                            <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.05 5.05a7 7 0 010 9.9m-2.83-7.07a3 3 0 010 4.24m-2.12 1.41a10.97 10.97 0 004.95 4.95l1.7-1.7a1 1 0 011.01-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1C10.611 21 3 13.389 3 4a1 1 0 011-1h3.83a1 1 0 011 1c0 1.24.2 2.45.57 3.57a1 1 0 01-.24 1.01l-1.7 1.7z" />
                            </svg>
                          )}
                          Call Lead
                        </button>
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="flex items-center justify-center h-full text-[var(--color-text-muted)] text-sm">
                  No extracted leads yet. Leads will appear here automatically when emails are synced.
                </div>
              )}
            </div>
          </div>
        </div>


        {/* Charts Section */}
        <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Day Comparison Chart */}
          <DayComparisonChart calls={allCalls} sms={allSms} emails={allEmails} isLoading={isLoading} />
          
          {/* Hourly Activity */}
          <HourlyActivity calls={allCalls} selectedDate={selectedDate} isLoading={isLoading} />
        </div>

        {/* Leads Section */}
        <Lead />

        {/* Communications Log */}
        <CommunicationsLog />

        {/* Footer */}
        <footer className="mt-12 text-center text-[var(--color-text-muted)] text-sm">
          <p>
            Powered by{' '}
            <a
              href="https://supabase.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Supabase
            </a>{' '}
            Real-time
          </p>
        </footer>
      </div>

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

