-- Payment tracking for completed bookings
ALTER TABLE booking_occurrences
ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'waiting_payment'
  CHECK (payment_status IN ('waiting_payment', 'invoice_sent', 'paid')),
ADD COLUMN IF NOT EXISTS payment_link text,
ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
ADD COLUMN IF NOT EXISTS payment_notes text;

CREATE INDEX IF NOT EXISTS idx_booking_occurrences_payment_status ON booking_occurrences(payment_status);

