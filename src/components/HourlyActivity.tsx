import { useMemo } from 'react'

interface Props {
  calls: Array<{ created_at: string; direction: string; duration: number }>
  selectedDate: Date | null
  isLoading: boolean
}

export default function HourlyActivity({ calls, selectedDate, isLoading }: Props) {
  const hourlyData = useMemo(() => {
    const startHour = 7
    const endHour = 19
    const hours = Array.from({ length: endHour - startHour + 1 }, (_, i) => ({ hour: startHour + i, count: 0 }))
    
    const targetDate = selectedDate || new Date()
    // Use local day boundaries so the chart matches the user's day view
    const dayStart = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      0, 0, 0, 0
    )
    const dayEnd = new Date(
      targetDate.getFullYear(),
      targetDate.getMonth(),
      targetDate.getDate(),
      23, 59, 59, 999
    )
    
    const dayCalls = calls.filter(c => {
      const callDate = new Date(c.created_at)
      return callDate >= dayStart && callDate <= dayEnd
    })
    
    dayCalls.forEach(call => {
      const callDate = new Date(call.created_at)
      const hour = callDate.getHours() // local hour to match the local window
      if (hour < startHour || hour > endHour) return
      hours[hour - startHour].count++
    })
    
    const maxCount = Math.max(...hours.map(h => h.count), 1)
    
    return hours.map(h => ({
      ...h,
      intensity: h.count / maxCount, // 0 to 1
    }))
  }, [calls, selectedDate])

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
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Hourly Activity
        </h3>
        <span className="text-[10px] text-gray-400 uppercase tracking-wider">7AM - 7PM</span>
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {hourlyData.map(({ hour, count, intensity }) => {
          const hourLabel = `${hour.toString().padStart(2, '0')}:00`
          const widthPercent = intensity * 100
          const height = Math.max(4, intensity * 20) // more compact height
          
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
                    {count}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      
      {maxCount === 0 && (
        <div className="text-center py-6 text-gray-400 text-sm">
          <p>No calls recorded between 7AM and 7PM for this day.</p>
        </div>
      )}
    </div>
  )
}

