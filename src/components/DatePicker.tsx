import { useState } from 'react'
import { format, startOfWeek, addDays, isSameDay, isToday } from 'date-fns'

interface Props {
  selectedDate: Date | null
  onDateChange: (date: Date | null) => void
}

export default function DatePicker({ selectedDate, onDateChange }: Props) {
  const [showCalendar, setShowCalendar] = useState(false)
  const today = new Date()
  const weekStart = startOfWeek(today, { weekStartsOn: 0 })
  
  const quickDates = [
    { label: 'Today', date: today },
    { label: 'Yesterday', date: addDays(today, -1) },
    { label: 'Tomorrow', date: addDays(today, 1) },
  ]

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  const handleDateClick = (date: Date) => {
    if (isSameDay(date, selectedDate || today)) {
      onDateChange(null) // Deselect if clicking same date
    } else {
      onDateChange(date)
    }
    setShowCalendar(false)
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {/* Quick date buttons */}
        {quickDates.map(({ label, date }) => (
          <button
            key={label}
            onClick={() => handleDateClick(date)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              selectedDate && isSameDay(date, selectedDate)
                ? 'bg-cyan-500 text-white'
                : 'bg-[var(--color-surface-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-lighter)]'
            }`}
          >
            {label}
          </button>
        ))}
        
        {/* Calendar toggle */}
        <button
          onClick={() => setShowCalendar(!showCalendar)}
          className="px-4 py-2 rounded-xl bg-[var(--color-surface-light)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-lighter)] text-sm font-medium flex items-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {selectedDate ? format(selectedDate, 'MMM d, yyyy') : 'Select Date'}
        </button>
      </div>

      {/* Calendar dropdown */}
      {showCalendar && (
        <>
          <div 
            className="fixed inset-0 z-10" 
            onClick={() => setShowCalendar(false)}
          />
          <div className="absolute top-full left-0 mt-2 glass-card rounded-xl p-4 z-20 min-w-[280px]">
            <div className="grid grid-cols-7 gap-1 mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                <div key={day} className="text-center text-xs text-gray-400 font-medium py-1">
                  {day}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {weekDays.map((day, idx) => {
                const isSelected = selectedDate && isSameDay(day, selectedDate)
                const isTodayDate = isToday(day)
                const isPast = day < today && !isTodayDate
                
                return (
                  <button
                    key={idx}
                    onClick={() => handleDateClick(day)}
                    className={`
                      aspect-square rounded-lg text-sm font-medium transition-all
                      ${isSelected 
                        ? 'bg-cyan-500 text-white' 
                        : isTodayDate
                        ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                        : isPast
                        ? 'text-gray-500 hover:bg-[var(--color-surface-light)]'
                        : 'text-white hover:bg-[var(--color-surface-light)]'
                      }
                    `}
                  >
                    {format(day, 'd')}
                  </button>
                )
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-white/10">
              <button
                onClick={() => {
                  onDateChange(null)
                  setShowCalendar(false)
                }}
                className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Clear Selection
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

