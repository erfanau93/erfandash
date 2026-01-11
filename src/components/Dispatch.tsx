import { useEffect, useMemo, useRef, useState } from 'react'
import 'mapbox-gl/dist/mapbox-gl.css'
import mapboxgl from 'mapbox-gl'
import { supabase } from '../lib/supabase'
import { fetchMapboxToken } from '../lib/mapbox'

type Cleaner = {
  id: string
  full_name: string
  phone: string | null
  base_location_text: string | null
  base_lat: number | null
  base_lng: number | null
  active: boolean | null
}

type BookingOccurrence = {
  id: string
  series_id: string
  start_at: string
  end_at: string
  status: string
  cleaner_id: string | null
  series?: {
    id: string
    title: string
    lead_id: string
    quote_id?: string | null
    service_address: string | null
    service_lat: number | null
    service_lng: number | null
    lead?: { id: string; name: string | null }
  }
}

// NOTE: This uses Dialpad directly from the browser (same approach as other parts of this app).
// If CORS blocks it, we can switch to an Edge Function proxy.
const DIALPAD_SMS_ENDPOINT = 'https://dialpad.com/api/v2/sms'
const dialpadUserId = '6452247499866112'
const dialpadToken =
  'NNRYnLXqJgkWXePcCG2SGCVzHfuB6kxAqQATPvnmn3x6k5RevHUCPdF8zF8jqXsssuyG67bEALxZH9TACsq4aARA46VL4yZ246Kf'

