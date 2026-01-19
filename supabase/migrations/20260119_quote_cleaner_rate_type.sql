-- Add cleaner rate type to support hourly vs per-job pay in quotes
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS cleaner_rate_type text DEFAULT 'hour'
  CHECK (cleaner_rate_type IN ('hour', 'job'));

-- Backfill nulls to default hourly
UPDATE quotes
SET cleaner_rate_type = 'hour'
WHERE cleaner_rate_type IS NULL;
