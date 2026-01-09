import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'

type Payload = {
  share_token?: string
  accept_name?: string
  accept_date?: string
  payment_method?: 'direct_transfer' | 'card'
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

  const name = (payload.accept_name || '').trim()
  const date = (payload.accept_date || '').trim()
  const paymentMethod = payload.payment_method
  if (!name) return json({ error: 'accept_name is required' }, 400, headers)
  if (!date) return json({ error: 'accept_date is required' }, 400, headers)
  if (!paymentMethod) return json({ error: 'payment_method is required' }, 400, headers)

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await supabaseAdmin
    .from('quotes')
    .update({
      accepted_at: new Date().toISOString(),
      accepted_name: name,
      accepted_signature: name,
      accepted_checkbox: true,
      accepted_date: date,
      accepted_payment_method: paymentMethod,
    })
    .eq('share_token', shareToken)
    .select('*')
    .single()

  if (error || !data) {
    console.error('accept-quote-public failed', error)
    return json({ error: error?.message || 'Failed to record acceptance' }, 500, headers)
  }

  return json({ quote: data }, 200, headers)
})


