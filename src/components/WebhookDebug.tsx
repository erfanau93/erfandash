import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export default function WebhookDebug() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        const { data, error } = await supabase
          .from('webhook_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)

        if (error) throw error
        setLogs(data || [])
      } catch (err) {
        console.error('Error fetching logs:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
    const interval = setInterval(fetchLogs, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [])

  if (loading) {
    return <div className="p-4">Loading webhook logs...</div>
  }

  return (
    <div className="p-6 glass-card rounded-2xl">
      <h2 className="text-2xl font-bold mb-4">Webhook Debug Logs</h2>
      <p className="text-sm text-gray-400 mb-4">
        Recent webhook payloads received from Dialpad
      </p>

      {logs.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p>No webhook logs yet.</p>
          <p className="text-sm mt-2">Make a call through Dialpad to see payloads here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {logs.map((log) => (
            <div key={log.id} className="p-4 bg-[var(--color-surface)] rounded-lg border border-white/10">
              <div className="text-xs text-gray-400 mb-2">
                {new Date(log.created_at).toLocaleString()}
              </div>
              <pre className="text-xs overflow-auto bg-black/20 p-3 rounded">
                {JSON.stringify(log.payload, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


