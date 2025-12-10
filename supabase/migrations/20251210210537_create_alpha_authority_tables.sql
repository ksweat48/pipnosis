-- Alpha Authority & Learning System Tables

CREATE TABLE IF NOT EXISTS alpha_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  session_id uuid,
  symbol text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('BUY', 'SELL', 'NO_TRADE')),
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  omega_consensus jsonb NOT NULL DEFAULT '{}',
  omega_votes jsonb NOT NULL DEFAULT '{}',
  alpha_override boolean NOT NULL DEFAULT false,
  override_reason text,
  conflict_detected boolean NOT NULL DEFAULT false,
  conflict_type text CHECK (conflict_type IN ('HARD', 'SOFT', 'NONE')),
  reasoning text NOT NULL,
  market_context jsonb NOT NULL DEFAULT '{}',
  trader_personality text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_user ON alpha_decisions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS alpha_decision_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  decision_id uuid REFERENCES alpha_decisions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid,
  executed boolean NOT NULL DEFAULT false,
  outcome text CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'NOT_EXECUTED')),
  pnl decimal(10, 2) DEFAULT 0,
  pnl_pct decimal(5, 2) DEFAULT 0,
  duration_minutes integer,
  exit_reason text CHECK (exit_reason IN ('TP', 'SL', 'MANUAL', 'TIMEOUT', 'NOT_EXECUTED')),
  alpha_was_right boolean,
  learning_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_alpha_outcomes_decision ON alpha_decision_outcomes(decision_id);

CREATE TABLE IF NOT EXISTS alpha_learning_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  period text NOT NULL CHECK (period IN ('daily', 'weekly', 'monthly')),
  period_start date NOT NULL,
  total_decisions integer DEFAULT 0,
  override_count integer DEFAULT 0,
  override_success_rate decimal(5, 2) DEFAULT 0,
  consensus_follow_count integer DEFAULT 0,
  consensus_success_rate decimal(5, 2) DEFAULT 0,
  avg_confidence decimal(5, 2) DEFAULT 0,
  win_rate decimal(5, 2) DEFAULT 0,
  profit_factor decimal(5, 2) DEFAULT 0,
  best_override_category text,
  worst_override_category text,
  learning_score decimal(5, 2) DEFAULT 50,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, period, period_start)
);

CREATE TABLE IF NOT EXISTS hard_coded_safety_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_name text UNIQUE NOT NULL,
  rule_type text NOT NULL CHECK (rule_type IN ('POSITION_SIZE', 'STOP_LOSS', 'LEVERAGE', 'DRAWDOWN', 'PRICE_VALIDATION', 'MAX_EXPOSURE')),
  rule_description text NOT NULL,
  rule_logic jsonb NOT NULL DEFAULT '{}',
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO hard_coded_safety_rules (rule_name, rule_type, rule_description, rule_logic, priority) VALUES
('max_position_size', 'POSITION_SIZE', 'Maximum position size per trade', '{"max_lots": 1.0, "max_pct_of_balance": 10}', 100),
('min_stop_loss', 'STOP_LOSS', 'Minimum stop loss distance', '{"min_atr_multiplier": 1.0, "min_pips": 5}', 90),
('max_leverage', 'LEVERAGE', 'Maximum leverage allowed', '{"max_leverage": 100}', 100),
('max_drawdown', 'DRAWDOWN', 'Maximum account drawdown', '{"max_drawdown_pct": 20}', 100),
('price_validation', 'PRICE_VALIDATION', 'Price must be within valid ranges', '{"check_symbol_ranges": true, "check_spread": true}', 95),
('max_concurrent_trades', 'MAX_EXPOSURE', 'Maximum concurrent open positions', '{"max_trades": 3, "max_symbols": 2}', 85)
ON CONFLICT (rule_name) DO NOTHING;

ALTER TABLE alpha_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_decision_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_learning_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE hard_coded_safety_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own alpha decisions"
  ON alpha_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alpha decisions"
  ON alpha_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own alpha outcomes"
  ON alpha_decision_outcomes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alpha outcomes"
  ON alpha_decision_outcomes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own alpha outcomes"
  ON alpha_decision_outcomes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users view own alpha metrics"
  ON alpha_learning_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own alpha metrics"
  ON alpha_learning_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own alpha metrics"
  ON alpha_learning_metrics FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Anyone can view safety rules"
  ON hard_coded_safety_rules FOR SELECT
  TO authenticated
  USING (true);