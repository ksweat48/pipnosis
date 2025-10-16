/*
  ═══════════════════════════════════════════════════════════════════════════
  PIPNOSIS AI TRADING PLATFORM - CONSOLIDATED DATABASE MIGRATION
  ═══════════════════════════════════════════════════════════════════════════

  This consolidated migration combines all database schema changes needed
  for the Pipnosis AI Trading platform with Auto Trading functionality.

  IMPORTANT: This script is IDEMPOTENT and can be safely run multiple times.
  All policies, triggers, and functions will be dropped and recreated.

  What this migration creates:
  1. Core user and trading tables
  2. Market data storage for live price caching
  3. Auto trading status and preferences tables
  4. AI trading brain tables (decisions, options, learning metrics)
  5. Admin role system with analytics views
  6. All necessary RLS policies for security
  7. Performance indexes
  8. Triggers for automatic updates

  After running this script:
  - Go to Table Editor > user_profiles
  - Find your user record
  - Set is_admin = true for your account
  - Refresh your application

  ═══════════════════════════════════════════════════════════════════════════
*/

-- ============================================================================
-- SECTION 1: CORE TABLES
-- ============================================================================

-- User Profiles Table
CREATE TABLE IF NOT EXISTS user_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  avatar_url text,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta', 'premium')),
  account_balance decimal(15,2) DEFAULT 10000.00,
  risk_profile text DEFAULT 'auto' CHECK (risk_profile IN ('low', 'medium', 'high', 'auto')),
  trading_preferences jsonb DEFAULT '{}',
  is_admin boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Trading Prompts Table
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

-- Trade Records Table
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

-- Journal Entries Table
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

-- Trading Sessions Table
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

-- Waitlist Table
CREATE TABLE IF NOT EXISTS waitlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  plan_type text DEFAULT 'free' CHECK (plan_type IN ('free', 'beta')),
  referral_code text,
  metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SECTION 2: MARKET DATA TABLES
-- ============================================================================

-- Market Data Table (for live price caching)
CREATE TABLE IF NOT EXISTS market_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  timestamp timestamptz NOT NULL,
  open numeric(20, 8) NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(20, 8) DEFAULT 0,
  tick_volume integer DEFAULT 0,
  spread integer DEFAULT 0,
  broker_time timestamptz,
  data_source text DEFAULT 'metaapi',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe, timestamp)
);

-- Market Data Subscriptions Table
CREATE TABLE IF NOT EXISTS market_data_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  last_update timestamptz DEFAULT now(),
  status text DEFAULT 'active',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

-- ============================================================================
-- SECTION 3: AUTO TRADING TABLES
-- ============================================================================

-- Auto Trading Status Table
CREATE TABLE IF NOT EXISTS auto_trading_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean DEFAULT false,
  trades_taken_today integer DEFAULT 0,
  max_daily_trades integer DEFAULT 6,
  last_scan_time timestamptz,
  last_trade_time timestamptz,
  opportunity_window_start timestamptz,
  opportunity_window_end timestamptz,
  scanning_active boolean DEFAULT false,
  last_opportunity_found timestamptz,
  consecutive_no_opportunity_count integer DEFAULT 0,
  daily_pnl numeric DEFAULT 0,
  daily_loss_limit numeric DEFAULT -500,
  emergency_stop boolean DEFAULT false,
  continuous_mode boolean DEFAULT false,
  learning_mode boolean DEFAULT true,
  total_trades_executed integer DEFAULT 0,
  started_by_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  learning_session_id uuid DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- User Trading Preferences Table
CREATE TABLE IF NOT EXISTS user_trading_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  risk_tolerance text DEFAULT 'medium' CHECK (risk_tolerance IN ('low', 'medium', 'high')),
  preferred_pairs text[] DEFAULT ARRAY['EURUSD', 'GBPUSD', 'XAUUSD'],
  max_position_size numeric DEFAULT 1.0,
  default_risk_per_trade numeric DEFAULT 2.0,
  auto_trading_enabled boolean DEFAULT false,
  auto_trading_hours_start time DEFAULT '00:00:00',
  auto_trading_hours_end time DEFAULT '23:59:59',
  min_confidence_threshold integer DEFAULT 75 CHECK (min_confidence_threshold >= 0 AND min_confidence_threshold <= 100),
  allow_ai_override boolean DEFAULT true,
  allow_hybrid_strategy boolean DEFAULT true,
  notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SECTION 4: AI TRADING BRAIN TABLES
-- ============================================================================

