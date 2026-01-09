// Supabase Edge Function to create a booking series and generate occurrences
// POST with JSON:
// {
//   leadId: string (required)
//   startsAt: string (ISO datetime, required)
//   durationMinutes: number (default 120)
//   repeatType: 'none' | 'weekly' | 'fortnightly' | '3-weekly' | 'monthly' | '2-monthly' (default 'none')
//   untilDate?: string (ISO date, optional end date)
//   occurrenceCount?: number (optional, generate N occurrences)
//   title?: string
//   notes?: string
//   timezone?: string (default 'Australia/Sydney')
//   updateLeadStatus?: boolean (default true - sets lead to 'Job Won')
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'
import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser } from '../_shared/auth.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

type RepeatType = 'none' | 'weekly' | 'fortnightly' | '3-weekly' | 'monthly' | '2-monthly'

interface CreateBookingPayload {
  leadId: string
  startsAt: string
  durationMinutes?: number
  repeatType?: RepeatType
  untilDate?: string
  occurrenceCount?: number
  title?: string
  notes?: string
  timezone?: string
  updateLeadStatus?: boolean
}

// Convert repeat type to RRULE string
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

// Generate occurrence dates from an RRULE
function generateOccurrences(
  startDate: Date,
  rrule: string | null,
  untilDate: Date | null,
  maxCount: number
): Date[] {
  const dates: Date[] = [new Date(startDate)]

  if (!rrule) {
    return dates // One-time booking
  }

  // Parse the RRULE
  const parts: Record<string, string> = {}
  rrule.split(';').forEach(part => {
    const [key, value] = part.split('=')
    if (key && value) parts[key] = value
  })

  const freq = parts['FREQ']
  const interval = parseInt(parts['INTERVAL'] || '1', 10)

  let currentDate = new Date(startDate)
  const endDate = untilDate || new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000) // Default: 1 year

  while (dates.length < maxCount) {
    // Advance to next occurrence
    if (freq === 'WEEKLY') {
      currentDate = new Date(currentDate.getTime() + interval * 7 * 24 * 60 * 60 * 1000)
    } else if (freq === 'MONTHLY') {
      const nextMonth = new Date(currentDate)
      nextMonth.setMonth(nextMonth.getMonth() + interval)
      currentDate = nextMonth
    } else {
      break // Unknown frequency
    }

    // Check if we've passed the end date
    if (currentDate > endDate) {
      break
    }

    dates.push(new Date(currentDate))
  }

  return dates
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req)
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers,
    })
  }

  if (!isCorsAllowed(req)) {
    return jsonResponse({ error: 'CORS blocked' }, 403, headers)
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, headers)
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500, headers)
  }

  // Require authenticated staff/admin
  const auth = await requireUser(req)
  if ('error' in auth) return auth.error
  const forbidden = requireRole(auth.role, ['admin', 'staff'])
  if (forbidden) return forbidden

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let payload: CreateBookingPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, headers)
  }

  // Validate required fields
  if (!payload.leadId) {
    return jsonResponse({ error: 'leadId is required' }, 400, headers)
  }
  if (!payload.startsAt) {
    return jsonResponse({ error: 'startsAt is required' }, 400, headers)
  }

  const startDate = new Date(payload.startsAt)
  if (isNaN(startDate.getTime())) {
    return jsonResponse({ error: 'startsAt must be a valid ISO date' }, 400, headers)
  }

  const durationMinutes = payload.durationMinutes || 120
  const repeatType = payload.repeatType || 'none'
  const rrule = repeatTypeToRRule(repeatType)
  const timezone = payload.timezone || 'Australia/Sydney'
  const title = payload.title || 'Regular clean'
  const notes = payload.notes || null
  const updateLeadStatus = payload.updateLeadStatus !== false

  // Parse until date if provided
  let untilDate: Date | null = null
  if (payload.untilDate) {
    untilDate = new Date(payload.untilDate)
    if (isNaN(untilDate.getTime())) {
      return jsonResponse({ error: 'untilDate must be a valid ISO date' }, 400, headers)
    }
  }

  // Max occurrences to generate (default 52 for a year of weekly, or use provided count)
  const maxOccurrences = payload.occurrenceCount || (rrule ? 52 : 1)

  try {
    // 1. Verify the lead exists
    const { data: lead, error: leadError } = await supabase
      .from('extracted_leads')
      .select('id, name, email')
      .eq('id', payload.leadId)
      .single()

    if (leadError || !lead) {
      return jsonResponse({ error: 'Lead not found' }, 404, headers)
    }

    // 2. Create the booking series
    const { data: series, error: seriesError } = await supabase
      .from('booking_series')
      .insert({
        lead_id: payload.leadId,
        title,
        timezone,
        starts_at: startDate.toISOString(),
        duration_minutes: durationMinutes,
        rrule,
        until_date: untilDate ? untilDate.toISOString().split('T')[0] : null,
        occurrence_count: payload.occurrenceCount || null,
        notes,
        status: 'active',
      })
      .select()
      .single()

    if (seriesError || !series) {
      console.error('Error creating booking series:', seriesError)
      return jsonResponse({ error: seriesError?.message || 'Failed to create booking series' }, 500, headers)
    }

    // 3. Generate occurrence dates
    const occurrenceDates = generateOccurrences(startDate, rrule, untilDate, maxOccurrences)

    // 4. Create occurrence records
    const occurrenceRecords = occurrenceDates.map(date => {
      const endDate = new Date(date.getTime() + durationMinutes * 60 * 1000)
      return {
        series_id: series.id,
        start_at: date.toISOString(),
        end_at: endDate.toISOString(),
        status: 'scheduled',
      }
    })

    const { data: occurrences, error: occurrencesError } = await supabase
      .from('booking_occurrences')
      .insert(occurrenceRecords)
      .select()

    if (occurrencesError) {
      console.error('Error creating occurrences:', occurrencesError)
      // Don't fail - series was created, occurrences can be regenerated
    }

    // 5. Update lead status to "Job Won" if requested
    if (updateLeadStatus) {
      const { error: statusError } = await supabase
        .from('extracted_leads')
        .update({ status: 'Job Won' })
        .eq('id', payload.leadId)

      if (statusError) {
        console.error('Error updating lead status:', statusError)
        // Don't fail - booking was created successfully
      }
    }

    return jsonResponse({
      success: true,
      series: {
        id: series.id,
        lead_id: series.lead_id,
        title: series.title,
        starts_at: series.starts_at,
        duration_minutes: series.duration_minutes,
        rrule: series.rrule,
        status: series.status,
      },
      occurrences_created: occurrences?.length || occurrenceDates.length,
      lead: {
        id: lead.id,
        name: lead.name,
        email: lead.email,
      },
    }, 200, headers)
  } catch (err) {
    console.error('Unexpected error:', err)
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return jsonResponse({ error: message }, 500, headers)
  }
})
















