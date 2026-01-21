-- Update quote/occurrence payment sync to use occurrence-level quote variants

-- Align existing occurrences with already-paid quotes (by direct quote linkage).
UPDATE booking_occurrences bo
SET payment_status = 'paid',
    payment_paid_at = COALESCE(bo.payment_paid_at, now()),
    payment_notes = COALESCE(bo.payment_notes, 'Auto-set from quote payment')
FROM quotes q
WHERE bo.quote_id = q.id
  AND q.accepted_payment_method = 'card_paid'
  AND bo.payment_status <> 'paid';

-- Quote paid -> linked occurrences paid (only those explicitly tied to the quote).
CREATE OR REPLACE FUNCTION mark_occurrences_paid_from_quote()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.accepted_payment_method = 'card_paid' THEN
    UPDATE booking_occurrences bo
    SET payment_status = 'paid',
        payment_paid_at = COALESCE(bo.payment_paid_at, now()),
        payment_notes = COALESCE(bo.payment_notes, 'Auto-set from quote payment')
    WHERE bo.quote_id = NEW.id
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

-- Occurrence paid -> linked quote paid (occurrence-level quote; fallback to series quote for legacy).
CREATE OR REPLACE FUNCTION sync_quote_paid_from_occurrence()
RETURNS TRIGGER AS $$
DECLARE
  quote uuid;
BEGIN
  SELECT COALESCE(NEW.quote_id, bs.quote_id)
  INTO quote
  FROM booking_series bs
  WHERE bs.id = NEW.series_id;

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

-- New occurrences inherit paid state only if their linked quote is already paid.
CREATE OR REPLACE FUNCTION set_occ_payment_from_quote()
RETURNS TRIGGER AS $$
DECLARE
  quote_paid boolean;
BEGIN
  IF NEW.quote_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT q.accepted_payment_method = 'card_paid'
  INTO quote_paid
  FROM quotes q
  WHERE q.id = NEW.quote_id;

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
