import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import type { EventClickArg, EventDropArg, EventContentArg } from '@fullcalendar/core'
import { supabase } from '../lib/supabase'
import { format } from 'date-fns'

type Cleaner = {
  id: string
  full_name: string
  active: boolean | null
}

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
  service_address?: string | null
  service_lat?: number | null
  service_lng?: number | null
}

interface BookingOccurrence {
  id: string
  series_id: string
  start_at: string
  end_at: string
  status: string
  notes: string | null
  original_start_at: string | null
  cleaner_id?: string | null
}

interface Lead {
  id: string
  name: string | null
  email: string | null
  phone_number: string | null
  region_notes: string | null
}

interface CalendarEvent {
  id: string
  title: string
  start: string
  end: string
  backgroundColor: string
  borderColor: string
  textColor: string
  extendedProps: {
    occurrence: BookingOccurrence
    series: BookingSeries
    lead: Lead | null
  }
}

// Status colors
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  scheduled: { bg: '#10b981', border: '#059669', text: '#ffffff' },
  completed: { bg: '#6366f1', border: '#4f46e5', text: '#ffffff' },
  cancelled: { bg: '#ef4444', border: '#dc2626', text: '#ffffff' },
  skipped: { bg: '#f59e0b', border: '#d97706', text: '#ffffff' },
}

// Visual cue: scheduled + cleaner assigned
const ASSIGNED_SCHEDULED_COLORS = { bg: '#06b6d4', border: '#0891b2', text: '#0b1220' }

const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  import.meta.env.VITE_MAPBOX_API_KEY ||
  import.meta.env.VITE_MAPBOX ||
  ''

const CALENDAR_VIEWS = ['dayGridMonth', 'timeGridWeek', 'timeGridDay'] as const
type CalendarView = (typeof CALENDAR_VIEWS)[number]
const isCalendarView = (val: string | null | undefined): val is CalendarView =>
  CALENDAR_VIEWS.includes(val as CalendarView)

