/*
  # Auto Trading System Tables

  1. Tables
    - auto_trading_status
    - user_trading_preferences

  2. Indexes
    - Performance indexes for auto trading

  3. Triggers
    - Auto-update timestamps
*/

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

-- Auto Trading Status Indexes
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_user_id ON auto_trading_status(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_enabled ON auto_trading_status(enabled);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_scanning_active ON auto_trading_status(scanning_active);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_continuous_mode ON auto_trading_status(continuous_mode);
CREATE INDEX IF NOT EXISTS idx_auto_trading_status_learning_mode ON auto_trading_status(learning_mode);

-- User Trading Preferences Index
CREATE INDEX IF NOT EXISTS idx_user_trading_preferences_user_id ON user_trading_preferences(user_id);

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