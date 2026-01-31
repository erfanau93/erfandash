import { useMemo, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format, subDays, addDays, startOfDay, endOfDay, isToday, isYesterday, isTomorrow } from 'date-fns'

interface DayData {
  date: string
  calls: number
  outbound: number
  inbound: number
  sms: number
  emails: number
}

interface Props {
  calls: Array<{ created_at: string; direction: string; duration: number }>
  sms: Array<{ created_at: string; direction: string }>
  emails: Array<{ created_at: string; direction: string }>
  selectedDate: Date | null
  isLoading: boolean
  onDateChange: (date: Date | null) => void
}

export default function DayComparisonChart({ calls, sms, emails, selectedDate, isLoading, onDateChange }: Props) {
  const [comparisonMode, setComparisonMode] = useState<'7-day' | '30-day-avg'>('7-day')

  const chartData = useMemo(() => {
    const anchor = selectedDate || new Date()

    const sumRange = (start: Date, end: Date) => {
      const dayCalls = calls.filter(c => {
        const callDate = new Date(c.created_at)
        return callDate >= start && callDate <= end
      })
      const daySms = sms.filter(s => {
        const smsDate = new Date(s.created_at)
        return smsDate >= start && smsDate <= end
      })
      const dayEmails = emails.filter(e => {
        const emailDate = new Date(e.created_at)
        return emailDate >= start && emailDate <= end
      })

      return {
        calls: dayCalls.length,
        outbound: dayCalls.filter(c => c.direction === 'outbound').length,
        inbound: dayCalls.filter(c => c.direction === 'inbound').length,
        sms: daySms.length,
        emails: dayEmails.length,
      }
    }

    if (comparisonMode === '30-day-avg') {
      const periodLength = 30
      const currentStart = startOfDay(subDays(anchor, periodLength - 1))
      const currentEnd = endOfDay(anchor)
      const prevEnd = endOfDay(subDays(currentStart, 1))
      const prevStart = startOfDay(subDays(currentStart, periodLength))

      const currentTotals = sumRange(currentStart, currentEnd)
      const prevTotals = sumRange(prevStart, prevEnd)

      const avg = (value: number) => Number((value / periodLength).toFixed(1))

      return [
        {
          date: 'Last 30d avg',
          calls: avg(currentTotals.calls),
          outbound: avg(currentTotals.outbound),
          inbound: avg(currentTotals.inbound),
          sms: avg(currentTotals.sms),
          emails: avg(currentTotals.emails),
        },
        {
          date: 'Prev 30d avg',
          calls: avg(prevTotals.calls),
          outbound: avg(prevTotals.outbound),
          inbound: avg(prevTotals.inbound),
          sms: avg(prevTotals.sms),
          emails: avg(prevTotals.emails),
        },
      ]
    }

    const days: DayData[] = []
    // 7-day window centered on the anchor day
    for (let i = -3; i <= 3; i++) {
      const date = addDays(anchor, i)
      const dayStart = startOfDay(date)
      const dayEnd = endOfDay(date)

      const totals = sumRange(dayStart, dayEnd)

      let label = format(date, 'EEE M/d')
      if (!selectedDate) {
        if (isToday(date)) label = 'Today'
        else if (isYesterday(date)) label = 'Yesterday'
        else if (isTomorrow(date)) label = 'Tomorrow'
      } else if (i === 0) {
        label = 'Selected'
      }

      days.push({
        date: label,
        calls: totals.calls,
        outbound: totals.outbound,
        inbound: totals.inbound,
        sms: totals.sms,
        emails: totals.emails,
      })
    }

    return days
  }, [calls, sms, emails, selectedDate, comparisonMode])

  if (isLoading) {
    return (
      <div className="glass-card rounded-2xl p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Day-to-Day Comparison</h3>
        <div className="shimmer h-64 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="glass-card rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h3 className="text-xl font-semibold text-white flex items-center gap-2">
          <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Day-to-Day Comparison
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl bg-white/5 p-1">
            <button
              onClick={() => setComparisonMode('7-day')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                comparisonMode === '7-day' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              7-day
            </button>
            <button
              onClick={() => setComparisonMode('30-day-avg')}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors ${
                comparisonMode === '30-day-avg' ? 'bg-cyan-600 text-white' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              30-day avg
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
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.1)" />
          <XAxis 
            dataKey="date" 
            stroke="#94a3b8"
            style={{ fontSize: '12px' }}
          />
          <YAxis 
            stroke="#94a3b8"
            style={{ fontSize: '12px' }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(30, 41, 59, 0.95)',
              border: '1px solid rgba(148, 163, 184, 0.2)',
              borderRadius: '8px',
              color: '#f8fafc',
            }}
          />
          <Legend 
            wrapperStyle={{ color: '#94a3b8', fontSize: '12px' }}
          />
          <Bar dataKey="calls" fill="#06b6d4" name="Total Calls" radius={[8, 8, 0, 0]} />
          <Bar dataKey="outbound" fill="#f97316" name="Outbound" radius={[8, 8, 0, 0]} />
          <Bar dataKey="inbound" fill="#22c55e" name="Inbound" radius={[8, 8, 0, 0]} />
          <Bar dataKey="sms" fill="#8b5cf6" name="SMS" radius={[8, 8, 0, 0]} />
          <Bar dataKey="emails" fill="#3b82f6" name="Emails" radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

