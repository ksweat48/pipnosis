/*
  # Alpha + Omega Performance Tracking System

  1. New Tables
    - `omega_votes`
      - Tracks every Omega specialist vote
      - Links to trades and outcomes
      - Records confidence and reasoning

    - `alpha_decisions`
      - Tracks Alpha coordinator decisions
      - Records vote aggregation and weights
      - Links to final trade outcomes

    - `midtrade_interventions`
      - Tracks mid-trade monitoring actions
      - Records trigger levels and decisions
      - Measures intervention effectiveness

    - `omega_performance_metrics`
      - Aggregated performance per Omega specialist
      - Tracks accuracy, confidence calibration
      - Win rate by market regime

  2. Security
    - Enable RLS on all tables
    - Authenticated users can read their own data
    - Service role can write during trading

  3. Indexes
    - Optimized for performance queries
    - User + timestamp lookups
    - Omega specialist filtering
*/

-- Omega Votes Table
CREATE TABLE IF NOT EXISTS omega_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  session_id uuid,
  trade_id uuid,

  -- Vote metadata
  omega_specialist text NOT NULL,
  vote text NOT NULL,
  confidence integer NOT NULL,
  reasoning text NOT NULL,

  -- Context
  symbol text NOT NULL,
  price numeric NOT NULL,
  market_regime text,
  volatility_state text,

  -- Vote weight
  applied_weight numeric DEFAULT 1.0,

  -- Outcome tracking
  trade_executed boolean DEFAULT false,
  trade_direction text,
  trade_outcome text,
  trade_pnl numeric,

  -- Vote accuracy
  vote_correct boolean,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Alpha Decisions Table
CREATE TABLE IF NOT EXISTS alpha_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  session_id uuid,
  trade_id uuid,

  -- Decision
  action text NOT NULL,
  confidence integer NOT NULL,
  reasoning text NOT NULL,

  -- Entry parameters
  entry_price numeric,
  stop_loss numeric,
  take_profit numeric,

  -- Context
  symbol text NOT NULL,
  market_regime text,
  volatility_state text,

  -- Omega council summary
  omega_votes_count integer DEFAULT 6,
  buy_votes integer DEFAULT 0,
  sell_votes integer DEFAULT 0,
  no_trade_votes integer DEFAULT 0,

  -- Vote details (JSONB for flexibility)
  omega_vote_details jsonb,
  vote_weights jsonb,

  -- Outcome
  trade_executed boolean DEFAULT false,
  safety_blocked boolean DEFAULT false,
  trade_outcome text,
  trade_pnl numeric,

  -- Decision quality
  decision_correct boolean,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Mid-Trade Interventions Table
CREATE TABLE IF NOT EXISTS midtrade_interventions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  session_id uuid,
  trade_id uuid NOT NULL,

  -- Trigger context
  trigger_level text NOT NULL,
  drawdown_pct numeric NOT NULL,
  minutes_in_trade integer NOT NULL,

  -- Decision
  action text NOT NULL,
  confidence integer NOT NULL,
  reasoning text NOT NULL,

  -- Changes made
  original_sl numeric,
  adjusted_sl numeric,

  -- Context
  symbol text NOT NULL,
  price numeric NOT NULL,
  entry_price numeric NOT NULL,
  market_regime text,
  volatility_state text,

  -- Emergency council votes (if applicable)
  omega_emergency_votes jsonb,

  -- Outcome tracking
  intervention_result text,
  pnl_impact numeric,

  created_at timestamptz DEFAULT now()
);

