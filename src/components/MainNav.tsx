import { useEffect, useState } from 'react'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Sales Funnel', href: '/salesfunnel' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Dispatch', href: '/dispatch' },
  { label: 'Quotes Sent', href: '/quotes-sent' },
  { label: 'Completed Jobs', href: '/completed' },
  { label: 'Cleaners Payout', href: '/cleaners-payout' },
  { label: 'Repeat Customers', href: '/repeat-customers' },
  { label: 'Marketing Loop', href: '/marketing-loop' },
  { label: 'Cleaners', href: '/cleaners' },
  { label: 'Analytics', href: '/analytics', isAnalytics: true },
  { label: 'Todo', href: '/todo', isTodo: true },
]

const normalizePath = (path: string) => {
  const trimmed = path.replace(/\/+$/, '')
  return trimmed || '/'
}

const isActivePath = (href: string, current: string) => {
  const target = normalizePath(href).toLowerCase()
  const path = normalizePath(current).toLowerCase()

  if (target === '/completed') {
    return path === '/completed' || path === '/completed-jobs'
  }

  return path === target
}

export default function MainNav() {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/'
  const [todoCount, setTodoCount] = useState(0)

  // Listen for todo count updates from TodoPage
  useEffect(() => {
    const handleTodoUpdate = (e: CustomEvent<{ count: number }>) => {
      setTodoCount(e.detail.count)
    }

    window.addEventListener('todo-count-update', handleTodoUpdate as any)
    
    // Initial fetch of todo count
    fetchTodoCount()

    return () => {
      window.removeEventListener('todo-count-update', handleTodoUpdate as any)
    }
  }, [])

  // Fetch todo count on mount and periodically
  const fetchTodoCount = async () => {
    try {
      // Import supabase dynamically to avoid circular deps
      const { supabase } = await import('../lib/supabase')
      const now = new Date()
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const todayEnd = new Date(today.getTime() + 24 * 60 * 60 * 1000)
      const fiveDaysFromNow = new Date(today.getTime() + 5 * 24 * 60 * 60 * 1000)

      // Count leads without status today
      const { count: leadsCount } = await supabase
        .from('extracted_leads')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', today.toISOString())
        .lt('created_at', todayEnd.toISOString())
        .or('status.is.null,status.eq.,status.eq.Unanswered')

      // Count unassigned jobs next 5 days
      const { count: unassignedCount } = await supabase
        .from('booking_occurrences')
        .select('id', { count: 'exact', head: true })
        .gte('start_at', today.toISOString())
        .lt('start_at', fiveDaysFromNow.toISOString())
        .is('cleaner_id', null)
        .neq('status', 'cancelled')

      // Count unpaid cleaner payouts
      const { count: payoutsCount } = await supabase
        .from('cleaner_payouts')
        .select('id', { count: 'exact', head: true })
        .is('paid_at', null)

      // Count pending manual todos
      const { count: manualCount } = await supabase
        .from('todos')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'manual')
        .eq('is_completed', false)

      const total = (leadsCount || 0) + (unassignedCount || 0) + (payoutsCount || 0) + (manualCount || 0)
      setTodoCount(total)
    } catch (err) {
      console.error('Failed to fetch todo count:', err)
    }
  }

  // Refresh count every 60 seconds
  useEffect(() => {
    const interval = setInterval(fetchTodoCount, 60000)
    return () => clearInterval(interval)
  }, [])

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-semibold">
              DP
            </div>
            <div className="flex flex-col">
              <span className="text-white font-semibold leading-tight">Little Fish Operations</span>
              <span className="text-xs text-white/60">Communications & jobs</span>
            </div>
          </div>

          <nav className="flex items-center gap-2 flex-wrap">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(item.href, currentPath)
              const isTodoItem = (item as any).isTodo
              const isAnalyticsItem = (item as any).isAnalytics
              const hasPendingTodos = isTodoItem && todoCount > 0

              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`relative px-3 py-2 rounded-xl border text-sm transition-colors ${
                    active
                      ? isAnalyticsItem
                        ? 'bg-indigo-500 text-white border-indigo-300/60 shadow-lg shadow-indigo-500/30'
                        : 'bg-cyan-500 text-white border-cyan-300/60 shadow-lg shadow-cyan-500/30'
                      : hasPendingTodos
                      ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 border-amber-400/50 animate-pulse'
                      : isAnalyticsItem
                      ? 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-200 border-indigo-400/30'
                      : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
                  } ${hasPendingTodos ? 'ring-2 ring-amber-400/50 ring-offset-1 ring-offset-transparent' : ''}`}
                >
                  <span className="flex items-center gap-1.5">
                    {isTodoItem && (
                      <span className={`text-base ${hasPendingTodos ? 'animate-bounce' : ''}`}>📋</span>
                    )}
                    {isAnalyticsItem && (
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                      </svg>
                    )}
                    {item.label}
                    {hasPendingTodos && (
                      <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 flex items-center justify-center rounded-full bg-red-500 text-white text-xs font-bold shadow-lg animate-pulse">
                        {todoCount > 99 ? '99+' : todoCount}
                      </span>
                    )}
                  </span>
                  {hasPendingTodos && (
                    <span className="absolute inset-0 rounded-xl bg-amber-400/20 animate-ping pointer-events-none" />
                  )}
                </a>
              )
            })}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new Event('open-global-search'))}
              className="px-3 py-2 rounded-xl border text-sm transition-colors bg-white/5 hover:bg-white/10 text-white border-white/10 flex items-center gap-2"
              title="Search (Ctrl/Cmd+K)"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
              <span className="hidden sm:inline">Search</span>
            </button>
          </nav>
        </div>
      </div>
    </header>
  )
}

