import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { supabase, supabaseUrl, supabaseAnonKey } from '../lib/supabase'

type RepeatType = 'none' | 'weekly' | 'fortnightly' | '3-weekly' | 'monthly' | '2-monthly'

interface Lead {
  id: string
  name?: string | null
  email?: string | null
  phone_number?: string | null
  region_notes?: string | null
}

interface BookingModalProps {
  lead: Lead
  onClose: () => void
  onSuccess?: (seriesId: string) => void
  onSkip?: () => void
}

type CreateBookingPayload = {
  leadId: string
  startsAt: string
  durationMinutes: number
  repeatType: RepeatType
  untilDate?: string
  occurrenceCount?: number
  notes?: string
  timezone?: string
  updateLeadStatus?: boolean
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'

const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'none', label: 'One-time (no repeat)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly (every 2 weeks)' },
  { value: '3-weekly', label: 'Every 3 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: '2-monthly', label: 'Every 2 months' },
]

const DURATION_OPTIONS = [
  { value: 60, label: '1 hour' },
  { value: 90, label: '1.5 hours' },
  { value: 120, label: '2 hours' },
  { value: 150, label: '2.5 hours' },
  { value: 180, label: '3 hours' },
  { value: 240, label: '4 hours' },
  { value: 300, label: '5 hours' },
  { value: 360, label: '6 hours' },
]

function repeatTypeToRRule(repeatType: RepeatType): string | null {
  switch (repeatType) {
    case 'weekly':
      return 'FREQ=WEEKLY;INTERVAL=1'
    case 'fortnightly':
      return 'FREQ=WEEKLY;INTERVAL=2'
    case '3-weekly':
      return 'FREQ=WEEKLY;INTERVAL=3'
    case 'monthly':
      return 'FREQ=MONTHLY;INTERVAL=1'
    case '2-monthly':
      return 'FREQ=MONTHLY;INTERVAL=2'
    case 'none':
    default:
      return null
  }
}

function generateOccurrences(startDate: Date, rrule: string | null, untilDate: Date | null, maxCount: number): Date[] {
  const dates: Date[] = [new Date(startDate)]

  if (!rrule) return dates

  const parts: Record<string, string> = {}
  rrule.split(';').forEach((part) => {
    const [key, value] = part.split('=')
    if (key && value) parts[key] = value
  })

  const freq = parts['FREQ']
  const interval = parseInt(parts['INTERVAL'] || '1', 10)
  let currentDate = new Date(startDate)
  const endDate = untilDate || new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000) // default: 1 year

  while (dates.length < maxCount) {
    if (freq === 'WEEKLY') {
      currentDate = new Date(currentDate.getTime() + interval * 7 * 24 * 60 * 60 * 1000)
    } else if (freq === 'MONTHLY') {
      const nextMonth = new Date(currentDate)
      nextMonth.setMonth(nextMonth.getMonth() + interval)
      currentDate = nextMonth
    } else {
      break
    }

    if (currentDate > endDate) break
    dates.push(new Date(currentDate))
  }

  return dates
}

