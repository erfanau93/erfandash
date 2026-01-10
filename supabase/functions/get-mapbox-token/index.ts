const MAPBOX_TOKEN = Deno.env.get('MAPBOX_TOKEN') || ''

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
    },
  })
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
      },
    })
  }

  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!MAPBOX_TOKEN) {
    return jsonResponse({ error: 'MAPBOX_TOKEN secret is not set' }, 500)
  }

  return jsonResponse({ token: MAPBOX_TOKEN })
})

