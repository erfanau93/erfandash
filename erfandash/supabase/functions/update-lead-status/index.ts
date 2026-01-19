import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

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

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: 'Server configuration error' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let payload: { leadId?: string; status?: string | null }
  try {
    payload = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const leadId = payload?.leadId
  const statusInput = payload?.status

  if (!leadId) {
    return jsonResponse({ error: 'leadId is required' }, 400)
  }

  if (statusInput === undefined) {
    return jsonResponse({ error: 'status is required' }, 400)
  }

  const normalizedStatus = statusInput === null ? null : String(statusInput).trim()
  if (normalizedStatus === '') {
    return jsonResponse({ error: 'status cannot be empty' }, 400)
  }

  try {
    const { data, error } = await supabase
      .from('extracted_leads')
      .update({ status: normalizedStatus })
      .eq('id', leadId)
      .select('id, status')
      .maybeSingle()

    if (error) {
      return jsonResponse({ error: error.message || 'Failed to update status' }, 500)
    }

    if (!data) {
      return jsonResponse({ error: 'Lead not found' }, 404)
    }

    return jsonResponse({ success: true, leadId: data.id, status: data.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unexpected error'
    return jsonResponse({ error: message }, 500)
  }
})

