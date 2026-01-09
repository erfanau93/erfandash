-- =====================================================
-- BOOKING SYSTEM TABLES
-- Run this in your Supabase SQL Editor
-- =====================================================

-- booking_series: One row per recurring (or one-off) service agreement
CREATE TABLE IF NOT EXISTS booking_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES extracted_leads(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Regular clean',
  
  -- Schedule
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 120,
  
  -- Recurrence (RFC5545 RRULE format, null = one-time booking)
  -- Examples:
  --   Weekly:      FREQ=WEEKLY;INTERVAL=1
  --   Fortnightly: FREQ=WEEKLY;INTERVAL=2
  --   Every 3 wks: FREQ=WEEKLY;INTERVAL=3
  --   Monthly:     FREQ=MONTHLY;INTERVAL=1
  --   Every 2 mo:  FREQ=MONTHLY;INTERVAL=2
  rrule text,
  
  -- End condition (all nullable - if all null, repeats forever)
  until_date date,           -- Stop after this date
  occurrence_count int,       -- Stop after N occurrences
  
  -- Metadata
  notes text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'cancelled')),
  assigned_user_id uuid,      -- For future staff assignment
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for quick lead lookups
CREATE INDEX IF NOT EXISTS idx_booking_series_lead_id ON booking_series(lead_id);
CREATE INDEX IF NOT EXISTS idx_booking_series_status ON booking_series(status);

-- booking_occurrences: Individual calendar events (generated from series)
CREATE TABLE IF NOT EXISTS booking_occurrences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES booking_series(id) ON DELETE CASCADE,
  
  -- Timing (always stored in UTC)
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  
  -- For exceptions: what was the original time before moving?
  original_start_at timestamptz,
  
  -- Status
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'skipped')),
  
  -- Override notes for this specific occurrence
  notes text,
  
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for calendar range queries (most important for performance)
CREATE INDEX IF NOT EXISTS idx_booking_occurrences_start_at ON booking_occurrences(start_at);
CREATE INDEX IF NOT EXISTS idx_booking_occurrences_series_id ON booking_occurrences(series_id);
CREATE INDEX IF NOT EXISTS idx_booking_occurrences_status ON booking_occurrences(status);

-- Prevent duplicate occurrences for same series at same time
CREATE UNIQUE INDEX IF NOT EXISTS idx_booking_occurrences_unique 
  ON booking_occurrences(series_id, COALESCE(original_start_at, start_at));

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_booking_series_updated_at ON booking_series;
CREATE TRIGGER update_booking_series_updated_at
  BEFORE UPDATE ON booking_series
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_booking_occurrences_updated_at ON booking_occurrences;
CREATE TRIGGER update_booking_occurrences_updated_at
  BEFORE UPDATE ON booking_occurrences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Enable RLS
ALTER TABLE booking_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_occurrences ENABLE ROW LEVEL SECURITY;

-- Policies (adjust based on your auth setup - these allow all for anon/authenticated)
DROP POLICY IF EXISTS "Allow all for booking_series" ON booking_series;
CREATE POLICY "Allow all for booking_series" ON booking_series
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for booking_occurrences" ON booking_occurrences;
CREATE POLICY "Allow all for booking_occurrences" ON booking_occurrences
  FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for both tables
ALTER PUBLICATION supabase_realtime ADD TABLE booking_series;
ALTER PUBLICATION supabase_realtime ADD TABLE booking_occurrences;
