function toYmd(d: Date) {
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function startOfWeekMonday(date: Date) {
  const d = new Date(date)
  const day = d.getDay() // 0=Sun
  const diff = (day === 0 ? -6 : 1) - day // shift to Monday
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function addDays(date: Date, days: number) {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function startOfMonth(date: Date) {
  const d = new Date(date)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

function addMonths(date: Date, months: number) {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export default function Dispatch() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<mapboxgl.Map | null>(null)
  const markersRef = useRef<mapboxgl.Marker[]>([])

  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState(() => {
    if (typeof window === 'undefined') return toYmd(new Date())
    const params = new URLSearchParams(window.location.search)
    const urlDate = params.get('date')
    const storedDate = (() => {
      try {
        return localStorage.getItem('dispatch-date')
      } catch {
        return null
      }
    })()
    const candidate = urlDate || storedDate
    if (candidate) {
      const parsed = new Date(candidate)
      if (!Number.isNaN(parsed.getTime())) return toYmd(parsed)
    }
    return toYmd(new Date())
  })
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>(() => {
    if (typeof window === 'undefined') return 'month'
    const params = new URLSearchParams(window.location.search)
    const urlView = params.get('view')
    const storedView = (() => {
      try {
        return localStorage.getItem('dispatch-view')
      } catch {
        return null
      }
    })()
    const candidate = (urlView || storedView) as 'day' | 'week' | 'month' | null
    return candidate === 'day' || candidate === 'week' || candidate === 'month' ? candidate : 'month'
  })
  const [jobs, setJobs] = useState<BookingOccurrence[]>([])
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [showCleaners, setShowCleaners] = useState(true)
  const [mapboxToken, setMapboxToken] = useState<string | null>(null)
  const [mapboxError, setMapboxError] = useState<string | null>(null)

  const [selectedCleanerIds, setSelectedCleanerIds] = useState<Record<string, boolean>>({})
  const [bulkMessage, setBulkMessage] = useState('')
  const [smsSending, setSmsSending] = useState(false)

  const [cleanerModalId, setCleanerModalId] = useState<string | null>(null)
  const [cleanerModalLoading, setCleanerModalLoading] = useState(false)
  const [cleanerModalError, setCleanerModalError] = useState<string | null>(null)
  const [cleanerModalData, setCleanerModalData] = useState<{
    cleaner: Cleaner | null
    avgRating: number | null
    reviewCount: number
    recentReviews: { rating: number; notes: string | null; created_at: string }[]
    completedJobs: { id: string; start_at: string; series_title: string | null; lead_name: string | null }[]
  } | null>(null)

  const activeCleaners = useMemo(() => cleaners.filter((c) => c.active !== false), [cleaners])
  const jobsUnassigned = useMemo(() => jobs.filter((j) => !j.cleaner_id), [jobs])
  const jobsAssigned = useMemo(() => jobs.filter((j) => Boolean(j.cleaner_id)), [jobs])

  const [quotePins, setQuotePins] = useState<Record<string, { address: string | null; lat: number | null; lng: number | null }>>(
    {}
  )

  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')

  useEffect(() => {
    fetchMapboxToken()
      .then((token) => {
        setMapboxToken(token)
        setMapboxError(null)
      })
      .catch((err) => {
        console.error('Mapbox token load failed', err)
        setMapboxError(err instanceof Error ? err.message : 'Unable to load Mapbox token')
      })
  }, [])

  useEffect(() => {
    if (!mapboxToken) return
    ;(mapboxgl as any).accessToken = mapboxToken
  }, [mapboxToken])

  useEffect(() => {
    if (!mapboxToken) return
    if (!mapContainerRef.current) return
    if (mapRef.current) return

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [151.2093, -33.8688], // Sydney
      zoom: 10,
    })

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'top-right')
    map.once('load', () => {
      // Ensure map renders if container size was 0 at init time
      map.resize()
    })
    map.on('error', (evt) => {
      console.error('Mapbox map error', evt?.error || evt)
      setMapboxError('Map tiles failed to load. Check token/domain permissions.')
    })
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [mapboxToken])

  // Persist date + view in URL params and localStorage so navigation keeps context.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    params.set('date', selectedDate)
    params.set('view', viewMode)
    const newUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState({}, '', newUrl)
    try {
      localStorage.setItem('dispatch-date', selectedDate)
      localStorage.setItem('dispatch-view', viewMode)
    } catch {
      // ignore storage failures
    }
  }, [selectedDate, viewMode])

  const clearMarkers = () => {
    for (const m of markersRef.current) m.remove()
    markersRef.current = []
  }

  const addJobMarker = (
    job: BookingOccurrence,
    lng: number,
    lat: number,
    label: string,
    assignedCleanerName?: string | null
  ) => {
    const map = mapRef.current
    if (!map) return
    const assigned = Boolean(job.cleaner_id)

    const el = document.createElement('div')
    el.style.width = '14px'
    el.style.height = '14px'
    el.style.borderRadius = '999px'
    // Assigned = green, Unassigned = orange
    el.style.border = assigned ? '2px solid rgba(34,197,94,0.95)' : '2px solid rgba(249,115,22,0.95)'
    el.style.background = assigned ? 'rgba(34,197,94,0.85)' : 'rgba(249,115,22,0.85)'
    el.style.cursor = 'pointer'
    el.title = label

    // Rich popup content so users can see/launch the job directly
    const popupContent = document.createElement('div')
    popupContent.style.display = 'grid'
    popupContent.style.gap = '4px'
    popupContent.style.maxWidth = '260px'
    popupContent.style.color = '#0f172a'
    popupContent.style.fontSize = '13px'

    const titleEl = document.createElement('div')
    titleEl.style.fontWeight = '600'
    titleEl.textContent = label

    const timeEl = document.createElement('div')
    timeEl.style.color = '#475569'
    timeEl.textContent = new Date(job.start_at).toLocaleString()

    const statusEl = document.createElement('div')
    statusEl.style.color = assigned ? '#16a34a' : '#ea580c'
    statusEl.textContent = assignedCleanerName
      ? `Assigned to ${assignedCleanerName}`
      : assigned
      ? 'Assigned'
      : 'Unassigned'

    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.textContent = 'Open job'
    openBtn.style.marginTop = '6px'
    openBtn.style.padding = '8px 10px'
    openBtn.style.borderRadius = '10px'
    openBtn.style.background = '#0ea5e9'
    openBtn.style.color = '#fff'
    openBtn.style.fontWeight = '600'
    openBtn.style.border = 'none'
    openBtn.style.cursor = 'pointer'
    openBtn.onclick = () => {
      window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: job.id } }))
    }

    popupContent.appendChild(titleEl)
    popupContent.appendChild(timeEl)
    popupContent.appendChild(statusEl)
    popupContent.appendChild(openBtn)

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .setPopup(new mapboxgl.Popup({ offset: 14 }).setDOMContent(popupContent))
      .addTo(map)

    // Ensure popup opens when clicking the marker element
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      marker.togglePopup()
    })

    markersRef.current.push(marker)
  }

  const addCleanerMarker = (cleaner: Cleaner) => {
    const map = mapRef.current
    if (!map) return
    if (typeof cleaner.base_lat !== 'number' || typeof cleaner.base_lng !== 'number') return

    const el = document.createElement('button')
    el.type = 'button'
    el.style.width = '14px'
    el.style.height = '14px'
    el.style.borderRadius = '999px'
    el.style.border = '2px solid rgba(255,255,255,0.9)'
    // Cleaners = purple
    el.style.background = 'rgba(168,85,247,0.95)'
    el.style.cursor = 'pointer'
    el.title = cleaner.full_name
    el.onclick = () => {
      setCleanerModalId(cleaner.id)
    }

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([cleaner.base_lng, cleaner.base_lat])
      .addTo(map)

    markersRef.current.push(marker)
  }

  const loadData = async () => {
    setError(null)
    setInfo(null)
    try {
      const baseDate = new Date(`${selectedDate}T00:00:00`)
      const rangeStart =
        viewMode === 'month' ? startOfMonth(baseDate) : viewMode === 'week' ? startOfWeekMonday(baseDate) : baseDate
      const rangeEnd =
        viewMode === 'month'
          ? addMonths(rangeStart, 1)
          : viewMode === 'week'
          ? addDays(rangeStart, 7)
          : addDays(rangeStart, 1)

      const [{ data: cleanersData, error: cleanersErr }, { data: jobsData, error: jobsErr }] = await Promise.all([
        supabase
          .from('cleaners')
          .select('id, full_name, phone, base_location_text, base_lat, base_lng, active')
          .order('full_name'),
        supabase
          .from('booking_occurrences')
          .select(
            `id, series_id, start_at, end_at, status, cleaner_id,
             series:booking_series(id, title, lead_id, quote_id, service_address, service_lat, service_lng, lead:extracted_leads(id, name))`
          )
          .gte('start_at', rangeStart.toISOString())
          .lt('start_at', rangeEnd.toISOString())
          .neq('status', 'cancelled')
          .order('start_at', { ascending: true }),
      ])

      if (cleanersErr) throw cleanersErr
      if (jobsErr) throw jobsErr
      setCleaners((cleanersData || []) as any)
      const jobList = (jobsData || []) as any[]
      setJobs(jobList as any)

      // Quote pins: use the quote explicitly linked to each booking; fallback to latest quote only for legacy bookings without quote_id.
      const quoteIds = Array.from(new Set(jobList.map((j) => j?.series?.quote_id).filter(Boolean))) as string[]
      const quoteById: Record<string, { address: string | null; lat: number | null; lng: number | null; lead_id: string | null }> = {}
      if (quoteIds.length) {
        const { data: quotes, error: qErr } = await supabase
          .from('quotes')
          .select('id, lead_id, address, address_lat, address_lng')
          .in('id', quoteIds)
        if (!qErr && quotes) {
          for (const q of quotes as any[]) {
            quoteById[q.id] = {
              address: q.address ?? null,
              lat: typeof q.address_lat === 'number' ? q.address_lat : null,
              lng: typeof q.address_lng === 'number' ? q.address_lng : null,
              lead_id: q.lead_id ?? null,
            }
          }
        }
      }

      const fallbackLeadIds = Array.from(
        new Set(
          jobList
            .map((j) => (!j?.series?.quote_id ? j?.series?.lead_id : null))
            .filter(Boolean)
        )
      ) as string[]
      const latestByLead: Record<string, { address: string | null; lat: number | null; lng: number | null }> = {}
      if (fallbackLeadIds.length) {
        const { data: quotes, error: qErr } = await supabase
          .from('quotes')
          .select('lead_id, address, address_lat, address_lng, created_at')
          .in('lead_id', fallbackLeadIds)
          .order('created_at', { ascending: false })
        if (!qErr && quotes) {
          for (const q of quotes as any[]) {
            const lid = q.lead_id as string
            if (!lid || latestByLead[lid]) continue
            latestByLead[lid] = {
              address: q.address ?? null,
              lat: typeof q.address_lat === 'number' ? q.address_lat : null,
              lng: typeof q.address_lng === 'number' ? q.address_lng : null,
            }
          }
        }
      }

      const pins: Record<string, { address: string | null; lat: number | null; lng: number | null }> = {}
      for (const j of jobList) {
        const sid = j?.series?.id
        if (!sid) continue
        const linked = j?.series?.quote_id ? quoteById[j.series.quote_id] : null
        const fallback = j?.series?.lead_id ? latestByLead[j.series.lead_id] : null
        const address = linked?.address ?? fallback?.address ?? j?.series?.service_address ?? null
        const lat = linked?.lat ?? fallback?.lat ?? j?.series?.service_lat ?? null
        const lng = linked?.lng ?? fallback?.lng ?? j?.series?.service_lng ?? null
        pins[sid] = {
          address,
          lat: typeof lat === 'number' ? lat : null,
          lng: typeof lng === 'number' ? lng : null,
        }
      }

      setQuotePins(pins)
    } catch (e: any) {
      setError(e?.message || 'Failed to load dispatch data')
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, viewMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    clearMarkers()

    // Add job markers
    for (const j of jobs) {
      const seriesId = j.series?.id
      const quotePin = seriesId ? quotePins[seriesId] : null
      const lat = quotePin?.lat ?? j.series?.service_lat
      const lng = quotePin?.lng ?? j.series?.service_lng
      if (typeof lat === 'number' && typeof lng === 'number') {
        const label = `${j.series?.lead?.name || 'Customer'} • ${j.series?.title || 'Job'}`
        const assignedCleaner = j.cleaner_id ? cleaners.find((c) => c.id === j.cleaner_id) : null
        addJobMarker(j, lng, lat, label, assignedCleaner?.full_name ?? null)
      }
    }

    // Add cleaner markers (toggleable)
    if (showCleaners) {
      for (const c of activeCleaners) {
        addCleanerMarker(c)
      }
    }
  }, [jobs, activeCleaners, showCleaners, quotePins, cleaners])

  const assignCleaner = async (occurrenceId: string, cleanerId: string | null) => {
    setError(null)
    setInfo(null)
    try {
      const { error: err } = await supabase
        .from('booking_occurrences')
        .update({ cleaner_id: cleanerId, assigned_at: cleanerId ? new Date().toISOString() : null })
        .eq('id', occurrenceId)
      if (err) throw err
      setInfo('Cleaner assigned')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Failed to assign cleaner')
    }
  }

  const toggleSelectCleaner = (id: string) => {
    setSelectedCleanerIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  const selectedCleanerList = useMemo(
    () => activeCleaners.filter((c) => selectedCleanerIds[c.id]),
    [activeCleaners, selectedCleanerIds]
  )

  const sendBulkSms = async () => {
    setError(null)
    setInfo(null)
    if (!bulkMessage.trim()) {
      setError('Type a message first.')
      return
    }
    if (selectedCleanerList.length === 0) {
      setError('Select at least one cleaner.')
      return
    }
    const recipients = selectedCleanerList.filter((c) => c.phone && c.phone.trim().length > 0)
    if (recipients.length === 0) {
      setError('Selected cleaners have no phone numbers.')
      return
    }
    setSmsSending(true)
    try {
      for (const c of recipients) {
        const payload = {
          infer_country_code: false,
          to_numbers: [c.phone],
          user_id: dialpadUserId,
          text: bulkMessage.trim(),
        }
        const response = await fetch(DIALPAD_SMS_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            accept: 'application/json',
            authorization: `Bearer ${dialpadToken}`,
          },
          body: JSON.stringify(payload),
        })
        const textBody = await response.text()
        let parsed: any = null
        try {
          parsed = textBody ? JSON.parse(textBody) : null
        } catch {
          parsed = null
        }
        if (!response.ok || parsed?.error) {
          const details =
            typeof parsed?.error === 'string'
              ? parsed.error
              : parsed?.error
              ? JSON.stringify(parsed.error)
              : textBody || `Failed to send SMS (status ${response.status})`
          throw new Error(`Dialpad error for ${c.full_name}: ${details}`)
        }
      }
      setInfo(`Sent SMS to ${recipients.length} cleaner(s).`)
      setBulkMessage('')
      setSelectedCleanerIds({})
    } catch (e: any) {
      setError(e?.message || 'Failed to send bulk SMS')
    } finally {
      setSmsSending(false)
    }
  }

  const openCleanerModal = async (cleanerId: string) => {
    setCleanerModalId(cleanerId)
  }

  useEffect(() => {
    if (!cleanerModalId) return
    ;(async () => {
      setCleanerModalLoading(true)
      setCleanerModalError(null)
      try {
        const cleaner = cleaners.find((c) => c.id === cleanerModalId) || null

        // Reviews + ratings
        const { data: reviews, error: reviewsErr } = await supabase
          .from('cleaner_job_reviews')
          .select('rating, notes, created_at')
          .eq('cleaner_id', cleanerModalId)
          .order('created_at', { ascending: false })
          .limit(50)
        if (reviewsErr) throw reviewsErr

        const list = (reviews || []) as { rating: number; notes: string | null; created_at: string }[]
        const reviewCount = list.length
        const avgRating = reviewCount ? list.reduce((a, r) => a + Number(r.rating || 0), 0) / reviewCount : null

        // Completed jobs history
        const { data: occs, error: occErr } = await supabase
          .from('booking_occurrences')
          .select('id, start_at, series:booking_series(title, lead:extracted_leads(name))')
          .eq('cleaner_id', cleanerModalId)
          .eq('status', 'completed')
          .order('start_at', { ascending: false })
          .limit(50)
        if (occErr) throw occErr

        const completedJobs = ((occs || []) as any[]).map((o) => ({
          id: o.id as string,
          start_at: o.start_at as string,
          series_title: o?.series?.title ?? null,
          lead_name: o?.series?.lead?.name ?? null,
        }))

        setCleanerModalData({
          cleaner,
          avgRating,
          reviewCount,
          recentReviews: list.slice(0, 8),
          completedJobs: completedJobs.slice(0, 12),
        })
      } catch (e: any) {
        setCleanerModalError(e?.message || 'Failed to load cleaner profile')
        setCleanerModalData(null)
      } finally {
        setCleanerModalLoading(false)
      }
    })()
  }, [cleanerModalId, cleaners])

  // Refresh board when another part of the app updates a job (e.g., from JobModal).
  useEffect(() => {
    const handler = () => {
      loadData()
    }
    window.addEventListener('job-updated', handler as any)
    return () => window.removeEventListener('job-updated', handler as any)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Dispatch</h1>
              <p className="text-[var(--color-text-muted)]">Map + quick assignment (simple mode).</p>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {viewMode === 'month' ? (
                <input
                  type="month"
                  value={selectedDate.slice(0, 7)}
                  onChange={(e) => setSelectedDate(`${e.target.value}-01`)}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white"
                />
              ) : (
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white"
                />
              )}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setViewMode('day')}
                  className={`px-3 py-2 text-sm rounded-xl border transition-colors ${
                    viewMode === 'day'
                      ? 'bg-cyan-600 text-white border-cyan-500/50'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                  }`}
                >
                  Day
                </button>
                <button
                  onClick={() => setViewMode('week')}
                  className={`px-3 py-2 text-sm rounded-xl border transition-colors ${
                    viewMode === 'week'
                      ? 'bg-cyan-600 text-white border-cyan-500/50'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                  }`}
                >
                  Week
                </button>
                <button
                  onClick={() => setViewMode('month')}
                  className={`px-3 py-2 text-sm rounded-xl border transition-colors ${
                    viewMode === 'month'
                      ? 'bg-cyan-600 text-white border-cyan-500/50'
                      : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                  }`}
                >
                  Month
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const d = new Date(`${selectedDate}T00:00:00`)
                    const next =
                      viewMode === 'month'
                        ? addMonths(d, -1)
                        : viewMode === 'week'
                        ? addDays(d, -7)
                        : addDays(d, -1)
                    setSelectedDate(toYmd(next))
                  }}
                  className="px-3 py-2 text-sm rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                >
                  Prev
                </button>
                <button
                  onClick={() => setSelectedDate(toYmd(new Date()))}
                  className="px-3 py-2 text-sm rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                >
                  Today
                </button>
                <button
                  onClick={() => {
                    const d = new Date(`${selectedDate}T00:00:00`)
                    const next =
                      viewMode === 'month'
                        ? addMonths(d, 1)
                        : viewMode === 'week'
                        ? addDays(d, 7)
                        : addDays(d, 1)
                    setSelectedDate(toYmd(next))
                  }}
                  className="px-3 py-2 text-sm rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                >
                  Next
                </button>
              </div>
              <button
                onClick={() => setShowCleaners((v) => !v)}
                className="px-3 py-2 text-sm rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
              >
                {showCleaners ? 'Hide cleaners' : 'Show cleaners'}
              </button>
            </div>
          </div>
        </header>

        {!mapboxToken && !mapboxError && (
          <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-sm">
            Loading Mapbox token from Supabase…
          </div>
        )}

        {mapboxError && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            Mapbox token unavailable. Check Supabase secret <span className="font-mono">MAPBOX_TOKEN</span>. {mapboxError}
          </div>
        )}

        {info && (
          <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-100 text-sm">
            {info}
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">{error}</div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Jobs + Bulk SMS */}
          <div className="lg:col-span-2 space-y-4">
            {/* Unassigned */}
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
              <div className="p-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div className="text-white font-semibold">
                  Unassigned jobs <span className="text-xs text-[var(--color-text-muted)]">({jobsUnassigned.length})</span>
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">Click a job for full details</div>
              </div>

              <div className="p-2 max-h-[30vh] overflow-y-auto">
                {jobsUnassigned.length === 0 ? (
                  <div className="p-3 text-sm text-[var(--color-text-muted)]">No unassigned jobs.</div>
                ) : (
                  jobsUnassigned.map((j) => {
                    const seriesId = j.series?.id
                    const quotePin = seriesId ? quotePins[seriesId] : null
                    const pinLat = quotePin?.lat ?? j.series?.service_lat
                    const pinLng = quotePin?.lng ?? j.series?.service_lng
                    const hasCoords = typeof pinLat === 'number' && typeof pinLng === 'number'
                    return (
                      <div key={j.id} className="p-3 rounded-2xl border border-orange-500/20 bg-orange-500/5 mb-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: j.id } }))
                            }
                            className="min-w-0 text-left flex-1"
                          >
                            <div className="text-white font-medium truncate">
                              {j.series?.lead?.name || 'Customer'} • {j.series?.title || 'Job'}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {new Date(j.start_at).toLocaleString()} • {j.status}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)] truncate">
                              {quotePin?.address || j.series?.service_address || 'No address set'}{' '}
                              {hasCoords ? '' : '• (no map pin yet)'}
                            </div>
                          </button>

                          <div className="w-[220px]">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  setPickerQuery('')
                                  setPickerOpenFor((prev) => (prev === j.id ? null : j.id))
                                }}
                                className="w-full text-left px-3 py-2 text-xs rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                              >
                                Assign cleaner… <span className="text-white/40">▼</span>
                              </button>
                              {pickerOpenFor === j.id && (
                                <div className="absolute z-[10010] mt-2 w-full rounded-xl border border-white/10 bg-[#12141a] shadow-2xl overflow-hidden">
                                  <div className="p-2 border-b border-white/10">
                                    <input
                                      value={pickerQuery}
                                      onChange={(e) => setPickerQuery(e.target.value)}
                                      placeholder="Search..."
                                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                                      autoFocus
                                    />
                                  </div>
                                  <div className="max-h-60 overflow-y-auto">
                                    {activeCleaners
                                      .filter((c) =>
                                        pickerQuery.trim()
                                          ? c.full_name.toLowerCase().includes(pickerQuery.trim().toLowerCase())
                                          : true
                                      )
                                      .map((c) => (
                                        <button
                                          key={c.id}
                                          type="button"
                                          onClick={() => {
                                            assignCleaner(j.id, c.id)
                                            setPickerOpenFor(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10"
                                        >
                                          {c.full_name}
                                        </button>
                                      ))}
                                    {activeCleaners.length === 0 && (
                                      <div className="px-3 py-3 text-sm text-white/60">No cleaners.</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Assigned */}
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
              <div className="p-4 border-b border-white/10">
                <div className="text-white font-semibold">
                  Assigned jobs <span className="text-xs text-[var(--color-text-muted)]">({jobsAssigned.length})</span>
                </div>
              </div>

              <div className="p-2 max-h-[30vh] overflow-y-auto">
                {jobsAssigned.length === 0 ? (
                  <div className="p-3 text-sm text-[var(--color-text-muted)]">No assigned jobs.</div>
                ) : (
                  jobsAssigned.map((j) => {
                    const seriesId = j.series?.id
                    const quotePin = seriesId ? quotePins[seriesId] : null
                    const pinLat = quotePin?.lat ?? j.series?.service_lat
                    const pinLng = quotePin?.lng ?? j.series?.service_lng
                    const hasCoords = typeof pinLat === 'number' && typeof pinLng === 'number'
                    const assignedCleaner = cleaners.find((c) => c.id === j.cleaner_id)
                    return (
                      <div key={j.id} className="p-3 rounded-2xl border border-green-500/20 bg-green-500/5 mb-2">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              window.dispatchEvent(new CustomEvent('open-job-modal', { detail: { occurrenceId: j.id } }))
                            }
                            className="min-w-0 text-left flex-1"
                          >
                            <div className="text-white font-medium truncate">
                              {j.series?.lead?.name || 'Customer'} • {j.series?.title || 'Job'}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)]">
                              {new Date(j.start_at).toLocaleString()} • {j.status}
                            </div>
                            <div className="text-xs text-[var(--color-text-muted)] truncate">
                              {quotePin?.address || j.series?.service_address || 'No address set'}{' '}
                              {hasCoords ? '' : '• (no map pin yet)'}
                            </div>
                          </button>

                          <div className="w-[220px] space-y-2">
                            <button
                              type="button"
                              onClick={() => assignedCleaner && openCleanerModal(assignedCleaner.id)}
                              className="w-full px-3 py-2 text-xs rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10 text-left"
                            >
                              {assignedCleaner?.full_name || 'Cleaner'} (view)
                            </button>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => {
                                  setPickerQuery('')
                                  setPickerOpenFor((prev) => (prev === j.id ? null : j.id))
                                }}
                                className="w-full text-left px-3 py-2 text-xs rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/10"
                              >
                                Change cleaner… <span className="text-white/40">▼</span>
                              </button>
                              {pickerOpenFor === j.id && (
                                <div className="absolute z-[10010] mt-2 w-full rounded-xl border border-white/10 bg-[#12141a] shadow-2xl overflow-hidden">
                                  <div className="p-2 border-b border-white/10">
                                    <input
                                      value={pickerQuery}
                                      onChange={(e) => setPickerQuery(e.target.value)}
                                      placeholder="Search..."
                                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                                      autoFocus
                                    />
                                  </div>
                                  <div className="max-h-60 overflow-y-auto">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        assignCleaner(j.id, null)
                                        setPickerOpenFor(null)
                                      }}
                                      className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10"
                                    >
                                      Unassign
                                    </button>
                                    {activeCleaners
                                      .filter((c) =>
                                        pickerQuery.trim()
                                          ? c.full_name.toLowerCase().includes(pickerQuery.trim().toLowerCase())
                                          : true
                                      )
                                      .map((c) => (
                                        <button
                                          key={c.id}
                                          type="button"
                                          onClick={() => {
                                            assignCleaner(j.id, c.id)
                                            setPickerOpenFor(null)
                                          }}
                                          className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10"
                                        >
                                          {c.full_name}
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Bulk SMS */}
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
              <div className="p-4 border-b border-white/10">
                <div className="text-white font-semibold">Bulk SMS to cleaners</div>
                <div className="text-xs text-[var(--color-text-muted)] mt-1">
                  Select cleaners below, write message, then send.
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="max-h-40 overflow-y-auto border border-white/10 rounded-xl bg-black/20">
                  {activeCleaners.length === 0 ? (
                    <div className="p-3 text-sm text-[var(--color-text-muted)]">No cleaners.</div>
                  ) : (
                    activeCleaners.map((c) => (
                      <label
                        key={c.id}
                        className="flex items-center gap-3 px-3 py-2 border-b border-white/5 last:border-b-0 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(selectedCleanerIds[c.id])}
                          onChange={() => toggleSelectCleaner(c.id)}
                        />
                        <span className="text-white flex-1 truncate">{c.full_name}</span>
                        <span className="text-xs text-[var(--color-text-muted)]">{c.phone || 'no phone'}</span>
                      </label>
                    ))
                  )}
                </div>
                <textarea
                  value={bulkMessage}
                  onChange={(e) => setBulkMessage(e.target.value)}
                  rows={3}
                  placeholder="Type message to send..."
                  className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm"
                />
                <button
                  onClick={sendBulkSms}
                  disabled={smsSending}
                  className="w-full px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-50"
                >
                  {smsSending ? 'Sending…' : `Send SMS (${selectedCleanerList.length} selected)`}
                </button>
              </div>
            </div>
          </div>

          {/* Map */}
          <div className="lg:col-span-3 rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <div className="text-white font-semibold">Map</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                Jobs: unassigned (orange) / assigned (green). Cleaners are purple and clickable (toggleable).
              </div>
            </div>
            <div ref={mapContainerRef} style={{ height: '72vh', width: '100%' }} />
          </div>
        </div>

        {/* Cleaner profile modal */}
        {cleanerModalId && (
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[10020] p-4"
            onClick={() => setCleanerModalId(null)}
          >
            <div
              className="bg-[#1a1d24] border border-white/10 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 border-b border-white/10 bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-lg">
                    {cleanerModalData?.cleaner?.full_name || 'Cleaner'}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">
                    {cleanerModalData?.cleaner?.base_location_text || 'No base location'} •{' '}
                    {cleanerModalData?.cleaner?.phone || 'No phone'}
                  </div>
                </div>
                <button
                  onClick={() => setCleanerModalId(null)}
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

              <div className="p-5 space-y-4">
                {cleanerModalLoading ? (
                  <div className="text-sm text-[var(--color-text-muted)]">Loading…</div>
                ) : cleanerModalError ? (
                  <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
                    {cleanerModalError}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="text-xs text-[var(--color-text-muted)]">Avg rating</div>
                        <div className="text-white text-xl font-semibold">
                          {cleanerModalData?.avgRating ? cleanerModalData.avgRating.toFixed(2) : '—'}
                        </div>
                      </div>
                      <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="text-xs text-[var(--color-text-muted)]">Reviews</div>
                        <div className="text-white text-xl font-semibold">{cleanerModalData?.reviewCount ?? 0}</div>
                      </div>
                      <div className="p-3 rounded-xl bg-white/5 border border-white/10">
                        <div className="text-xs text-[var(--color-text-muted)]">Completed jobs (recent)</div>
                        <div className="text-white text-xl font-semibold">
                          {cleanerModalData?.completedJobs?.length ?? 0}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                        <div className="text-white font-semibold mb-2">Recent reviews</div>
                        {cleanerModalData?.recentReviews?.length ? (
                          <div className="space-y-2">
                            {cleanerModalData.recentReviews.map((r, idx) => (
                              <div key={idx} className="p-3 rounded-xl bg-black/20 border border-white/10">
                                <div className="text-sm text-white">
                                  Rating: <span className="font-semibold">{r.rating}</span>
                                </div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {new Date(r.created_at).toLocaleString()}
                                </div>
                                {r.notes ? <div className="text-sm text-white/80 mt-1">{r.notes}</div> : null}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--color-text-muted)]">No reviews yet.</div>
                        )}
                      </div>

                      <div className="p-4 rounded-2xl bg-white/5 border border-white/10">
                        <div className="text-white font-semibold mb-2">Work history (completed)</div>
                        {cleanerModalData?.completedJobs?.length ? (
                          <div className="space-y-2">
                            {cleanerModalData.completedJobs.map((j) => (
                              <div key={j.id} className="p-3 rounded-xl bg-black/20 border border-white/10">
                                <div className="text-sm text-white font-medium">
                                  {j.lead_name || 'Customer'} • {j.series_title || 'Job'}
                                </div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {new Date(j.start_at).toLocaleString()}
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--color-text-muted)]">No completed jobs yet.</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}



