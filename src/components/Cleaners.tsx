import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type AvailabilityBucket = 'Morning' | 'Afternoon' | 'Evening' | 'Night'
type DayName = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday'

type Cleaner = {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  base_location_text: string | null
  base_lat: number | null
  base_lng: number | null
  abn: string | null
  bank_account_name: string | null
  bank_bsb: string | null
  bank_account_number: string | null
  rates: Record<string, number> | null
  min_booking_minutes: number | null
  notice_hours: number | null
  cancellation_policy: string | null
  has_transport: boolean | null
  transport_type: string | null
  max_travel_km: number | null
  can_transport_equipment: boolean | null
  public_liability_policy_number: string | null
  public_liability_expiry: string | null
  team_size: number | null
  availability: any
  active: boolean | null
}

const DAYS: DayName[] = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const BUCKETS: AvailabilityBucket[] = ['Morning', 'Afternoon', 'Evening', 'Night']

const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  import.meta.env.VITE_MAPBOX_API_KEY ||
  import.meta.env.VITE_MAPBOX ||
  ''

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

function defaultAvailability() {
  const base: Record<string, Record<string, boolean>> = {}
  for (const d of DAYS) {
    base[d] = { Morning: false, Afternoon: false, Evening: false, Night: false }
  }
  return base
}

