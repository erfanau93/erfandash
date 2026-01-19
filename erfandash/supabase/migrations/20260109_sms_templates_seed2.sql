-- Idempotent seed to expand SMS templates and ensure payment columns exist.
-- Safe to run multiple times.

-- Safety: ensure payment columns exist
ALTER TABLE booking_occurrences
ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
ADD COLUMN IF NOT EXISTS payment_link text,
ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'waiting_payment'
  CHECK (payment_status IN ('waiting_payment', 'invoice_sent', 'paid')),
ADD COLUMN IF NOT EXISTS payment_notes text,
ADD COLUMN IF NOT EXISTS payment_paid_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_booking_occurrences_payment_status ON booking_occurrences(payment_status);

-- Additional payment reminder templates
INSERT INTO payment_sms_templates (slug, title, tone, body, is_default, updated_at)
VALUES
  ('payment-soft-ack', 'Soft thank-you + link', 'friendly', 'Hi {{name}}, thanks again! Your total is {{amount}} (inc GST). Settle anytime here: {{payment_link}}.', false, now()),
  ('payment-checkin-2', 'Check-in after visit', 'neutral', 'Hope the clean went well. When you have a moment, please finalise {{amount}} here: {{payment_link}}.', false, now()),
  ('payment-second-reminder', 'Second reminder', 'firm', 'Hi {{name}}, this is a reminder to complete payment of {{amount}} at {{payment_link}}. Let me know if you need help.', false, now()),
  ('payment-final', 'Final notice', 'firm', 'Final reminder: {{amount}} remains outstanding. Please pay today at {{payment_link}}. Reply if you already paid.', false, now()),
  ('payment-friendly-2', 'Thank you + next steps', 'friendly', 'We appreciate your business! Balance {{amount}} can be paid securely here: {{payment_link}}. Thanks so much.', false, now()),
  ('payment-gst-clarify', 'GST clarified', 'neutral', 'Quick note: your total including GST is {{amount}}. Pay anytime via {{payment_link}}. Thank you!', false, now())
ON CONFLICT (slug) DO NOTHING;

-- Additional review / thank-you templates
INSERT INTO review_sms_templates (slug, title, tone, body, is_default, updated_at)
VALUES
  ('review-checkin-1', 'Quality check-in', 'friendly', 'Hi {{name}}, hope today''s clean was great. If anything was missed, reply and we''ll fix it. Review here: {{review_link}}', false, now()),
  ('review-nudge-1', 'Short nudge', 'neutral', 'Mind leaving a quick review? It really helps us improve: {{review_link}}', false, now()),
  ('review-star', 'Quick 5-star ask', 'friendly', 'If you loved today''s clean, a quick 5-star here means a lot: {{review_link}}. Thank you!', false, now()),
  ('review-detailed', 'Detailed feedback', 'neutral', 'We''re always improving. Would you share a short review of your experience? {{review_link}}', false, now()),
  ('review-repeat', 'Repeat customer thank-you', 'friendly', 'Thanks for choosing us again, {{name}}. When you have a minute, a review here really helps: {{review_link}}', false, now()),
  ('review-followup', 'Follow-up & support', 'friendly', 'Everything all good after the clean? Reply if we can tweak anything. Review link: {{review_link}}', false, now())
ON CONFLICT (slug) DO NOTHING;


