-- =====================================================
-- CLEANERS + DISPATCH (simple, admin-only)
-- =====================================================

-- Cleaners: onboarding profile + operational preferences.
CREATE TABLE IF NOT EXISTS cleaners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  full_name text NOT NULL,
  phone text,
  email text,

  -- Location (Mapbox geocode)
  base_location_text text,           -- "Suburb/area" or full place name
  base_lat double precision,
  base_lng double precision,

  -- Business / compliance
  abn text,
  public_liability_policy_number text,
  public_liability_expiry date,

  -- Payments (simple mode: stored here; tighten later with auth/RLS)
  bank_account_name text,
  bank_bsb text,
  bank_account_number text,

  -- Pricing / constraints
  rates jsonb NOT NULL DEFAULT '{}'::jsonb,         -- e.g. {"standard":45,"end_of_lease":55}
  min_booking_minutes int NOT NULL DEFAULT 120,
  notice_hours int NOT NULL DEFAULT 24,
  cancellation_policy text,

  -- Transport / capability
  has_transport boolean NOT NULL DEFAULT false,
  transport_type text,                              -- car / public transport / bike / etc
  max_travel_km int NOT NULL DEFAULT 15,
  can_transport_equipment boolean NOT NULL DEFAULT false,
  team_size int NOT NULL DEFAULT 1,

  -- Availability (simple buckets)
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,  -- day -> {Morning,Afternoon,Evening,Night}

  active boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cleaners_active ON cleaners(active);

-- Add job address/coords to booking_series for dispatch mapping (one address per series).
ALTER TABLE booking_series
  ADD COLUMN IF NOT EXISTS service_address text,
  ADD COLUMN IF NOT EXISTS service_lat double precision,
  ADD COLUMN IF NOT EXISTS service_lng double precision;

CREATE INDEX IF NOT EXISTS idx_booking_series_service_latlng
  ON booking_series(service_lat, service_lng);

-- Assign cleaner to each occurrence (so reschedules/cancellations don't break history).
ALTER TABLE booking_occurrences
  ADD COLUMN IF NOT EXISTS cleaner_id uuid REFERENCES cleaners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_notes text;

CREATE INDEX IF NOT EXISTS idx_booking_occurrences_cleaner_id ON booking_occurrences(cleaner_id);

-- Reviews (created only after job is completed via UI; DB enforces completed).
CREATE TABLE IF NOT EXISTS cleaner_job_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurrence_id uuid NOT NULL REFERENCES booking_occurrences(id) ON DELETE CASCADE,
  cleaner_id uuid NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cleaner_job_reviews_occurrence_unique
  ON cleaner_job_reviews(occurrence_id);
CREATE INDEX IF NOT EXISTS idx_cleaner_job_reviews_cleaner_id ON cleaner_job_reviews(cleaner_id);

-- Ensure review can only be inserted once the occurrence is completed.
CREATE OR REPLACE FUNCTION ensure_occurrence_completed_for_review()
RETURNS TRIGGER AS $$
DECLARE
  occ_status text;
BEGIN
  SELECT status INTO occ_status FROM booking_occurrences WHERE id = NEW.occurrence_id;
  IF occ_status IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'Cannot review: booking occurrence % is not completed (status=%)', NEW.occurrence_id, occ_status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_review_requires_completed ON cleaner_job_reviews;
CREATE TRIGGER trg_review_requires_completed
  BEFORE INSERT ON cleaner_job_reviews
  FOR EACH ROW
  EXECUTE FUNCTION ensure_occurrence_completed_for_review();

-- updated_at triggers
DROP TRIGGER IF EXISTS update_cleaners_updated_at ON cleaners;
CREATE TRIGGER update_cleaners_updated_at
  BEFORE UPDATE ON cleaners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: matches current project pattern (allow all). Tighten later with auth.
ALTER TABLE cleaners ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_job_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for cleaners" ON cleaners;
CREATE POLICY "Allow all for cleaners" ON cleaners
  FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Allow all for cleaner_job_reviews" ON cleaner_job_reviews;
CREATE POLICY "Allow all for cleaner_job_reviews" ON cleaner_job_reviews
  FOR ALL USING (true) WITH CHECK (true);