export default function Cleaners() {
  const [cleaners, setCleaners] = useState<Cleaner[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const selected = useMemo(() => cleaners.find((c) => c.id === selectedId) || null, [cleaners, selectedId])

  const [form, setForm] = useState(() => ({
    full_name: '',
    phone: '',
    email: '',
    base_location_text: '',
    base_lat: null as number | null,
    base_lng: null as number | null,
    abn: '',
    bank_account_name: '',
    bank_bsb: '',
    bank_account_number: '',
    min_booking_minutes: 120,
    notice_hours: 24,
    cancellation_policy: '',
    has_transport: false,
    transport_type: 'car',
    max_travel_km: 15,
    can_transport_equipment: false,
    public_liability_policy_number: '',
    public_liability_expiry: '',
    team_size: 1,
    ratesText: '{"standard":45}',
    availability: defaultAvailability() as Record<DayName, Record<AvailabilityBucket, boolean>>,
    active: true,
  }))

  const [locationResults, setLocationResults] = useState<{ place_name: string; center?: [number, number] }[]>([])

  const fetchCleaners = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const { data, error: err } = await supabase
        .from('cleaners')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500)
      if (err) throw err
      setCleaners((data || []) as any)
    } catch (e: any) {
      setError(e?.message || 'Failed to load cleaners')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCleaners()
  }, [fetchCleaners])

  const startNew = () => {
    setSelectedId(null)
    setForm({
      full_name: '',
      phone: '',
      email: '',
      base_location_text: '',
      base_lat: null,
      base_lng: null,
      abn: '',
      bank_account_name: '',
      bank_bsb: '',
      bank_account_number: '',
      min_booking_minutes: 120,
      notice_hours: 24,
      cancellation_policy: '',
      has_transport: false,
      transport_type: 'car',
      max_travel_km: 15,
      can_transport_equipment: false,
      public_liability_policy_number: '',
      public_liability_expiry: '',
      team_size: 1,
      ratesText: '{"standard":45}',
      availability: defaultAvailability(),
      active: true,
    })
    setLocationResults([])
  }

  const loadIntoForm = (c: Cleaner) => {
    setSelectedId(c.id)
    setForm({
      full_name: c.full_name || '',
      phone: c.phone || '',
      email: c.email || '',
      base_location_text: c.base_location_text || '',
      base_lat: c.base_lat ?? null,
      base_lng: c.base_lng ?? null,
      abn: c.abn || '',
      bank_account_name: c.bank_account_name || '',
      bank_bsb: c.bank_bsb || '',
      bank_account_number: c.bank_account_number || '',
      min_booking_minutes: c.min_booking_minutes ?? 120,
      notice_hours: c.notice_hours ?? 24,
      cancellation_policy: c.cancellation_policy || '',
      has_transport: Boolean(c.has_transport),
      transport_type: c.transport_type || 'car',
      max_travel_km: c.max_travel_km ?? 15,
      can_transport_equipment: Boolean(c.can_transport_equipment),
      public_liability_policy_number: c.public_liability_policy_number || '',
      public_liability_expiry: c.public_liability_expiry || '',
      team_size: c.team_size ?? 1,
      ratesText: JSON.stringify(c.rates || {}, null, 0) || '{"standard":45}',
      availability: (c.availability as any) || defaultAvailability(),
      active: c.active !== false,
    })
    setLocationResults([])
  }

  const handleLocationSearch = useCallback(async (q: string) => {
    if (!q || q.trim().length < 3) {
      setLocationResults([])
      return
    }
    try {
      const results = await mapboxSuggest(q.trim())
      setLocationResults(results)
    } catch {
      setLocationResults([])
    }
  }, [])

  const toggleAvailability = (day: DayName, bucket: AvailabilityBucket) => {
    setForm((prev) => ({
      ...prev,
      availability: {
        ...prev.availability,
        [day]: { ...prev.availability[day], [bucket]: !prev.availability[day][bucket] },
      },
    }))
  }

  const saveCleaner = async () => {
    setError(null)
    let rates: any = {}
    try {
      rates = form.ratesText ? JSON.parse(form.ratesText) : {}
    } catch {
      setError('Rates must be valid JSON (e.g. {"standard":45,"end_of_lease":55})')
      return
    }

    const payload = {
      full_name: form.full_name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      base_location_text: form.base_location_text.trim() || null,
      base_lat: form.base_lat,
      base_lng: form.base_lng,
      abn: form.abn.trim() || null,
      bank_account_name: form.bank_account_name.trim() || null,
      bank_bsb: form.bank_bsb.trim() || null,
      bank_account_number: form.bank_account_number.trim() || null,
      min_booking_minutes: Number(form.min_booking_minutes) || 120,
      notice_hours: Number(form.notice_hours) || 24,
      cancellation_policy: form.cancellation_policy.trim() || null,
      has_transport: Boolean(form.has_transport),
      transport_type: form.transport_type.trim() || null,
      max_travel_km: Number(form.max_travel_km) || 15,
      can_transport_equipment: Boolean(form.can_transport_equipment),
      public_liability_policy_number: form.public_liability_policy_number.trim() || null,
      public_liability_expiry: form.public_liability_expiry || null,
      team_size: Number(form.team_size) || 1,
      rates,
      availability: form.availability,
      active: Boolean(form.active),
    }

    if (!payload.full_name) {
      setError('Full name is required')
      return
    }

    try {
      if (selectedId) {
        const { error: err } = await supabase.from('cleaners').update(payload).eq('id', selectedId)
        if (err) throw err
      } else {
        const { data, error: err } = await supabase.from('cleaners').insert(payload).select('id').single()
        if (err) throw err
        if (data?.id) setSelectedId(data.id)
      }
      await fetchCleaners()
    } catch (e: any) {
      setError(e?.message || 'Failed to save cleaner')
    }
  }

  const deleteCleaner = async () => {
    if (!selectedId) return
    if (!confirm('Delete this cleaner?')) return
    setError(null)
    try {
      const { error: err } = await supabase.from('cleaners').delete().eq('id', selectedId)
      if (err) throw err
      startNew()
      await fetchCleaners()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete cleaner')
    }
  }

  return (
    <div className="min-h-screen p-6 md:p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Cleaners</h1>
              <p className="text-[var(--color-text-muted)]">Onboard, update availability, and store rates.</p>
            </div>
          </div>
        </header>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-sm">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* List */}
          <div className="rounded-2xl border border-white/10 bg-[var(--color-surface)] overflow-hidden">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div className="text-white font-semibold">All cleaners</div>
              <button
                onClick={startNew}
                className="px-3 py-1.5 text-sm rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                + New
              </button>
            </div>

            <div className="p-2 max-h-[70vh] overflow-y-auto">
              {isLoading ? (
                <div className="p-3 text-sm text-[var(--color-text-muted)]">Loading…</div>
              ) : cleaners.length === 0 ? (
                <div className="p-3 text-sm text-[var(--color-text-muted)]">No cleaners yet.</div>
              ) : (
                cleaners.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => loadIntoForm(c)}
                    className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
                      selectedId === c.id
                        ? 'bg-white/10 border-white/20'
                        : 'bg-transparent border-transparent hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-white font-medium">{c.full_name}</div>
                        <div className="text-xs text-[var(--color-text-muted)]">
                          {(c.base_location_text || 'No base location') + (c.active === false ? ' • inactive' : '')}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Form */}
          <div className="lg:col-span-2 rounded-2xl border border-white/10 bg-[var(--color-surface)] p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="text-white font-semibold">{selected ? 'Edit cleaner' : 'New cleaner'}</div>
              <div className="flex items-center gap-2">
                {selectedId && (
                  <button
                    onClick={deleteCleaner}
                    className="px-3 py-2 text-sm rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-200 border border-red-500/20"
                  >
                    Delete
                  </button>
                )}
                <button
                  onClick={saveCleaner}
                  className="px-4 py-2 text-sm rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white"
                >
                  Save
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Full name</label>
                <input
                  value={form.full_name}
                  onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-white/90">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))}
                  />
                  Active
                </label>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Phone</label>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Email</label>
                <input
                  value={form.email}
                  onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Base location (suburb/area)
                </label>
                <input
                  value={form.base_location_text}
                  onChange={(e) => {
                    // If the user edits the text manually, clear coords so we don't keep stale lat/lng.
                    setForm((p) => ({ ...p, base_location_text: e.target.value, base_lat: null, base_lng: null }))
                    handleLocationSearch(e.target.value)
                  }}
                  placeholder="Search suburb/area (Mapbox)"
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                  onBlur={() => setTimeout(() => setLocationResults([]), 150)}
                />
                <div className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                  {typeof form.base_lat === 'number' && typeof form.base_lng === 'number'
                    ? `Pinned: ${form.base_lat.toFixed(5)}, ${form.base_lng.toFixed(5)}`
                    : 'Not pinned yet — pick a suggestion to save coordinates.'}
                </div>
                {locationResults.length > 0 && (
                  <div className="mt-2 border border-white/10 rounded-xl bg-black/40 max-h-44 overflow-y-auto text-sm">
                    {locationResults.map((r) => (
                      <button
                        key={r.place_name}
                        type="button"
                        onClick={() => {
                          setForm((p) => ({
                            ...p,
                            base_location_text: r.place_name,
                            base_lng: r.center?.[0] ?? null,
                            base_lat: r.center?.[1] ?? null,
                          }))
                          setLocationResults([])
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-white/10 text-white"
                      >
                        {r.place_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">ABN</label>
                <input
                  value={form.abn}
                  onChange={(e) => setForm((p) => ({ ...p, abn: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Team size</label>
                <input
                  type="number"
                  min={1}
                  value={form.team_size}
                  onChange={(e) => setForm((p) => ({ ...p, team_size: Number(e.target.value) }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Bank details</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    value={form.bank_account_name}
                    onChange={(e) => setForm((p) => ({ ...p, bank_account_name: e.target.value }))}
                    placeholder="Account name"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                  />
                  <input
                    value={form.bank_bsb}
                    onChange={(e) => setForm((p) => ({ ...p, bank_bsb: e.target.value }))}
                    placeholder="BSB"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                  />
                  <input
                    value={form.bank_account_number}
                    onChange={(e) => setForm((p) => ({ ...p, bank_account_number: e.target.value }))}
                    placeholder="Account number"
                    className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Min booking (minutes)</label>
                <input
                  type="number"
                  min={30}
                  step={30}
                  value={form.min_booking_minutes}
                  onChange={(e) => setForm((p) => ({ ...p, min_booking_minutes: Number(e.target.value) }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Notice required (hours)</label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={form.notice_hours}
                  onChange={(e) => setForm((p) => ({ ...p, notice_hours: Number(e.target.value) }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Rates (JSON)
                </label>
                <textarea
                  value={form.ratesText}
                  onChange={(e) => setForm((p) => ({ ...p, ratesText: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white font-mono"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Availability</label>
                <div className="border border-white/10 rounded-2xl overflow-hidden">
                  <div className="grid grid-cols-5 gap-0 bg-white/5 border-b border-white/10">
                    <div className="p-2 text-xs text-[var(--color-text-muted)]">Day</div>
                    {BUCKETS.map((b) => (
                      <div key={b} className="p-2 text-xs text-[var(--color-text-muted)] text-center">
                        {b}
                      </div>
                    ))}
                  </div>
                  {DAYS.map((d) => (
                    <div key={d} className="grid grid-cols-5 gap-0 border-b border-white/10 last:border-b-0">
                      <div className="p-2 text-sm text-white/90">{d}</div>
                      {BUCKETS.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => toggleAvailability(d, b)}
                          className={`p-2 text-xs text-center transition-colors ${
                            form.availability?.[d]?.[b] ? 'bg-cyan-500/25 text-cyan-200' : 'bg-transparent text-white/60 hover:bg-white/5'
                          }`}
                        >
                          {form.availability?.[d]?.[b] ? 'Yes' : '—'}
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Transport & travel
                </label>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <label className="flex items-center gap-2 text-sm text-white/90">
                    <input
                      type="checkbox"
                      checked={form.has_transport}
                      onChange={(e) => setForm((p) => ({ ...p, has_transport: e.target.checked }))}
                    />
                    Has transport
                  </label>
                  <select
                    value={form.transport_type}
                    onChange={(e) => setForm((p) => ({ ...p, transport_type: e.target.value }))}
                    className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                  >
                    <option value="car">car</option>
                    <option value="public_transport">public transport</option>
                    <option value="bike">bike</option>
                    <option value="other">other</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={form.max_travel_km}
                    onChange={(e) => setForm((p) => ({ ...p, max_travel_km: Number(e.target.value) }))}
                    className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                    placeholder="Max km"
                  />
                  <label className="flex items-center gap-2 text-sm text-white/90">
                    <input
                      type="checkbox"
                      checked={form.can_transport_equipment}
                      onChange={(e) => setForm((p) => ({ ...p, can_transport_equipment: e.target.checked }))}
                    />
                    Can carry equipment
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Public liability policy #</label>
                <input
                  value={form.public_liability_policy_number}
                  onChange={(e) => setForm((p) => ({ ...p, public_liability_policy_number: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">Policy expiry</label>
                <input
                  type="date"
                  value={form.public_liability_expiry}
                  onChange={(e) => setForm((p) => ({ ...p, public_liability_expiry: e.target.value }))}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-2">
                  Cancellation policy
                </label>
                <textarea
                  value={form.cancellation_policy}
                  onChange={(e) => setForm((p) => ({ ...p, cancellation_policy: e.target.value }))}
                  rows={2}
                  className="w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white"
                />
              </div>
            </div>

            <div className="mt-4 text-xs text-[var(--color-text-muted)]">
              Note: this “simple mode” stores bank details in the DB like the rest of the app. If you ever expose this beyond internal
              use, we should lock this down with auth/RLS or move payouts behind an Edge Function.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


