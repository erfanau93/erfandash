import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

type Props = {
  children: React.ReactNode
}

export default function AuthGate({ children }: Props) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Awaited<ReturnType<typeof supabase.auth.getSession>>['data']['session']>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, newSession) => {
      setSession(newSession)
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const userEmail = useMemo(() => session?.user?.email || null, [session?.user?.email])

  const signIn = async () => {
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) throw error
    } catch (e: any) {
      setError(e?.message || 'Sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const signOut = async () => {
    setBusy(true)
    setError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    } catch (e: any) {
      setError(e?.message || 'Sign-out failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-white/10 shadow-2xl p-6">
          <div className="text-sm text-[var(--color-text-muted)]">Loading session…</div>
        </div>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="animated-bg min-h-screen flex items-center justify-center p-6 text-white">
        <div className="w-full max-w-md rounded-2xl bg-[var(--color-surface)] border border-white/10 shadow-2xl p-6 space-y-4">
          <div>
            <h1 className="text-2xl font-semibold">Sign in</h1>
            <p className="text-sm text-[var(--color-text-muted)]">Access is restricted. Please sign in to continue.</p>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-200">{error}</div>
          )}

          <div className="space-y-2">
            <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Email</label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-3 py-2 text-sm text-white"
              placeholder="you@company.com"
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider">Password</label>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              className="w-full rounded-lg bg-[var(--color-surface-light)] border border-white/10 px-3 py-2 text-sm text-white"
              placeholder="••••••••"
            />
          </div>

          <button
            onClick={signIn}
            disabled={busy || !email.trim() || !password}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 px-3 py-2 text-sm font-semibold"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="text-xs text-[var(--color-text-muted)]">
            Admin roles are enforced server-side via Supabase RLS. If you can’t access data after signing in, your user
            likely needs an admin/staff role in `profiles`.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-7xl mx-auto px-8 pt-6">
        <div className="flex items-center justify-end gap-3 text-xs text-[var(--color-text-muted)]">
          <span>Signed in as {userEmail}</span>
          <button
            onClick={signOut}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white border border-white/10"
          >
            Sign out
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}


