/*
  # Create Trading Monitors System

  ## Overview
  Creates three educational trading monitors that provide advisory intelligence
  to users without affecting Alpha's autonomous trading decisions.

  ## New Tables

  1. `user_monitor_preferences`
     - `user_id` (uuid, references auth.users)
     - `entry_price_monitor_enabled` (boolean)
     - `session_intelligence_enabled` (boolean)
     - `vwap_kiss_monitor_enabled` (boolean)
     - `created_at`, `updated_at` (timestamptz)

  2. `entry_price_recommendations`
     - `id` (uuid, primary key)
     - `user_id` (uuid, references auth.users)
     - `trade_id` (uuid, references goal_session_trades)
     - `symbol` (text)
     - `direction` (text - 'buy' or 'sell')
     - `alpha_entry_price` (numeric) - Price Alpha executed at
     - `optimal_entry_price` (numeric) - Recommended entry price
     - `pullback_zone_low` (numeric)
     - `pullback_zone_high` (numeric)
     - `pattern_type` (text) - e.g., 'retracement', 'bounce', 'breakout_pullback'
     - `confidence_score` (numeric) - 0-100
     - `reasoning` (text)
     - `created_at` (timestamptz)

  3. `session_intelligence_data`
     - `id` (uuid, primary key)
     - `session_name` (text) - 'London', 'New York', 'Asian'
     - `session_start_hour` (integer) - EST/EDT hour
     - `session_end_hour` (integer)
     - `best_pairs` (jsonb) - Array of {symbol, confidence, reasoning}
     - `market_condition` (text) - 'trending', 'ranging', 'volatile', 'quiet'
     - `is_tradable` (boolean)
     - `recommendation_text` (text)
     - `created_at` (timestamptz)
     - `expires_at` (timestamptz)

  4. `vwap_kiss_signals`
     - `id` (uuid, primary key)
     - `symbol` (text)
     - `current_price` (numeric)
     - `vwap_price` (numeric)
     - `distance_percent` (numeric) - Distance from VWAP
     - `signal_strength` (text) - 'hot', 'good', 'watch'
     - `direction_bias` (text) - 'bullish', 'bearish', 'neutral'
     - `scalp_opportunity_score` (numeric) - 0-100
     - `entry_suggestion` (numeric)
     - `exit_suggestion` (numeric)
     - `reasoning` (text)
     - `created_at` (timestamptz)
     - `expires_at` (timestamptz)

  ## Security
  - RLS enabled on all tables
  - Users can only access their own monitor preferences and recommendations
  - Session intelligence and VWAP signals are public (all authenticated users can read)

  ## Advisory-Only Guarantee
  - These tables are completely separate from core trading execution
  - No triggers or functions that modify trading logic
  - Read-only display data for educational purposes
*/

-- 1. User Monitor Preferences Table
CREATE TABLE IF NOT EXISTS user_monitor_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_price_monitor_enabled boolean DEFAULT true NOT NULL,
  session_intelligence_enabled boolean DEFAULT true NOT NULL,
  vwap_kiss_monitor_enabled boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- RLS for user_monitor_preferences
ALTER TABLE user_monitor_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own monitor preferences"
  ON user_monitor_preferences FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own monitor preferences"
  ON user_monitor_preferences FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own monitor preferences"
  ON user_monitor_preferences FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Auto-update timestamp
CREATE TRIGGER update_user_monitor_preferences_updated_at
  BEFORE UPDATE ON user_monitor_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 2. Entry Price Recommendations Table
CREATE TABLE IF NOT EXISTS entry_price_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid REFERENCES goal_session_trades(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('buy', 'sell')),
  alpha_entry_price numeric NOT NULL CHECK (alpha_entry_price > 0),
  optimal_entry_price numeric NOT NULL CHECK (optimal_entry_price > 0),
  pullback_zone_low numeric NOT NULL CHECK (pullback_zone_low > 0),
  pullback_zone_high numeric NOT NULL CHECK (pullback_zone_high > 0),
  pattern_type text NOT NULL,
  confidence_score numeric NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_entry_recommendations_user_trade
  ON entry_price_recommendations(user_id, trade_id);
CREATE INDEX IF NOT EXISTS idx_entry_recommendations_created
  ON entry_price_recommendations(created_at DESC);

-- RLS for entry_price_recommendations
ALTER TABLE entry_price_recommendations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own entry recommendations"
  ON entry_price_recommendations FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert entry recommendations"
  ON entry_price_recommendations FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 3. Session Intelligence Data Table
