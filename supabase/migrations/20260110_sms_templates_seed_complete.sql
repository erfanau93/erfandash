-- Seed 5 payment reminder templates and 5 review reminder templates
-- This migration ensures we have the required templates with proper placeholders

-- Payment Reminder Templates (5 templates)
-- Placeholders: {{name}}, {{phone}}, {{number}}, {{amount}}, {{payment_link}}, {{stripe_payment_link}}, {{quote_link}}
INSERT INTO payment_sms_templates (slug, title, tone, body, is_default, updated_at)
VALUES
  ('payment-reminder-1', 'Friendly Payment Reminder', 'friendly', 
   'Hi {{name}}, thanks for having us! Your invoice for {{amount}} is ready. Pay securely here: {{payment_link}}. View quote: {{quote_link}}', 
   true, now()),
  
  ('payment-reminder-2', 'Gentle Reminder with Details', 'neutral', 
   'Hi {{name}}, quick reminder about your cleaning invoice of {{amount}}. You can pay via {{payment_link}} or view your quote at {{quote_link}}. Questions? Call us at {{phone}}.', 
   false, now()),
  
  ('payment-reminder-3', 'Professional Payment Request', 'neutral', 
   'Hello {{name}}, your invoice for {{amount}} is due. Please complete payment at {{payment_link}}. Quote available: {{quote_link}}. Thank you!', 
   false, now()),
  
  ('payment-reminder-4', 'Urgent Payment Reminder', 'firm', 
   'Hi {{name}}, your payment of {{amount}} is overdue. Please settle via {{payment_link}} today. Quote: {{quote_link}}. Contact {{phone}} if you need assistance.', 
   false, now()),
  
  ('payment-reminder-5', 'Thank You + Payment Link', 'friendly', 
   'Thanks {{name}}! Your total is {{amount}}. Pay here: {{payment_link}}. View full quote: {{quote_link}}. We appreciate your business!', 
   false, now())
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  tone = EXCLUDED.tone,
  body = EXCLUDED.body,
  updated_at = now();

-- Review Reminder Templates (5 templates)
-- Placeholders: {{name}}, {{review_link}}
INSERT INTO review_sms_templates (slug, title, tone, body, is_default, updated_at)
VALUES
  ('review-reminder-1', 'Thank You + Review Request', 'friendly', 
   'Hi {{name}}, thank you for choosing us! If you have a moment, we''d love your feedback: {{review_link}}', 
   true, now()),
  
  ('review-reminder-2', 'Quick Review Ask', 'friendly', 
   'Hey {{name}}, thanks so much! Could you please leave us a review? It really helps: {{review_link}}', 
   false, now()),
  
  ('review-reminder-3', 'Grateful Review Request', 'friendly', 
   'Hi {{name}}, we hope you were happy with the service! A quick review would mean a lot: {{review_link}} Thank you!', 
   false, now()),
  
  ('review-reminder-4', 'Short & Sweet Review', 'friendly', 
   'Thanks {{name}}! If you enjoyed our service, please leave a review: {{review_link}} We appreciate it!', 
   false, now()),
  
  ('review-reminder-5', 'Follow-up Review Request', 'neutral', 
   'Hi {{name}}, hope everything was great! We''d appreciate if you could share your experience: {{review_link}} Thanks!', 
   false, now())
ON CONFLICT (slug) DO UPDATE SET
  title = EXCLUDED.title,
  tone = EXCLUDED.tone,
  body = EXCLUDED.body,
  updated_at = now();