-- AI Trade Decisions Table
CREATE TABLE IF NOT EXISTS ai_trade_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  decision_type text NOT NULL CHECK (decision_type IN ('manual', 'auto')),
  chatgpt_prompt text NOT NULL,
  chatgpt_response jsonb NOT NULL,
  market_context jsonb NOT NULL,
  trade_direction text CHECK (trade_direction IN ('BUY', 'SELL')),
  confidence_score integer CHECK (confidence_score >= 0 AND confidence_score <= 100),
  strategy_used text NOT NULL,
  reasoning text NOT NULL,
  approved boolean DEFAULT false,
  executed boolean DEFAULT false,
  trade_id uuid REFERENCES trade_records(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  executed_at timestamptz
);

-- Trade Options Table (3 risk variants)
CREATE TABLE IF NOT EXISTS trade_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL REFERENCES ai_trade_decisions(id) ON DELETE CASCADE,
  option_type text NOT NULL CHECK (option_type IN ('low_risk', 'medium_risk', 'high_risk')),
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  lot_size numeric NOT NULL,
  estimated_profit numeric NOT NULL,
  estimated_loss numeric NOT NULL,
  risk_reward_ratio numeric NOT NULL,
  confidence integer CHECK (confidence >= 0 AND confidence <= 100),
  reasoning text NOT NULL,
  selected boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Strategy Comparison Table
CREATE TABLE IF NOT EXISTS strategy_comparison (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  fxflow_signal jsonb,
  ai_independent_signal jsonb,
  hybrid_signal jsonb,
  strategy_selected text NOT NULL CHECK (strategy_selected IN ('fxflow_baseline', 'ai_independent', 'hybrid')),
  selection_reason text NOT NULL,
  fxflow_confidence integer,
  ai_confidence integer,
  hybrid_confidence integer,
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven', 'pending')),
  pnl numeric,
  created_at timestamptz DEFAULT now(),
  outcome_recorded_at timestamptz
);

-- AI Learning Metrics Table
CREATE TABLE IF NOT EXISTS ai_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid REFERENCES trade_records(id) ON DELETE CASCADE,
  decision_id uuid REFERENCES ai_trade_decisions(id) ON DELETE CASCADE,
  strategy_used text NOT NULL,
  predicted_confidence integer NOT NULL,
  actual_outcome text NOT NULL CHECK (actual_outcome IN ('win', 'loss', 'breakeven', 'pending')),
  predicted_pnl numeric,
  actual_pnl numeric,
  accuracy_score numeric,
  market_conditions jsonb NOT NULL,
  indicators_used jsonb NOT NULL,
  lessons_learned text,
  created_at timestamptz DEFAULT now()
);

-- ============================================================================
-- SECTION 5: INDEXES FOR PERFORMANCE
-- ============================================================================

