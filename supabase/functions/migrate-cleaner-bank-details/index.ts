import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser, supabaseAdmin } from '../_shared/auth.ts'
import { encryptString } from '../_shared/crypto.ts'

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

  // Find rows still storing plaintext, and encrypt them.
  const { data: cleaners, error } = await supabaseAdmin
    .from('cleaners')
    .select('id, bank_account_name, bank_bsb, bank_account_number, bank_account_name_enc, bank_bsb_enc, bank_account_number_enc')
    .limit(1000)

  if (error) return json({ error: error.message }, 500, headers)

  let migrated = 0
  for (const c of cleaners || []) {
    const hasPlain = Boolean(c.bank_account_name || c.bank_bsb || c.bank_account_number)
    const hasEnc = Boolean(c.bank_account_name_enc || c.bank_bsb_enc || c.bank_account_number_enc)
    if (!hasPlain || hasEnc) continue

    const update: Record<string, any> = {
      bank_account_name: null,
      bank_bsb: null,
      bank_account_number: null,
      bank_account_name_enc: c.bank_account_name ? await encryptString(String(c.bank_account_name)) : null,
      bank_bsb_enc: c.bank_bsb ? await encryptString(String(c.bank_bsb)) : null,
      bank_account_number_enc: c.bank_account_number ? await encryptString(String(c.bank_account_number)) : null,
    }
    const { error: upErr } = await supabaseAdmin.from('cleaners').update(update).eq('id', c.id)
    if (upErr) {
      console.error('Failed migrating cleaner bank details', c.id, upErr)
      return json({ error: `Failed migrating cleaner ${c.id}: ${upErr.message}` }, 500, headers)
    }
    migrated++
  }

  return json({ ok: true, migrated }, 200, headers)
})


