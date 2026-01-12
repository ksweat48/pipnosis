/*
  # Trading Core RLS Policies

  1. Enable RLS on trading tables
  2. Create user-scoped policies for:
    - trading_prompts
    - trade_records
    - journal_entries
    - trading_sessions
*/

-- Enable RLS on all trading tables
ALTER TABLE trading_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can insert own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can update own prompts" ON trading_prompts;
DROP POLICY IF EXISTS "Users can view own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can insert own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can update own trades" ON trade_records;
DROP POLICY IF EXISTS "Users can view own journal" ON journal_entries;
DROP POLICY IF EXISTS "Users can insert own journal entries" ON journal_entries;
DROP POLICY IF EXISTS "Users can view own sessions" ON trading_sessions;
DROP POLICY IF EXISTS "Users can insert own sessions" ON trading_sessions;
DROP POLICY IF EXISTS "Users can update own sessions" ON trading_sessions;

-- Trading Prompts Policies
CREATE POLICY "Users can view own prompts"
  ON trading_prompts FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prompts"
  ON trading_prompts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prompts"
  ON trading_prompts FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trade Records Policies
CREATE POLICY "Users can view own trades"
  ON trade_records FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trades"
  ON trade_records FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trades"
  ON trade_records FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Journal Entries Policies
CREATE POLICY "Users can view own journal"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own journal entries"
  ON journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Trading Sessions Policies
CREATE POLICY "Users can view own sessions"
  ON trading_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sessions"
  ON trading_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sessions"
  ON trading_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);