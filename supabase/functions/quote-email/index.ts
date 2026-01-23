import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const supabaseUrl = Deno.env.get('SUPABASE_URL') || ''
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const resendApiKey = Deno.env.get('RESEND_API_KEY') || ''

const quoteEmailFrom =
  Deno.env.get('QUOTE_EMAIL_FROM') ||
  Deno.env.get('BOOKING_CONFIRMATION_EMAIL_FROM') ||
  Deno.env.get('JOB_WON_EMAIL_FROM') ||
  'notifications@sydneypremiumcleaning.com.au'
const quoteEmailReplyTo =
  Deno.env.get('QUOTE_EMAIL_REPLY_TO') ||
  Deno.env.get('BOOKING_CONFIRMATION_REPLY_TO') ||
  'sales@sydneypremiumcleaning.com.au'

const businessName = Deno.env.get('BUSINESS_NAME') || 'Sydney Premium Cleaning'
const businessEmail = Deno.env.get('BUSINESS_EMAIL') || 'sales@sydneypremiumcleaning.com.au'
const businessPhone = Deno.env.get('BUSINESS_PHONE') || '0426413984'
const businessAbn = Deno.env.get('BUSINESS_ABN') || '95 675 300 875'
const businessOperatingName = Deno.env.get('BUSINESS_OPERATING_NAME') || 'SYDNEY PREMIUM CLEANING AU'

const bankAccountName = Deno.env.get('BANK_ACCOUNT_NAME') || 'LITTLEFISH AU PTY LTD'
const bankBsb = Deno.env.get('BANK_BSB') || '062692'
const bankAccountNumber = Deno.env.get('BANK_ACCOUNT_NUMBER') || '82781125'

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

function formatCurrency(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return '—'
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value)
}

function normalizeList(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'None'
  return value
    .map((item) => {
      if (typeof item === 'string') return item
      if (item && typeof item === 'object' && 'name' in item) return String((item as any).name)
      return JSON.stringify(item)
    })
    .join(', ')
}

