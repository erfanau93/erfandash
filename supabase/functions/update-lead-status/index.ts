import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser, supabaseAdmin } from '../_shared/auth.ts'

type Payload = {
  leadId?: string
  status?: string | null
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req)
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (!isCorsAllowed(req)) return json({ error: 'CORS blocked' }, 403, headers)
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, headers)

  const auth = await requireUser(req)
  if ('error' in auth) return auth.error
  const forbidden = requireRole(auth.role, ['admin', 'staff'])
  if (forbidden) return forbidden

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const leadId = payload.leadId
  if (!leadId) return json({ error: 'leadId is required' }, 400, headers)

  const { error } = await supabaseAdmin.from('extracted_leads').update({ status: payload.status ?? null }).eq('id', leadId)
  if (error) {
    console.error('update-lead-status failed', error)
    return json({ error: error.message }, 500, headers)
  }

  return json({ ok: true }, 200, headers)
})


