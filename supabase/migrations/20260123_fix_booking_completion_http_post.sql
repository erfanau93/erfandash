-- Fix pg_net http_post signature by passing jsonb headers/body
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