async function createBookingViaEdge(payload: CreateBookingPayload) {
  try {
    // Try using supabase client first
    const { data, error } = await supabase.functions.invoke('create-booking-series', {
      body: payload,
    })

    if (error) {
      throw new Error(error.message || 'Edge function failed')
    }
    if (data?.error) {
      throw new Error(data.error)
    }
    if (!data?.series?.id) {
      throw new Error('Edge function did not return a booking id')
    }

    return data
  } catch (err) {
    // If supabase.functions.invoke fails (e.g., network error, CORS issue), try direct fetch
    // This handles cases where the Supabase client has issues but the endpoint is accessible
    const errorMessage = err instanceof Error ? err.message : 'Unknown error'
    
    // Check if it's a network/fetch error
    if (errorMessage.includes('Failed to fetch') || errorMessage.includes('NetworkError') || errorMessage.includes('fetch')) {
      console.warn('Supabase client invoke failed with network error, trying direct fetch:', errorMessage)
    }
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000) // 30 second timeout
      
      const response = await fetch(`${supabaseUrl}/functions/v1/create-booking-series`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseAnonKey,
          Authorization: `Bearer ${supabaseAnonKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)

      const responseData = await response.json().catch(() => ({}))
      
      if (!response.ok || responseData?.error) {
        throw new Error(responseData?.error || `Edge function failed (${response.status})`)
      }
      
      if (!responseData?.series?.id) {
        throw new Error('Edge function did not return a booking id')
      }

      return responseData
    } catch (fetchErr) {
      // Re-throw with a more descriptive error message
      const fetchErrorMsg = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error'
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.')
      }
      // Re-throw the original error if fetch also fails, but include fetch error for debugging
      throw err instanceof Error ? err : new Error(`Edge function unavailable: ${fetchErrorMsg}`)
    }
  }
}

async function createBookingDirect(payload: CreateBookingPayload) {
  const startDate = new Date(payload.startsAt)
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Please enter a valid date and time')
  }

  const rrule = repeatTypeToRRule(payload.repeatType)
  const untilDate = payload.untilDate ? new Date(payload.untilDate) : null
  const maxOccurrences = payload.occurrenceCount || (rrule ? 52 : 1)

  const { data: leadExists, error: leadError } = await supabase
    .from('extracted_leads')
    .select('id')
    .eq('id', payload.leadId)
    .maybeSingle()

  if (leadError || !leadExists) {
    throw new Error('Lead not found')
  }

  const { data: series, error: seriesError } = await supabase
    .from('booking_series')
    .insert({
      lead_id: payload.leadId,
      title: 'Regular clean',
      timezone: payload.timezone || DEFAULT_TIMEZONE,
      starts_at: startDate.toISOString(),
      duration_minutes: payload.durationMinutes || 120,
      rrule,
      until_date: untilDate ? untilDate.toISOString().split('T')[0] : null,
      occurrence_count: payload.occurrenceCount || null,
      notes: payload.notes || null,
      status: 'active',
    })
    .select()
    .single()

  if (seriesError || !series) {
    throw new Error(seriesError?.message || 'Failed to create booking series')
  }

  const occurrenceDates = generateOccurrences(startDate, rrule, untilDate, maxOccurrences)
  const occurrenceRecords = occurrenceDates.map((date) => {
    const endDate = new Date(date.getTime() + (payload.durationMinutes || 120) * 60 * 1000)
    return {
      series_id: series.id,
      start_at: date.toISOString(),
      end_at: endDate.toISOString(),
      status: 'scheduled',
    }
  })

  const { error: occurrencesError } = await supabase.from('booking_occurrences').insert(occurrenceRecords)
  if (occurrencesError) {
    await supabase.from('booking_series').delete().eq('id', series.id)
    throw new Error(occurrencesError.message || 'Failed to create booking occurrences')
  }

  if (payload.updateLeadStatus !== false) {
    await supabase.from('extracted_leads').update({ status: 'Job Won' }).eq('id', payload.leadId)
  }

  return { series }
}

export default function BookingModal({ lead, onClose, onSuccess, onSkip }: BookingModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSuccess, setShowSuccess] = useState(false)
  const [successData, setSuccessData] = useState<{ occurrencesCreated: number; startDate: string; seriesId?: string } | null>(null)
  
  // Form state
  const [date, setDate] = useState(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    return tomorrow.toISOString().split('T')[0]
  })
  const [time, setTime] = useState('09:00')
  const [duration, setDuration] = useState(120)
  const [repeatType, setRepeatType] = useState<RepeatType>('weekly')
  const [endType, setEndType] = useState<'never' | 'date' | 'count'>('never')
  const [endDate, setEndDate] = useState(() => {
    const sixMonths = new Date()
    sixMonths.setMonth(sixMonths.getMonth() + 6)
    return sixMonths.toISOString().split('T')[0]
  })
  const [occurrenceCount, setOccurrenceCount] = useState(12)
  const [notes, setNotes] = useState('')

  // Handle ESC key
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  // Prevent body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = 'unset' }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const startsAt = new Date(`${date}T${time}:00`)
      
      const payload: CreateBookingPayload = {
        leadId: lead.id,
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
        repeatType,
        notes: notes || undefined,
        updateLeadStatus: true,
        timezone: DEFAULT_TIMEZONE,
      }

      if (repeatType !== 'none') {
        if (endType === 'date') {
          payload.untilDate = endDate
        } else if (endType === 'count') {
          payload.occurrenceCount = occurrenceCount
        }
      }

      let result
      try {
        result = await createBookingViaEdge(payload)
      } catch (edgeErr) {
        console.warn('Edge function failed, retrying with direct database insert:', edgeErr)
        // Fallback to direct database insert if edge function fails
        // This handles cases where edge functions aren't accessible (e.g., CORS, network issues)
        try {
          result = await createBookingDirect(payload)
        } catch (directErr) {
          // If direct insert also fails, throw with a helpful message
          console.error('Both edge function and direct insert failed:', { edgeErr, directErr })
          throw new Error(
            directErr instanceof Error 
              ? directErr.message 
              : 'Failed to create booking. Please check your connection and try again.'
          )
        }
      }

      // Show success popup
      const occurrencesCreated = result?.occurrences_created || (result?.series ? 1 : 0)
      const seriesId = result?.series?.id
      setSuccessData({
        occurrencesCreated,
        startDate: payload.startsAt,
        seriesId,
      })
      setShowSuccess(true)
      
      // Auto-close after 3 seconds, then call success callback
      setTimeout(() => {
        setShowSuccess(false)
        setTimeout(() => {
          // Call success callback after popup is dismissed
          onSuccess?.(seriesId)
          onClose()
        }, 300) // Small delay for animation
      }, 3000)
    } catch (err) {
      console.error('Error creating booking:', err)
      setError(err instanceof Error ? err.message : 'Failed to create booking')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = () => {
    onSkip?.()
    onClose()
  }

  const modal = (
    <div 
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
      onClick={showSuccess ? undefined : onClose}
    >
      <div 
        className="bg-[#1a1d24] border border-white/10 rounded-2xl w-full max-w-lg max-h-[90vh] overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-teal-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              </div>
              <div>
                <h3 className="text-white font-semibold text-lg">Schedule First Booking</h3>
                <p className="text-sm text-emerald-300/70">
                  {lead.name || 'Lead'} — Job Won! 🎉
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
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5 overflow-y-auto max-h-[60vh]">
          {/* Date & Time Row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Date
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
                Time
              </label>
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
              />
            </div>
          </div>

          {/* Duration */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Duration
            </label>
            <select
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50"
            >
              {DURATION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value} className="bg-[#1a1d24]">
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Repeat Type */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Repeat
            </label>
            <div className="grid grid-cols-2 gap-2">
              {REPEAT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRepeatType(opt.value)}
                  className={`px-3 py-2 text-sm rounded-lg border transition-all ${
                    repeatType === opt.value
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* End Condition (only for recurring) */}
          {repeatType !== 'none' && (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10 space-y-3">
              <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider">
                End Condition
              </label>
              <div className="flex gap-2">
                {[
                  { value: 'never', label: 'Never' },
                  { value: 'date', label: 'Until Date' },
                  { value: 'count', label: 'After # Visits' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setEndType(opt.value as typeof endType)}
                    className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-all ${
                      endType === opt.value
                        ? 'bg-teal-500/20 border-teal-500/50 text-teal-300'
                        : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {endType === 'date' && (
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                />
              )}

              {endType === 'count' && (
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={200}
                    value={occurrenceCount}
                    onChange={(e) => setOccurrenceCount(Number(e.target.value))}
                    className="w-24 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/50"
                  />
                  <span className="text-sm text-gray-400">visits</span>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Any special instructions..."
              className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}
        </form>

        {/* Footer */}
        <div className="p-5 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleSkip}
            className="px-4 py-2.5 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Skip for now
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-sm rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-medium shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  Create Booking
                </>
              )}
            </button>
          </div>
        </div>

        {/* Success Popup Overlay */}
        {showSuccess && successData && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[10001] transition-opacity duration-300">
            <div className="bg-[#1a1d24] border border-emerald-500/30 rounded-2xl w-full max-w-md mx-4 p-6 shadow-2xl transform transition-all duration-300 scale-100">
              <div className="flex flex-col items-center text-center space-y-4">
                {/* Success Icon */}
                <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-2">
                  <svg
                    className="w-10 h-10 text-emerald-400"
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
                </div>

                {/* Success Message */}
                <div>
                  <h3 className="text-2xl font-bold text-white mb-2">Booking Scheduled!</h3>
                  <p className="text-emerald-300/80 text-sm mb-1">
                    {successData.occurrencesCreated === 1
                      ? '1 booking occurrence created'
                      : `${successData.occurrencesCreated} booking occurrences created`}
                  </p>
                  <p className="text-gray-400 text-xs">
                    First booking: {new Date(successData.startDate).toLocaleString()}
                  </p>
                </div>

                {/* Close Button */}
                <button
                  onClick={() => {
                    const seriesId = successData?.seriesId
                    setShowSuccess(false)
                    setTimeout(() => {
                      // Call success callback after popup is dismissed
                      onSuccess?.(seriesId)
                      onClose()
                    }, 300)
                  }}
                  className="mt-4 px-6 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-medium transition-all"
                >
                  Great!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}
















