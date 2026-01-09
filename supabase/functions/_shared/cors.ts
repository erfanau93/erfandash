export function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''

  // Comma-separated list of allowed origins (e.g. "https://app.example.com,http://localhost:5173")
  const allowListRaw = Deno.env.get('ALLOWED_ORIGINS') || ''
  const allowList = allowListRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const defaultDev = new Set(['http://localhost:5173', 'http://127.0.0.1:5173'])
  const isAllowed =
    (origin && allowList.includes(origin)) || (origin && allowList.length === 0 && defaultDev.has(origin))

  // If no Origin header (server-to-server), allow it.
  const allowOrigin = origin ? (isAllowed ? origin : '') : '*'

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } as Record<string, string>
}

export function isCorsAllowed(req: Request) {
  const origin = req.headers.get('origin') || ''
  if (!origin) return true // server-to-server

  const allowListRaw = Deno.env.get('ALLOWED_ORIGINS') || ''
  const allowList = allowListRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (allowList.length === 0) {
    return origin === 'http://localhost:5173' || origin === 'http://127.0.0.1:5173'
  }
  return allowList.includes(origin)
}


