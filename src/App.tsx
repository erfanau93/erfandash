/**
 * App - Root Application Component
 * 
 * Apple VisionOS Inspired CRM Interface
 * A calm, powerful system that feels alive and effortless.
 */

import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard'
import WebhookDebug from './components/WebhookDebug'
import QuotePublicView from './components/QuotePublicView'
import SalesFunnel from './components/SalesFunnel'
import Calendar from './components/Calendar'
import CompletedJobs from './components/CompletedJobs'
import Cleaners from './components/Cleaners'
import CleanersPayout from './components/CleanersPayout'
import Dispatch from './components/Dispatch'
import QuotesSent from './components/QuotesSent'
import RepeatCustomers from './components/RepeatCustomers'
import TodoPage from './components/TodoPage'
import JobModal from './components/JobModal'
import GlobalSearch from './components/GlobalSearch'
import MainNav from './components/MainNav'
import Breadcrumbs from './components/Breadcrumbs'
import NewLeadNotifier from './components/NewLeadNotifier'
import MarketingLoopNotifier from './components/MarketingLoopNotifier'
import ManualTodoPopup from './components/ManualTodoPopup'
import MarketingLoop from './components/MarketingLoop'
import BusinessAnalytics from './components/BusinessAnalytics'
import { GlassCard, Button } from './components/ui'

function getBreadcrumbs(path: string): Array<{ label: string; href?: string }> {
  const normalizedPath = path.replace(/\/+$/, '') || '/'
  
  if (normalizedPath === '/') {
    return [{ label: 'Dashboard' }]
  }

  const pathMap: Record<string, string> = {
    '/salesfunnel': 'Sales Pipeline',
    '/calendar': 'Calendar',
    '/dispatch': 'Dispatch',
    '/cleaners': 'Cleaners',
    '/cleaners-payout': 'Payouts',
    '/completed': 'Completed Jobs',
    '/completed-jobs': 'Completed Jobs',
    '/quotes-sent': 'Quotes',
    '/repeat-customers': 'Repeat Customers',
    '/todo': 'Todo',
    '/marketing-loop': 'Marketing Loop',
    '/analytics': 'Analytics',
  }

  const breadcrumbs: Array<{ label: string; href?: string }> = [
    { label: 'Home', href: '/' }
  ]
  
  if (pathMap[normalizedPath]) {
    breadcrumbs.push({ label: pathMap[normalizedPath] })
  } else if (normalizedPath !== '/') {
    const pathName = normalizedPath.split('/').pop() || ''
    breadcrumbs.push({ 
      label: pathName.charAt(0).toUpperCase() + pathName.slice(1).replace(/-/g, ' ')
    })
  }

  return breadcrumbs
}

