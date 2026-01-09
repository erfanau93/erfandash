import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'

type Payload = { share_token?: string }

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!supabaseUrl || !supabaseServiceKey) return json({ error: 'Supabase service key missing' }, 500, headers)

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const shareToken = payload.share_token?.trim()
  if (!shareToken) return json({ error: 'share_token is required' }, 400, headers)

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Minimal safety: only allow setting card_paid if they had previously chosen card.
  const { data: quote, error: fetchError } = await supabaseAdmin
    .from('quotes')
    .select('id, accepted_payment_method')
    .eq('share_token', shareToken)
    .single()
  if (fetchError || !quote) return json({ error: 'Quote not found' }, 404, headers)

  if (quote.accepted_payment_method !== 'card') {
    return json({ error: 'Quote is not in card payment mode' }, 400, headers)
  }

  const { data, error } = await supabaseAdmin
    .from('quotes')
    .update({ accepted_payment_method: 'card_paid' })
    .eq('id', quote.id)
    .select('*')
    .single()

  if (error || !data) return json({ error: error?.message || 'Failed to mark paid' }, 500, headers)
  return json({ quote: data }, 200, headers)
})


