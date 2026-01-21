CREATE TABLE IF NOT EXISTS daily_summary_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_date date NOT NULL UNIQUE,
  timezone text NOT NULL DEFAULT 'Australia/Sydney',
  sent_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb
);
