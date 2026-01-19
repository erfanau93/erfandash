-- Preserve discount percent chosen in the UI by storing it alongside discount_amount.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS discount_percentage double precision;

-- Backfill from existing data when possible.
UPDATE quotes
SET discount_percentage = COALESCE(
  NULLIF(discount_percentage, 0),
  CASE
    WHEN subtotal IS NOT NULL AND subtotal <> 0 THEN ROUND((discount_amount / subtotal) * 100, 2)
    ELSE 0
  END
)
WHERE discount_percentage IS NULL OR discount_percentage = 0;

-- Keep future writes consistent.
ALTER TABLE quotes
  ALTER COLUMN discount_percentage SET DEFAULT 0,
  ALTER COLUMN discount_percentage SET NOT NULL;

