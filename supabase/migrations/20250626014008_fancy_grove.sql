/*
  # Fix Policy Conflicts - Clean Migration

  This migration safely handles existing policies by dropping them first,
  then recreating everything with proper error handling.

  1. Drop all existing policies safely
  2. Recreate all tables with IF NOT EXISTS
  3. Create all policies with unique names
  4. Add proper indexes and triggers
*/

-- Drop all existing policies safely (won't error if they don't exist)
DO $$ 
BEGIN
  -- Drop user_profiles policies
  DROP POLICY IF EXISTS "Users can read own profile" ON user_profiles;
  DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
  DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
  DROP POLICY IF EXISTS "user_profiles_select_own" ON user_profiles;
  DROP POLICY IF EXISTS "user_profiles_update_own" ON user_profiles;
  DROP POLICY IF EXISTS "user_profiles_insert_own" ON user_profiles;

  -- Drop trading_prompts policies
  DROP POLICY IF EXISTS "Users can read own prompts" ON trading_prompts;
  DROP POLICY IF EXISTS "Users can insert own prompts" ON trading_prompts;
  DROP POLICY IF EXISTS "Users can update own prompts" ON trading_prompts;
  DROP POLICY IF EXISTS "trading_prompts_select_own" ON trading_prompts;
  DROP POLICY IF EXISTS "trading_prompts_insert_own" ON trading_prompts;
  DROP POLICY IF EXISTS "trading_prompts_update_own" ON trading_prompts;

  -- Drop trade_records policies
  DROP POLICY IF EXISTS "Users can read own trades" ON trade_records;
  DROP POLICY IF EXISTS "Users can insert own trades" ON trade_records;
  DROP POLICY IF EXISTS "Users can update own trades" ON trade_records;
  DROP POLICY IF EXISTS "trade_records_select_own" ON trade_records;
  DROP POLICY IF EXISTS "trade_records_insert_own" ON trade_records;
  DROP POLICY IF EXISTS "trade_records_update_own" ON trade_records;

  -- Drop journal_entries policies
  DROP POLICY IF EXISTS "Users can read own journal" ON journal_entries;
  DROP POLICY IF EXISTS "Users can insert own journal entries" ON journal_entries;
  DROP POLICY IF EXISTS "journal_entries_select_own" ON journal_entries;
  DROP POLICY IF EXISTS "journal_entries_insert_own" ON journal_entries;

  -- Drop trading_sessions policies
  DROP POLICY IF EXISTS "Users can read own sessions" ON trading_sessions;
  DROP POLICY IF EXISTS "Users can insert own sessions" ON trading_sessions;
  DROP POLICY IF EXISTS "Users can update own sessions" ON trading_sessions;
  DROP POLICY IF EXISTS "trading_sessions_select_own" ON trading_sessions;
  DROP POLICY IF EXISTS "trading_sessions_insert_own" ON trading_sessions;
  DROP POLICY IF EXISTS "trading_sessions_update_own" ON trading_sessions;

EXCEPTION
  WHEN OTHERS THEN
    -- Ignore any errors from dropping non-existent policies
    NULL;
END $$;

-- Create all tables with IF NOT EXISTS (safe to run multiple times)
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta', 'premium')),
  account_balance decimal(15,2) DEFAULT 10000.00,
  risk_profile text DEFAULT 'auto' CHECK (risk_profile IN ('low', 'medium', 'high', 'auto')),
  trading_preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  prompt_text text NOT NULL,
  account_balance decimal(15,2) NOT NULL,
  market_data jsonb,
  strategies_generated jsonb DEFAULT '[]',
  selected_strategy jsonb,
  ai_confidence text CHECK (ai_confidence IN ('high', 'medium', 'low')),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'completed', 'executed', 'failed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  prompt_id uuid REFERENCES trading_prompts(id) ON DELETE SET NULL,
  symbol text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  lot_size decimal(10,2) NOT NULL,
  entry_price decimal(15,5) NOT NULL,
  current_price decimal(15,5),
  stop_loss decimal(15,5),
  take_profit decimal(15,5),
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'closed', 'cancelled')),
  pnl decimal(15,2) DEFAULT 0.00,
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  mt5_ticket text,
  trade_metadata jsonb DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trade_records(id) ON DELETE SET NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('trade_entry', 'trade_exit', 'market_update', 'ai_decision', 'modification')),
  title text NOT NULL,
  content text NOT NULL,
  confidence_level text CHECK (confidence_level IN ('high', 'medium', 'low')),
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES user_profiles(id) ON DELETE CASCADE,
  session_start timestamptz DEFAULT now(),
  session_end timestamptz,
  total_trades integer DEFAULT 0,
  total_pnl decimal(15,2) DEFAULT 0.00,
  session_metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta')),
  referral_code text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security (safe to run multiple times)
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;

-- Create all policies with completely unique names to avoid conflicts
CREATE POLICY "pipnosis_user_profiles_read" ON user_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

CREATE POLICY "pipnosis_user_profiles_write" ON user_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "pipnosis_user_profiles_create" ON user_profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "pipnosis_trading_prompts_read" ON trading_prompts
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_trading_prompts_create" ON trading_prompts
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipnosis_trading_prompts_write" ON trading_prompts
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_trade_records_read" ON trade_records
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_trade_records_create" ON trade_records
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipnosis_trade_records_write" ON trade_records
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_journal_entries_read" ON journal_entries
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_journal_entries_create" ON journal_entries
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipnosis_trading_sessions_read" ON trading_sessions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "pipnosis_trading_sessions_create" ON trading_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "pipnosis_trading_sessions_write" ON trading_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Create indexes (IF NOT EXISTS prevents errors)
CREATE INDEX IF NOT EXISTS idx_trading_prompts_user_id ON trading_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_prompts_created_at ON trading_prompts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_records_user_id ON trade_records(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_records_status ON trade_records(status);
CREATE INDEX IF NOT EXISTS idx_trade_records_opened_at ON trade_records(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Create or replace the update function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Drop existing triggers if they exist, then recreate
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
DROP TRIGGER IF EXISTS update_trading_prompts_updated_at ON trading_prompts;

CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_trading_prompts_updated_at
  BEFORE UPDATE ON trading_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Success message
DO $$
BEGIN
  RAISE NOTICE 'Pipnosis database migration completed successfully! All tables, policies, and indexes are now properly configured.';
END $$;