async function sendQuoteEmail(params: {
  to: string
  customerName: string
  customerEmail: string
  quoteNumber: string
  serviceLabel: string
  addressLabel: string
  addonsLabel: string
  subtotalLabel: string
  discountLabel: string
  gstLabel: string
  totalLabel: string
  depositLabel: string
  remainingLabel: string
  shareUrl?: string | null
  description?: string | null
}) {
  const {
    to,
    customerName,
    customerEmail,
    quoteNumber,
    serviceLabel,
    addressLabel,
    addonsLabel,
    subtotalLabel,
    discountLabel,
    gstLabel,
    totalLabel,
    depositLabel,
    remainingLabel,
    shareUrl,
    description,
  } = params

  const subject = `Cleaning Quote — ${businessName}`

  const text = [
    `Hi ${customerName},`,
    ``,
    `Here is your cleaning quote.`,
    `Quote #: ${quoteNumber}`,
    ``,
    `Service: ${serviceLabel}`,
    `Address: ${addressLabel}`,
    `Add-ons: ${addonsLabel}`,
    ``,
    `Subtotal: ${subtotalLabel}`,
    `Discount: ${discountLabel}`,
    `GST (10%): ${gstLabel}`,
    `Total (inc GST): ${totalLabel}`,
    `Deposit: ${depositLabel}`,
    `Remaining balance: ${remainingLabel}`,
    ``,
    `Pay via direct transfer:`,
    `Account Name: ${bankAccountName}`,
    `BSB: ${bankBsb}`,
    `Account: ${bankAccountNumber}`,
    `Reference: ${quoteNumber}`,
    ``,
    ...(shareUrl ? [`View it online: ${shareUrl}`, ``] : []),
    ...(description ? [`Summary: ${description}`, ``] : []),
    `If you'd like to proceed, reply to this email.`,
    ``,
    `${businessName}`,
    businessEmail,
    businessPhone,
    `ABN: ${businessAbn}`,
  ].join('\n')

  const html = `
    <div style="background:#f5f7fb;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
      <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <div style="background:#0f172a;color:#ffffff;padding:20px 24px;">
          <h1 style="margin:0;font-size:20px;">Cleaning Quote</h1>
          <p style="margin:6px 0 0;font-size:14px;">${businessName}</p>
        </div>

        <div style="padding:20px 24px;font-size:14px;line-height:1.6;color:#0f172a;">
          <p style="margin:0 0 12px;">Hi ${customerName},</p>
          <p style="margin:0 0 16px;">Here is your cleaning quote.</p>

          <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
            <div style="flex:1 1 220px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
              <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Quote</div>
              <div style="margin-top:6px;">No. ${quoteNumber}</div>
              <div style="margin-top:4px;color:#64748b;">${businessOperatingName}</div>
            </div>
            <div style="flex:1 1 220px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
              <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Recipient</div>
              <div style="margin-top:6px;">${customerName}</div>
              ${customerEmail ? `<div style="margin-top:4px;color:#64748b;">${customerEmail}</div>` : ''}
            </div>
          </div>

          <div style="background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:6px 0;color:#64748b;width:160px;">Service</td>
                <td style="padding:6px 0;">${serviceLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#64748b;">Address</td>
                <td style="padding:6px 0;">${addressLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#64748b;">Add-ons</td>
                <td style="padding:6px 0;">${addonsLabel}</td>
              </tr>
            </table>
          </div>

          ${
            description
              ? `<div style="margin-top:16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
                  <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Summary</div>
                  <div style="margin-top:6px;">${description}</div>
                </div>`
              : ''
          }

          <div style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:12px;">
            <table style="width:100%;border-collapse:collapse;font-size:14px;">
              <tr>
                <td style="padding:4px 0;color:#64748b;">Subtotal</td>
                <td style="padding:4px 0;text-align:right;">${subtotalLabel}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">Discount</td>
                <td style="padding:4px 0;text-align:right;">${discountLabel}</td>
              </tr>
              <tr>
                <td style="padding:4px 0;color:#64748b;">GST (10%)</td>
                <td style="padding:4px 0;text-align:right;">${gstLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;font-weight:600;">Total (inc GST)</td>
                <td style="padding:6px 0;text-align:right;font-weight:600;">${totalLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#0f172a;font-weight:600;">Deposit</td>
                <td style="padding:6px 0;text-align:right;color:#0f172a;font-weight:600;">${depositLabel}</td>
              </tr>
              <tr>
                <td style="padding:6px 0;color:#0f172a;font-weight:600;">Remaining balance</td>
                <td style="padding:6px 0;text-align:right;color:#0f172a;font-weight:600;">${remainingLabel}</td>
              </tr>
            </table>
          </div>

          <div style="margin-top:16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:12px;">
            <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.04em;">Pay via direct transfer</div>
            <div style="margin-top:8px;">Account Name: ${bankAccountName}</div>
            <div style="margin-top:4px;">BSB: ${bankBsb}</div>
            <div style="margin-top:4px;">Account: ${bankAccountNumber}</div>
            <div style="margin-top:4px;">Reference: ${quoteNumber}</div>
          </div>

          ${
            shareUrl
              ? `<p style="margin:16px 0 0;">
                  View it online:
                  <a href="${shareUrl}" style="color:#2563eb;">${shareUrl}</a>
                </p>`
              : ''
          }

          <p style="margin:16px 0 0;">If you'd like to proceed, reply to this email.</p>

          <p style="margin:16px 0 0;font-weight:600;">${businessName}</p>
          <p style="margin:4px 0 0;color:#64748b;">${businessEmail}</p>
          <p style="margin:2px 0 0;color:#64748b;">${businessPhone}</p>
          <p style="margin:2px 0 0;color:#64748b;">ABN: ${businessAbn}</p>
        </div>

        <div style="background:#f8fafc;padding:12px 24px;font-size:12px;color:#94a3b8;">
          This is an automated quote email. Reply if you have any questions.
        </div>
      </div>
    </div>
  `.trim()

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: quoteEmailFrom,
      to: [to],
      subject,
      text,
      html,
      ...(quoteEmailReplyTo ? { reply_to: quoteEmailReplyTo } : {}),
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Resend send failed: ${errorText}`)
  }
}

Deno.serve(async (req) => {
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

  if (!resendApiKey || !quoteEmailFrom) {
    return jsonResponse({ error: 'Missing email configuration' }, 500)
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey)

  let payload: {
    quoteId?: string
    shareUrl?: string
    emailOverride?: string
    testOnly?: boolean
    testEmailTo?: string
  } = {}

  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  if (payload.testOnly) {
    const testEmailTo = payload.testEmailTo || ''
    if (!testEmailTo) {
      return jsonResponse({ error: 'testEmailTo is required for testOnly mode' }, 400)
    }
  } else if (!payload.quoteId) {
    return jsonResponse({ error: 'quoteId is required' }, 400)
  }

  const { data: quote, error: quoteError } = payload.quoteId
    ? await supabase
        .from('quotes')
        .select(
          [
            'id',
            'lead_id',
            'quote_number',
            'address',
            'description',
            'service',
            'addons',
            'custom_addons',
            'subtotal',
            'discount_amount',
            'gst',
            'total_inc_gst',
            'deposit_percentage',
            'deposit_amount',
            'remaining_balance',
            'customer_name',
            'customer_email',
          ].join(', ')
        )
        .eq('id', payload.quoteId)
        .maybeSingle()
    : await supabase
        .from('quotes')
        .select(
          [
            'id',
            'lead_id',
            'quote_number',
            'address',
            'description',
            'service',
            'addons',
            'custom_addons',
            'subtotal',
            'discount_amount',
            'gst',
            'total_inc_gst',
            'deposit_percentage',
            'deposit_amount',
            'remaining_balance',
            'customer_name',
            'customer_email',
          ].join(', ')
        )
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

  if (quoteError || !quote) {
    return jsonResponse({ error: 'Quote not found' }, 404)
  }

  const leadId = quote.lead_id
  const lead =
    leadId
      ? (
          await supabase
            .from('extracted_leads')
            .select('id, name, email')
            .eq('id', leadId)
            .maybeSingle()
        ).data
      : null

  const customerName = quote.customer_name || lead?.name || 'Client'
  const customerEmail = quote.customer_email || lead?.email || ''
  const targetEmail = payload.testOnly ? payload.testEmailTo || '' : payload.emailOverride || customerEmail

  if (!targetEmail) {
    return jsonResponse({ error: 'Missing customer email' }, 400)
  }

  const quoteNumber = quote.quote_number || quote.id
  const serviceLabel = quote.service || 'cleaning service'
  const addressLabel = quote.address || '—'
  const addonsLabel = normalizeList(quote.addons || quote.custom_addons || [])

  await sendQuoteEmail({
    to: targetEmail,
    customerName,
    customerEmail,
    quoteNumber,
    serviceLabel,
    addressLabel,
    addonsLabel,
    subtotalLabel: formatCurrency(quote.subtotal),
    discountLabel: formatCurrency(quote.discount_amount),
    gstLabel: formatCurrency(quote.gst),
    totalLabel: formatCurrency(quote.total_inc_gst),
    depositLabel: formatCurrency(quote.deposit_amount),
    remainingLabel: formatCurrency(quote.remaining_balance),
    shareUrl: payload.shareUrl,
    description: quote.description,
  })

  return jsonResponse({ success: true, test_only: payload.testOnly === true, email_to: targetEmail })
})
