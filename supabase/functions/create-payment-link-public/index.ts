import Stripe from 'https://esm.sh/stripe@12.18.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'

type Payload = {
  share_token?: string
  pay_full_amount?: boolean
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

  const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') || ''
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  const defaultSuccess = Deno.env.get('STRIPE_SUCCESS_URL') || 'https://example.com/payment-success'
  const defaultCancel = Deno.env.get('STRIPE_CANCEL_URL') || 'https://example.com/payment-cancel'

  if (!stripeSecret) return json({ error: 'Stripe not configured' }, 500, headers)
  if (!supabaseUrl || !supabaseServiceKey) return json({ error: 'Supabase service key missing' }, 500, headers)

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON payload' }, 400, headers)
  }

  const shareToken = payload.share_token
  if (!shareToken) return json({ error: 'share_token is required' }, 400, headers)

  const payFullAmount = Boolean(payload.pay_full_amount)

  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: quote, error } = await supabaseAdmin
    .from('quotes')
    .select('id, total_inc_gst, deposit_amount, customer_email, customer_name, quote_number')
    .eq('share_token', shareToken)
    .single()

  if (error || !quote) return json({ error: 'Quote not found' }, 404, headers)

  const amountNumber = payFullAmount
    ? Number(quote.total_inc_gst)
    : Number(quote.deposit_amount ?? quote.total_inc_gst)

  if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
    return json({ error: 'Invalid amount for quote' }, 400, headers)
  }

  const stripe = new Stripe(stripeSecret, { apiVersion: '2024-06-20' })

  const amountCents = Math.round(amountNumber * 100)
  const description = `Cleaning Quote ${quote.quote_number || quote.id}`

  // Redirect URLs should live on your app domain; these are defaults if you don't pass them in env.
  const successUrl = `${defaultSuccess}`.replace(/\/$/, '') + `?quote=${shareToken}&payment_status=success`
  const cancelUrl = `${defaultCancel}`.replace(/\/$/, '') + `?quote=${shareToken}&payment_status=cancelled`

  try {
    const link = await stripe.paymentLinks.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'aud',
            unit_amount: amountCents,
            product_data: { name: description },
          },
        },
      ],
      metadata: {
        quoteId: quote.id,
        share_token: shareToken,
        pay_full_amount: payFullAmount ? 'true' : 'false',
      },
      after_completion: { type: 'redirect', redirect: { url: successUrl } },
    })

    return json({ url: link.url, id: link.id }, 200, headers)
  } catch (err) {
    console.error('Stripe payment link error:', err)
    const message = err instanceof Error ? err.message : 'Stripe error'
    return json({ error: message }, 500, headers)
  }
})


