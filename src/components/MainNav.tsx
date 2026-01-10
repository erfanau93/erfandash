const NAV_ITEMS = [
  { label: 'Dashboard', href: '/' },
  { label: 'Sales Funnel', href: '/salesfunnel' },
  { label: 'Calendar', href: '/calendar' },
  { label: 'Dispatch', href: '/dispatch' },
  { label: 'Cleaners', href: '/cleaners' },
  { label: 'Completed Jobs', href: '/completed' },
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

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-black/30 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex flex-col gap-3">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-semibold">
              DP
            </div>
            <div className="flex flex-col">
              <span className="text-white font-semibold leading-tight">Dialpad Ops</span>
              <span className="text-xs text-white/60">Communications & jobs</span>
            </div>
          </div>

          <nav className="flex items-center gap-2 flex-wrap">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(item.href, currentPath)
              return (
                <a
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-2 rounded-xl border text-sm transition-colors ${
                    active
                      ? 'bg-cyan-500 text-white border-cyan-300/60 shadow-lg shadow-cyan-500/30'
                      : 'bg-white/5 hover:bg-white/10 text-white border-white/10'
                  }`}
                >
                  {item.label}
                </a>
              )
            })}
          </nav>
        </div>
      </div>
    </header>
  )
}