-- Omega Performance Metrics (Aggregated)
CREATE TABLE IF NOT EXISTS omega_performance_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) NOT NULL,
  omega_specialist text NOT NULL,

  -- Time window
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,

  -- Vote statistics
  total_votes integer DEFAULT 0,
  buy_votes integer DEFAULT 0,
  sell_votes integer DEFAULT 0,
  no_trade_votes integer DEFAULT 0,

  -- Accuracy
  votes_correct integer DEFAULT 0,
  accuracy_rate numeric DEFAULT 0,

  -- Confidence calibration
  avg_confidence numeric DEFAULT 0,
  confidence_when_correct numeric DEFAULT 0,
  confidence_when_wrong numeric DEFAULT 0,

  -- By market regime
  bull_accuracy numeric DEFAULT 0,
  bear_accuracy numeric DEFAULT 0,
  sideways_accuracy numeric DEFAULT 0,

  -- By volatility
  low_vol_accuracy numeric DEFAULT 0,
  high_vol_accuracy numeric DEFAULT 0,

  -- Impact
  avg_vote_weight numeric DEFAULT 1.0,
  decisive_votes integer DEFAULT 0,

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, omega_specialist, period_start)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_omega_votes_user_created ON omega_votes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omega_votes_specialist ON omega_votes(omega_specialist, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_omega_votes_trade ON omega_votes(trade_id);

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_user_created ON alpha_decisions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_trade ON alpha_decisions(trade_id);
CREATE INDEX IF NOT EXISTS idx_alpha_decisions_outcome ON alpha_decisions(trade_outcome);

CREATE INDEX IF NOT EXISTS idx_midtrade_interventions_user ON midtrade_interventions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_midtrade_interventions_trade ON midtrade_interventions(trade_id);
CREATE INDEX IF NOT EXISTS idx_midtrade_interventions_level ON midtrade_interventions(trigger_level);

CREATE INDEX IF NOT EXISTS idx_omega_performance_user_specialist ON omega_performance_metrics(user_id, omega_specialist);

-- Enable Row Level Security
ALTER TABLE omega_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE midtrade_interventions ENABLE ROW LEVEL SECURITY;
ALTER TABLE omega_performance_metrics ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can read own omega votes"
  ON omega_votes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can write omega votes"
  ON omega_votes FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update omega votes"
  ON omega_votes FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own alpha decisions"
  ON alpha_decisions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can write alpha decisions"
  ON alpha_decisions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update alpha decisions"
  ON alpha_decisions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can read own midtrade interventions"
  ON midtrade_interventions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can write midtrade interventions"
  ON midtrade_interventions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can read own omega performance"
  ON omega_performance_metrics FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can write omega performance"
  ON omega_performance_metrics FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update omega performance"
  ON omega_performance_metrics FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to update omega performance metrics
CREATE OR REPLACE FUNCTION update_omega_performance_metrics(
  p_user_id uuid,
  p_omega_specialist text,
  p_period_days integer DEFAULT 7
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_metrics record;
BEGIN
  v_period_end := now();
  v_period_start := v_period_end - (p_period_days || ' days')::interval;

  SELECT
    COUNT(*) as total_votes,
    SUM(CASE WHEN vote = 'BUY' THEN 1 ELSE 0 END) as buy_votes,
    SUM(CASE WHEN vote = 'SELL' THEN 1 ELSE 0 END) as sell_votes,
    SUM(CASE WHEN vote = 'NO_TRADE' THEN 1 ELSE 0 END) as no_trade_votes,
    SUM(CASE WHEN vote_correct = true THEN 1 ELSE 0 END) as votes_correct,
    AVG(confidence) as avg_confidence,
    AVG(CASE WHEN vote_correct = true THEN confidence ELSE NULL END) as confidence_when_correct,
    AVG(CASE WHEN vote_correct = false THEN confidence ELSE NULL END) as confidence_when_wrong,
    AVG(applied_weight) as avg_vote_weight
  INTO v_metrics
  FROM omega_votes
  WHERE user_id = p_user_id
    AND omega_specialist = p_omega_specialist
    AND created_at >= v_period_start
    AND created_at <= v_period_end
    AND trade_executed = true;

  INSERT INTO omega_performance_metrics (
    user_id,
    omega_specialist,
    period_start,
    period_end,
    total_votes,
    buy_votes,
    sell_votes,
    no_trade_votes,
    votes_correct,
    accuracy_rate,
    avg_confidence,
    confidence_when_correct,
    confidence_when_wrong,
    avg_vote_weight
  )
  VALUES (
    p_user_id,
    p_omega_specialist,
    v_period_start,
    v_period_end,
    COALESCE(v_metrics.total_votes, 0),
    COALESCE(v_metrics.buy_votes, 0),
    COALESCE(v_metrics.sell_votes, 0),
    COALESCE(v_metrics.no_trade_votes, 0),
    COALESCE(v_metrics.votes_correct, 0),
    CASE WHEN v_metrics.total_votes > 0
      THEN v_metrics.votes_correct::numeric / v_metrics.total_votes
      ELSE 0
    END,
    COALESCE(v_metrics.avg_confidence, 0),
    COALESCE(v_metrics.confidence_when_correct, 0),
    COALESCE(v_metrics.confidence_when_wrong, 0),
    COALESCE(v_metrics.avg_vote_weight, 1.0)
  )
  ON CONFLICT (user_id, omega_specialist, period_start)
  DO UPDATE SET
    period_end = EXCLUDED.period_end,
    total_votes = EXCLUDED.total_votes,
    buy_votes = EXCLUDED.buy_votes,
    sell_votes = EXCLUDED.sell_votes,
    no_trade_votes = EXCLUDED.no_trade_votes,
    votes_correct = EXCLUDED.votes_correct,
    accuracy_rate = EXCLUDED.accuracy_rate,
    avg_confidence = EXCLUDED.avg_confidence,
    confidence_when_correct = EXCLUDED.confidence_when_correct,
    confidence_when_wrong = EXCLUDED.confidence_when_wrong,
    avg_vote_weight = EXCLUDED.avg_vote_weight,
    updated_at = now();
END;
$$;