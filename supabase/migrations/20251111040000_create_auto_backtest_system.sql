/*
  # Auto-Backtesting System with Dynamic Health Monitoring

  1. New Tables
    - `auto_backtest_controller`
      - Tracks the auto-backtest system state (running/stopped/paused)
      - Stores current cycle count, consecutive runs, and cooldown status
      - Records system health metrics and timestamps

    - `auto_backtest_health_log`
      - Historical log of system health metrics over time
      - Tracks database response times, error rates, stress scores
      - Used for dynamic cooldown decision making

  2. Configuration
    - Auto-backtest system settings per user
    - Configurable cooldown thresholds and cycle limits

  3. Security
    - Enable RLS on all tables
    - Users can only access their own auto-backtest data
*/

-- Auto-backtest controller state table
CREATE TABLE IF NOT EXISTS auto_backtest_controller (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status text NOT NULL DEFAULT 'stopped', -- 'running', 'stopped', 'paused_for_live_trade', 'cooldown'
  is_active boolean NOT NULL DEFAULT false,

  -- Cycle tracking
  total_backtests_completed integer NOT NULL DEFAULT 0,
  consecutive_runs integer NOT NULL DEFAULT 0,
  current_cycle_count integer NOT NULL DEFAULT 0,

  -- Cooldown management
  cooldown_active boolean NOT NULL DEFAULT false,
  cooldown_started_at timestamptz,
  cooldown_ends_at timestamptz,
  cooldown_reason text,
  cooldown_duration_minutes integer DEFAULT 15,

  -- System health
  system_stress_score integer DEFAULT 0, -- 0-100
  last_database_response_ms integer DEFAULT 0,
  error_count_last_hour integer DEFAULT 0,
  consecutive_errors integer DEFAULT 0,

  -- Live trading coordination
  paused_for_live_trade boolean NOT NULL DEFAULT false,
  live_trade_started_at timestamptz,

  -- Timestamps
  started_at timestamptz,
  stopped_at timestamptz,
  last_backtest_started_at timestamptz,
  last_backtest_completed_at timestamptz,
  last_health_check_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Health metrics log (time-series data)
CREATE TABLE IF NOT EXISTS auto_backtest_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  controller_id uuid REFERENCES auto_backtest_controller(id) ON DELETE CASCADE NOT NULL,

  -- Health metrics snapshot
  stress_score integer NOT NULL,
  database_response_ms integer NOT NULL,
  error_rate_percent numeric(5,2) DEFAULT 0,
  memory_usage_mb integer,

  -- Context
  active_backtests integer DEFAULT 0,
  supabase_connections integer DEFAULT 0,

  -- Decision made
  action_taken text, -- 'continue', 'early_cooldown', 'slow_down', 'pause'
  reason text,

  logged_at timestamptz DEFAULT now()
);

-- Auto-backtest configuration per user
CREATE TABLE IF NOT EXISTS auto_backtest_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,

  -- Cycle limits
  max_consecutive_runs integer DEFAULT 100,
  standard_cooldown_minutes integer DEFAULT 15,

  -- Health thresholds for early cooldown
  max_stress_score integer DEFAULT 80,
  max_db_response_ms integer DEFAULT 5000,
  max_error_rate_percent numeric(5,2) DEFAULT 10.0,
  max_consecutive_errors integer DEFAULT 3,

  -- Backtest randomization ranges
  min_duration_days integer DEFAULT 1,
  max_duration_days integer DEFAULT 3,
  delay_between_runs_min_seconds integer DEFAULT 1,
  delay_between_runs_max_seconds integer DEFAULT 20,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_auto_backtest_controller_user ON auto_backtest_controller(user_id);
CREATE INDEX IF NOT EXISTS idx_auto_backtest_controller_status ON auto_backtest_controller(user_id, status);
CREATE INDEX IF NOT EXISTS idx_auto_backtest_health_log_user_time ON auto_backtest_health_log(user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS idx_auto_backtest_health_log_controller ON auto_backtest_health_log(controller_id, logged_at DESC);

-- Enable Row Level Security
ALTER TABLE auto_backtest_controller ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_backtest_health_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_backtest_config ENABLE ROW LEVEL SECURITY;

-- RLS Policies for auto_backtest_controller
CREATE POLICY "Users can view own auto-backtest controller"
  ON auto_backtest_controller FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto-backtest controller"
  ON auto_backtest_controller FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto-backtest controller"
  ON auto_backtest_controller FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own auto-backtest controller"
  ON auto_backtest_controller FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- RLS Policies for auto_backtest_health_log
CREATE POLICY "Users can view own health logs"
  ON auto_backtest_health_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own health logs"
  ON auto_backtest_health_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- RLS Policies for auto_backtest_config
CREATE POLICY "Users can view own auto-backtest config"
  ON auto_backtest_config FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own auto-backtest config"
  ON auto_backtest_config FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own auto-backtest config"
  ON auto_backtest_config FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Function to initialize default config for new users
CREATE OR REPLACE FUNCTION initialize_auto_backtest_config()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO auto_backtest_config (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create config for new users
DROP TRIGGER IF EXISTS on_user_created_init_auto_backtest_config ON auth.users;
CREATE TRIGGER on_user_created_init_auto_backtest_config
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION initialize_auto_backtest_config();
