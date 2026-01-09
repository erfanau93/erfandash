import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { supabase, type DialpadEmail } from '../lib/supabase'
import { startOfDay, endOfDay, addDays, isSameDay } from 'date-fns'
import QuoteTool from './QuoteTool'

interface ExtractedLead {
  id?: string
  email_id: string
  name: string | null
  phone_number: string | null
  email: string | null
  region_notes: string | null
  extracted_at?: string
  status?: string | null
  first_contact?: string | number | null
  last_text_date?: string | null
  last_text_body?: string | null
}

interface LeadEmail extends DialpadEmail {
  external_number?: string | null
  extractedLead?: ExtractedLead | null
}

interface LeadModalProps {
  email: LeadEmail
  onClose: () => void
  onExtracted?: () => void
}

function LeadModal({ email, onClose, onExtracted }: LeadModalProps) {
  const [extractedLead, setExtractedLead] = useState<ExtractedLead | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionError, setExtractionError] = useState<string | null>(null)

  // Handle ESC key to close modal
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  // Fetch extracted lead data
  useEffect(() => {
    const fetchExtractedLead = async () => {
      try {
        const { data, error } = await supabase
          .from('extracted_leads')
          .select('*')
          .eq('email_id', email.id)
          .single()

        if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
          console.error('Error fetching extracted lead:', error)
          return
        }

        if (data) {
          setExtractedLead(data)
        }
      } catch (error) {
        console.error('Error fetching extracted lead:', error)
      }
    }

    fetchExtractedLead()
  }, [email.id])

  const handleExtractLead = async () => {
    setIsExtracting(true)
    setExtractionError(null)

    try {
      const { data, error } = await supabase.functions.invoke('extract-lead-info', {
        body: { email_id: email.id },
      })
      if (error) throw error

      const payload: any = data || {}
      if (payload.success) {
        // Fetch the freshly stored row so we keep the lead id for quote linking
        try {
          const { data: persisted, error: persistedError } = await supabase
            .from('extracted_leads')
            .select('*')
            .eq('email_id', email.id)
            .single()

          if (persistedError) {
            console.warn('Lead extracted but fetching saved record failed, falling back to payload', persistedError)
          }

          setExtractedLead(
            persisted || {
              email_id: email.id,
              name: payload.name,
              phone_number: payload.phone_number,
              email: payload.email,
              region_notes: payload.region_notes,
              extracted_at: payload.extracted_at,
            }
          )
        } catch (fetchErr) {
          console.warn('Lead extracted but persisted row lookup failed', fetchErr)
          setExtractedLead({
            email_id: email.id,
            name: payload.name,
            phone_number: payload.phone_number,
            email: payload.email,
            region_notes: payload.region_notes,
            extracted_at: payload.extracted_at,
          })
        }
        // Notify parent to refresh leads list
        if (onExtracted) {
          onExtracted()
        }
      } else {
        setExtractionError(payload.error || 'Failed to extract lead information')
      }
    } catch (error) {
      console.error('Error extracting lead:', error)
      setExtractionError('Failed to extract lead information. Please try again.')
    } finally {
      setIsExtracting(false)
    }
  }

  const isPaid = extractedLead?.status?.toLowerCase() === 'paid'

  return (
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
      onClick={onClose}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    >
      <div 
        className="bg-[var(--color-surface)] border border-white/10 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <h3 className="text-white font-semibold">Lead Details</h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                {email.from_email || 'Unknown Contact'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
          >
            <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto max-h-[60vh]">
          {/* Extracted Lead Information */}
          <div className="mb-6 p-4 rounded-xl bg-gradient-to-br from-emerald-500/10 to-green-500/10 border border-emerald-500/20">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-emerald-400 uppercase tracking-wider">
                Extracted Lead Information
              </h4>
            {isPaid && (
              <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-500/30">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Paid
              </span>
            )}
              {!extractedLead && (
                <button
                  onClick={handleExtractLead}
                  disabled={isExtracting}
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 rounded-lg transition-colors disabled:opacity-50"
                >
                  {isExtracting ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Extracting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      Extract Lead Info
                    </>
                  )}
                </button>
              )}
            </div>

            {extractionError && (
              <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-xs">
                {extractionError}
              </div>
            )}

            {extractedLead ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Name</span>
                  <p className="text-white font-medium mt-1">{extractedLead.name || '-'}</p>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Phone Number</span>
                  <p className="text-white font-medium mt-1">{extractedLead.phone_number || '-'}</p>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Email</span>
                  <p className="text-white font-medium mt-1">{extractedLead.email || '-'}</p>
                </div>
                <div>
                  <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Region/Notes</span>
                  <p className="text-white font-medium mt-1">{extractedLead.region_notes || '-'}</p>
                </div>
              </div>
            ) : (
              <p className="text-[var(--color-text-muted)] text-sm italic">
                Click "Extract Lead Info" to automatically extract lead information using AI.
              </p>
            )}
          </div>

          <div className="mb-6">
            <QuoteTool lead={extractedLead} emailId={email.id} />
          </div>

          {/* Subject */}
          <div className="mb-4">
            <h4 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
              Subject
            </h4>
            <p className="text-white text-lg font-medium">{email.subject || 'No subject'}</p>
          </div>

          {/* Email Body */}
          {email.body && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                Email Body
              </h4>
              <div className="p-4 rounded-xl bg-[var(--color-surface-light)] border border-white/5 max-h-96 overflow-y-auto">
                <div 
                  className="email-body-content"
                  dangerouslySetInnerHTML={{ __html: email.body }}
                  style={{
                    color: 'white',
                    fontFamily: 'inherit',
                    fontSize: '0.875rem',
                    lineHeight: '1.5',
                  }}
                />
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="mt-6 pt-4 border-t border-white/10">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-[var(--color-text-muted)]">From:</span>
                <span className="ml-2 text-white">{email.from_email || '-'}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">To:</span>
                <span className="ml-2 text-white">{email.to_email || '-'}</span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Date:</span>
                <span className="ml-2 text-white">
                  {new Date(email.created_at).toLocaleString()}
                </span>
              </div>
              <div>
                <span className="text-[var(--color-text-muted)]">Direction:</span>
                <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium ${
                  email.direction === 'outbound' 
                    ? 'bg-orange-500/20 text-orange-400' 
                    : 'bg-green-500/20 text-green-400'
                }`}>
                  {email.direction === 'outbound' ? 'Sent' : 'Received'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper function to check if an email subject matches lead patterns
function isLeadEmail(subject: string | null): boolean {
  if (!subject) return false
  
  // Normalize the subject: decode HTML entities and normalize quotes
  const normalizedSubject = subject
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .trim()
  
  // Check for lead patterns
  const leadPatterns = [
    /^New message from\s+"[^"]+"$/i,
    /^New message from\s+'[^']+'$/i,
    /^New Meta Lead$/i,
    /^New Entry - Lead Form$/i,
  ]
  
  return leadPatterns.some(pattern => pattern.test(normalizedSubject))
}

export default function Lead() {
  const [leads, setLeads] = useState<LeadEmail[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedLead, setSelectedLead] = useState<LeadEmail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [expandedContacts, setExpandedContacts] = useState<Set<string>>(new Set())

  const fetchLeads = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      console.log('[Lead] Fetching emails...')

      // Fetch emails
      const { data: emails, error: emailsError } = await supabase
        .from('dialpad_emails')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(selectedDate ? 200 : 100)

      if (emailsError) {
        console.error('[Lead] Error fetching emails:', emailsError)
        throw emailsError
      }
      
      console.log('[Lead] Fetched emails:', emails?.length || 0)

      // Filter emails for selected date if provided
      let filteredEmails = emails || []
      if (selectedDate) {
        const startOfSelectedDay = startOfDay(selectedDate)
        const endOfSelectedDay = endOfDay(selectedDate)
        
        filteredEmails = filteredEmails.filter(email => {
          const emailDate = new Date(email.created_at)
          return emailDate >= startOfSelectedDay && emailDate <= endOfSelectedDay
        })
      }

      // Filter for lead emails based on subject patterns
      const leadEmails: LeadEmail[] = filteredEmails
        .filter((email: DialpadEmail) => isLeadEmail(email.subject))
        .map((email: DialpadEmail) => ({
          ...email,
          external_number: email.direction === 'inbound' ? email.from_email : email.to_email,
        }))

      // Fetch extracted lead data for all lead emails
      const leadIds = leadEmails.map(lead => lead.id)
      if (leadIds.length > 0) {
        try {
          const { data: extractedLeads, error: extractedLeadsError } = await supabase
            .from('extracted_leads')
            .select('*')
            .in('email_id', leadIds)

          if (extractedLeadsError) {
            console.error('Error fetching extracted leads:', extractedLeadsError)
            // Still set leads even if extracted leads query fails
            setLeads(leadEmails)
          } else {
            // Create a map of email_id to extracted lead data
            const extractedMap = new Map(
              (extractedLeads || []).map(lead => [lead.email_id, lead])
            )

            // Add extracted lead data to lead emails
            const leadsWithExtracted = leadEmails.map(lead => ({
              ...lead,
              extractedLead: extractedMap.get(lead.id) || null,
            }))

            setLeads(leadsWithExtracted as LeadEmail[])
          }
        } catch (extractedLeadsErr) {
          console.error('Error fetching extracted leads:', extractedLeadsErr)
          // Still set leads even if extracted leads query fails
          setLeads(leadEmails)
        }
      } else {
        setLeads(leadEmails)
      }

      console.log(`[Lead] Loaded ${leadEmails.length} lead emails`)
    } catch (error) {
      console.error('Error fetching leads:', error)
      setError(error instanceof Error ? error.message : 'Failed to fetch leads')
    } finally {
      setIsLoading(false)
    }
  }, [selectedDate])

  useEffect(() => {
    fetchLeads()

    // Subscribe to realtime updates for emails
    const emailsChannel = supabase
      .channel('leads_email_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dialpad_emails' }, () => {
        console.log('Email data changed, refreshing leads...')
        fetchLeads()
      })
      .subscribe()

    // Subscribe to realtime updates for extracted leads
    const extractedLeadsChannel = supabase
      .channel('extracted_leads_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'extracted_leads' }, () => {
        console.log('Extracted leads data changed, refreshing leads...')
        fetchLeads()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(emailsChannel)
      supabase.removeChannel(extractedLeadsChannel)
    }
  }, [fetchLeads])

  const toggleContactExpand = (leadId: string) => {
    setExpandedContacts(prev => {
      const newSet = new Set(prev)
      if (newSet.has(leadId)) {
        newSet.delete(leadId)
      } else {
        newSet.add(leadId)
      }
      return newSet
    })
  }

  const getContactDisplay = (lead: LeadEmail, full: boolean = false) => {
    const email = lead.direction === 'inbound' ? lead.from_email : lead.to_email
    if (!full && email && email.length > 20) {
      return email.substring(0, 17) + '...'
    }
    return email || 'Unknown'
  }

  const getSubjectPreview = (subject: string | null) => {
    if (!subject) return 'No subject'
    // Decode HTML entities for display
    const decoded = subject
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
    return decoded.length > 50 ? decoded.substring(0, 47) + '...' : decoded
  }

  return (
    <div className="mt-8 glass-card rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-white/10">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">Leads</h2>
                <p className="text-xs text-[var(--color-text-muted)]">Filtered lead emails from forms and Meta</p>
              </div>
            </div>
          </div>

          {/* Date Filter */}
          <div className="flex items-center gap-1.5">
            {[
              { label: 'Today', date: new Date() },
              { label: 'Yesterday', date: addDays(new Date(), -1) },
              { label: 'Tomorrow', date: addDays(new Date(), 1) },
            ].map(({ label, date }) => (
              <button
                key={label}
                onClick={() => {
                  if (selectedDate && isSameDay(date, selectedDate)) {
                    setSelectedDate(null)
                  } else {
                    setSelectedDate(date)
                  }
                }}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                  selectedDate && isSameDay(date, selectedDate)
                    ? 'bg-emerald-500 text-white'
                    : 'bg-[var(--color-surface-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-lighter)]'
                }`}
              >
                {label}
              </button>
            ))}
            {selectedDate && (
              <button
                onClick={() => setSelectedDate(null)}
                className="px-2 py-1 text-xs text-[var(--color-text-muted)] hover:text-white"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-4 mx-6 mt-4 bg-red-500/10 border border-red-500/20 rounded-xl">
          <div className="flex items-center gap-2 text-red-400">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-[var(--color-surface)] z-10">
            <tr className="border-b border-white/10">
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Contact</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Subject</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Extracted Info</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Direction</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Date</th>
              <th className="text-left text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {isLoading ? (
              // Loading skeleton
              [...Array(5)].map((_, i) => (
                <tr key={i} className="hover:bg-white/5">
                  <td className="px-3 py-2"><div className="shimmer h-5 w-28 rounded" /></td>
                  <td className="px-3 py-2"><div className="shimmer h-5 w-40 rounded" /></td>
                  <td className="px-3 py-2"><div className="shimmer h-5 w-32 rounded" /></td>
                  <td className="px-3 py-2"><div className="shimmer h-5 w-16 rounded" /></td>
                  <td className="px-3 py-2"><div className="shimmer h-5 w-20 rounded" /></td>
                  <td className="px-3 py-2"><div className="shimmer h-5 w-14 rounded" /></td>
                </tr>
              ))
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[var(--color-text-muted)] text-sm">
                  No leads found
                </td>
              </tr>
            ) : (
              leads.map((lead) => (
                <tr
                  key={lead.id}
                  className="hover:bg-white/5 cursor-pointer transition-colors"
                  onClick={() => setSelectedLead(lead)}
                >
                  <td className="px-3 py-2 max-w-[120px]">
                    <div className="flex items-center gap-1">
                      <span className="text-white text-xs font-medium truncate">
                        {getContactDisplay(lead, expandedContacts.has(lead.id))}
                      </span>
                      {(getContactDisplay(lead, true).length > 15 || (getContactDisplay(lead, true).length > 20)) && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            toggleContactExpand(lead.id)
                          }}
                          className="flex-shrink-0 text-[var(--color-text-muted)] hover:text-white transition-colors"
                          title={expandedContacts.has(lead.id) ? 'Collapse' : 'Expand'}
                        >
                          {expandedContacts.has(lead.id) ? (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                            </svg>
                          ) : (
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 max-w-xs">
                    <p className="text-xs text-gray-300 truncate">
                      {getSubjectPreview(lead.subject)}
                    </p>
                  </td>
                  <td className="px-3 py-2 max-w-[200px]">
                    {lead.extractedLead ? (
                      <div className="flex flex-col gap-1">
                        {lead.extractedLead.status?.toLowerCase() === 'paid' && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-200 border border-emerald-500/30 w-fit">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Paid
                          </span>
                        )}
                        {lead.extractedLead.name && (
                          <div className="text-xs text-white">
                            <span className="text-[var(--color-text-muted)]">Name:</span> {lead.extractedLead.name}
                          </div>
                        )}
                        {lead.extractedLead.phone_number && (
                          <div className="text-xs text-white">
                            <span className="text-[var(--color-text-muted)]">Phone:</span> {lead.extractedLead.phone_number}
                          </div>
                        )}
                        {lead.extractedLead.email && (
                          <div className="text-xs text-white truncate">
                            <span className="text-[var(--color-text-muted)]">Email:</span> {lead.extractedLead.email}
                          </div>
                        )}
                        {!lead.extractedLead.name && !lead.extractedLead.phone_number && !lead.extractedLead.email && (
                          <span className="text-xs text-[var(--color-text-muted)] italic">No data extracted</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-[var(--color-text-muted)] italic">Not extracted</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-medium ${
                      lead.direction === 'outbound' 
                        ? 'bg-orange-500/20 text-orange-400' 
                        : 'bg-green-500/20 text-green-400'
                    }`}>
                      {lead.direction === 'outbound' ? (
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                        </svg>
                      ) : (
                        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                        </svg>
                      )}
                      {lead.direction === 'outbound' ? 'Sent' : 'Recv'}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {new Date(lead.created_at).toLocaleDateString('en-US', { 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedLead(lead)
                      }}
                      className="flex items-center gap-1 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 text-gray-300 rounded transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                      <span className="hidden sm:inline">View</span>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Stats Footer */}
      <div className="p-3 border-t border-white/10 bg-[var(--color-surface)]/50">
        <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
          <span>
            Showing {leads.length} lead{leads.length !== 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              {leads.filter(l => l.direction === 'inbound').length} received
            </span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
              {leads.filter(l => l.direction === 'outbound').length} sent
            </span>
          </div>
        </div>
      </div>

      {/* Modal - Rendered via Portal to avoid overflow issues */}
      {selectedLead && createPortal(
        <LeadModal
          email={selectedLead}
          onClose={() => setSelectedLead(null)}
          onExtracted={fetchLeads}
        />,
        document.body
      )}
    </div>
  )
}

