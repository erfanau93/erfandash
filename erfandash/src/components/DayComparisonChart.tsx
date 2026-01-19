import { useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import { format, subDays, isToday, isYesterday, isTomorrow } from 'date-fns'

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
  isLoading: boolean
}

export default function DayComparisonChart({ calls, sms, emails, isLoading }: Props) {
  const chartData = useMemo(() => {
    const days: DayData[] = []
    const today = new Date()
    
    // Get data for yesterday, today, and tomorrow
    for (let i = -1; i <= 1; i++) {
      const date = subDays(today, -i)
      const dayStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0))
      const dayEnd = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999))
      
      const dayCalls = calls.filter(c => {
        const callDate = new Date(c.created_at)
        return callDate >= dayStart && callDate <= dayEnd
      })
      
      const daySms = sms.filter(s => {
        const smsDate = new Date(s.created_at)
        return smsDate >= dayStart && smsDate <= dayEnd
      })
      
      const dayEmails = emails.filter(e => {
        const emailDate = new Date(e.created_at)
        return emailDate >= dayStart && emailDate <= dayEnd
      })
      
      let label = format(date, 'EEE M/d')
      if (isToday(date)) label = 'Today'
      else if (isYesterday(date)) label = 'Yesterday'
      else if (isTomorrow(date)) label = 'Tomorrow'
      
      days.push({
        date: label,
        calls: dayCalls.length,
        outbound: dayCalls.filter(c => c.direction === 'outbound').length,
        inbound: dayCalls.filter(c => c.direction === 'inbound').length,
        sms: daySms.length,
        emails: dayEmails.length,
      })
    }
    
    return days.reverse() // Show yesterday, today, tomorrow
  }, [calls, sms, emails])

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
      <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
        <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        Day-to-Day Comparison
      </h3>
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

