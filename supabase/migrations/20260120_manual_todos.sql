-- =====================================================
-- MANUAL TODOS
-- =====================================================

CREATE TABLE IF NOT EXISTS todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('lead_status', 'unassigned_job', 'past_due_unpaid', 'cleaner_payout', 'manual')),
  reference_id uuid,
  reference_type text,
  title text NOT NULL,
  description text,
  is_completed boolean NOT NULL DEFAULT false,
  due_date date,
  auto_generated boolean NOT NULL DEFAULT false,
  roll_over boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  dismissed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_todos_type ON todos(type);
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(is_completed);
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos(created_at DESC);

-- updated_at trigger
DROP TRIGGER IF EXISTS update_todos_updated_at ON todos;
CREATE TRIGGER update_todos_updated_at
  BEFORE UPDATE ON todos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: matches current project pattern (allow all). Tighten later with auth.
ALTER TABLE todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all for todos" ON todos;
CREATE POLICY "Allow all for todos" ON todos
  FOR ALL USING (true) WITH CHECK (true);
