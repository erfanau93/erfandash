-- Link each booking series to the quote that was used to win/confirm it.
-- This enables the UI to show the correct price/service/add-ons even when
-- multiple quotes exist for the same lead.
ALTER TABLE booking_series
  ADD COLUMN IF NOT EXISTS quote_id uuid REFERENCES quotes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_series_quote_id ON booking_series(quote_id);


