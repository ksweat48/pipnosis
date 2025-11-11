/*
  # Consolidated Missing Tables Migration
  
  This migration creates all remaining missing tables identified by validation.
  All creations use IF NOT EXISTS for safety and idempotency.
  
  Tables created:
  - historical_candles (historical OHLC data)
  - metaapi_connection_health (MetaAPI connection monitoring)
  - metatap_token_cache (token caching)
  - Autonomous Copilot tables (countdown_state, flow_v, learning_patterns, etc.)
  - Balanced Profitability Model tables (ai_composite_scores, ai_risk_state, etc.)
  - Strategy Discovery tables (ai_discovered_strategies, market_regime_history, etc.)
  - Auto Backtest tables (auto_backtest_config, auto_backtest_health_log)
*/

-- =============================================================================
-- HISTORICAL CANDLES TABLE
-- =============================================================================
CREATE TABLE IF NOT EXISTS historical_candles (
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
  broker_time text,
  data_source text DEFAULT 'metaapi_historical',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'historical_candles_symbol_timeframe_timestamp_key'
  ) THEN
    ALTER TABLE historical_candles 
    ADD CONSTRAINT historical_candles_symbol_timeframe_timestamp_key 
    UNIQUE(symbol, timeframe, timestamp);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol_timeframe_timestamp 
  ON historical_candles(symbol, timeframe, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_historical_candles_symbol ON historical_candles(symbol);
CREATE INDEX IF NOT EXISTS idx_historical_candles_timeframe ON historical_candles(timeframe);
CREATE INDEX IF NOT EXISTS idx_historical_candles_timestamp ON historical_candles(timestamp DESC);

ALTER TABLE historical_candles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can read historical candles" ON historical_candles;
CREATE POLICY "Anyone can read historical candles"
  ON historical_candles FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can insert historical candles" ON historical_candles;
CREATE POLICY "Authenticated users can insert historical candles"
  ON historical_candles FOR INSERT TO authenticated WITH CHECK (true);

-- =============================================================================
-- METAAPI CONNECTION HEALTH
-- =============================================================================
CREATE TABLE IF NOT EXISTS metaapi_connection_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_status text NOT NULL DEFAULT 'disconnected',
  last_message_at timestamptz,
  reconnect_count integer DEFAULT 0,
  error_message text,
  region text NOT NULL,
  account_id text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_metaapi_connection_health_singleton 
  ON metaapi_connection_health((1));

ALTER TABLE metaapi_connection_health ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read connection health" ON metaapi_connection_health;
CREATE POLICY "Authenticated users can read connection health"
  ON metaapi_connection_health FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can manage connection health" ON metaapi_connection_health;
CREATE POLICY "Authenticated users can manage connection health"
  ON metaapi_connection_health FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- METATAP TOKEN CACHE
-- =============================================================================
CREATE TABLE IF NOT EXISTS metatap_token_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text NOT NULL UNIQUE,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  region text DEFAULT 'new-york',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metatap_token_cache_account ON metatap_token_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_metatap_token_cache_expires ON metatap_token_cache(expires_at);

ALTER TABLE metatap_token_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage metatap tokens" ON metatap_token_cache;
CREATE POLICY "Authenticated users can manage metatap tokens"
  ON metatap_token_cache FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- =============================================================================
-- AUTONOMOUS COPILOT TABLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS countdown_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  candle_close_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS flow_v (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  flow_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS learning_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  pattern_type text NOT NULL,
  pattern_data jsonb NOT NULL,
  success_rate numeric(5,2),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defensive_mode_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  activated_at timestamptz NOT NULL,
  reason text NOT NULL,
  metrics jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  email_type text NOT NULL,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  status text DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sound_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  enabled boolean DEFAULT true,
  volume numeric(3,2) DEFAULT 0.5,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session_metrics_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  metrics jsonb NOT NULL,
  snapshot_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reasoning_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  reasoning_type text NOT NULL,
  reasoning_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_switches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  from_strategy text NOT NULL,
  to_strategy text NOT NULL,
  reason text,
  switched_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS on autonomous copilot tables
ALTER TABLE countdown_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_v ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE defensive_mode_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE sound_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_metrics_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE reasoning_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_switches ENABLE ROW LEVEL SECURITY;

-- Policies for autonomous copilot tables
DROP POLICY IF EXISTS "Users can manage own countdown_state" ON countdown_state;
CREATE POLICY "Users can manage own countdown_state"
  ON countdown_state FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own flow_v" ON flow_v;
CREATE POLICY "Users can manage own flow_v"
  ON flow_v FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own learning_patterns" ON learning_patterns;
CREATE POLICY "Users can manage own learning_patterns"
  ON learning_patterns FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own defensive_mode_log" ON defensive_mode_log;
CREATE POLICY "Users can view own defensive_mode_log"
  ON defensive_mode_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own email_queue" ON email_queue;
CREATE POLICY "Users can manage own email_queue"
  ON email_queue FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can manage own sound_preferences" ON sound_preferences;
CREATE POLICY "Users can manage own sound_preferences"
  ON sound_preferences FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own session_metrics_snapshot" ON session_metrics_snapshot;
CREATE POLICY "Users can view own session_metrics_snapshot"
  ON session_metrics_snapshot FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own reasoning_log" ON reasoning_log;
CREATE POLICY "Users can view own reasoning_log"
  ON reasoning_log FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own strategy_switches" ON strategy_switches;
CREATE POLICY "Users can view own strategy_switches"
  ON strategy_switches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- =============================================================================
-- BALANCED PROFITABILITY MODEL TABLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_composite_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  spc_score numeric(5,2),
  css_score numeric(5,2),
  ev_score numeric(5,2),
  composite_score numeric(5,2) NOT NULL,
  confidence_level text,
  calculated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_risk_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  current_risk_level text NOT NULL,
  max_position_size numeric(10,2),
  stop_loss_multiplier numeric(5,2),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_session_learnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,
  learning_summary jsonb NOT NULL,
  key_insights text[],
  recommendations text[],
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai_pattern_ev_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_name text NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  expected_value numeric(10,2),
  occurrences integer DEFAULT 1,
  win_rate numeric(5,2),
  avg_profit numeric(10,2),
  avg_loss numeric(10,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_composite_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_risk_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_session_learnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_pattern_ev_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own ai_composite_scores" ON ai_composite_scores;
CREATE POLICY "Users can view own ai_composite_scores"
  ON ai_composite_scores FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own ai_risk_state" ON ai_risk_state;
CREATE POLICY "Users can view own ai_risk_state"
  ON ai_risk_state FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own ai_session_learnings" ON ai_session_learnings;
CREATE POLICY "Users can view own ai_session_learnings"
  ON ai_session_learnings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Authenticated users can view ai_pattern_ev_tracking" ON ai_pattern_ev_tracking;
CREATE POLICY "Authenticated users can view ai_pattern_ev_tracking"
  ON ai_pattern_ev_tracking FOR SELECT TO authenticated USING (true);

-- =============================================================================
-- STRATEGY DISCOVERY TABLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS ai_discovered_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_name text NOT NULL,
  strategy_type text NOT NULL,
  discovery_method text NOT NULL,
  parameters jsonb NOT NULL,
  backtest_results jsonb,
  confidence_score numeric(5,2),
  status text DEFAULT 'discovered',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS market_regime_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  regime_type text NOT NULL,
  detected_at timestamptz NOT NULL,
  characteristics jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_creation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid,
  creation_trigger text NOT NULL,
  parameters_used jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_parameter_evolution (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid,
  parameter_name text NOT NULL,
  old_value text,
  new_value text NOT NULL,
  reason text,
  changed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_selection_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  selected_strategy_id uuid,
  selection_reason text NOT NULL,
  market_conditions jsonb,
  selected_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS strategy_validation_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id uuid,
  validation_type text NOT NULL,
  passed boolean NOT NULL,
  metrics jsonb,
  validated_at timestamptz DEFAULT now()
);

ALTER TABLE ai_discovered_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_regime_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_creation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_parameter_evolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_selection_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_validation_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view ai_discovered_strategies" ON ai_discovered_strategies;
CREATE POLICY "Authenticated users can view ai_discovered_strategies"
  ON ai_discovered_strategies FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view market_regime_history" ON market_regime_history;
CREATE POLICY "Authenticated users can view market_regime_history"
  ON market_regime_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view strategy logs" ON strategy_creation_log;
CREATE POLICY "Authenticated users can view strategy logs"
  ON strategy_creation_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view strategy_parameter_evolution" ON strategy_parameter_evolution;
CREATE POLICY "Authenticated users can view strategy_parameter_evolution"
  ON strategy_parameter_evolution FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view strategy_selection_log" ON strategy_selection_log;
CREATE POLICY "Authenticated users can view strategy_selection_log"
  ON strategy_selection_log FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view strategy_validation_results" ON strategy_validation_results;
CREATE POLICY "Authenticated users can view strategy_validation_results"
  ON strategy_validation_results FOR SELECT TO authenticated USING (true);

-- =============================================================================
-- AUTO BACKTEST TABLES
-- =============================================================================
CREATE TABLE IF NOT EXISTS auto_backtest_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enabled boolean DEFAULT false,
  frequency_hours integer DEFAULT 24,
  symbols text[] DEFAULT ARRAY['EURUSD'],
  timeframes text[] DEFAULT ARRAY['H1'],
  lookback_days integer DEFAULT 30,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auto_backtest_health_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid,
  status text NOT NULL,
  error_message text,
  duration_ms integer,
  strategies_tested integer,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE auto_backtest_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE auto_backtest_health_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view auto_backtest_config" ON auto_backtest_config;
CREATE POLICY "Authenticated users can view auto_backtest_config"
  ON auto_backtest_config FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated users can view auto_backtest_health_log" ON auto_backtest_health_log;
CREATE POLICY "Authenticated users can view auto_backtest_health_log"
  ON auto_backtest_health_log FOR SELECT TO authenticated USING (true);