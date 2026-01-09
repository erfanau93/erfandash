// Supabase Edge Function to create a Stripe Payment Link.
// Set secrets in your Supabase project:
//   STRIPE_SECRET_KEY (required)
//   STRIPE_SUCCESS_URL (optional)
//   STRIPE_CANCEL_URL (optional)
// Expects POST with JSON:
//   { amount_cents, currency?, quoteId?, customerName?, customerEmail?, description?, success_url?, cancel_url? }

import Stripe from 'https://esm.sh/stripe@12.18.0?target=deno'
import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser } from '../_shared/auth.ts'

type CreatePaymentLinkPayload = {
  amount_cents: number
  currency?: string
  quoteId?: string
  customerName?: string
  customerEmail?: string
  description?: string
  success_url?: string
  cancel_url?: string
}

const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY') || ''
const defaultSuccess = Deno.env.get('STRIPE_SUCCESS_URL') || 'https://example.com/payment-success'
const defaultCancel = Deno.env.get('STRIPE_CANCEL_URL') || 'https://example.com/payment-cancel'

if (!stripeSecret) {
  console.error('Missing STRIPE_SECRET_KEY env')
}

const stripe = new Stripe(stripeSecret, {
  apiVersion: '2024-06-20',
})

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
  })
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers,
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, headers)
  }

  if (!isCorsAllowed(req)) {
    return jsonResponse({ error: 'CORS blocked' }, 403, headers)
  }

  // Admin/staff only (payment link creation uses Stripe secret)
  const auth = await requireUser(req)
  if ('error' in auth) return auth.error
  const forbidden = requireRole(auth.role, ['admin', 'staff'])
  if (forbidden) return forbidden

  if (!stripeSecret) {
    return jsonResponse({ error: 'Server missing STRIPE_SECRET_KEY' }, 500, headers)
  }

  let payload: CreatePaymentLinkPayload
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, headers)
  }

  const amount = Number(payload.amount_cents)
  if (!Number.isFinite(amount) || amount < 1) {
    return jsonResponse({ error: 'amount_cents must be a positive integer (cents)' }, 400, headers)
  }

  const currency = (payload.currency || 'aud').toLowerCase()
  const description = payload.description || 'Cleaning service'
  const successUrl = payload.success_url || defaultSuccess
  const cancelUrl = payload.cancel_url || defaultCancel

  try {
    const link = await stripe.paymentLinks.create({
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: Math.round(amount),
            product_data: { name: description },
          },
        },
      ],
      metadata: {
        quoteId: payload.quoteId || '',
        customerName: payload.customerName || '',
        customerEmail: payload.customerEmail || '',
      },
      after_completion: { type: 'redirect', redirect: { url: successUrl } },
      // Stripe does not currently support cancel_url on Payment Links; handled by user navigation.
    })

    return jsonResponse({ url: link.url, id: link.id }, 200, headers)
  } catch (err) {
    console.error('Stripe payment link error:', err)
    const message = err instanceof Error ? err.message : 'Stripe error'
    return jsonResponse({ error: message }, 500, headers)
  }
})


















