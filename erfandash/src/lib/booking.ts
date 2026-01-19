import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'

export type RepeatType = 'none' | 'weekly' | 'fortnightly' | '3-weekly' | 'monthly' | '2-monthly'

export type CreateBookingPayload = {
  leadId: string
  quoteId: string
  startsAt: string
  durationMinutes: number
  repeatType: RepeatType
  untilDate?: string
  occurrenceCount?: number
  notes?: string
  timezone?: string
  updateLeadStatus?: boolean
}

export type BookingResult = {
  series?: any
  occurrences_created?: number
}

export const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney'

export const REPEAT_OPTIONS: { value: RepeatType; label: string }[] = [
  { value: 'none', label: 'One-time (no repeat)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly (every 2 weeks)' },
  { value: '3-weekly', label: 'Every 3 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: '2-monthly', label: 'Every 2 months' },
]

export const DURATION_OPTIONS = [
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

async function createBookingViaEdge(payload: CreateBookingPayload): Promise<BookingResult> {
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

  return data as BookingResult
}

async function createBookingDirect(payload: CreateBookingPayload): Promise<BookingResult> {
  const startDate = new Date(payload.startsAt)
  if (Number.isNaN(startDate.getTime())) {
    throw new Error('Please enter a valid date and time')
  }

  const rrule = repeatTypeToRRule(payload.repeatType)
  const untilDate = payload.untilDate ? new Date(payload.untilDate) : null
  const maxOccurrences = payload.occurrenceCount || (rrule ? 52 : 1)

  // Verify lead exists
  const { data: leadExists, error: leadError } = await supabase
    .from('extracted_leads')
    .select('id')
    .eq('id', payload.leadId)
    .maybeSingle()

  if (leadError || !leadExists) {
    throw new Error('Lead not found')
  }

  // Verify quote exists and belongs to lead
  const { data: quoteExists, error: quoteError } = await supabase
    .from('quotes')
    .select('id, address, address_lat, address_lng')
    .eq('id', payload.quoteId)
    .eq('lead_id', payload.leadId)
    .maybeSingle()

  if (quoteError || !quoteExists) {
    throw new Error('Quote not found or does not belong to this lead')
  }

  const quoteAddress = (quoteExists as any).address || null
  const quoteLat = typeof (quoteExists as any).address_lat === 'number' ? (quoteExists as any).address_lat : null
  const quoteLng = typeof (quoteExists as any).address_lng === 'number' ? (quoteExists as any).address_lng : null

  const { data: series, error: seriesError } = await supabase
    .from('booking_series')
    .insert({
      lead_id: payload.leadId,
      quote_id: payload.quoteId,
      title: 'Regular clean',
      timezone: payload.timezone || DEFAULT_TIMEZONE,
      starts_at: startDate.toISOString(),
      duration_minutes: payload.durationMinutes || 120,
      rrule,
      until_date: untilDate ? untilDate.toISOString().split('T')[0] : null,
      occurrence_count: payload.occurrenceCount || null,
      notes: payload.notes || null,
      status: 'active',
      service_address: quoteAddress,
      service_lat: quoteLat,
      service_lng: quoteLng,
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

  return { series, occurrences_created: occurrenceRecords.length }
}

export async function createBooking(payload: CreateBookingPayload): Promise<BookingResult> {
  try {
    return await createBookingViaEdge(payload)
  } catch (edgeErr) {
    const errorMessage = edgeErr instanceof Error ? edgeErr.message : 'Unknown error'

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

      return responseData as BookingResult
    } catch (fetchErr) {
      const fetchErrorMsg = fetchErr instanceof Error ? fetchErr.message : 'Unknown fetch error'
      if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
        throw new Error('Request timed out. Please try again.')
      }
      console.warn('Edge function fetch fallback failed, attempting direct insert:', fetchErrorMsg)
      return createBookingDirect(payload)
    }
  }
}

