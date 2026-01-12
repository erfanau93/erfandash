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

type QuotePin = {
  address: string | null
  lat: number | null
  lng: number | null
  total_inc_gst: number | null
}

type CleanerReviewStat = {
  avg: number | null
  count: number
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

// Calculate distance between two points using Haversine formula
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a =
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

// Format distance for display
function formatDistance(km: number): string {
  if (km < 1) {
    return `${Math.round(km * 1000)}m`
  }
  return `${km.toFixed(1)}km`
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return `$${Number(value).toFixed(2)}`
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

  // Map highlighting state
  const [highlightedJobId, setHighlightedJobId] = useState<string | null>(null)
  const [highlightedCleanerId, setHighlightedCleanerId] = useState<string | null>(null)

  const activeCleaners = useMemo(() => cleaners.filter((c) => c.active !== false), [cleaners])
  const jobsUnassigned = useMemo(() => jobs.filter((j) => !j.cleaner_id), [jobs])
  const jobsAssigned = useMemo(() => jobs.filter((j) => Boolean(j.cleaner_id)), [jobs])

  const [quotePins, setQuotePins] = useState<Record<string, QuotePin>>({})

  const [pickerOpenFor, setPickerOpenFor] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [cleanerReviewStats, setCleanerReviewStats] = useState<Record<string, CleanerReviewStat>>({})
  const [selectedLocation, setSelectedLocation] = useState<{ label: string; lat: number; lng: number } | null>(null)
  const [locationQuery, setLocationQuery] = useState('')
  const [locationResults, setLocationResults] = useState<{ place_name: string; center: [number, number] | undefined }[]>([])
  const [isLocationSearching, setIsLocationSearching] = useState(false)
  const [cleanerSort, setCleanerSort] = useState<'distance' | 'reviews' | 'availability'>('distance')
  const [cleanerNameFilter, setCleanerNameFilter] = useState('')
  const [cleanerPage, setCleanerPage] = useState(1)
  const CLEANER_PAGE_SIZE = 6

  const [unassignedSort, setUnassignedSort] = useState<'due_asc' | 'due_desc' | 'cost_high' | 'cost_low'>('due_asc')
  const [assignedSort, setAssignedSort] = useState<'due_asc' | 'due_desc' | 'cost_high' | 'cost_low'>('due_asc')
  const [unassignedPage, setUnassignedPage] = useState(1)
  const [assignedPage, setAssignedPage] = useState(1)
  const JOB_PAGE_SIZE = 6

  const [bulkSearch, setBulkSearch] = useState('')
  const [bulkPage, setBulkPage] = useState(1)
  const BULK_PAGE_SIZE = 8

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
    if (!locationQuery || locationQuery.trim().length < 3) {
      setLocationResults([])
      setIsLocationSearching(false)
      return
    }

    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setIsLocationSearching(true)
      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(
          locationQuery.trim()
        )}.json?access_token=${mapboxToken}&autocomplete=true&limit=5&country=AU`
        const res = await fetch(url, { signal: controller.signal })
        const data = await res.json().catch(() => ({}))
        const suggestions =
          data?.features
            ?.map((f: any) => ({
              place_name: f?.place_name as string,
              center: f?.center as [number, number] | undefined, // [lng, lat]
            }))
            .filter((x: any) => typeof x?.place_name === 'string' && x.place_name.length > 0) || []
        setLocationResults(suggestions)
      } catch (err) {
        if ((err as any)?.name !== 'AbortError') {
          console.error('Mapbox location search failed', err)
          setLocationResults([])
        }
      } finally {
        setIsLocationSearching(false)
      }
    }, 250)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [locationQuery, mapboxToken])

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

  // Highlight and pan/zoom to a job on the map
  const highlightJobOnMap = (jobId: string) => {
    const map = mapRef.current
    if (!map) return

    const job = jobs.find(j => j.id === jobId)
    if (!job) return

    const seriesId = job.series?.id
    const quotePin = seriesId ? quotePins[seriesId] : null
    const lat = quotePin?.lat ?? job.series?.service_lat
    const lng = quotePin?.lng ?? job.series?.service_lng

    if (typeof lat === 'number' && typeof lng === 'number') {
      // Clear previous highlights
      setHighlightedJobId(null)
      setHighlightedCleanerId(null)

      // Set new highlight
      setHighlightedJobId(jobId)

      // Pan and zoom to the job location with smooth animation
      map.flyTo({
        center: [lng, lat],
        zoom: 16,
        duration: 1200,
        easing: (t) => t * (2 - t) // ease-out quadratic
      })

      // Clear highlight after animation with a longer duration for better visibility
      setTimeout(() => setHighlightedJobId(null), 4000)
    }
  }

  // Highlight and center on a cleaner on the map
  const highlightCleanerOnMap = (cleanerId: string) => {
    const map = mapRef.current
    if (!map) return

    const cleaner = cleaners.find(c => c.id === cleanerId)
    if (!cleaner || typeof cleaner.base_lat !== 'number' || typeof cleaner.base_lng !== 'number') return

    // Clear previous highlights
    setHighlightedJobId(null)
    setHighlightedCleanerId(null)

    // Set new highlight
    setHighlightedCleanerId(cleanerId)

    // Pan and zoom to the cleaner location with smooth animation
    map.flyTo({
      center: [cleaner.base_lng, cleaner.base_lat],
      zoom: 16,
      duration: 1200,
      easing: (t) => t * (2 - t) // ease-out quadratic
    })

    // Clear highlight after animation with a longer duration for better visibility
    setTimeout(() => setHighlightedCleanerId(null), 4000)
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

    // Add highlight animation if this job is highlighted
    if (highlightedJobId === job.id) {
      el.style.animation = 'pulse-glow 1.5s ease-in-out infinite alternate'
      el.style.transform = 'scale(2.2)'
      el.style.boxShadow = '0 0 30px rgba(34,197,94,0.9), 0 0 60px rgba(34,197,94,0.6), 0 0 90px rgba(34,197,94,0.3)'
      el.style.borderWidth = '3px'
      el.style.zIndex = '1000'
    }

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

    // Add highlight animation if this cleaner is highlighted
    if (highlightedCleanerId === cleaner.id) {
      el.style.animation = 'pulse-glow 1.5s ease-in-out infinite alternate'
      el.style.transform = 'scale(2.2)'
      el.style.boxShadow = '0 0 30px rgba(168,85,247,0.9), 0 0 60px rgba(168,85,247,0.6), 0 0 90px rgba(168,85,247,0.3)'
      el.style.borderWidth = '3px'
      el.style.zIndex = '1000'
    }

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([cleaner.base_lng, cleaner.base_lat])
      .addTo(map)

    markersRef.current.push(marker)
  }

  const getJobCost = (job: BookingOccurrence): number | null => {
    const seriesId = job.series?.id
    const pin = seriesId ? quotePins[seriesId] : null
    return typeof pin?.total_inc_gst === 'number' ? pin.total_inc_gst : null
  }

  const compareJobs = (a: BookingOccurrence, b: BookingOccurrence, sort: typeof unassignedSort) => {
    if (sort === 'cost_high' || sort === 'cost_low') {
      const aCost = getJobCost(a)
      const bCost = getJobCost(b)
      if (aCost !== null && bCost !== null) {
        return sort === 'cost_high' ? bCost - aCost : aCost - bCost
      }
      if (aCost !== null) return -1
      if (bCost !== null) return 1
    }
    const aDate = new Date(a.start_at).getTime()
    const bDate = new Date(b.start_at).getTime()
    return sort === 'due_desc' ? bDate - aDate : aDate - bDate
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

      const [
        { data: cleanersData, error: cleanersErr },
        { data: jobsData, error: jobsErr },
        { data: reviewStats, error: reviewStatsErr },
      ] = await Promise.all([
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
        supabase
          .from('cleaner_job_reviews')
          .select('cleaner_id, avg_rating:avg(rating), review_count:count(id)')
          // Aggregates automatically group by non-aggregate columns in PostgREST
          .order('cleaner_id'),
      ])

      if (cleanersErr) throw cleanersErr
      if (jobsErr) throw jobsErr
      if (reviewStatsErr) {
        console.warn('Failed to load cleaner review stats', reviewStatsErr)
      }
      setCleaners((cleanersData || []) as any)
      const jobList = (jobsData || []) as any[]
      setJobs(jobList as any)

      if (reviewStats && Array.isArray(reviewStats)) {
        const stats: Record<string, CleanerReviewStat> = {}
        for (const row of reviewStats as any[]) {
          const cid = row?.cleaner_id as string | undefined
          if (!cid) continue
          stats[cid] = {
            avg: typeof row?.avg_rating === 'number' ? row.avg_rating : null,
            count: typeof row?.review_count === 'number' ? row.review_count : 0,
          }
        }
        setCleanerReviewStats(stats)
      } else {
        setCleanerReviewStats({})
      }

      // Quote pins: use the quote explicitly linked to each booking; fallback to latest quote only for legacy bookings without quote_id.
      const quoteIds = Array.from(new Set(jobList.map((j) => j?.series?.quote_id).filter(Boolean))) as string[]
      const quoteById: Record<
        string,
        { address: string | null; lat: number | null; lng: number | null; lead_id: string | null; total_inc_gst: number | null }
      > = {}
      if (quoteIds.length) {
        const { data: quotes, error: qErr } = await supabase
          .from('quotes')
          .select('id, lead_id, address, address_lat, address_lng, total_inc_gst')
          .in('id', quoteIds)
        if (!qErr && quotes) {
          for (const q of quotes as any[]) {
            quoteById[q.id] = {
              address: q.address ?? null,
              lat: typeof q.address_lat === 'number' ? q.address_lat : null,
              lng: typeof q.address_lng === 'number' ? q.address_lng : null,
              lead_id: q.lead_id ?? null,
              total_inc_gst: typeof q.total_inc_gst === 'number' ? q.total_inc_gst : null,
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
      const latestByLead: Record<string, { address: string | null; lat: number | null; lng: number | null; total_inc_gst: number | null }> =
        {}
      if (fallbackLeadIds.length) {
        const { data: quotes, error: qErr } = await supabase
          .from('quotes')
          .select('lead_id, address, address_lat, address_lng, created_at, total_inc_gst')
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
              total_inc_gst: typeof q.total_inc_gst === 'number' ? q.total_inc_gst : null,
            }
          }
        }
      }

      const pins: Record<string, QuotePin> = {}
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
          total_inc_gst: typeof (linked?.total_inc_gst ?? fallback?.total_inc_gst) === 'number'
            ? (linked?.total_inc_gst ?? fallback?.total_inc_gst ?? null)
            : null,
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
    setUnassignedPage(1)
  }, [unassignedSort, jobsUnassigned.length])

  useEffect(() => {
    setAssignedPage(1)
  }, [assignedSort, jobsAssigned.length])

  useEffect(() => {
    setCleanerPage(1)
  }, [cleanerSort, cleanerNameFilter, selectedLocation, activeCleaners.length])

  useEffect(() => {
    setBulkPage(1)
  }, [bulkSearch, activeCleaners.length])

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
  }, [jobs, activeCleaners, showCleaners, quotePins, cleaners, highlightedJobId, highlightedCleanerId])

  const decoratedCleaners = useMemo(
    () =>
      activeCleaners.map((cleaner) => {
        const currentJobs = jobsAssigned.filter((j) => j.cleaner_id === cleaner.id)
        const isAvailable = currentJobs.length === 0
        const hasValidCoords = typeof cleaner.base_lat === 'number' && typeof cleaner.base_lng === 'number'

        let nearestJobDistance: number | null = null
        let nearestJob: BookingOccurrence | null = null
        if (hasValidCoords) {
          for (const job of jobs) {
            const seriesId = job.series?.id
            const quotePin = seriesId ? quotePins[seriesId] : null
            const jobLat = quotePin?.lat ?? job.series?.service_lat
            const jobLng = quotePin?.lng ?? job.series?.service_lng

            if (typeof jobLat === 'number' && typeof jobLng === 'number') {
              const distance = calculateDistance(cleaner.base_lat!, cleaner.base_lng!, jobLat, jobLng)
              if (nearestJobDistance === null || distance < nearestJobDistance) {
                nearestJobDistance = distance
                nearestJob = job
              }
            }
          }
        }

        const stats = cleanerReviewStats[cleaner.id] || { avg: null, count: 0 }
        const distanceToSearch =
          selectedLocation && hasValidCoords
            ? calculateDistance(cleaner.base_lat!, cleaner.base_lng!, selectedLocation.lat, selectedLocation.lng)
            : null

        return {
          cleaner,
          currentJobs,
          isAvailable,
          hasValidCoords,
          nearestJobDistance,
          nearestJob,
          reviewAvg: stats.avg,
          reviewCount: stats.count,
          distanceToSearch,
        }
      }),
    [activeCleaners, jobsAssigned, jobs, quotePins, cleanerReviewStats, selectedLocation]
  )

  const filteredCleaners = useMemo(() => {
    const query = cleanerNameFilter.trim().toLowerCase()
    if (!query) return decoratedCleaners
    return decoratedCleaners.filter((item) => item.cleaner.full_name.toLowerCase().includes(query))
  }, [decoratedCleaners, cleanerNameFilter])

  const sortedCleaners = useMemo(() => {
    const list = [...filteredCleaners]
    if (cleanerSort === 'distance' && selectedLocation) {
      return list.sort((a, b) => {
        const aD = a.distanceToSearch
        const bD = b.distanceToSearch
        if (aD !== null && bD !== null) return aD - bD
        if (aD !== null) return -1
        if (bD !== null) return 1
        return a.cleaner.full_name.localeCompare(b.cleaner.full_name)
      })
    }
    if (cleanerSort === 'reviews') {
      return list.sort((a, b) => {
        const aAvg = a.reviewAvg ?? 0
        const bAvg = b.reviewAvg ?? 0
        if (bAvg !== aAvg) return bAvg - aAvg
        return (b.reviewCount ?? 0) - (a.reviewCount ?? 0)
      })
    }
    return list.sort((a, b) => {
      if (a.isAvailable && !b.isAvailable) return -1
      if (!a.isAvailable && b.isAvailable) return 1
      if (a.nearestJobDistance !== null && b.nearestJobDistance !== null) {
        return a.nearestJobDistance - b.nearestJobDistance
      }
      return 0
    })
  }, [filteredCleaners, cleanerSort, selectedLocation])

  const totalCleanerPages = Math.max(1, Math.ceil(sortedCleaners.length / CLEANER_PAGE_SIZE))
  const cleanerPageSafe = Math.min(cleanerPage, totalCleanerPages)
  const pagedCleaners = sortedCleaners.slice(
    (cleanerPageSafe - 1) * CLEANER_PAGE_SIZE,
    cleanerPageSafe * CLEANER_PAGE_SIZE
  )

  const sortedUnassigned = useMemo(
    () => [...jobsUnassigned].sort((a, b) => compareJobs(a, b, unassignedSort)),
    [jobsUnassigned, unassignedSort, quotePins]
  )
  const sortedAssigned = useMemo(
    () => [...jobsAssigned].sort((a, b) => compareJobs(a, b, assignedSort)),
    [jobsAssigned, assignedSort, quotePins]
  )

  const totalUnassignedPages = Math.max(1, Math.ceil(sortedUnassigned.length / JOB_PAGE_SIZE))
  const totalAssignedPages = Math.max(1, Math.ceil(sortedAssigned.length / JOB_PAGE_SIZE))
  const unassignedPageSafe = Math.min(unassignedPage, totalUnassignedPages)
  const assignedPageSafe = Math.min(assignedPage, totalAssignedPages)

  const pagedUnassigned = sortedUnassigned.slice(
    (unassignedPageSafe - 1) * JOB_PAGE_SIZE,
    unassignedPageSafe * JOB_PAGE_SIZE
  )
  const pagedAssigned = sortedAssigned.slice((assignedPageSafe - 1) * JOB_PAGE_SIZE, assignedPageSafe * JOB_PAGE_SIZE)

  const filteredBulkCleaners = useMemo(() => {
    const q = bulkSearch.trim().toLowerCase()
    if (!q) return activeCleaners
    return activeCleaners.filter(
      (c) => c.full_name.toLowerCase().includes(q) || (c.phone ?? '').toLowerCase().includes(q)
    )
  }, [activeCleaners, bulkSearch])

  const totalBulkPages = Math.max(1, Math.ceil(filteredBulkCleaners.length / BULK_PAGE_SIZE))
  const bulkPageSafe = Math.min(bulkPage, totalBulkPages)
  const pagedBulkCleaners = filteredBulkCleaners.slice(
    (bulkPageSafe - 1) * BULK_PAGE_SIZE,
    bulkPageSafe * BULK_PAGE_SIZE
  )

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

  const handleSelectLocation = (item: { place_name: string; center?: [number, number] }) => {
    if (!item?.center || typeof item.center[0] !== 'number' || typeof item.center[1] !== 'number') return
    setSelectedLocation({ label: item.place_name, lng: item.center[0], lat: item.center[1] })
    setLocationQuery(item.place_name)
    setLocationResults([])

    const map = mapRef.current
    if (map) {
      map.flyTo({ center: [item.center[0], item.center[1]], zoom: 12, essential: true })
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

        <div className="grid grid-cols-1 lg:grid-cols-7 gap-6">
          {/* Jobs + Bulk SMS */}
          <div className="lg:col-span-2 space-y-4">
            {/* Unassigned */}
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
              <div className="p-4 border-b border-white/10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-white font-semibold">
                    Unassigned jobs{' '}
                    <span className="text-xs text-[var(--color-text-muted)]">({sortedUnassigned.length})</span>
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)]">Click a job for full details</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/80">
                  <label className="text-[var(--color-text-muted)]">Sort</label>
                  <select
                    value={unassignedSort}
                    onChange={(e) => setUnassignedSort(e.target.value as any)}
                    className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="due_asc">Closest due</option>
                    <option value="due_desc">Furthest due</option>
                    <option value="cost_high">Cost high → low</option>
                    <option value="cost_low">Cost low → high</option>
                  </select>
                </div>
              </div>

              <div className="p-2 max-h-[30vh] overflow-y-auto">
                {sortedUnassigned.length === 0 ? (
                  <div className="p-3 text-sm text-[var(--color-text-muted)]">No unassigned jobs.</div>
                ) : (
                  pagedUnassigned.map((j) => {
                    const seriesId = j.series?.id
                    const quotePin = seriesId ? quotePins[seriesId] : null
                    const pinLat = quotePin?.lat ?? j.series?.service_lat
                    const pinLng = quotePin?.lng ?? j.series?.service_lng
                    const hasCoords = typeof pinLat === 'number' && typeof pinLng === 'number'
                    const cost = getJobCost(j)
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
                            {cost !== null && (
                              <div className="text-xs text-[var(--color-text-muted)]">Cost: {formatCurrency(cost)}</div>
                            )}
                            <div className="text-xs text-[var(--color-text-muted)] truncate">
                              {quotePin?.address || j.series?.service_address || 'No address set'}{' '}
                              {hasCoords ? '' : '• (no map pin yet)'}
                            </div>
                          </button>

                          <div className="w-[220px] space-y-2">
                            {hasCoords && (
                              <button
                                type="button"
                                onClick={() => highlightJobOnMap(j.id)}
                                className="w-full px-3 py-1.5 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white transition-colors flex items-center gap-1"
                                title="View on map"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                </svg>
                                View on Map
                              </button>
                            )}
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

              {sortedUnassigned.length > JOB_PAGE_SIZE && (
                <div className="p-3 border-t border-white/10 flex items-center justify-between text-xs text-white/80">
                  <div>
                    Page {unassignedPageSafe} / {totalUnassignedPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setUnassignedPage((p) => Math.max(1, p - 1))}
                      disabled={unassignedPageSafe <= 1}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnassignedPage((p) => Math.min(totalUnassignedPages, p + 1))}
                      disabled={unassignedPageSafe >= totalUnassignedPages}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Assigned */}
            <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
              <div className="p-4 border-b border-white/10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-white font-semibold">
                  Assigned jobs <span className="text-xs text-[var(--color-text-muted)]">({sortedAssigned.length})</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/80">
                  <label className="text-[var(--color-text-muted)]">Sort</label>
                  <select
                    value={assignedSort}
                    onChange={(e) => setAssignedSort(e.target.value as any)}
                    className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                  >
                    <option value="due_asc">Closest due</option>
                    <option value="due_desc">Furthest due</option>
                    <option value="cost_high">Cost high → low</option>
                    <option value="cost_low">Cost low → high</option>
                  </select>
                </div>
              </div>

              <div className="p-2 max-h-[30vh] overflow-y-auto">
                {sortedAssigned.length === 0 ? (
                  <div className="p-3 text-sm text-[var(--color-text-muted)]">No assigned jobs.</div>
                ) : (
                  pagedAssigned.map((j) => {
                    const seriesId = j.series?.id
                    const quotePin = seriesId ? quotePins[seriesId] : null
                    const pinLat = quotePin?.lat ?? j.series?.service_lat
                    const pinLng = quotePin?.lng ?? j.series?.service_lng
                    const hasCoords = typeof pinLat === 'number' && typeof pinLng === 'number'
                    const assignedCleaner = cleaners.find((c) => c.id === j.cleaner_id)
                    const cost = getJobCost(j)
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
                            {cost !== null && (
                              <div className="text-xs text-[var(--color-text-muted)]">Cost: {formatCurrency(cost)}</div>
                            )}
                            <div className="text-xs text-[var(--color-text-muted)] truncate">
                              {quotePin?.address || j.series?.service_address || 'No address set'}{' '}
                              {hasCoords ? '' : '• (no map pin yet)'}
                            </div>
                          </button>

                          <div className="w-[220px] space-y-2">
                            {hasCoords && (
                              <button
                                type="button"
                                onClick={() => highlightJobOnMap(j.id)}
                                className="w-full px-3 py-1.5 text-xs rounded-lg bg-cyan-600 hover:bg-cyan-700 text-white transition-colors flex items-center gap-1"
                                title="View on map"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                </svg>
                                View on Map
                              </button>
                            )}
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

              {sortedAssigned.length > JOB_PAGE_SIZE && (
                <div className="p-3 border-t border-white/10 flex items-center justify-between text-xs text-white/80">
                  <div>
                    Page {assignedPageSafe} / {totalAssignedPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAssignedPage((p) => Math.max(1, p - 1))}
                      disabled={assignedPageSafe <= 1}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setAssignedPage((p) => Math.min(totalAssignedPages, p + 1))}
                      disabled={assignedPageSafe >= totalAssignedPages}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
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
                <div className="flex items-center gap-2 text-sm">
                  <input
                    value={bulkSearch}
                    onChange={(e) => setBulkSearch(e.target.value)}
                    placeholder="Search cleaners by name or phone"
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white"
                  />
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {filteredBulkCleaners.length} match{filteredBulkCleaners.length === 1 ? '' : 'es'}
                  </span>
                </div>

                <div className="max-h-40 overflow-y-auto border border-white/10 rounded-xl bg-black/20">
                  {filteredBulkCleaners.length === 0 ? (
                    <div className="p-3 text-sm text-[var(--color-text-muted)]">No cleaners.</div>
                  ) : (
                    pagedBulkCleaners.map((c) => (
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
                {filteredBulkCleaners.length > BULK_PAGE_SIZE && (
                  <div className="flex items-center justify-between text-xs text-white/80">
                    <div>
                      Page {bulkPageSafe} / {totalBulkPages}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setBulkPage((p) => Math.max(1, p - 1))}
                        disabled={bulkPageSafe <= 1}
                        className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() => setBulkPage((p) => Math.min(totalBulkPages, p + 1))}
                        disabled={bulkPageSafe >= totalBulkPages}
                        className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
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

          {/* Cleaner Side Panel */}
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
            <div className="p-4 border-b border-white/10">
              <div className="text-white font-semibold">Cleaners</div>
              <div className="text-xs text-[var(--color-text-muted)] mt-1">
                Available cleaners and their status
              </div>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid gap-3">
                <div className="space-y-2">
                  <div className="text-xs text-[var(--color-text-muted)]">Search by area (Mapbox powered)</div>
                  <div className="relative">
                    <input
                      value={locationQuery}
                      onChange={(e) => setLocationQuery(e.target.value)}
                      placeholder="Type a suburb or postcode to rank cleaners by distance"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                    />
                    {isLocationSearching && (
                      <div className="absolute right-3 top-2 text-xs text-[var(--color-text-muted)]">Searching…</div>
                    )}
                    {locationResults.length > 0 && (
                      <div className="absolute mt-1 w-full rounded-lg bg-[#0c0f16] border border-white/10 z-[10030] max-h-48 overflow-y-auto shadow-2xl">
                        {locationResults.map((item) => (
                          <button
                            key={item.place_name}
                            type="button"
                            onClick={() => handleSelectLocation(item)}
                            className="w-full text-left px-3 py-2 text-sm text-white hover:bg-white/10"
                          >
                            {item.place_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedLocation && (
                    <div className="flex items-center justify-between text-xs text-white/80 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                      <span>
                        Using location: <span className="font-semibold text-white">{selectedLocation.label}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedLocation(null)
                          setLocationQuery('')
                        }}
                        className="text-[var(--color-text-muted)] hover:text-white"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 w-full sm:max-w-xs">
                    <input
                      value={cleanerNameFilter}
                      onChange={(e) => setCleanerNameFilter(e.target.value)}
                      placeholder="Filter cleaners by name"
                      className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/80">
                    <label className="text-[var(--color-text-muted)]">Sort</label>
                    <select
                      value={cleanerSort}
                      onChange={(e) => setCleanerSort(e.target.value as any)}
                      className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
                    >
                      <option value="distance">Distance (if location set)</option>
                      <option value="reviews">Reviews high → low</option>
                      <option value="availability">Availability</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="max-h-[58vh] overflow-y-auto pr-1">
                {sortedCleaners.length === 0 ? (
                  <div className="text-sm text-[var(--color-text-muted)]">No active cleaners.</div>
                ) : (
                  <div className="space-y-3">
                    {pagedCleaners.map((item) => {
                      const { cleaner, currentJobs, isAvailable, hasValidCoords, nearestJobDistance, nearestJob, reviewAvg, reviewCount, distanceToSearch } = item
                      return (
                        <div key={cleaner.id} className="p-3 rounded-xl border border-white/10 bg-white/5">
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0 space-y-1">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-white font-medium truncate">{cleaner.full_name}</div>
                                <div className="text-xs text-[var(--color-text-muted)]">
                                  {currentJobs.length} job{currentJobs.length !== 1 ? 's' : ''}
                                </div>
                              </div>
                              <div className="text-xs text-[var(--color-text-muted)]">
                                {isAvailable ? (
                                  <span className="text-emerald-400">● Available</span>
                                ) : (
                                  <span className="text-amber-400">● Busy</span>
                                )}
                                {selectedLocation ? (
                                  <span className="ml-2 text-blue-400">
                                    • {distanceToSearch !== null ? `${formatDistance(distanceToSearch)} away` : 'No base location'}
                                  </span>
                                ) : (
                                  nearestJobDistance !== null && (
                                    <span className="ml-2 text-blue-400">
                                      • {formatDistance(nearestJobDistance)} to nearest job
                                    </span>
                                  )
                                )}
                              </div>
                              {cleaner.base_location_text && (
                                <div className="text-xs text-[var(--color-text-muted)] truncate">
                                  📍 {cleaner.base_location_text}
                                </div>
                              )}
                              {reviewCount > 0 ? (
                                <div className="text-xs text-white/80">
                                  {reviewAvg !== null ? reviewAvg.toFixed(1) : '—'}/5 based on {reviewCount}{' '}
                                  review{reviewCount === 1 ? '' : 's'}
                                </div>
                              ) : (
                                <div className="text-xs text-[var(--color-text-muted)]">No reviews yet.</div>
                              )}
                              {!isAvailable && currentJobs.length > 0 && (
                                <div className="text-xs text-[var(--color-text-muted)] truncate">
                                  Current: {currentJobs.map(j => j.series?.title || 'Job').join(', ')}
                                </div>
                              )}
                              {nearestJob && (
                                <div className="text-xs text-[var(--color-text-muted)] truncate">
                                  Nearest job: {nearestJob.series?.title || 'Job'} ({new Date(nearestJob.start_at).toLocaleString()})
                                </div>
                              )}
                            </div>
                            {hasValidCoords && (
                              <button
                                type="button"
                                onClick={() => highlightCleanerOnMap(cleaner.id)}
                                className="px-2 py-1.5 text-xs rounded-lg bg-purple-600 hover:bg-purple-700 text-white transition-colors flex items-center gap-1 flex-shrink-0"
                                title="View on map"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                                </svg>
                                Map
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {sortedCleaners.length > CLEANER_PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs text-white/80">
                  <div>
                    Page {cleanerPageSafe} / {totalCleanerPages}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCleanerPage((p) => Math.max(1, p - 1))}
                      disabled={cleanerPageSafe <= 1}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCleanerPage((p) => Math.min(totalCleanerPages, p + 1))}
                      disabled={cleanerPageSafe >= totalCleanerPages}
                      className="px-2 py-1 rounded-lg bg-white/10 border border-white/10 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
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



