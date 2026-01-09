import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser } from '../_shared/auth.ts'

type Payload = {
  to_numbers?: string[] | string
  text?: string
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function normalizeNumbers(val: string[] | string | undefined): string[] {
  if (!val) return []
  if (Array.isArray(val)) return val.map((s) => String(s).trim()).filter(Boolean)
  return String(val)
    .split(/[,\n]/g)
    .map((s) => s.trim())
    .filter(Boolean)
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

  const toNumbers = normalizeNumbers(payload.to_numbers)
  const text = payload.text?.trim() || ''
  if (!toNumbers.length) return json({ error: 'to_numbers is required' }, 400, headers)
  if (!text) return json({ error: 'text is required' }, 400, headers)

  const res = await fetch('https://dialpad.com/api/v2/sms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${dialpadToken}`,
    },
    body: JSON.stringify({
      user_id: dialpadUserId,
      to_numbers: toNumbers,
      text,
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error('Dialpad send sms failed', data)
    return json({ error: data?.message || data?.error || 'Dialpad error' }, res.status, headers)
  }

  return json({ ok: true, data }, 200, headers)
})


