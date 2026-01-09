-- Safety migration to ensure booking payment columns and SMS template tables exist.
-- This is idempotent and can be run on environments that may have missed prior migrations.

-- Ensure booking_occurrences has the payment columns the UI expects
ALTER TABLE booking_occurrences
ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'waiting_payment'
  CHECK (payment_status IN ('waiting_payment', 'invoice_sent', 'paid')),
ADD COLUMN IF NOT EXISTS payment_link text,
ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
ADD COLUMN IF NOT EXISTS payment_notes text,
ADD COLUMN IF NOT EXISTS payment_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_booking_occurrences_payment_status
  ON booking_occurrences(payment_status);

-- Ensure payment reminder templates/logs tables exist
CREATE TABLE IF NOT EXISTS payment_sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  title text NOT NULL,
  tone text NOT NULL DEFAULT 'friendly',
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  template_id uuid REFERENCES payment_sms_templates(id),
  body text NOT NULL,
  tone text,
  amount_cents integer,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_sms_logs_occurrence_id ON payment_sms_logs(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_payment_sms_logs_sent_at ON payment_sms_logs(sent_at DESC);

-- Ensure thank-you / review SMS templates/logs tables exist
CREATE TABLE IF NOT EXISTS review_sms_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE,
  title text NOT NULL,
  tone text NOT NULL DEFAULT 'friendly',
  body text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  template_id uuid REFERENCES review_sms_templates(id),
  body text NOT NULL,
  tone text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_review_sms_logs_occurrence_id ON review_sms_logs(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_review_sms_logs_sent_at ON review_sms_logs(sent_at DESC);

-- Open RLS to match the app's anon usage (adjust later if needed)
ALTER TABLE payment_sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_sms_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_sms_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for payment_sms_templates" ON payment_sms_templates;
CREATE POLICY "Allow all for payment_sms_templates" ON payment_sms_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for payment_sms_logs" ON payment_sms_logs;
CREATE POLICY "Allow all for payment_sms_logs" ON payment_sms_logs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for review_sms_templates" ON review_sms_templates;
CREATE POLICY "Allow all for review_sms_templates" ON review_sms_templates FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for review_sms_logs" ON review_sms_logs;
CREATE POLICY "Allow all for review_sms_logs" ON review_sms_logs FOR ALL USING (true) WITH CHECK (true);

-- Seed defaults (friendly through firm) for both payment and review SMS.
INSERT INTO payment_sms_templates (slug, title, tone, body, is_default)
VALUES
  ('payment-friendly-1', 'Friendly thank-you', 'friendly', 'Hi {{name}}, thanks for having us! Today''s clean comes to {{amount}} inc GST. You can pay securely here: {{payment_link}}. Let me know if any questions.', true),
  ('payment-reminder-1', 'Gentle reminder', 'neutral', 'Quick reminder about your cleaning balance of {{amount}} (inc GST). Please pay here: {{payment_link}}. If you already paid, thank you!', true),
  ('payment-firm-1', 'Firmer follow-up', 'firm', 'Hi {{name}}, our records show {{amount}} remains outstanding for your recent service. Please complete payment today at {{payment_link}} to avoid interruption.', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO review_sms_templates (slug, title, tone, body, is_default)
VALUES
  ('review-thanks-1', 'Thank you + review', 'friendly', 'Thanks so much {{name}}! If you have a moment, could you leave us a quick Google review? {{review_link}}', true),
  ('review-thanks-2', 'Short & sweet', 'friendly', 'We loved working with you, {{name}}. A short review really helps us: {{review_link}}', true),
  ('review-thanks-3', 'Service follow-up', 'neutral', 'Hi {{name}}, hope you were happy with the clean. Mind sharing feedback here? {{review_link}} Thanks heaps!', true)
ON CONFLICT (slug) DO NOTHING;













