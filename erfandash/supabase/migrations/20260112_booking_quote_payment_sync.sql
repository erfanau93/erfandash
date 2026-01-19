-- Ensure bookings are tied to the quote that generated them and keep payment state in sync.

-- 1) Guarantee the FK exists (idempotent).
ALTER TABLE booking_series
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_series_quote_id ON booking_series(quote_id);

-- 2) Optional backfill: for any series without a quote_id, attach the latest quote for the same lead.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_name = 'quotes'
  ) THEN
    UPDATE booking_series bs
    SET quote_id = q.id
    FROM (
      SELECT DISTINCT ON (lead_id) id, lead_id, created_at
      FROM quotes
      ORDER BY lead_id, created_at DESC
    ) q
    WHERE bs.quote_id IS NULL
      AND bs.lead_id = q.lead_id;
  END IF;
END;
$$;

-- Align existing occurrences with already-paid quotes.
UPDATE booking_occurrences bo
SET payment_status = 'paid',
    payment_paid_at = COALESCE(bo.payment_paid_at, now()),
    payment_notes = COALESCE(bo.payment_notes, 'Auto-set from quote payment')
FROM booking_series bs
JOIN quotes q ON q.id = bs.quote_id
WHERE bo.series_id = bs.id
  AND q.accepted_payment_method = 'card_paid'
  AND bo.payment_status <> 'paid';

-- 3) When a quote is marked as card-paid, mark all related occurrences as paid.
CREATE OR REPLACE FUNCTION mark_occurrences_paid_from_quote()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.accepted_payment_method = 'card_paid' THEN
    UPDATE booking_occurrences bo
    SET payment_status = 'paid',
        payment_paid_at = COALESCE(bo.payment_paid_at, now()),
        payment_notes = COALESCE(bo.payment_notes, 'Auto-set from quote payment')
    FROM booking_series bs
    WHERE bo.series_id = bs.id
      AND bs.quote_id = NEW.id
      AND bo.payment_status <> 'paid';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mark_occurrences_paid_from_quote ON quotes;
CREATE TRIGGER trg_mark_occurrences_paid_from_quote
AFTER UPDATE OF accepted_payment_method ON quotes
FOR EACH ROW
WHEN (NEW.accepted_payment_method IS DISTINCT FROM OLD.accepted_payment_method)
EXECUTE FUNCTION mark_occurrences_paid_from_quote();

-- 3b) When an occurrence is marked paid, reflect that on its quote.
CREATE OR REPLACE FUNCTION sync_quote_paid_from_occurrence()
RETURNS TRIGGER AS $$
DECLARE
  quote uuid;
BEGIN
  SELECT quote_id INTO quote FROM booking_series WHERE id = NEW.series_id;

  IF quote IS NOT NULL AND NEW.payment_status = 'paid' THEN
    UPDATE quotes
    SET accepted_payment_method = 'card_paid'
    WHERE id = quote
      AND accepted_payment_method IS DISTINCT FROM 'card_paid';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_quote_paid_from_occurrence ON booking_occurrences;
CREATE TRIGGER trg_sync_quote_paid_from_occurrence
AFTER UPDATE OF payment_status ON booking_occurrences
FOR EACH ROW
WHEN (NEW.payment_status IS DISTINCT FROM OLD.payment_status)
EXECUTE FUNCTION sync_quote_paid_from_occurrence();

-- Backfill quotes as paid if any linked occurrences are already marked paid.
UPDATE quotes q
SET accepted_payment_method = 'card_paid'
FROM booking_series bs
JOIN booking_occurrences bo ON bo.series_id = bs.id
WHERE bs.quote_id = q.id
  AND bo.payment_status = 'paid'
  AND q.accepted_payment_method IS DISTINCT FROM 'card_paid';

-- 4) If a series is tied to an already-paid quote, new occurrences inherit the paid state.
CREATE OR REPLACE FUNCTION set_occ_payment_from_quote()
RETURNS TRIGGER AS $$
DECLARE
  quote_paid boolean;
BEGIN
  SELECT q.accepted_payment_method = 'card_paid'
  INTO quote_paid
  FROM booking_series bs
  JOIN quotes q ON q.id = bs.quote_id
  WHERE bs.id = NEW.series_id;

  IF quote_paid THEN
    NEW.payment_status := 'paid';
    IF NEW.payment_paid_at IS NULL THEN
      NEW.payment_paid_at := now();
    END IF;
    IF NEW.payment_notes IS NULL THEN
      NEW.payment_notes := 'Auto-set from quote payment';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_occ_payment_from_quote ON booking_occurrences;
CREATE TRIGGER trg_set_occ_payment_from_quote
BEFORE INSERT ON booking_occurrences
FOR EACH ROW EXECUTE FUNCTION set_occ_payment_from_quote();


