/*
  # Autonomous Co-Pilot Schema Extensions

  1. New Tables
    - `countdown_state` - Manages countdown timers for auto-execution
    - `flow_v2_signals` - Stores Flow Trader V2 strategy signal data
    - `learning_patterns` - Pattern memory for AI learning layer
    - `strategy_performance` - Tracks performance metrics per strategy/symbol
    - `defensive_mode_log` - Logs defensive mode activations
    - `email_queue` - Email notification queue with retry logic
    - `sound_preferences` - User preferences for audio notifications
    - `session_metrics_snapshot` - Real-time session performance snapshots
    - `reasoning_log` - Stores AI reasoning for every decision
    - `strategy_switches` - Tracks when AI switches between strategies

  2. Schema Enhancements
    - Add autonomous mode fields to goal_sessions
    - Add Flow V2 specific fields to goal_session_trades
    - Add learning metrics to goal_sessions

  3. Security
    - Enable RLS on all new tables
    - Add policies for authenticated user access
*/

-- Countdown State Table
CREATE TABLE IF NOT EXISTS countdown_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  signal_id uuid NOT NULL,
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  stop_loss numeric NOT NULL,
  take_profit numeric NOT NULL,
  confidence numeric NOT NULL,
  setup_type text NOT NULL,
  reasoning text NOT NULL,
  start_time timestamptz DEFAULT now() NOT NULL,
  expiry_time timestamptz NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  cancel_token text,
  cancelled_at timestamptz,
  executed_at timestamptz,
  data jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_countdown_state_session ON countdown_state(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_countdown_state_status ON countdown_state(status);
CREATE INDEX IF NOT EXISTS idx_countdown_state_expiry ON countdown_state(expiry_time);

ALTER TABLE countdown_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own countdown states"
  ON countdown_state FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own countdown states"
  ON countdown_state FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own countdown states"
  ON countdown_state FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Flow V2 Signals Table
CREATE TABLE IF NOT EXISTS flow_v2_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  h1_bias text NOT NULL,
  h1_candle_color text NOT NULL,
  m5_halftrend_color text,
  m5_stoch_rsi numeric,
  m5_signal_line numeric,
  m5_price numeric,
  m5_filter_passed boolean DEFAULT false,
  m1_ha_flip text,
  m1_rsi numeric,
  m1_signal_line numeric,
  m1_price numeric,
  m1_choch_detected boolean DEFAULT false,
  m1_execution_ready boolean DEFAULT false,
  indicators jsonb DEFAULT '{}'::jsonb,
  phase text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_flow_v2_signals_session ON flow_v2_signals(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_flow_v2_signals_symbol ON flow_v2_signals(symbol);
CREATE INDEX IF NOT EXISTS idx_flow_v2_signals_phase ON flow_v2_signals(phase);

ALTER TABLE flow_v2_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own flow signals"
  ON flow_v2_signals FOR SELECT
  TO authenticated
  USING (goal_session_id IN (
    SELECT id FROM goal_sessions WHERE user_id = auth.uid()
  ));

CREATE POLICY "System can insert flow signals"
  ON flow_v2_signals FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Learning Patterns Table
CREATE TABLE IF NOT EXISTS learning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  feature_vector jsonb NOT NULL,
  outcome text NOT NULL,
  win boolean NOT NULL,
  risk_reward numeric,
  mae numeric,
  mfe numeric,
  duration_minutes integer,
  weight numeric DEFAULT 1.0,
  confidence_at_entry numeric,
  market_regime text,
  time_of_day text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_learning_patterns_user ON learning_patterns(user_id);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_strategy ON learning_patterns(strategy_name);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_symbol ON learning_patterns(symbol);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_outcome ON learning_patterns(outcome);
CREATE INDEX IF NOT EXISTS idx_learning_patterns_created ON learning_patterns(created_at DESC);

ALTER TABLE learning_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own learning patterns"
  ON learning_patterns FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own learning patterns"
  ON learning_patterns FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Strategy Performance Table
CREATE TABLE IF NOT EXISTS strategy_performance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  strategy_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  avg_risk_reward numeric DEFAULT 0,
  expectancy numeric DEFAULT 0,
  total_profit numeric DEFAULT 0,
  avg_duration_minutes integer DEFAULT 0,
  confidence_threshold numeric DEFAULT 75,
  last_adjusted_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, strategy_name, symbol, timeframe)
);

CREATE INDEX IF NOT EXISTS idx_strategy_performance_user ON strategy_performance(user_id);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_strategy ON strategy_performance(strategy_name);
CREATE INDEX IF NOT EXISTS idx_strategy_performance_expectancy ON strategy_performance(expectancy DESC);

ALTER TABLE strategy_performance ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy performance"
  ON strategy_performance FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own strategy performance"
  ON strategy_performance FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own strategy performance"
  ON strategy_performance FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Defensive Mode Log Table
