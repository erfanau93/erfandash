-- Add coordinate columns to quotes so dispatch can use Mapbox-derived pins.
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS address_lat double precision,
  ADD COLUMN IF NOT EXISTS address_lng double precision;

CREATE INDEX IF NOT EXISTS idx_quotes_address_latlng ON quotes(address_lat, address_lng);
CREATE INDEX IF NOT EXISTS idx_quotes_lead_id_created_at ON quotes(lead_id, created_at DESC);




