import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser, supabaseAdmin } from '../_shared/auth.ts'
import { decryptString } from '../_shared/crypto.ts'

type Payload = { cleaner_id?: string }

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
  const forbidden = requireRole(auth.role, ['admin'])
  if (forbidden) return forbidden

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const cleanerId = payload.cleaner_id?.trim()
  if (!cleanerId) return json({ error: 'cleaner_id is required' }, 400, headers)

  const { data, error } = await supabaseAdmin
    .from('cleaners')
    .select('id, bank_account_name_enc, bank_bsb_enc, bank_account_number_enc')
    .eq('id', cleanerId)
    .single()

  if (error || !data) return json({ error: 'Cleaner not found' }, 404, headers)

  const bank_account_name = data.bank_account_name_enc ? await decryptString(data.bank_account_name_enc) : ''
  const bank_bsb = data.bank_bsb_enc ? await decryptString(data.bank_bsb_enc) : ''
  const bank_account_number = data.bank_account_number_enc ? await decryptString(data.bank_account_number_enc) : ''

  return json({ ok: true, bank_account_name, bank_bsb, bank_account_number }, 200, headers)
})


