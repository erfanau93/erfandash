# Email Logs Guide

This guide explains how to view what emails look like when they come in.

## Option 1: View Emails in Console (Quick View)

Run the PowerShell script to see recent emails in your terminal:

```powershell
.\view-email-logs.ps1
```

This will:
- Prompt for your Supabase anon key (or use environment variable)
- Ask how many emails to view (default: 10)
- Display emails in a readable text format with:
  - Subject
  - Direction (Inbound/Outbound)
  - From/To addresses
  - Timestamp
  - Body preview

## Option 2: Export Emails to HTML File

Export emails to a beautiful HTML file that you can open in your browser:

```powershell
.\export-email-logs.ps1
```

This will:
- Prompt for your Supabase anon key (or use environment variable)
- Ask how many emails to export (default: 50)
- Create an HTML file named `email-logs_YYYYMMDD_HHMMSS.html`
- Open the file in your browser to see formatted emails with full HTML rendering

## Option 3: View in Supabase Dashboard

1. Go to your Supabase Dashboard
2. Navigate to **Table Editor** → `dialpad_emails`
3. View emails directly in the database

## Option 4: View Webhook Logs (Raw Payloads)

To see what the raw webhook payloads look like when emails come in:

### Using Supabase CLI:
```bash
supabase functions logs outlook-webhook --tail
```

### Using Supabase Dashboard:
1. Go to **Edge Functions** → `outlook-webhook`
2. Click on **Logs** tab
3. View real-time logs showing when emails are received

The webhook logs show:
- When emails are received
- HTTP status codes
- Execution times
- Any errors

## Option 5: Query Database Directly

You can also query the database directly using SQL:

```sql
-- View recent emails
SELECT 
    id,
    message_id,
    subject,
    from_email,
    to_email,
    direction,
    created_at,
    LEFT(body, 500) as body_preview
FROM dialpad_emails
ORDER BY created_at DESC
LIMIT 20;

-- View full email body
SELECT 
    subject,
    from_email,
    to_email,
    direction,
    created_at,
    body
FROM dialpad_emails
WHERE id = 'your-email-id-here';
```

## Environment Variables

To avoid entering your Supabase key each time, set it as an environment variable:

```powershell
$env:SUPABASE_ANON_KEY = "your-anon-key-here"
```

Or add it to your PowerShell profile:
```powershell
notepad $PROFILE
```

Then add:
```powershell
$env:SUPABASE_ANON_KEY = "your-anon-key-here"
```

## Understanding Email Data

Each email in the database contains:

- **id**: Unique identifier
- **message_id**: Microsoft Graph message ID
- **subject**: Email subject line
- **from_email**: Sender email address
- **to_email**: Recipient email address
- **direction**: `inbound` (received) or `outbound` (sent)
- **created_at**: Timestamp when email was received/sent
- **body**: Full HTML email body

## Troubleshooting

### "Error: Supabase key not provided"
- Make sure you enter your Supabase anon key when prompted
- Or set it as an environment variable: `$env:SUPABASE_ANON_KEY`

### "Error fetching emails"
- Check your internet connection
- Verify your Supabase URL and key are correct
- Make sure the `dialpad_emails` table exists in your database

### No emails showing up
- Check if emails are actually being received (check Outlook)
- Verify the webhook is set up correctly
- Check Edge Function logs for errors

## Getting Your Supabase Anon Key

1. Go to your Supabase Dashboard
2. Navigate to **Settings** → **API**
3. Copy the **anon/public** key


