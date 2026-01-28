-- Marketing Loop Email Tables and Templates
-- Mirrors the SMS journey structure for email campaigns

-- Marketing Email Templates (7 steps)
CREATE TABLE IF NOT EXISTS marketing_email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step integer NOT NULL CHECK (step >= 1 AND step <= 7),
  variant integer NOT NULL DEFAULT 1 CHECK (variant >= 1),
  title text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(step, variant)
);

-- Marketing Email Journeys (tracks email sequence per lead)
CREATE TABLE IF NOT EXISTS marketing_email_journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES extracted_leads(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status = ANY (ARRAY['active'::text, 'paused'::text, 'completed'::text, 'cancelled'::text])),
  current_step integer NOT NULL DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 7),
  next_send_at timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(lead_id)
);

-- Marketing Email Logs (send history)
CREATE TABLE IF NOT EXISTS marketing_email_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES marketing_email_journeys(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES extracted_leads(id) ON DELETE CASCADE,
  step integer NOT NULL CHECK (step >= 1 AND step <= 7),
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  template_id uuid REFERENCES marketing_email_templates(id),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL CHECK (status = ANY (ARRAY['sent'::text, 'failed'::text, 'skipped'::text])),
  resend_message_id text,
  error text,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_marketing_email_templates_step ON marketing_email_templates(step);
CREATE INDEX IF NOT EXISTS idx_marketing_email_journeys_lead_id ON marketing_email_journeys(lead_id);
CREATE INDEX IF NOT EXISTS idx_marketing_email_journeys_status ON marketing_email_journeys(status);
CREATE INDEX IF NOT EXISTS idx_marketing_email_journeys_next_send_at ON marketing_email_journeys(next_send_at) WHERE next_send_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marketing_email_logs_journey_id ON marketing_email_logs(journey_id);
CREATE INDEX IF NOT EXISTS idx_marketing_email_logs_lead_id ON marketing_email_logs(lead_id);
CREATE INDEX IF NOT EXISTS idx_marketing_email_logs_sent_at ON marketing_email_logs(sent_at DESC);

-- RLS Policies
ALTER TABLE marketing_email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_email_journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for marketing_email_templates" ON marketing_email_templates;
CREATE POLICY "Allow all for marketing_email_templates" ON marketing_email_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for marketing_email_journeys" ON marketing_email_journeys;
CREATE POLICY "Allow all for marketing_email_journeys" ON marketing_email_journeys FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for marketing_email_logs" ON marketing_email_logs;
CREATE POLICY "Allow all for marketing_email_logs" ON marketing_email_logs FOR ALL USING (true) WITH CHECK (true);

-- Seed SMS Templates (7 steps) - Upsert to match provided copy
INSERT INTO marketing_sms_templates (step, variant, title, body, is_default, updated_at)
VALUES
  (1, 1, 'Step 1 - Immediate reminder', 'Hi {{name}}, it''s Sydney Premium Cleaning 🙂
We tried to give you a quick call earlier about your cleaning enquiry.
If you''d like info or pricing, just reply YES and I''ll send it through.', true, now()),
  (2, 1, 'Step 2 - +3 days value check', 'Hey {{name}} — just checking in.
If you''re still considering a cleaner, we''ve got availability coming up and can make it pretty flexible.
Happy to send details if you want — just reply YES.', true, now()),
  (3, 1, 'Step 3 - +7 days permission check', 'Hi {{name}}, quick one — are you still looking for a cleaner, or all sorted now?
If you reply either way, I''ll update our notes and won''t bug you 🙂', true, now()),
  (4, 1, 'Step 4 - +14 days incentive', '{{name}}, we''re offering a small first-clean discount this month for new bookings.
If timing or price was the issue before, this might help.
Reply INFO and I''ll explain.', true, now()),
  (5, 1, 'Step 5 - +14 days value reframe', 'Some people prefer starting with a lighter clean before committing.
We can customise the clean to suit your budget or priority areas.
If that sounds useful, reply DETAILS and I''ll run through it.', true, now()),
  (6, 1, 'Step 6 - +1 month reset', 'Hi {{name}} — just touching base.
A lot of people book a reset clean every few weeks or months rather than regularly.
If you want a quick quote, reply QUOTE and I''ll sort it.', true, now()),
  (7, 1, 'Step 7 - Final close-out', 'Last message from Sydney Premium Cleaning, {{name}}.
If you don''t need a cleaner right now, no worries at all — just reply STOP and I''ll close your enquiry.
Otherwise, feel free to save our number for later 🙂', true, now())
ON CONFLICT (step, variant) DO UPDATE SET
  title = EXCLUDED.title,
  body = EXCLUDED.body,
  is_default = EXCLUDED.is_default,
  updated_at = now();

-- Seed Email Templates (7 steps) - With 15% discount inserted
INSERT INTO marketing_email_templates (step, variant, title, subject, body, is_default, updated_at)
VALUES
  (1, 1, 'Step 1 - +1 day follow-up', 'Quick follow-up', 'Hi {{name}},

Just a quick note from Sydney Premium Cleaning.

We tried to reach you earlier regarding your cleaning enquiry and didn''t want to assume anything. If you''re still considering a cleaner, I''m happy to send through pricing and availability.

If it helps, we''re currently offering 15% off your first clean for new bookings.

No rush at all, just reply to this email if you''d like more info.

Kind regards,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (2, 1, 'Step 2 - +5 days availability', 'Availability coming up', 'Hi {{name}},

Just checking back in.

We''ve got some upcoming availability and thought I''d reach out in case you were still weighing things up. We keep things flexible and can tailor the clean to suit your place and budget.

There''s also 15% off the first clean if you decide to go ahead.

Happy to help, just reply if you''d like details.

Thanks,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (3, 1, 'Step 3 - +14 days permission', 'Still looking, or all sorted?', 'Hi {{name}},

Quick question so we don''t keep bothering you.

Are you still looking for a cleaner, or have you already found someone?

If you reply either way, I''ll update our notes and make sure we don''t follow up unnecessarily.

Best,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (4, 1, 'Step 4 - +32 days offer', 'Small offer if timing or price was the issue', 'Hi {{name}},

Sometimes timing or budget is the only thing that gets in the way.

If that was the case, we''re currently offering 15% off your first clean, which can make it easier to get started without a big commitment.

If you''d like me to explain how it works or check availability, just reply to this email.

Kind regards,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (5, 1, 'Step 5 - +44 days flexible options', 'Flexible options available', 'Hi {{name}},

A lot of our clients start with a one-off or lighter clean before deciding on anything ongoing.

We can focus on priority areas or keep things within a set budget, and the 15% first-clean discount still applies.

If that sounds useful, feel free to reply and I''ll run through some options.

Regards,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (6, 1, 'Step 6 - +79 days reset clean', 'Reset clean option', 'Hi {{name}},

Just touching base.

Many people book a reset clean every few months rather than regular services. It''s a good way to get things back on track without committing long term.

If you''d like a quick quote with 15% off the first clean, just reply and I''ll organise it.

All the best,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now()),
  (7, 1, 'Step 7 - +121 days final', 'Closing the loop', 'Hi {{name}},

This will be the last follow-up from Sydney Premium Cleaning.

If you don''t need a cleaner right now, no problem at all. If you ever need help in the future, feel free to reach out.

Thanks for your time,
Sydney Premium Cleaning
https://sydneypremiumcleaning.com.au/

0426 413 984
sales@sydneypremiumcleaning.com.au', true, now())
ON CONFLICT (step, variant) DO UPDATE SET
  title = EXCLUDED.title,
  subject = EXCLUDED.subject,
  body = EXCLUDED.body,
  is_default = EXCLUDED.is_default,
  updated_at = now();
