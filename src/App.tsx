import Dashboard from './components/Dashboard'
import WebhookDebug from './components/WebhookDebug'
import QuotePublicView from './components/QuotePublicView'
import SalesFunnel from './components/SalesFunnel'
import Calendar from './components/Calendar'
import CompletedJobs from './components/CompletedJobs'
import Cleaners from './components/Cleaners'
import Dispatch from './components/Dispatch'
import JobModal from './components/JobModal'
import GlobalSearch from './components/GlobalSearch'
import MainNav from './components/MainNav'
import Breadcrumbs from './components/Breadcrumbs'

function getBreadcrumbs(path: string): Array<{ label: string; href?: string }> {
  const normalizedPath = path.replace(/\/+$/, '') || '/'
  
  if (normalizedPath === '/') {
    return [{ label: 'Dashboard' }]
  }

  const pathMap: Record<string, string> = {
    '/salesfunnel': 'Sales Funnel',
    '/calendar': 'Calendar',
    '/dispatch': 'Dispatch',
    '/cleaners': 'Cleaners',
    '/completed': 'Completed Jobs',
    '/completed-jobs': 'Completed Jobs',
  }

  const breadcrumbs: Array<{ label: string; href?: string }> = [
    { label: 'Home', href: '/' }
  ]
  
  if (pathMap[normalizedPath]) {
    breadcrumbs.push({ label: pathMap[normalizedPath] })
  } else if (normalizedPath !== '/') {
    // For any other paths, show the path name
    const pathName = normalizedPath.split('/').pop() || ''
    breadcrumbs.push({ 
      label: pathName.charAt(0).toUpperCase() + pathName.slice(1).replace(/-/g, ' ')
    })
  }

  return breadcrumbs
}

function PaymentStatus({ success }: { success?: boolean }) {
  return (
    <div className="animated-bg min-h-screen flex items-center justify-center p-6 text-white">
      <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-white/10 shadow-2xl p-6 space-y-3 text-center">
        <div className="w-14 h-14 rounded-full mx-auto flex items-center justify-center bg-emerald-500/15">
          <svg
            className={`w-7 h-7 ${success ? 'text-emerald-400' : 'text-amber-300'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            {success ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            )}
          </svg>
        </div>
        <h1 className="text-2xl font-semibold">
          {success ? 'Payment successful' : 'Payment cancelled'}
        </h1>
        <p className="text-sm text-[var(--color-text-muted)]">
          {success
            ? 'Thank you! Your payment has been recorded.'
            : 'No charge was made. You can retry your payment anytime.'}
        </p>
      </div>
    </div>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const shareToken = params.get('quote')
  const path = window.location.pathname

  if (path.endsWith('/payment-success')) {
    return <PaymentStatus success />
  }

  if (path.endsWith('/payment-cancel')) {
    return <PaymentStatus success={false} />
  }

  if (shareToken) {
    return (
      <div className="animated-bg min-h-screen">
        <QuotePublicView shareToken={shareToken} />
      </div>
    )
  }

  const breadcrumbs = getBreadcrumbs(path)

  if (path.endsWith('/salesfunnel')) {
    return (
      <div className="animated-bg min-h-screen">
        <MainNav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <GlobalSearch />
        <SalesFunnel />
        <JobModal />
      </div>
    )
  }

  if (path.endsWith('/calendar')) {
    return (
      <div className="animated-bg min-h-screen">
        <MainNav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <GlobalSearch />
        <Calendar />
        <JobModal />
      </div>
    )
  }

  if (path.endsWith('/completed') || path.endsWith('/completed-jobs')) {
    return (
      <div className="animated-bg min-h-screen">
        <MainNav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <GlobalSearch />
        <CompletedJobs />
        <JobModal />
      </div>
    )
  }

  if (path.endsWith('/cleaners')) {
    return (
      <div className="animated-bg min-h-screen">
        <MainNav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <GlobalSearch />
        <Cleaners />
        <JobModal />
      </div>
    )
  }

  if (path.endsWith('/dispatch')) {
    return (
      <div className="animated-bg min-h-screen">
        <MainNav />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
          <Breadcrumbs items={breadcrumbs} />
        </div>
        <GlobalSearch />
        <Dispatch />
        <JobModal />
      </div>
    )
  }

  return (
    <div className="animated-bg min-h-screen">
      <MainNav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <Breadcrumbs items={breadcrumbs} />
      </div>
      <GlobalSearch />
      <Dashboard />
      <div className="max-w-7xl mx-auto px-8 pb-8">
        <WebhookDebug />
      </div>
      <JobModal />
    </div>
  )
}

export default App