-- User Profiles Indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_is_admin ON user_profiles(is_admin) WHERE is_admin = true;
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- Trading Prompts Indexes
CREATE INDEX IF NOT EXISTS idx_trading_prompts_user_id ON trading_prompts(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_prompts_created_at ON trading_prompts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_prompts_confidence ON trading_prompts(ai_confidence);

-- Trade Records Indexes
CREATE INDEX IF NOT EXISTS idx_trade_records_user_id ON trade_records(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_records_status ON trade_records(status);
CREATE INDEX IF NOT EXISTS idx_trade_records_opened_at ON trade_records(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_records_pnl ON trade_records(pnl);
CREATE INDEX IF NOT EXISTS idx_trade_records_symbol_status ON trade_records(symbol, status);

-- Journal Entries Indexes
CREATE INDEX IF NOT EXISTS idx_journal_entries_user_id ON journal_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_created_at ON journal_entries(created_at DESC);

-- Trading Sessions Indexes
CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);

-- Waitlist Indexes
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist(created_at DESC);

-- Market Data Indexes
CREATE INDEX IF NOT EXISTS idx_market_data_symbol_timeframe_timestamp
  ON market_data(symbol, timeframe, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_symbol ON market_data(symbol);
CREATE INDEX IF NOT EXISTS idx_market_data_timeframe ON market_data(timeframe);
CREATE INDEX IF NOT EXISTS idx_market_data_timestamp ON market_data(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_market_data_created_at ON market_data(created_at DESC);

-- Market Data Subscriptions Index
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON market_data_subscriptions(status);

-- Auto Trading Status Indexes
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_user_id ON auto_trading_status(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_enabled ON auto_trading_status(enabled);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_scanning_active ON auto_trading_status(scanning_active);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_continuous_mode ON auto_trading_status(continuous_mode);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_learning_mode ON auto_trading_status(learning_mode);

-- User Trading Preferences Index
CREATE INDEX IF NOT EXISTS idx_user_trading_preferences_user_id ON user_trading_preferences(user_id);

-- AI Trade Decisions Indexes
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_user_id ON ai_trade_decisions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_created_at ON ai_trade_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_decision_type ON ai_trade_decisions(decision_type);
CREATE INDEX IF NOT EXISTS idx_ai_trade_decisions_executed ON ai_trade_decisions(executed);

-- Trade Options Indexes
CREATE INDEX IF NOT EXISTS idx_trade_options_user_id ON trade_options(user_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_decision_id ON trade_options(decision_id);
CREATE INDEX IF NOT EXISTS idx_trade_options_selected ON trade_options(selected);

-- Strategy Comparison Indexes
CREATE INDEX IF NOT EXISTS idx_strategy_comparison_user_id ON strategy_comparison(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_comparison_created_at ON strategy_comparison(created_at DESC);

-- AI Learning Metrics Indexes
CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_user_id ON ai_learning_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_learning_metrics_trade_id ON ai_learning_metrics(trade_id);

-- ============================================================================
-- SECTION 6: ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_data_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_trade_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trade_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_comparison ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_learning_metrics ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to ensure clean state
DROP POLICY IF EXISTS "Users can view own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON user_profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON user_profiles;
DROP POLICY IF EXISTS "Admins can view all profiles" ON user_profiles;
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
DROP POLICY IF EXISTS "Anyone can read market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can insert market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can update market data" ON market_data;
DROP POLICY IF EXISTS "Authenticated users can read subscriptions" ON market_data_subscriptions;
DROP POLICY IF EXISTS "Authenticated users can manage subscriptions" ON market_data_subscriptions;
DROP POLICY IF EXISTS "Users can view own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can create own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can update own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can view own trading preferences" ON user_trading_preferences;
DROP POLICY IF EXISTS "Users can create own trading preferences" ON user_trading_preferences;
DROP POLICY IF EXISTS "Users can update own trading preferences" ON user_trading_preferences;
DROP POLICY IF EXISTS "Users can view own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can create own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can update own AI trade decisions" ON ai_trade_decisions;
DROP POLICY IF EXISTS "Users can view own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can create own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can update own trade options" ON trade_options;
DROP POLICY IF EXISTS "Users can view own strategy comparisons" ON strategy_comparison;
DROP POLICY IF EXISTS "Users can create own strategy comparisons" ON strategy_comparison;
DROP POLICY IF EXISTS "Users can view own AI learning metrics" ON ai_learning_metrics;
DROP POLICY IF EXISTS "Users can create own AI learning metrics" ON ai_learning_metrics;

-- User Profiles Policies
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

-- Admin Policy for User Profiles (REMOVED - caused infinite recursion)
-- Users can already read their own profile including is_admin field via "Users can view own profile" policy
-- Admin features in application code will verify admin status after reading the profile

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

-- Market Data Policies (public read, authenticated write)
CREATE POLICY "Anyone can read market data"
  ON market_data FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert market data"
  ON market_data FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update market data"
  ON market_data FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Market Data Subscriptions Policies
CREATE POLICY "Authenticated users can read subscriptions"
  ON market_data_subscriptions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can manage subscriptions"
  ON market_data_subscriptions FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Auto Trading Status Policies
CREATE POLICY "Users can view own auto trading status"
  ON auto_trading_status FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own auto trading status"
  ON auto_trading_status FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto trading status"
  ON auto_trading_status FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- User Trading Preferences Policies
CREATE POLICY "Users can view own trading preferences"
  ON user_trading_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trading preferences"
  ON user_trading_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trading preferences"
  ON user_trading_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- AI Trade Decisions Policies
CREATE POLICY "Users can view own AI trade decisions"
  ON ai_trade_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own AI trade decisions"
  ON ai_trade_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own AI trade decisions"
  ON ai_trade_decisions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trade Options Policies
CREATE POLICY "Users can view own trade options"
  ON trade_options FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own trade options"
  ON trade_options FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trade options"
  ON trade_options FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Strategy Comparison Policies
CREATE POLICY "Users can view own strategy comparisons"
  ON strategy_comparison FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own strategy comparisons"
  ON strategy_comparison FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- AI Learning Metrics Policies
CREATE POLICY "Users can view own AI learning metrics"
  ON ai_learning_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own AI learning metrics"
  ON ai_learning_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- SECTION 7: FUNCTIONS AND TRIGGERS
-- ============================================================================

-- Function to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
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

DROP TRIGGER IF EXISTS market_data_updated_at ON market_data;
CREATE TRIGGER market_data_updated_at
  BEFORE UPDATE ON market_data
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON market_data_subscriptions;
CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON market_data_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Function to auto-create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (
    id,
    email,
    full_name,
    plan_type,
    account_balance,
    risk_profile,
    trading_preferences,
    is_admin
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'free',
    10000.00,
    'auto',
    '{}'::jsonb,
    NEW.email = ANY(ARRAY['ksweat48@gmail.com', 'admin@pipnosis.com'])
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for auto-creating user profiles
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Function to reset daily auto trading counts
CREATE OR REPLACE FUNCTION reset_daily_auto_trading_counts()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Only reset for non-continuous mode (future regular users)
  UPDATE auto_trading_status
  SET
    trades_taken_today = 0,
    daily_pnl = 0,
    consecutive_no_opportunity_count = 0,
    emergency_stop = false,
    updated_at = now()
  WHERE enabled = true
    AND continuous_mode = false;
END;
$$;

-- Function to update auto trading status timestamp
CREATE OR REPLACE FUNCTION update_auto_trading_status_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_auto_trading_status_timestamp ON auto_trading_status;
CREATE TRIGGER trigger_update_auto_trading_status_timestamp
  BEFORE UPDATE ON auto_trading_status
  FOR EACH ROW
  EXECUTE FUNCTION update_auto_trading_status_timestamp();

-- Function to update user trading preferences timestamp
CREATE OR REPLACE FUNCTION update_user_trading_preferences_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_user_trading_preferences_timestamp ON user_trading_preferences;
CREATE TRIGGER trigger_update_user_trading_preferences_timestamp
  BEFORE UPDATE ON user_trading_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_user_trading_preferences_timestamp();

-- ============================================================================
-- SECTION 8: ANALYTICS VIEWS (FOR ADMIN DASHBOARD)
-- ============================================================================

-- Platform-wide statistics view
CREATE OR REPLACE VIEW platform_statistics AS
SELECT
  COUNT(DISTINCT up.id) as total_users,
  COUNT(DISTINCT CASE WHEN tr.status = 'open' THEN up.id END) as active_traders,
  COUNT(tr.id) as total_trades,
  COUNT(CASE WHEN tr.status = 'open' THEN 1 END) as open_positions,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as closed_positions,
  COALESCE(SUM(tr.pnl), 0) as total_platform_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_trade_pnl,
  COALESCE(SUM(up.account_balance), 0) as total_platform_balance,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric /
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0
  END as win_rate_percentage
FROM user_profiles up
LEFT JOIN trade_records tr ON tr.user_id = up.id;

-- User trading summary view
CREATE OR REPLACE VIEW user_trading_summary AS
SELECT
  up.id as user_id,
  up.email,
  up.full_name,
  up.account_balance,
  up.plan_type,
  up.created_at as user_since,
  COUNT(tr.id) as total_trades,
  COUNT(CASE WHEN tr.status = 'open' THEN 1 END) as open_positions,
  COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) as closed_trades,
  COALESCE(SUM(tr.pnl), 0) as total_pnl,
  COALESCE(AVG(tr.pnl) FILTER (WHERE tr.status = 'closed'), 0) as avg_pnl_per_trade,
  COALESCE(MAX(tr.pnl), 0) as best_trade,
  COALESCE(MIN(tr.pnl), 0) as worst_trade,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END) as winning_trades,
  COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl < 0 THEN 1 END) as losing_trades,
  CASE
    WHEN COUNT(CASE WHEN tr.status = 'closed' THEN 1 END) > 0
    THEN ROUND(
      (COUNT(CASE WHEN tr.status = 'closed' AND tr.pnl > 0 THEN 1 END)::numeric /
       COUNT(CASE WHEN tr.status = 'closed' THEN 1 END)::numeric * 100), 2
    )
    ELSE 0
  END as win_rate
FROM user_profiles up
LEFT JOIN trade_records tr ON tr.user_id = up.id
GROUP BY up.id, up.email, up.full_name, up.account_balance, up.plan_type, up.created_at;

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '🎉 PIPNOSIS DATABASE MIGRATION COMPLETED SUCCESSFULLY! 🎉';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'All tables, indexes, policies, and triggers have been created.';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Go to Table Editor > user_profiles in Supabase Dashboard';
  RAISE NOTICE '2. Find your user record by email';
  RAISE NOTICE '3. Set is_admin = true for your account';
  RAISE NOTICE '4. Refresh your Pipnosis application';
  RAISE NOTICE '5. The Auto Trading button should now work!';
  RAISE NOTICE '';
  RAISE NOTICE 'Your database is ready for Pipnosis AI Trading Platform.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
