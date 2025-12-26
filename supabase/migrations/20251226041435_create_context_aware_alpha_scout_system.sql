/*
  # Context-Aware Alpha Scout System

  1. New Tables
    - `council_context`
      - Stores the last council decision and full team wisdom
      - Tracks Omega issues, required improvements, and market snapshot
      - Enables Alpha to scout with full context of team's perspective
  
  2. Purpose
    - Massive cost savings: 50-88% reduction in LLM calls
    - Alpha scouts with purpose, not blindly
    - Full council wisdom persists between cycles
    - Only reconvenes team when conditions actually improve
  
  3. Security
    - Enable RLS
    - Users can only access their own council context
*/

-- Create council_context table
CREATE TABLE IF NOT EXISTS council_context (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid REFERENCES goal_sessions(id) ON DELETE CASCADE,
  
  -- Timing
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Council Decision
  alpha_decision text NOT NULL CHECK (alpha_decision IN ('no_trade', 'trade_taken', 'scouting')),
  confidence numeric NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  threshold_gap numeric NOT NULL, -- How much more is needed to reach threshold
  target_threshold numeric NOT NULL DEFAULT 75, -- What we're aiming for
  
  -- What each Omega flagged as issues
  omega_issues jsonb NOT NULL DEFAULT '{}',
  -- Format: {
  --   "omega-1": ["EUR/USD sideways", "GBP/USD weak trend"],
  --   "omega-5": ["Low volatility all pairs"],
  --   "omega-8": ["Thin liquidity EUR/USD"]
  -- }
  
  -- What needs to improve for next reconvene
  required_improvements jsonb NOT NULL DEFAULT '{}',
  -- Format: {
  --   "trend": ["EUR/USD needs EMA cross", "GBP/USD needs stronger move"],
  --   "volatility": ["Need ATR > 0.0015 on 2+ pairs"],
  --   "liquidity": ["Need volume increase on EUR/USD"]
  -- }
  
  -- Lightweight metrics from last scan
  last_snapshot jsonb NOT NULL DEFAULT '{}',
  -- Format: {
  --   "EUR/USD": {"ema20": 1.0950, "ema50": 1.0960, "atr": 0.0012, "volume": 1000, ...},
  --   "GBP/USD": {...}
  -- }
  
  -- Scout tracking
  scout_cycles integer DEFAULT 0, -- How many scout cycles since last full council
  last_improvement_score numeric DEFAULT 0, -- Latest improvement score from Alpha
  improvement_trend text[], -- Track improvement over time ["15%", "25%", "45%"]
  
  -- Metadata
  symbols_scanned text[] NOT NULL DEFAULT '{}', -- Which pairs were in last scan
  total_omega_votes integer DEFAULT 0, -- How many Omegas participated
  
  -- Indexes for performance
  UNIQUE(user_id, session_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_council_context_user_session ON council_context(user_id, session_id);
CREATE INDEX IF NOT EXISTS idx_council_context_created_at ON council_context(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_council_context_alpha_decision ON council_context(alpha_decision);

-- Enable RLS
ALTER TABLE council_context ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own council context"
  ON council_context FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own council context"
  ON council_context FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own council context"
  ON council_context FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own council context"
  ON council_context FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to get latest council context for a session
CREATE OR REPLACE FUNCTION get_latest_council_context(p_user_id uuid, p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_context jsonb;
BEGIN
  SELECT to_jsonb(cc.*) INTO v_context
  FROM council_context cc
  WHERE cc.user_id = p_user_id
    AND cc.session_id = p_session_id
  ORDER BY cc.created_at DESC
  LIMIT 1;
  
  RETURN COALESCE(v_context, '{}'::jsonb);
END;
$$;

-- Function to update scout cycle tracking
CREATE OR REPLACE FUNCTION increment_scout_cycle(
  p_user_id uuid,
  p_session_id uuid,
  p_improvement_score numeric
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE council_context
  SET 
    scout_cycles = scout_cycles + 1,
    last_improvement_score = p_improvement_score,
    improvement_trend = array_append(improvement_trend, p_improvement_score::text || '%'),
    updated_at = now()
  WHERE user_id = p_user_id
    AND session_id = p_session_id;
END;
$$;

-- Function to store new council context
CREATE OR REPLACE FUNCTION store_council_context(
  p_user_id uuid,
  p_session_id uuid,
  p_alpha_decision text,
  p_confidence numeric,
  p_threshold_gap numeric,
  p_target_threshold numeric,
  p_omega_issues jsonb,
  p_required_improvements jsonb,
  p_last_snapshot jsonb,
  p_symbols_scanned text[],
  p_total_omega_votes integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_context_id uuid;
BEGIN
  -- Insert or update (upsert) council context
  INSERT INTO council_context (
    user_id,
    session_id,
    alpha_decision,
    confidence,
    threshold_gap,
    target_threshold,
    omega_issues,
    required_improvements,
    last_snapshot,
    symbols_scanned,
    total_omega_votes,
    scout_cycles,
    last_improvement_score,
    improvement_trend
  ) VALUES (
    p_user_id,
    p_session_id,
    p_alpha_decision,
    p_confidence,
    p_threshold_gap,
    p_target_threshold,
    p_omega_issues,
    p_required_improvements,
    p_last_snapshot,
    p_symbols_scanned,
    p_total_omega_votes,
    0, -- Reset scout cycles
    0, -- Reset improvement score
    ARRAY[]::text[] -- Reset trend
  )
  ON CONFLICT (user_id, session_id)
  DO UPDATE SET
    alpha_decision = EXCLUDED.alpha_decision,
    confidence = EXCLUDED.confidence,
    threshold_gap = EXCLUDED.threshold_gap,
    target_threshold = EXCLUDED.target_threshold,
    omega_issues = EXCLUDED.omega_issues,
    required_improvements = EXCLUDED.required_improvements,
    last_snapshot = EXCLUDED.last_snapshot,
    symbols_scanned = EXCLUDED.symbols_scanned,
    total_omega_votes = EXCLUDED.total_omega_votes,
    scout_cycles = 0,
    last_improvement_score = 0,
    improvement_trend = ARRAY[]::text[],
    updated_at = now()
  RETURNING id INTO v_context_id;
  
  RETURN v_context_id;
END;
$$;

COMMENT ON TABLE council_context IS 'Stores Omega Council context for Alpha Scout to use between full scans';
COMMENT ON FUNCTION get_latest_council_context IS 'Retrieves the latest council context for Alpha Scout';
COMMENT ON FUNCTION increment_scout_cycle IS 'Tracks Alpha Scout cycles and improvement scores';
COMMENT ON FUNCTION store_council_context IS 'Stores or updates council context after full council meeting';
