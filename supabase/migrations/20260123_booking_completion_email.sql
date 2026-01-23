-- Track completion emails and trigger notifications when jobs are completed
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS booking_occurrence_completion_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  email_to text,
  payload jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_occurrence_completion_emails_occurrence_id
  ON booking_occurrence_completion_emails(occurrence_id);

CREATE OR REPLACE FUNCTION notify_booking_occurrence_completed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    PERFORM net.http_post(
      url := 'https://etiaoqskgplpfydblzne.supabase.co/functions/v1/booking-completed-email',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0aWFvcXNrZ3BscGZ5ZGJsem5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyMzI0NzAsImV4cCI6MjA4MjgwODQ3MH0.c-AlsveEx_bxVgEivga3PRrBp5ylY3He9EJXbaa2N2c',
        'Content-Type',
        'application/json'
      ),
      body := jsonb_build_object('occurrenceId', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_booking_occurrence_completed_notify ON booking_occurrences;
CREATE TRIGGER trg_booking_occurrence_completed_notify
  AFTER UPDATE OF status ON booking_occurrences
  FOR EACH ROW
  EXECUTE FUNCTION notify_booking_occurrence_completed();