async function mapboxSuggest(query: string) {
  if (!MAPBOX_TOKEN) return []
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
    query
  )}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=5&country=AU`
  const res = await fetch(url)
  const data = await res.json().catch(() => ({}))
  const features = Array.isArray(data?.features) ? data.features : []
  return features
    .map((f: any) => ({
      place_name: f?.place_name as string,
      center: f?.center as [number, number] | undefined, // [lng, lat]
    }))
    .filter((x: any) => typeof x.place_name === 'string' && x.place_name.length > 0)
}

function EventDetailModal({
  event,
  onClose,
  onStatusChange,
  onReschedule,
  cleaners,
  onAssignCleaner,
  onUpdateSeriesAddress,
}: {
  event: CalendarEvent
  onClose: () => void
  onStatusChange: (occurrenceId: string, status: string) => Promise<void>
  onReschedule: (occurrenceId: string, newStart: Date) => Promise<void>
  cleaners: Cleaner[]
  onAssignCleaner: (occurrenceId: string, cleanerId: string | null) => Promise<void>
  onUpdateSeriesAddress: (
    seriesId: string,
    address: string | null,
    lat: number | null,
    lng: number | null
  ) => Promise<void>
}) {
  const { occurrence, series, lead } = event.extendedProps
  const [isUpdating, setIsUpdating] = useState(false)
  const [newDate, setNewDate] = useState(format(new Date(occurrence.start_at), 'yyyy-MM-dd'))
  const [newTime, setNewTime] = useState(format(new Date(occurrence.start_at), 'HH:mm'))
  const [showReschedule, setShowReschedule] = useState(false)
  const [assigningCleaner, setAssigningCleaner] = useState(false)
  const [updatingAddress, setUpdatingAddress] = useState(false)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [latestQuote, setLatestQuote] = useState<{
    service: string | null
    bedrooms: number | null
    bathrooms: number | null
    addons: string[] | null
    total_inc_gst: number | null
    cleaner_pay: number | null
  } | null>(null)

  const activeCleaners = useMemo(() => cleaners.filter((c) => c.active !== false), [cleaners])
  const selectedCleanerId = occurrence.cleaner_id || ''
  const selectedCleanerName = useMemo(() => {
    const c = cleaners.find((x) => x.id === selectedCleanerId)
    return c?.full_name || 'Unassigned'
  }, [cleaners, selectedCleanerId])

  const [addressText, setAddressText] = useState(series.service_address || '')
  const [addressResults, setAddressResults] = useState<{ place_name: string; center?: [number, number] }[]>([])

  useEffect(() => {
    // Lightweight "job summary": load latest quote for this lead (if any).
    if (!lead?.id) {
      setLatestQuote(null)
      return
    }
    let cancelled = false
    ;(async () => {
      setQuoteLoading(true)
      setQuoteError(null)
      try {
        const { data, error } = await supabase
          .from('quotes')
          .select('service, bedrooms, bathrooms, addons, total_inc_gst, cleaner_pay, created_at')
          .eq('lead_id', lead.id)
          .order('created_at', { ascending: false })
          .limit(1)
        if (error) throw error
        const q = (data && data[0]) as any
        if (!cancelled) {
          setLatestQuote(
            q
              ? {
                  service: q.service ?? null,
                  bedrooms: typeof q.bedrooms === 'number' ? q.bedrooms : null,
                  bathrooms: typeof q.bathrooms === 'number' ? q.bathrooms : null,
                  addons: Array.isArray(q.addons) ? (q.addons as string[]) : null,
                  total_inc_gst: typeof q.total_inc_gst === 'number' ? q.total_inc_gst : null,
                  cleaner_pay: typeof q.cleaner_pay === 'number' ? q.cleaner_pay : null,
                }
              : null
          )
        }
      } catch (e: any) {
        if (!cancelled) setQuoteError(e?.message || 'Failed to load quote')
      } finally {
        if (!cancelled) setQuoteLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [lead?.id])

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleStatusChange = async (status: string) => {
    setIsUpdating(true)
    try {
      await onStatusChange(occurrence.id, status)
      onClose()
    } finally {
      setIsUpdating(false)
    }
  }

  const handleReschedule = async () => {
    setIsUpdating(true)
    try {
      const newStart = new Date(`${newDate}T${newTime}:00`)
      await onReschedule(occurrence.id, newStart)
      onClose()
    } finally {
      setIsUpdating(false)
    }
  }

  const handleAssignCleaner = async (cleanerId: string) => {
    setAssigningCleaner(true)
    try {
      await onAssignCleaner(occurrence.id, cleanerId || null)
    } finally {
      setAssigningCleaner(false)
    }
  }

  const handleAddressSearch = useCallback(async (q: string) => {
    setAddressText(q)
    if (!q || q.trim().length < 3) {
      setAddressResults([])
      return
    }
    try {
      const results = await mapboxSuggest(q.trim())
      setAddressResults(results)
    } catch {
      setAddressResults([])
    }
  }, [])

  const handleSelectAddress = async (place_name: string, center?: [number, number]) => {
    setUpdatingAddress(true)
    try {
      const lng = center?.[0] ?? null
      const lat = center?.[1] ?? null
      await onUpdateSeriesAddress(series.id, place_name, lat, lng)
      setAddressText(place_name)
      setAddressResults([])
    } finally {
      setUpdatingAddress(false)
    }
  }

  return createPortal(
    <div 
      className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10000] p-4"
      onClick={onClose}
    >
      <div 
        className="bg-[#1a1d24] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-gradient-to-r from-cyan-500/10 to-blue-500/10">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold text-lg">{series.title}</h3>
              <p className="text-sm text-cyan-300/70 mt-1">
                {format(new Date(occurrence.start_at), 'EEEE, MMMM d, yyyy')}
              </p>
              <p className="text-sm text-cyan-300/70">
                {format(new Date(occurrence.start_at), 'h:mm a')} – {format(new Date(occurrence.end_at), 'h:mm a')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: occurrence.id } }))
                }
                className="px-3 py-2 text-xs rounded-lg bg-white/5 hover:bg-white/10 text-white border border-white/10"
              >
                Job details
              </button>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
              >
                <svg
                  className="w-5 h-5 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Quick summary */}
          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Job summary</h4>
                <div className="text-sm text-white">
                  <span className="text-white/70">Cleaner:</span> <span className="font-semibold">{selectedCleanerName}</span>
                </div>
                <div className="text-sm text-white mt-1">
                  <span className="text-white/70">Service:</span>{' '}
                  <span className="font-semibold">{latestQuote?.service || series.title || '—'}</span>
                </div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  {typeof latestQuote?.bedrooms === 'number' && typeof latestQuote?.bathrooms === 'number'
                    ? `${latestQuote.bedrooms} bed / ${latestQuote.bathrooms} bath`
                    : 'No quote details yet.'}
                </div>
                {latestQuote?.addons?.length ? (
                  <div className="text-xs text-[var(--color-text-muted)] mt-1 truncate">
                    Add-ons: {(latestQuote.addons || []).join(', ')}
                  </div>
                ) : null}
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  {typeof latestQuote?.total_inc_gst === 'number'
                    ? `Job total: $${latestQuote.total_inc_gst.toFixed(2)}`
                    : 'Job total: —'}{' '}
                  •{' '}
                  {typeof latestQuote?.cleaner_pay === 'number'
                    ? `Cleaner pay: $${latestQuote.cleaner_pay.toFixed(2)}`
                    : 'Cleaner pay: —'}
                </div>
                {quoteLoading ? <div className="text-xs text-[var(--color-text-muted)] mt-1">Loading quote…</div> : null}
                {quoteError ? <div className="text-xs text-red-300 mt-1">{quoteError}</div> : null}
              </div>
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: occurrence.id } }))
                }
                className="px-3 py-2 text-xs rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                Open quote
              </button>
            </div>
          </div>

          {/* Lead Info */}
          {lead && (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Customer</h4>
              <div className="space-y-2">
                {lead.name && (
                  <p className="text-white font-medium">{lead.name}</p>
                )}
                {lead.phone_number && (
                  <p className="text-sm text-gray-300 flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                    </svg>
                    {lead.phone_number}
                  </p>
                )}
                {lead.email && (
                  <p className="text-sm text-gray-300 flex items-center gap-2">
                    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {lead.email}
                  </p>
                )}
                {lead.region_notes && (
                  <p className="text-sm text-gray-400 mt-2">{lead.region_notes}</p>
                )}
              </div>
            </div>
          )}

          {/* Assignment */}
          <div className="p-4 rounded-xl bg-white/5 border border-white/10">
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Dispatch</h4>
            <div className="space-y-2">
              <label className="block text-xs text-gray-400 mb-1">Assigned cleaner</label>
              <select
                value={selectedCleanerId}
                disabled={assigningCleaner}
                onChange={(e) => handleAssignCleaner(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
              >
                <option value="" className="bg-[#1a1d24]">
                  Unassigned
                </option>
                {activeCleaners.map((c) => (
                  <option key={c.id} value={c.id} className="bg-[#1a1d24]">
                    {c.full_name}
                  </option>
                ))}
              </select>

              <label className="block text-xs text-gray-400 mb-1 mt-3">Service address</label>
              <input
                value={addressText}
                onChange={(e) => handleAddressSearch(e.target.value)}
                placeholder="Search address (Mapbox)"
                className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                disabled={updatingAddress}
                onBlur={() => setTimeout(() => setAddressResults([]), 150)}
              />
              {addressResults.length > 0 && (
                <div className="border border-white/10 rounded-lg bg-black/50 max-h-40 overflow-y-auto text-sm">
                  {addressResults.map((item) => (
                    <button
                      key={item.place_name}
                      type="button"
                      onClick={() => handleSelectAddress(item.place_name, item.center)}
                      className="w-full text-left px-3 py-2 hover:bg-white/10 text-white"
                    >
                      {item.place_name}
                    </button>
                  ))}
                </div>
              )}
              {!MAPBOX_TOKEN && (
                <div className="text-xs text-amber-200/80">
                  Mapbox token missing. Set <span className="font-mono">VITE_MAPBOX_TOKEN</span> to use autocomplete.
                </div>
              )}
            </div>
          </div>

          {/* Current Status */}
          <div>
            <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-3">Status</h4>
            <div className="flex flex-wrap gap-2">
              {['scheduled', 'completed', 'skipped', 'cancelled'].map((status) => (
                <button
                  key={status}
                  onClick={() => handleStatusChange(status)}
                  disabled={isUpdating || occurrence.status === status}
                  className={`px-3 py-1.5 text-sm rounded-lg border transition-all capitalize ${
                    occurrence.status === status
                      ? 'bg-white/20 border-white/30 text-white font-medium'
                      : 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                  } disabled:opacity-50`}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>

          {/* Reschedule */}
          <div>
            <button
              onClick={() => setShowReschedule(!showReschedule)}
              className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {showReschedule ? 'Cancel reschedule' : 'Reschedule this visit'}
            </button>

            {showReschedule && (
              <div className="mt-3 p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">New Date</label>
                    <input
                      type="date"
                      value={newDate}
                      onChange={(e) => setNewDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">New Time</label>
                    <input
                      type="time"
                      value={newTime}
                      onChange={(e) => setNewTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
                    />
                  </div>
                </div>
                <button
                  onClick={handleReschedule}
                  disabled={isUpdating}
                  className="w-full px-4 py-2 text-sm rounded-lg bg-cyan-500 hover:bg-cyan-400 text-white font-medium transition-colors disabled:opacity-50"
                >
                  {isUpdating ? 'Moving...' : 'Move to new time'}
                </button>
              </div>
            )}
          </div>

          {/* Notes */}
          {(occurrence.notes || series.notes) && (
            <div className="p-4 rounded-xl bg-white/5 border border-white/10">
              <h4 className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Notes</h4>
              <p className="text-sm text-gray-300">{occurrence.notes || series.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

export default function Calendar() {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [initialCalendarView] = useState<CalendarView>(() => {
    if (typeof window === 'undefined') return 'timeGridWeek'
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('calView')
    const fromStorage = (() => {
      try {
        return localStorage.getItem('calendar-view')
      } catch {
        return null
      }
    })()
    const candidate = (fromUrl || fromStorage) as string | null
    return isCalendarView(candidate) ? candidate : 'timeGridWeek'
  })
  const [initialCalendarDate] = useState<Date>(() => {
    if (typeof window === 'undefined') return new Date()
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('calDate')
    const fromStorage = (() => {
      try {
        return localStorage.getItem('calendar-date')
      } catch {
        return null
      }
    })()
    const candidate = fromUrl || fromStorage
    const parsed = candidate ? new Date(candidate) : null
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date()
  })
  const [dateRange, setDateRange] = useState({ start: new Date(), end: new Date() })
  const [lastRangeKey, setLastRangeKey] = useState<string>('')
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const calendarRef = useRef<FullCalendar>(null)
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [reviewTarget, setReviewTarget] = useState<{
    occurrenceId: string
    cleanerId: string
    cleanerName: string
    leadName: string
    seriesTitle: string
    startAt: string
  } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewRating, setReviewRating] = useState<number>(5)
  const [reviewNotes, setReviewNotes] = useState<string>('')
  const [savingReview, setSavingReview] = useState(false)

  const renderEventContent = useCallback((arg: EventContentArg) => {
    const { event, timeText } = arg
    const extended = event.extendedProps as CalendarEvent['extendedProps']
    const leadName = extended?.lead?.name || 'Customer'
    const serviceTitle = extended?.series?.title || event.title

    return (
      <div className="flex flex-col gap-[2px] leading-tight">
        {timeText ? (
          <span className="text-[11px] font-semibold opacity-90">{timeText}</span>
        ) : null}
        <span className="text-[12px] font-semibold break-words">{leadName}</span>
        <span className="text-[11px] opacity-90 break-words">{serviceTitle}</span>
      </div>
    )
  }, [])

  const fetchCleaners = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cleaners')
        .select('id, full_name, active')
        .order('full_name', { ascending: true })
        .limit(500)
      if (error) throw error
      setCleaners((data || []) as any)
    } catch (err) {
      console.error('Failed to load cleaners', err)
    }
  }, [])

  useEffect(() => {
    fetchCleaners()
  }, [fetchCleaners])

  // Fetch bookings for current view
  const fetchBookings = useCallback(async (start: Date, end: Date) => {
    setIsLoading(true)
    setFetchError(null)
    try {
      // Fetch occurrences in range with series data
      const { data: occurrences, error: occError } = await supabase
        .from('booking_occurrences')
        .select(`
          *,
          series:booking_series(*, lead:extracted_leads(*))
        `)
        .gte('start_at', start.toISOString())
        .lt('start_at', end.toISOString())
        .order('start_at', { ascending: true })

      if (occError) {
        console.error('Error fetching occurrences:', occError)
        setFetchError(occError.message || 'Failed to load bookings')
        return
      }

      const calendarEvents: CalendarEvent[] = (occurrences || []).map((occ: any) => {
        let colors = STATUS_COLORS[occ.status] || STATUS_COLORS.scheduled
        if (occ.status === 'scheduled' && occ.cleaner_id) {
          colors = ASSIGNED_SCHEDULED_COLORS
        }
        const series = occ.series
        const lead = series?.lead
        const leadName = lead?.name || 'Customer'
        const serviceTitle = series?.title || 'Booking'
        const displayTitle = `${leadName} - ${serviceTitle}`

        return {
          id: occ.id,
          title: displayTitle,
          start: occ.start_at,
          end: occ.end_at,
          backgroundColor: colors.bg,
          borderColor: colors.border,
          textColor: colors.text,
          extendedProps: {
            occurrence: occ,
            series: series,
            lead: lead,
          },
        }
      })

      setEvents(calendarEvents)
    } catch (err) {
      console.error('Error fetching bookings:', err)
      setFetchError(err instanceof Error ? err.message : 'Failed to load bookings')
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Handle date range change
  const handleDatesSet = useCallback(
    (dateInfo: { start: Date; end: Date; view: { type: string } }) => {
      const viewType = dateInfo.view?.type as string | undefined
      const key = `${viewType || 'unknown'}_${dateInfo.start.toISOString()}_${dateInfo.end.toISOString()}`
      if (key === lastRangeKey) return
      setLastRangeKey(key)
      setDateRange({ start: dateInfo.start, end: dateInfo.end })

      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        params.set('calDate', dateInfo.start.toISOString())
        if (isCalendarView(viewType)) {
          params.set('calView', viewType)
          try {
            localStorage.setItem('calendar-view', viewType)
          } catch {
            // ignore storage failures
          }
        }
        try {
          localStorage.setItem('calendar-date', dateInfo.start.toISOString())
        } catch {
          // ignore storage failures
        }
        const newUrl = `${window.location.pathname}?${params.toString()}`
        window.history.replaceState({}, '', newUrl)
      }

      fetchBookings(dateInfo.start, dateInfo.end)
    },
    [fetchBookings, lastRangeKey]
  )

  // Handle event click
  const handleEventClick = useCallback((info: EventClickArg) => {
    setSelectedEvent(info.event.toPlainObject() as unknown as CalendarEvent)
  }, [])

  // Handle drag & drop
  const handleEventDrop = useCallback(async (info: EventDropArg) => {
    const occurrenceId = info.event.id
    const newStart = info.event.start
    const newEnd = info.event.end

    if (!newStart || !newEnd) {
      info.revert()
      return
    }

    // Get the original start time for tracking moved bookings
    const extendedProps = info.event.extendedProps as CalendarEvent['extendedProps']
    const originalStartAt = extendedProps.occurrence.original_start_at || extendedProps.occurrence.start_at

    setActionError(null)

    const { error } = await supabase
      .from('booking_occurrences')
      .update({
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
        original_start_at: originalStartAt,
      })
      .eq('id', occurrenceId)

    if (error) {
      console.error('Error moving booking:', error)
      setActionError('Could not move booking. Please try again.')
      info.revert()
    }
  }, [])

  // Update occurrence status
  const handleStatusChange = useCallback(async (occurrenceId: string, status: string) => {
    const { error } = await supabase
      .from('booking_occurrences')
      .update({ status })
      .eq('id', occurrenceId)

    if (error) {
      console.error('Error updating status:', error)
      return
    }

    // Refresh events
    fetchBookings(dateRange.start, dateRange.end)

    // Prompt review when moving to completed (only if a cleaner is assigned and no review exists yet)
    if (status === 'completed') {
      try {
        const { data: existing } = await supabase
          .from('cleaner_job_reviews')
          .select('id')
          .eq('occurrence_id', occurrenceId)
          .limit(1)
        if (existing && existing.length > 0) return

        const ev = events.find((e) => e.id === occurrenceId) || selectedEvent || null
        const occCleanerId = ev?.extendedProps?.occurrence?.cleaner_id || null
        if (!occCleanerId) return

        const cleaner = cleaners.find((c) => c.id === occCleanerId)
        if (!cleaner) return

        setReviewError(null)
        setReviewRating(5)
        setReviewNotes('')
        setReviewTarget({
          occurrenceId,
          cleanerId: occCleanerId,
          cleanerName: cleaner.full_name,
          leadName: ev?.extendedProps?.lead?.name || 'Customer',
          seriesTitle: ev?.extendedProps?.series?.title || 'Job',
          startAt: ev?.extendedProps?.occurrence?.start_at || new Date().toISOString(),
        })
      } catch (err) {
        console.error('Failed to prepare review modal', err)
      }
    }
  }, [cleaners, dateRange, events, fetchBookings, selectedEvent])

  const handleAssignCleaner = useCallback(
    async (occurrenceId: string, cleanerId: string | null) => {
      const { error } = await supabase
        .from('booking_occurrences')
        .update({ cleaner_id: cleanerId, assigned_at: cleanerId ? new Date().toISOString() : null })
        .eq('id', occurrenceId)
      if (error) {
        console.error('Error assigning cleaner:', error)
        return
      }
      fetchBookings(dateRange.start, dateRange.end)
    },
    [fetchBookings, dateRange]
  )

  const handleUpdateSeriesAddress = useCallback(
    async (seriesId: string, address: string | null, lat: number | null, lng: number | null) => {
      const { error } = await supabase
        .from('booking_series')
        .update({ service_address: address, service_lat: lat, service_lng: lng })
        .eq('id', seriesId)
      if (error) {
        console.error('Error updating address:', error)
        return
      }
      fetchBookings(dateRange.start, dateRange.end)
    },
    [fetchBookings, dateRange]
  )

  const submitReview = async () => {
    if (!reviewTarget) return
    setSavingReview(true)
    setReviewError(null)
    try {
      const { error } = await supabase.from('cleaner_job_reviews').insert({
        occurrence_id: reviewTarget.occurrenceId,
        cleaner_id: reviewTarget.cleanerId,
        rating: reviewRating,
        notes: reviewNotes.trim() || null,
      })
      if (error) throw error
      setReviewTarget(null)
    } catch (err: any) {
      setReviewError(err?.message || 'Failed to save review')
    } finally {
      setSavingReview(false)
    }
  }

  // Reschedule occurrence
  const handleReschedule = useCallback(async (occurrenceId: string, newStart: Date) => {
    // Find the occurrence to get duration
    const event = events.find(e => e.id === occurrenceId)
    if (!event) return

    const duration = event.extendedProps.series.duration_minutes
    const newEnd = new Date(newStart.getTime() + duration * 60 * 1000)
    const originalStartAt = event.extendedProps.occurrence.original_start_at || event.extendedProps.occurrence.start_at

    const { error } = await supabase
      .from('booking_occurrences')
      .update({
        start_at: newStart.toISOString(),
        end_at: newEnd.toISOString(),
        original_start_at: originalStartAt,
      })
      .eq('id', occurrenceId)

    if (error) {
      console.error('Error rescheduling:', error)
      return
    }

    fetchBookings(dateRange.start, dateRange.end)
  }, [events, fetchBookings, dateRange])

  // Initial fetch on mount - get current week's data
  useEffect(() => {
    const now = new Date()
    const start = new Date(now)
    start.setDate(start.getDate() - start.getDay()) // Start of week (Sunday)
    start.setHours(0, 0, 0, 0)
    
    const end = new Date(start)
    end.setDate(end.getDate() + 7) // End of week
    
    const key = `${start.toISOString()}_${end.toISOString()}`
    setLastRangeKey(key)
    setDateRange({ start, end })
    fetchBookings(start, end)
  }, [fetchBookings]) // Only run once on mount

  // Subscribe to realtime updates
  useEffect(() => {
    const channel = supabase
      .channel('booking_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_occurrences' }, () => {
        fetchBookings(dateRange.start, dateRange.end)
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_series' }, () => {
        fetchBookings(dateRange.start, dateRange.end)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [fetchBookings, dateRange])

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
                <svg className="w-9 h-9 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                Booking Calendar
              </h1>
              <p className="text-[var(--color-text-muted)]">
                Manage all your scheduled jobs
              </p>
            </div>

          </div>
        </header>

        {/* Legend */}
        <div className="mb-6 flex flex-wrap items-center gap-4">
          <span className="text-sm text-gray-400">Status:</span>
          {Object.entries(STATUS_COLORS).map(([status, colors]) => (
            <div key={status} className="flex items-center gap-2">
              <div 
                className="w-3 h-3 rounded" 
                style={{ backgroundColor: colors.bg }}
              />
              <span className="text-sm text-gray-300 capitalize">{status}</span>
            </div>
          ))}
        </div>

        {actionError ? (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {actionError}
          </div>
        ) : null}

        {/* Calendar */}
        <div className="glass-card rounded-2xl p-4 md:p-6 overflow-hidden">
          {fetchError ? (
            <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
              Failed to load calendar: {fetchError}
            </div>
          ) : isLoading && events.length === 0 ? (
            <div className="h-[700px] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <svg className="w-8 h-8 animate-spin text-cyan-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-gray-400">Loading calendar...</p>
              </div>
            </div>
          ) : (
            <div className="calendar-wrapper">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                initialView={initialCalendarView}
                initialDate={initialCalendarDate}
                headerToolbar={{
                  left: 'prev,next today',
                  center: 'title',
                  right: 'dayGridMonth,timeGridWeek,timeGridDay',
                }}
                events={events}
                editable={true}
                selectable={true}
                selectMirror={true}
                dayMaxEvents={true}
                weekends={true}
                datesSet={handleDatesSet}
                eventClick={handleEventClick}
                eventDrop={handleEventDrop}
                slotMinTime="06:00:00"
                slotMaxTime="22:00:00"
                allDaySlot={false}
                height={820}
                expandRows={true}
                slotEventOverlap={false}
                eventOverlap={false}
                eventMaxStack={3}
                eventContent={renderEventContent}
                eventClassNames={() => ['custom-calendar-event']}
                views={{
                  dayGridMonth: {
                    dayMaxEventRows: 4,
                    eventContent: renderEventContent,
                  },
                }}
                eventTimeFormat={{
                  hour: 'numeric',
                  minute: '2-digit',
                  meridiem: 'short',
                }}
                slotLabelFormat={{
                  hour: 'numeric',
                  minute: '2-digit',
                  meridiem: 'short',
                }}
              />
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          {['scheduled', 'completed', 'skipped', 'cancelled'].map((status) => {
            const count = events.filter(e => e.extendedProps.occurrence.status === status).length
            const colors = STATUS_COLORS[status]
            return (
              <div 
                key={status}
                className="glass-card rounded-xl p-4 border-l-4"
                style={{ borderLeftColor: colors.bg }}
              >
                <p className="text-2xl font-bold text-white">{count}</p>
                <p className="text-sm text-gray-400 capitalize">{status}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <EventDetailModal
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onStatusChange={handleStatusChange}
          onReschedule={handleReschedule}
          cleaners={cleaners}
          onAssignCleaner={handleAssignCleaner}
          onUpdateSeriesAddress={handleUpdateSeriesAddress}
        />
      )}

      {/* Review Modal (on completion) */}
      {reviewTarget &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10001] p-4"
            onClick={() => setReviewTarget(null)}
          >
            <div
              className="bg-[#1a1d24] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-white font-semibold text-lg">Review cleaner</h3>
                    <p className="text-sm text-[var(--color-text-muted)] mt-1">
                      {reviewTarget.cleanerName} • {reviewTarget.leadName} •{' '}
                      {format(new Date(reviewTarget.startAt), 'EEE, MMM d')}
                    </p>
                  </div>
                  <button
                    onClick={() => setReviewTarget(null)}
                    className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
                  >
                    <svg
                      className="w-5 h-5 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Rating</label>
                  <div className="flex gap-2">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => setReviewRating(n)}
                        type="button"
                        className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                          reviewRating === n
                            ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-200'
                            : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Notes</label>
                  <textarea
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                    placeholder="Anything to note about this clean?"
                  />
                </div>

                {reviewError && (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                    {reviewError}
                  </div>
                )}
              </div>

              <div className="p-5 border-t border-white/10 bg-white/[0.02] flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setReviewTarget(null)}
                  className="px-4 py-2.5 text-sm rounded-xl bg-white/5 hover:bg-white/10 text-white border border-white/10 transition-colors"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={submitReview}
                  disabled={savingReview}
                  className="px-5 py-2.5 text-sm rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-400 hover:to-cyan-400 text-white font-medium shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                >
                  {savingReview ? 'Saving…' : 'Save review'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  )
}


