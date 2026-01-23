-- Track reminder emails sent for booking occurrences
CREATE TABLE IF NOT EXISTS booking_occurrence_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  reminder_type text NOT NULL DEFAULT '24h' CHECK (reminder_type IN ('24h')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  email_to text,
  payload jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_occurrence_reminders_unique
  ON booking_occurrence_reminders(occurrence_id, reminder_type);

CREATE INDEX IF NOT EXISTS idx_booking_occurrence_reminders_occurrence_id
  ON booking_occurrence_reminders(occurrence_id);
