import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type AppRole = 'admin' | 'staff' | 'viewer' | string

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

if (!supabaseUrl || !serviceKey) {
  console.warn('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Edge Function env')
}

export const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

export async function requireUser(req: Request) {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : ''
  if (!token) {
    return { error: new Response(JSON.stringify({ error: 'Missing Authorization bearer token' }), { status: 401 }) }
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !data?.user) {
    return { error: new Response(JSON.stringify({ error: 'Invalid or expired token' }), { status: 401 }) }
  }

  // Resolve role from profiles table
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', data.user.id)
    .maybeSingle()

  const role = (profile?.role || 'viewer') as AppRole

  return { user: data.user, role }
}

export function requireRole(role: AppRole, allowed: AppRole[]) {
  if (allowed.includes(role)) return null
  return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
}