CREATE TABLE IF NOT EXISTS defensive_mode_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trigger_reason text NOT NULL,
  loss_streak integer,
  mdd_percentage numeric,
  previous_risk_percentage numeric,
  new_risk_percentage numeric,
  activated_at timestamptz DEFAULT now() NOT NULL,
  deactivated_at timestamptz,
  trades_while_active integer DEFAULT 0,
  recovery_achieved boolean DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_defensive_mode_session ON defensive_mode_log(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_defensive_mode_active ON defensive_mode_log(activated_at) WHERE deactivated_at IS NULL;

ALTER TABLE defensive_mode_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own defensive logs"
  ON defensive_mode_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own defensive logs"
  ON defensive_mode_log FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own defensive logs"
  ON defensive_mode_log FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Email Queue Table
CREATE TABLE IF NOT EXISTS email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  recipient_email text NOT NULL,
  template_name text NOT NULL,
  subject text NOT NULL,
  data jsonb DEFAULT '{}'::jsonb,
  status text DEFAULT 'pending' NOT NULL,
  priority text DEFAULT 'medium' NOT NULL,
  retry_count integer DEFAULT 0,
  max_retries integer DEFAULT 3,
  scheduled_for timestamptz DEFAULT now() NOT NULL,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_queue_status ON email_queue(status);
CREATE INDEX IF NOT EXISTS idx_email_queue_scheduled ON email_queue(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_email_queue_priority ON email_queue(priority);

ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own emails"
  ON email_queue FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert emails"
  ON email_queue FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update emails"
  ON email_queue FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Sound Preferences Table
CREATE TABLE IF NOT EXISTS sound_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  notification_sound_enabled boolean DEFAULT true,
  alarm_sound_enabled boolean DEFAULT true,
  notification_volume numeric DEFAULT 0.7,
  alarm_volume numeric DEFAULT 0.9,
  notification_sound_file text DEFAULT 'notification.mp3',
  alarm_sound_file text DEFAULT 'alarm.mp3',
  browser_notifications_enabled boolean DEFAULT true,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE sound_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sound preferences"
  ON sound_preferences FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own sound preferences"
  ON sound_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own sound preferences"
  ON sound_preferences FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Session Metrics Snapshot Table
CREATE TABLE IF NOT EXISTS session_metrics_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  open_trades integer DEFAULT 0,
  closed_trades integer DEFAULT 0,
  win_rate numeric DEFAULT 0,
  current_pl numeric DEFAULT 0,
  mdd numeric DEFAULT 0,
  avg_risk_reward numeric DEFAULT 0,
  active_strategy text,
  market_regime text,
  defensive_mode_active boolean DEFAULT false,
  next_scan_eta integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_metrics_session ON session_metrics_snapshot(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_session_metrics_created ON session_metrics_snapshot(created_at DESC);

ALTER TABLE session_metrics_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own session metrics"
  ON session_metrics_snapshot FOR SELECT
  TO authenticated
  USING (goal_session_id IN (
    SELECT id FROM goal_sessions WHERE user_id = auth.uid()
  ));

CREATE POLICY "System can insert session metrics"
  ON session_metrics_snapshot FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Reasoning Log Table
CREATE TABLE IF NOT EXISTS reasoning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reasoning_type text NOT NULL,
  strategy_selected text,
  conviction numeric,
  market_conditions jsonb,
  reasoning_text text NOT NULL,
  decision text NOT NULL,
  model_used text DEFAULT 'gpt-4o',
  tokens_used integer,
  latency_ms integer,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reasoning_log_session ON reasoning_log(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_reasoning_log_created ON reasoning_log(created_at DESC);

ALTER TABLE reasoning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own reasoning logs"
  ON reasoning_log FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert reasoning logs"
  ON reasoning_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Strategy Switches Table
CREATE TABLE IF NOT EXISTS strategy_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  from_strategy text NOT NULL,
  to_strategy text NOT NULL,
  reason text NOT NULL,
  market_regime_change jsonb,
  confidence numeric,
  switched_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_strategy_switches_session ON strategy_switches(goal_session_id);
CREATE INDEX IF NOT EXISTS idx_strategy_switches_switched ON strategy_switches(switched_at DESC);

ALTER TABLE strategy_switches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own strategy switches"
  ON strategy_switches FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "System can insert strategy switches"
  ON strategy_switches FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Enhance goal_sessions table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'countdown_duration_seconds') THEN
    ALTER TABLE goal_sessions ADD COLUMN countdown_duration_seconds integer DEFAULT 180;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'active_strategy') THEN
    ALTER TABLE goal_sessions ADD COLUMN active_strategy text DEFAULT 'flow_v2';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'defensive_mode_active') THEN
    ALTER TABLE goal_sessions ADD COLUMN defensive_mode_active boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'loss_streak') THEN
    ALTER TABLE goal_sessions ADD COLUMN loss_streak integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'max_concurrent_trades') THEN
    ALTER TABLE goal_sessions ADD COLUMN max_concurrent_trades integer DEFAULT 2;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'learning_enabled') THEN
    ALTER TABLE goal_sessions ADD COLUMN learning_enabled boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_sessions' AND column_name = 'email_notifications_enabled') THEN
    ALTER TABLE goal_sessions ADD COLUMN email_notifications_enabled boolean DEFAULT true;
  END IF;
END $$;

-- Enhance goal_session_trades table
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'strategy_used') THEN
    ALTER TABLE goal_session_trades ADD COLUMN strategy_used text DEFAULT 'flow_v2';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'flow_v2_signal_id') THEN
    ALTER TABLE goal_session_trades ADD COLUMN flow_v2_signal_id uuid;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'mae') THEN
    ALTER TABLE goal_session_trades ADD COLUMN mae numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'mfe') THEN
    ALTER TABLE goal_session_trades ADD COLUMN mfe numeric DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'breakeven_moved') THEN
    ALTER TABLE goal_session_trades ADD COLUMN breakeven_moved boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'trailing_active') THEN
    ALTER TABLE goal_session_trades ADD COLUMN trailing_active boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'partial_closes') THEN
    ALTER TABLE goal_session_trades ADD COLUMN partial_closes jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'early_exit_reason') THEN
    ALTER TABLE goal_session_trades ADD COLUMN early_exit_reason text;
  END IF;
END $$;
