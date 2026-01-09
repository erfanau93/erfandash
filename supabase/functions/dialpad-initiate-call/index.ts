import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser } from '../_shared/auth.ts'

type Payload = {
  phone_number?: string
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

  const dialpadToken = Deno.env.get('DIALPAD_API_KEY') || ''
  const dialpadUserId = Deno.env.get('DIALPAD_USER_ID') || ''
  if (!dialpadToken || !dialpadUserId) {
    return json({ error: 'Server missing DIALPAD_API_KEY or DIALPAD_USER_ID' }, 500, headers)
  }

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const phone = payload.phone_number?.trim()
  if (!phone) return json({ error: 'phone_number is required' }, 400, headers)

  const url = `https://dialpad.com/api/v2/users/${dialpadUserId}/initiate_call`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${dialpadToken}`,
    },
    body: JSON.stringify({ phone_number: phone }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Dialpad initiate call failed', data)
    return json({ error: data?.message || data?.error || 'Dialpad error' }, res.status, headers)
  }

  return json({ ok: true, data }, 200, headers)
})