CREATE TABLE IF NOT EXISTS session_intelligence_data (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_name text NOT NULL CHECK (session_name IN ('London', 'New York', 'Asian')),
  session_start_hour integer NOT NULL CHECK (session_start_hour >= 0 AND session_start_hour < 24),
  session_end_hour integer NOT NULL CHECK (session_end_hour >= 0 AND session_end_hour < 24),
  best_pairs jsonb NOT NULL DEFAULT '[]'::jsonb,
  market_condition text NOT NULL CHECK (market_condition IN ('trending', 'ranging', 'volatile', 'quiet', 'sideways')),
  is_tradable boolean NOT NULL,
  recommendation_text text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL,
  CONSTRAINT session_times_valid CHECK (session_start_hour != session_end_hour)
);

-- Index for fast lookups of current session data
CREATE INDEX IF NOT EXISTS idx_session_intelligence_expires
  ON session_intelligence_data(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_intelligence_session
  ON session_intelligence_data(session_name, expires_at DESC);

-- RLS for session_intelligence_data (public read for all authenticated users)
ALTER TABLE session_intelligence_data ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view session intelligence"
  ON session_intelligence_data FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert session intelligence"
  ON session_intelligence_data FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 4. VWAP Kiss Signals Table
CREATE TABLE IF NOT EXISTS vwap_kiss_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  current_price numeric NOT NULL CHECK (current_price > 0),
  vwap_price numeric NOT NULL CHECK (vwap_price > 0),
  distance_percent numeric NOT NULL,
  signal_strength text NOT NULL CHECK (signal_strength IN ('hot', 'good', 'watch')),
  direction_bias text NOT NULL CHECK (direction_bias IN ('bullish', 'bearish', 'neutral')),
  scalp_opportunity_score numeric NOT NULL CHECK (scalp_opportunity_score >= 0 AND scalp_opportunity_score <= 100),
  entry_suggestion numeric NOT NULL CHECK (entry_suggestion > 0),
  exit_suggestion numeric NOT NULL CHECK (exit_suggestion > 0),
  reasoning text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Index for fast lookups of active signals
CREATE INDEX IF NOT EXISTS idx_vwap_signals_expires
  ON vwap_kiss_signals(signal_strength, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_vwap_signals_symbol
  ON vwap_kiss_signals(symbol, expires_at DESC);

-- RLS for vwap_kiss_signals (public read for all authenticated users)
ALTER TABLE vwap_kiss_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view VWAP kiss signals"
  ON vwap_kiss_signals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert VWAP kiss signals"
  ON vwap_kiss_signals FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Cleanup function to remove expired data (runs periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_monitor_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete expired session intelligence (older than 2 hours)
  DELETE FROM session_intelligence_data
  WHERE expires_at < now() - interval '2 hours';

  -- Delete expired VWAP signals (older than 10 minutes)
  DELETE FROM vwap_kiss_signals
  WHERE expires_at < now() - interval '10 minutes';

  -- Delete old entry recommendations (keep last 50 per user)
  DELETE FROM entry_price_recommendations
  WHERE id NOT IN (
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as rn
      FROM entry_price_recommendations
    ) ranked
    WHERE rn <= 50
  );
END;
$$;

-- Function to get user's monitor preferences (creates if not exists)
CREATE OR REPLACE FUNCTION get_user_monitor_preferences(p_user_id uuid)
RETURNS TABLE (
  entry_price_monitor_enabled boolean,
  session_intelligence_enabled boolean,
  vwap_kiss_monitor_enabled boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Insert default preferences if they don't exist
  INSERT INTO user_monitor_preferences (user_id)
  VALUES (p_user_id)
  ON CONFLICT (user_id) DO NOTHING;

  -- Return preferences
  RETURN QUERY
  SELECT
    ump.entry_price_monitor_enabled,
    ump.session_intelligence_enabled,
    ump.vwap_kiss_monitor_enabled
  FROM user_monitor_preferences ump
  WHERE ump.user_id = p_user_id;
END;
$$;

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO service_role;
GRANT ALL ON user_monitor_preferences TO service_role;
GRANT ALL ON entry_price_recommendations TO service_role;
GRANT ALL ON session_intelligence_data TO service_role;
GRANT ALL ON vwap_kiss_signals TO service_role;

-- Enable realtime for live updates
ALTER PUBLICATION supabase_realtime ADD TABLE entry_price_recommendations;
ALTER PUBLICATION supabase_realtime ADD TABLE session_intelligence_data;
ALTER PUBLICATION supabase_realtime ADD TABLE vwap_kiss_signals;