-- Add quote variants for per-occurrence receipts and pricing adjustments

-- 1) Add quote linkage on occurrences
ALTER TABLE booking_occurrences
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_occurrences_quote_id
  ON booking_occurrences(quote_id);

-- 2) Add variant metadata on quotes
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS base_quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS quote_scope text NOT NULL DEFAULT 'series_base'
    CHECK (quote_scope IN ('series_base', 'occurrence_variant'));

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS quote_version int;

CREATE INDEX IF NOT EXISTS idx_quotes_base_quote_id
  ON quotes(base_quote_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_base_quote_version
  ON quotes(base_quote_id, quote_version)
  WHERE base_quote_id IS NOT NULL AND quote_version IS NOT NULL;

-- 3) Backfill legacy data: tie occurrences to the series quote
UPDATE booking_occurrences bo
SET quote_id = bs.quote_id
FROM booking_series bs
WHERE bo.series_id = bs.id
  AND bo.quote_id IS NULL
  AND bs.quote_id IS NOT NULL;
