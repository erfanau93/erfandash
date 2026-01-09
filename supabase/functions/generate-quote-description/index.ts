import { corsHeaders, isCorsAllowed } from '../_shared/cors.ts'
import { requireRole, requireUser } from '../_shared/auth.ts'

type Payload = {
  customerName?: string
  service?: string
  bedrooms?: number
  bathrooms?: number
  addons?: string[]
  customAddons?: { name: string; price: number }[]
  notes?: string
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

  const apiKey = Deno.env.get('OPENAI_API_KEY') || ''
  if (!apiKey) return json({ error: 'Server missing OPENAI_API_KEY' }, 500, headers)

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, headers)
  }

  const customerName = (payload.customerName || 'customer').trim()
  const service = payload.service || 'general'
  const bedrooms = Number(payload.bedrooms ?? 0)
  const bathrooms = Number(payload.bathrooms ?? 0)
  const addons = Array.isArray(payload.addons) ? payload.addons : []
  const customAddons = Array.isArray(payload.customAddons) ? payload.customAddons : []
  const notes = payload.notes || ''

  const system =
    'You write a concise (30–60 words) customer-facing summary of cleaning work. Use only the provided facts (service, rooms, add-ons, custom add-ons, notes). No assumptions or extra services. Be clear, friendly, and factual. Do not present the customer as part of the cleaning team.'
  const user = `Create a 30–60 word summary of what Sydney Premium Cleaning will do. Facts only, no hallucinations.
Name: ${customerName}.
Service: ${service}.
Bedrooms: ${bedrooms}.
Bathrooms: ${bathrooms}.
Add-ons: ${addons.join(', ') || 'none'}.
Custom add-ons: ${customAddons.map((c) => `${c?.name || ''} $${c?.price || 0}`).join(', ') || 'none'}.
Notes: ${notes || 'none'}.
The name is the customer/recipient, not the cleaning provider. Refer to the customer as "you" or by name, and the cleaner as Sydney Premium Cleaning.`

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.6,
      max_tokens: 180,
    }),
  })

  const data = await res.json().catch(() => ({}))
  const text = data?.choices?.[0]?.message?.content?.trim?.()

  if (!res.ok || !text) {
    console.error('OpenAI error', data)
    return json({ error: data?.error?.message || 'OpenAI request failed' }, 500, headers)
  }

  return json({ text }, 200, headers)
})