function LoginScreen({
  onLogin,
  error,
}: {
  onLogin: (username: string, password: string) => void
  error?: string
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onLogin(username.trim(), password)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <GlassCard className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-[var(--color-accent)] to-teal-600 flex items-center justify-center mb-4 shadow-lg shadow-teal-500/20">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <h1 className="text-title text-white mb-1">Welcome back</h1>
          <p className="text-caption">Sign in to continue to Operations Hub</p>
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-micro">Username</label>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="input"
              placeholder="Enter username"
              autoComplete="username"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-micro">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="Enter password"
              autoComplete="current-password"
            />
          </div>
          {error && (
            <div className="p-3 rounded-lg bg-[var(--color-error-muted)] border border-red-500/20">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          <Button type="submit" variant="primary" className="w-full">
            Sign in
          </Button>
        </form>
        
        <p className="text-xs text-center text-[var(--color-text-muted)] mt-6">
          Shared quote links remain accessible without sign-in
        </p>
      </GlassCard>
    </div>
  )
}

function PaymentStatus({ success }: { success?: boolean }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <GlassCard className="w-full max-w-md p-8 text-center">
        <div className={`w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4 ${
          success ? 'bg-emerald-500/15' : 'bg-amber-500/15'
        }`}>
          <svg
            className={`w-8 h-8 ${success ? 'text-emerald-400' : 'text-amber-400'}`}
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
        <h1 className="text-title text-white mb-2">
          {success ? 'Payment successful' : 'Payment cancelled'}
        </h1>
        <p className="text-caption">
          {success
            ? 'Thank you! Your payment has been recorded.'
            : 'No charge was made. You can retry your payment anytime.'}
        </p>
      </GlassCard>
    </div>
  )
}

function App() {
  const params = new URLSearchParams(window.location.search)
  const shareToken = params.get('quote')
  const path = window.location.pathname

  const [isAuthed, setIsAuthed] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [error, setError] = useState<string>()
  const [showWebhookLogs, setShowWebhookLogs] = useState(false)

  useEffect(() => {
    if (localStorage.getItem('authUser') === 'admin123') {
      setIsAuthed(true)
    }
    setAuthChecked(true)
  }, [])

  const handleLogin = (username: string, password: string) => {
    if (username === 'admin123' && password === 'BeCreative123!!') {
      localStorage.setItem('authUser', 'admin123')
      setIsAuthed(true)
      setError(undefined)
    } else {
      setError('Invalid credentials')
    }
  }

  const handleLogout = () => {
    localStorage.removeItem('authUser')
    setIsAuthed(false)
    setError(undefined)
  }

  // Public routes
  if (path.endsWith('/payment-success')) {
    return <PaymentStatus success />
  }

  if (path.endsWith('/payment-cancel')) {
    return <PaymentStatus success={false} />
  }

  if (shareToken) {
    return (
      <div className="min-h-screen">
        <QuotePublicView shareToken={shareToken} />
      </div>
    )
  }

  // Auth check
  if (!authChecked) {
    return null
  }

  if (!isAuthed) {
    return <LoginScreen onLogin={handleLogin} error={error} />
  }

  // Authenticated layout wrapper
  const breadcrumbs = getBreadcrumbs(path)
  
  const Layout = ({ children }: { children: React.ReactNode }) => (
    <div className="min-h-screen relative">
      {/* Logout button */}
      <button
        onClick={handleLogout}
        className="fixed top-4 right-4 z-[100] px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--color-text-secondary)] hover:text-white bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] border border-[var(--glass-border)] transition-colors"
      >
        Sign out
      </button>
      
      <MainNav />
      
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <Breadcrumbs items={breadcrumbs} />
      </div>
      
      <GlobalSearch />
      <NewLeadNotifier />
      <MarketingLoopNotifier />
      <ManualTodoPopup />
      
      {children}
      
      <JobModal />
    </div>
  )

  // Route matching
  if (path.endsWith('/salesfunnel')) {
    return <Layout><SalesFunnel /></Layout>
  }

  if (path.endsWith('/calendar')) {
    return <Layout><Calendar /></Layout>
  }

  if (path.endsWith('/completed') || path.endsWith('/completed-jobs')) {
    return <Layout><CompletedJobs /></Layout>
  }

  if (path.endsWith('/cleaners')) {
    return <Layout><Cleaners /></Layout>
  }

  if (path.endsWith('/dispatch')) {
    return <Layout><Dispatch /></Layout>
  }

  if (path.endsWith('/cleaners-payout')) {
    return <Layout><CleanersPayout /></Layout>
  }

  if (path.endsWith('/quotes-sent')) {
    return <Layout><QuotesSent /></Layout>
  }

  if (path.endsWith('/repeat-customers')) {
    return <Layout><RepeatCustomers /></Layout>
  }

  if (path.endsWith('/todo')) {
    return <Layout><TodoPage /></Layout>
  }

  if (path.endsWith('/marketing-loop')) {
    return <Layout><MarketingLoop /></Layout>
  }

  if (path.endsWith('/analytics')) {
    return <Layout><BusinessAnalytics /></Layout>
  }

  // Default: Dashboard
  return (
    <Layout>
      <Dashboard />
      
      {/* Webhook logs toggle (debug) */}
      {showWebhookLogs && (
        <div className="fixed inset-x-0 bottom-20 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
            <div className="relative">
              <button
                onClick={() => setShowWebhookLogs(false)}
                className="absolute -top-3 right-0 px-3 py-1 text-xs rounded-full bg-[var(--color-surface)] border border-[var(--glass-border)] text-[var(--color-text-secondary)] hover:text-white"
              >
                Close
              </button>
              <WebhookDebug />
            </div>
          </div>
        </div>
      )}
      
      <button
        onClick={() => setShowWebhookLogs((prev) => !prev)}
        className="fixed bottom-4 right-4 z-40 px-4 py-2 text-xs font-medium rounded-full bg-[var(--color-surface)] border border-[var(--glass-border)] text-[var(--color-text-secondary)] hover:text-white hover:bg-[var(--color-surface-hover)] transition-colors"
        aria-expanded={showWebhookLogs}
      >
        {showWebhookLogs ? 'Hide Logs' : 'Logs'}
      </button>
    </Layout>
  )
}

export default App
