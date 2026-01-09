import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser, supabaseAdmin } from '../_shared/auth.ts'
import { encryptString } from '../_shared/crypto.ts'

type Payload = {
  cleaner_id?: string
  bank_account_name?: string | null
  bank_bsb?: string | null
  bank_account_number?: string | null
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

  const bank_account_name = (payload.bank_account_name ?? '').toString().trim()
  const bank_bsb = (payload.bank_bsb ?? '').toString().trim()
  const bank_account_number = (payload.bank_account_number ?? '').toString().trim()

  const update: Record<string, any> = {
    bank_account_name: null,
    bank_bsb: null,
    bank_account_number: null,
    bank_account_name_enc: bank_account_name ? await encryptString(bank_account_name) : null,
    bank_bsb_enc: bank_bsb ? await encryptString(bank_bsb) : null,
    bank_account_number_enc: bank_account_number ? await encryptString(bank_account_number) : null,
  }

  const { error } = await supabaseAdmin.from('cleaners').update(update).eq('id', cleanerId)
  if (error) {
    console.error('set-cleaner-bank-details failed', error)
    return json({ error: error.message }, 500, headers)
  }

  return json({ ok: true }, 200, headers)
})


