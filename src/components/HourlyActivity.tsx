import { useMemo, useState } from 'react'
import { addDays, subDays, startOfDay, endOfDay } from 'date-fns'

interface Props {
  calls: Array<{ created_at: string; direction: string; duration: number }>
  selectedDate: Date | null
  isLoading: boolean
  onDateChange: (date: Date | null) => void
}

export default function HourlyActivity({ calls, selectedDate, isLoading, onDateChange }: Props) {
  const [viewMode, setViewMode] = useState<'day' | '7-day-avg'>('day')

  const hourlyData = useMemo(() => {
    const startHour = 7
    const endHour = 19
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => ({ hour: startHour + i, count: 0 }))
    
    const targetDate = selectedDate || new Date()
    const rangeStart = viewMode === '7-day-avg'
      ? startOfDay(subDays(targetDate, 6))
      : startOfDay(targetDate)
    const rangeEnd = viewMode === '7-day-avg'
      ? endOfDay(targetDate)
      : endOfDay(targetDate)

    const rangeCalls = calls.filter(c => {
      const callDate = new Date(c.created_at)
      return callDate >= rangeStart && callDate <= rangeEnd
    })

    rangeCalls.forEach(call => {
      const callDate = new Date(call.created_at)
      const hour = callDate.getHours() // local hour to match the local window
      if (hour < startHour || hour > endHour) return
      hours[hour - startHour].count++
    })

    if (viewMode === '7-day-avg') {
      const daysInWindow = 7
      hours.forEach((item) => {
        item.count = Number((item.count / daysInWindow).toFixed(1))
      })
    }

    const maxCount = Math.max(...hours.map(h => h.count), 1)
    
    return hours.map(h => ({
      ...h,
      intensity: h.count / maxCount, // 0 to 1
    }))
  }, [calls, selectedDate, viewMode])

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-5">
        <h3 className="text-lg font-semibold text-white mb-3">Hourly Activity</h3>
        <div className="shimmer h-48 rounded-lg" />
      </div>
    )
  }

  const maxCount = Math.max(...hourlyData.map(h => h.count))

  return (
    <div className="glass-card rounded-2xl p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Hourly Activity
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
            <button
              onClick={() => setViewMode('day')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                viewMode === 'day' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode('7-day-avg')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                viewMode === '7-day-avg' ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              7-day avg
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onDateChange(addDays(selectedDate || new Date(), -1))}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-300"
              aria-label="Previous day"
              title="Previous day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => onDateChange(addDays(selectedDate || new Date(), 1))}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-300"
              aria-label="Next day"
              title="Next day"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
          <span className="text-[10px] text-gray-400 uppercase tracking-wider">7AM - 7PM</span>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">7 AM - 12 PM</div>
          {hourlyData
            .filter(({ hour }) => hour < 12)
            .map(({ hour, count, intensity }) => {
              const hourLabel = `${hour.toString().padStart(2, '0')}:00`
              const widthPercent = intensity * 100
              const height = Math.max(4, intensity * 20)
              const displayCount = viewMode === 'day' ? count : Number(count.toFixed(1))

              let bgColor = 'bg-slate-700'
              if (intensity > 0.7) bgColor = 'bg-emerald-500'
              else if (intensity > 0.4) bgColor = 'bg-cyan-500'
              else if (intensity > 0.1) bgColor = 'bg-blue-500'

              return (
                <div key={hour} className="flex items-center gap-2">
                  <div className="w-14 text-[11px] text-gray-400 font-mono">{hourLabel}</div>
                  <div className="flex-1 relative">
                    <div
                      className={`${bgColor} rounded-full transition-all duration-300`}
                      style={{
                        width: `${widthPercent}%`,
                        height: `${height}px`,
                        minWidth: count > 0 ? '6px' : '0px',
                      }}
                    />
                    {count > 0 && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-white font-medium">
                        {displayCount}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">12 PM - 7 PM</div>
          {hourlyData
            .filter(({ hour }) => hour >= 12)
            .map(({ hour, count, intensity }) => {
              const hourLabel = `${hour.toString().padStart(2, '0')}:00`
              const widthPercent = intensity * 100
              const height = Math.max(4, intensity * 20)
              const displayCount = viewMode === 'day' ? count : Number(count.toFixed(1))

              let bgColor = 'bg-slate-700'
              if (intensity > 0.7) bgColor = 'bg-emerald-500'
              else if (intensity > 0.4) bgColor = 'bg-cyan-500'
              else if (intensity > 0.1) bgColor = 'bg-blue-500'

              return (
                <div key={hour} className="flex items-center gap-2">
                  <div className="w-14 text-[11px] text-gray-400 font-mono">{hourLabel}</div>
                  <div className="flex-1 relative">
                    <div
                      className={`${bgColor} rounded-full transition-all duration-300`}
                      style={{
                        width: `${widthPercent}%`,
                        height: `${height}px`,
                        minWidth: count > 0 ? '6px' : '0px',
                      }}
                    />
                    {count > 0 && (
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-white font-medium">
                        {displayCount}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
        </div>
      </div>
      
      {maxCount === 0 && (
        <div className="text-center py-6 text-gray-400 text-sm">
          <p>
            {viewMode === 'day'
              ? 'No calls recorded between 7AM and 7PM for this day.'
              : 'No calls recorded between 7AM and 7PM in the last 7 days.'}
          </p>
        </div>
      )}
    </div>
  )
}

