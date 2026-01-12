/*
  # Auto Trading RLS Policies & Functions

  1. Enable RLS on auto trading tables
  2. Create user-scoped policies
  3. Add daily reset function
*/

-- Enable RLS
ALTER TABLE auto_trading_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_trading_preferences ENABLE ROW LEVEL SECURITY;

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can create own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can update own auto trading status" ON auto_trading_status;
DROP POLICY IF EXISTS "Users can view own trading preferences" ON user_trading_preferences;
DROP POLICY IF EXISTS "Users can create own trading preferences" ON user_trading_preferences;
DROP POLICY IF EXISTS "Users can update own trading preferences" ON user_trading_preferences;

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