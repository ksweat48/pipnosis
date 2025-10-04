/*
  # Initial Pipnosis Schema Setup

  1. New Tables
    - `user_profiles` - User account and trading configuration
      - `id` (uuid, primary key, references auth.users)
      - `email` (text, unique)
      - `full_name` (text)
      - `avatar_url` (text)
      - `plan_type` (text, default 'free')
      - `account_balance` (decimal, default 10000.00)
      - `risk_profile` (text, default 'auto')
      - `trading_preferences` (jsonb)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `trading_prompts` - User trading prompts and AI analysis
      - `id` (uuid, primary key)
      - `user_id` (uuid, references user_profiles)
      - `prompt_text` (text)
      - `account_balance` (decimal)
      - `market_data` (jsonb)
      - `strategies_generated` (jsonb)
      - `selected_strategy` (jsonb)
      - `ai_confidence` (text)
      - `status` (text, default 'pending')
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `trade_records` - Executed trades and their results
      - `id` (uuid, primary key)
      - `user_id` (uuid, references user_profiles)
      - `prompt_id` (uuid, references trading_prompts)
      - `symbol` (text)
      - `trade_type` (text)
      - `lot_size` (decimal)
      - `entry_price` (decimal)
      - `current_price` (decimal)
      - `stop_loss` (decimal)
      - `take_profit` (decimal)
      - `status` (text, default 'pending')
      - `pnl` (decimal, default 0.00)
      - `opened_at` (timestamptz)
      - `closed_at` (timestamptz)
      - `mt5_ticket` (text)
      - `trade_metadata` (jsonb)

    - `journal_entries` - Trading journal and AI decision logs
      - `id` (uuid, primary key)
      - `user_id` (uuid, references user_profiles)
      - `trade_id` (uuid, references trade_records)
      - `entry_type` (text)
      - `title` (text)
      - `content` (text)
      - `confidence_level` (text)
      - `metadata` (jsonb)
      - `created_at` (timestamptz)

    - `trading_sessions` - Trading session tracking
      - `id` (uuid, primary key)
      - `user_id` (uuid, references user_profiles)
      - `session_start` (timestamptz)
      - `session_end` (timestamptz)
      - `total_trades` (integer, default 0)
      - `total_pnl` (decimal, default 0.00)
      - `session_metadata` (jsonb)
      - `created_at` (timestamptz)

    - `waitlist` - Beta access waitlist
      - `id` (uuid, primary key)
      - `email` (text, unique)
      - `plan_type` (text, default 'free')
      - `referral_code` (text)
      - `metadata` (jsonb)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for authenticated users to access their own data
    - All policies use auth.uid() for user identification

  3. Indexes
    - Add indexes for common query patterns (user_id, created_at, status)

  4. Triggers
    - Auto-update updated_at timestamps on user_profiles and trading_prompts
*/

-- Create all tables
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

-- Enable Row Level Security
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for user_profiles
CREATE POLICY "Users can view own profile"
  ON user_profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON user_profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON user_profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Create RLS policies for trading_prompts
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

-- Create RLS policies for trade_records
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

-- Create RLS policies for journal_entries
CREATE POLICY "Users can view own journal"
  ON journal_entries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own journal entries"
  ON journal_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Create RLS policies for trading_sessions
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

-- Create indexes for performance
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

-- Create function for updating updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for auto-updating timestamps
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_trading_prompts_updated_at ON trading_prompts;
CREATE TRIGGER update_trading_prompts_updated_at
  BEFORE UPDATE ON trading_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
