-- Keep booking_series address/coords + quote link in sync whenever a quote is saved.
-- Prefers the series already linked to the quote, otherwise the newest unlinked series
-- for the same lead (or the sole series if only one exists).
CREATE OR REPLACE FUNCTION sync_booking_series_from_quote()
RETURNS TRIGGER AS $$
DECLARE
  target_series uuid;
  series_count integer;
BEGIN
  IF NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO series_count FROM booking_series WHERE lead_id = NEW.lead_id;

  -- 1) If this quote is already linked, update that series.
  SELECT id INTO target_series
  FROM booking_series
  WHERE lead_id = NEW.lead_id
    AND quote_id = NEW.id
  LIMIT 1;

  -- 2) Otherwise, pick the most recent unlinked series.
  IF target_series IS NULL THEN
    SELECT id INTO target_series
    FROM booking_series
    WHERE lead_id = NEW.lead_id
      AND quote_id IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  -- 3) If there's exactly one series for this lead, allow re-linking to this quote.
  IF target_series IS NULL AND series_count = 1 THEN
    SELECT id INTO target_series
    FROM booking_series
    WHERE lead_id = NEW.lead_id
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF target_series IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE booking_series
  SET
    quote_id = NEW.id,
    service_address = COALESCE(NULLIF(TRIM(NEW.address), ''), service_address),
    service_lat = COALESCE(NEW.address_lat, service_lat),
    service_lng = COALESCE(NEW.address_lng, service_lng)
  WHERE id = target_series;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_booking_series_from_quote ON quotes;
CREATE TRIGGER trg_sync_booking_series_from_quote
AFTER INSERT OR UPDATE ON quotes
FOR EACH ROW
EXECUTE FUNCTION sync_booking_series_from_quote();

