-- ============================================================================
-- CONSOLIDATED MISSING MIGRATIONS SCRIPT
-- ============================================================================
-- This script applies all migrations that are typically missing after running
-- only the base consolidated schema (20251016_100000).
--
-- Run this AFTER confirming which specific tables are missing.
-- This is IDEMPOTENT and safe to run multiple times.
-- ============================================================================

-- ============================================================================
-- PHASE 1: AI PREDICTION SYSTEM (Oct 17)
-- ============================================================================
CREATE TABLE IF NOT EXISTS ai_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  timeframe text NOT NULL,
  prediction_type text NOT NULL CHECK (prediction_type IN ('directional', 'reversal', 'continuation')),
  confidence_score numeric(5,2) NOT NULL CHECK (confidence_score >= 0 AND confidence_score <= 100),
  predicted_direction text CHECK (predicted_direction IN ('bullish', 'bearish', 'neutral')),
  entry_price numeric(15,5),
  target_price numeric(15,5),
  stop_loss numeric(15,5),
  reasoning jsonb,
  indicators_used text[],
  prediction_made_at timestamptz NOT NULL DEFAULT now(),
  prediction_expires_at timestamptz,
  actual_outcome text CHECK (actual_outcome IN ('correct', 'incorrect', 'pending', 'expired')),
  outcome_recorded_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_predictions_user ON ai_predictions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_symbol_timeframe ON ai_predictions(symbol, timeframe, prediction_made_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_predictions_outcome ON ai_predictions(user_id, actual_outcome) WHERE actual_outcome IN ('correct', 'incorrect');

ALTER TABLE ai_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own predictions" ON ai_predictions;
CREATE POLICY "Users can view own predictions"
  ON ai_predictions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own predictions" ON ai_predictions;
CREATE POLICY "Users can insert own predictions"
  ON ai_predictions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own predictions" ON ai_predictions;
CREATE POLICY "Users can update own predictions"
  ON ai_predictions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PHASE 2: METAAPI TOKEN CACHE (Oct 23)
-- ============================================================================
CREATE TABLE IF NOT EXISTS metaapi_token_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id text UNIQUE NOT NULL,
  token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_account ON metaapi_token_cache(account_id);
CREATE INDEX IF NOT EXISTS idx_metaapi_token_cache_expires ON metaapi_token_cache(expires_at);

ALTER TABLE metaapi_token_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role can manage tokens" ON metaapi_token_cache;
CREATE POLICY "Service role can manage tokens"
  ON metaapi_token_cache FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PHASE 3: TRADING SESSIONS (Oct 24)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_name text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  session_status text DEFAULT 'active' CHECK (session_status IN ('active', 'completed', 'cancelled')),
  initial_balance numeric(15,2),
  final_balance numeric(15,2),
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  total_pnl numeric(15,2) DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_user ON trading_sessions(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_status ON trading_sessions(user_id, session_status);

ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own sessions" ON trading_sessions;
CREATE POLICY "Users can view own sessions"
  ON trading_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own sessions" ON trading_sessions;
CREATE POLICY "Users can insert own sessions"
  ON trading_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own sessions" ON trading_sessions;
CREATE POLICY "Users can update own sessions"
  ON trading_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PHASE 4: FUNCTION MONITORING (Oct 24)
-- ============================================================================
CREATE TABLE IF NOT EXISTS function_monitoring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  execution_status text NOT NULL CHECK (execution_status IN ('success', 'error', 'timeout')),
  execution_time_ms integer,
  error_message text,
  request_payload jsonb,
  response_payload jsonb,
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_function_monitoring_name ON function_monitoring(function_name, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_function_monitoring_status ON function_monitoring(execution_status, executed_at DESC);

ALTER TABLE function_monitoring ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view function monitoring" ON function_monitoring;
CREATE POLICY "Authenticated users can view function monitoring"
  ON function_monitoring FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service can insert monitoring records" ON function_monitoring;
CREATE POLICY "Service can insert monitoring records"
  ON function_monitoring FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- PHASE 5: REALTIME PRICES (Oct 27)
-- ============================================================================
CREATE TABLE IF NOT EXISTS realtime_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  bid numeric(15,5) NOT NULL,
  ask numeric(15,5) NOT NULL,
  spread numeric(15,5),
  timestamp timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'metaapi',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol ON realtime_prices(symbol, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_realtime_prices_timestamp ON realtime_prices(timestamp DESC);

ALTER TABLE realtime_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view realtime prices" ON realtime_prices;
CREATE POLICY "Anyone can view realtime prices"
  ON realtime_prices FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service can insert prices" ON realtime_prices;
CREATE POLICY "Service can insert prices"
  ON realtime_prices FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- ============================================================================
-- PHASE 6: CONNECTION HEALTH STATUS (Oct 27)
-- ============================================================================
CREATE TABLE IF NOT EXISTS connection_health_status (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'degraded', 'down')),
  last_check_at timestamptz NOT NULL DEFAULT now(),
  response_time_ms integer,
  error_message text,
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_connection_health_service ON connection_health_status(service_name, last_check_at DESC);

ALTER TABLE connection_health_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view health status" ON connection_health_status;
CREATE POLICY "Authenticated users can view health status"
  ON connection_health_status FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Service can update health status" ON connection_health_status;
CREATE POLICY "Service can update health status"
  ON connection_health_status FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================================================
-- PHASE 7: SIMULATED POSITIONS (Oct 29)
-- ============================================================================
CREATE TABLE IF NOT EXISTS simulated_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  position_type text NOT NULL CHECK (position_type IN ('buy', 'sell')),
  entry_price numeric(15,5) NOT NULL,
  current_price numeric(15,5),
  stop_loss numeric(15,5),
  take_profit numeric(15,5),
  lot_size numeric(10,2) DEFAULT 0.01,
  position_status text DEFAULT 'open' CHECK (position_status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  pnl numeric(15,2) DEFAULT 0,
  pnl_pips numeric(10,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_simulated_positions_user ON simulated_positions(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulated_positions_status ON simulated_positions(user_id, position_status);
CREATE INDEX IF NOT EXISTS idx_simulated_positions_symbol ON simulated_positions(symbol, position_status);

ALTER TABLE simulated_positions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own positions" ON simulated_positions;
CREATE POLICY "Users can view own positions"
  ON simulated_positions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own positions" ON simulated_positions;
CREATE POLICY "Users can insert own positions"
  ON simulated_positions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own positions" ON simulated_positions;
CREATE POLICY "Users can update own positions"
  ON simulated_positions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PHASE 8: TRADE HISTORY (Oct 30)
-- ============================================================================
CREATE TABLE IF NOT EXISTS trade_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  symbol text NOT NULL,
  trade_type text NOT NULL CHECK (trade_type IN ('buy', 'sell')),
  entry_price numeric(15,5) NOT NULL,
  exit_price numeric(15,5),
  stop_loss numeric(15,5),
  take_profit numeric(15,5),
  lot_size numeric(10,2) DEFAULT 0.01,
  trade_status text DEFAULT 'open' CHECK (trade_status IN ('open', 'closed', 'cancelled')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  pnl numeric(15,2) DEFAULT 0,
  pnl_pips numeric(10,2) DEFAULT 0,
  strategy_used text,
  notes text,
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven')),
  risk_reward_ratio numeric(10,2),
  max_adverse_excursion numeric(10,2),
  max_favorable_excursion numeric(10,2),
  hold_time_minutes integer,
  session_id uuid REFERENCES trading_sessions(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_history_user ON trade_history(user_id, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_history_status ON trade_history(user_id, trade_status);
CREATE INDEX IF NOT EXISTS idx_trade_history_symbol ON trade_history(symbol, opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_trade_history_outcome ON trade_history(user_id, trade_outcome) WHERE trade_outcome IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trade_history_session ON trade_history(session_id);

ALTER TABLE trade_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own trade history" ON trade_history;
CREATE POLICY "Users can view own trade history"
  ON trade_history FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own trades" ON trade_history;
CREATE POLICY "Users can insert own trades"
  ON trade_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own trades" ON trade_history;
CREATE POLICY "Users can update own trades"
  ON trade_history FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- COMPLETION MESSAGE
-- ============================================================================
DO $$
BEGIN
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'CONSOLIDATED MISSING MIGRATIONS APPLIED SUCCESSFULLY';
  RAISE NOTICE '====================================================================';
  RAISE NOTICE 'Tables created in this migration:';
  RAISE NOTICE '  - ai_predictions (AI Prediction System)';
  RAISE NOTICE '  - metaapi_token_cache (MetaAPI Token Cache)';
  RAISE NOTICE '  - trading_sessions (Trading Sessions)';
  RAISE NOTICE '  - function_monitoring (Function Monitoring)';
  RAISE NOTICE '  - realtime_prices (Realtime Prices)';
  RAISE NOTICE '  - connection_health_status (Connection Health)';
  RAISE NOTICE '  - simulated_positions (Simulated Positions)';
  RAISE NOTICE '  - trade_history (Trade History)';
  RAISE NOTICE '';
  RAISE NOTICE 'Next steps:';
  RAISE NOTICE '  1. Run the migration status checker again to verify completion';
  RAISE NOTICE '  2. If still missing tables, run remaining migration files';
  RAISE NOTICE '  3. Set is_admin = true for your user in user_profiles table';
  RAISE NOTICE '====================================================================';
END $$;
