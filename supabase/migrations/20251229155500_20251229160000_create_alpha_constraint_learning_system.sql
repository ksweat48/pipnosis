/*
  # Alpha Constraint Learning System

  1. New Tables
    - `alpha_constraint_violations` - Track all constraint violations and how they were resolved
    - `alpha_revisions` - Track Alpha's revision decisions and their outcomes

  2. Purpose
    - Enable learning: Track which constraints Alpha violates most often
    - Measure revision effectiveness: Do revised trades perform better?
    - Optimize constraint boundaries: Are constraints too strict or too loose?
    - Monitor Alpha's growth: Does violation frequency decrease over time?

  3. Security
    - Enable RLS on all tables
    - Users can only access their own data
*/

-- Alpha Constraint Violations Table
CREATE TABLE IF NOT EXISTS alpha_constraint_violations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid,
  created_at timestamptz DEFAULT now(),

  -- Decision Context
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),
  entry_price numeric NOT NULL,

  -- Original Decision (before revision/correction)
  original_stop_loss numeric NOT NULL,
  original_take_profit numeric NOT NULL,
  original_confidence integer NOT NULL CHECK (original_confidence >= 0 AND original_confidence <= 100),
  original_rr numeric NOT NULL,

  -- Constraint That Was Violated
  violation_type text NOT NULL CHECK (violation_type IN ('MIN_RR', 'MAX_TP', 'MIN_SL', 'MAX_SL', 'SESSION_TIME')),
  violation_severity text NOT NULL CHECK (violation_severity IN ('WARNING', 'ERROR', 'CATASTROPHIC')),
  violation_message text NOT NULL,

  -- Constraints At Time Of Violation
  constraints jsonb NOT NULL,

  -- How It Was Resolved
  resolution_type text NOT NULL CHECK (resolution_type IN ('ALPHA_REVISED', 'AUTO_CORRECTED', 'BLOCKED', 'IGNORED')),
  revised_stop_loss numeric,
  revised_take_profit numeric,
  revised_confidence integer CHECK (revised_confidence >= 0 AND revised_confidence <= 100),
  revised_rr numeric,

  -- Outcome (filled when trade closes)
  trade_id uuid,
  outcome text CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING')),
  pnl_result numeric,

  -- Learning Metrics
  revision_improved_outcome boolean,
  confidence_penalty_applied integer DEFAULT 0,

  -- Metadata
  market_context jsonb,
  omega_votes jsonb
);

-- Alpha Revisions Table
CREATE TABLE IF NOT EXISTS alpha_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_session_id uuid,
  created_at timestamptz DEFAULT now(),

  -- Context
  symbol text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('BUY', 'SELL')),

  -- Original Decision
  original_decision jsonb NOT NULL,

  -- Violations That Triggered Revision
  violations jsonb NOT NULL,
  constraints jsonb NOT NULL,

  -- Revision Response
  alpha_revised boolean NOT NULL,
  revised_decision jsonb,
  revision_reasoning text,
  accepted_constraints text[],

  -- Outcome
  trade_id uuid,
  outcome text CHECK (outcome IN ('WIN', 'LOSS', 'BREAKEVEN', 'PENDING')),
  pnl_result numeric,

  -- Learning Metrics
  revision_time_ms integer,
  llm_tokens_used integer,
  confidence_change integer,
  improved_outcome boolean
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_alpha_violations_user_id ON alpha_constraint_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_alpha_violations_created_at ON alpha_constraint_violations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_violations_violation_type ON alpha_constraint_violations(violation_type);
CREATE INDEX IF NOT EXISTS idx_alpha_violations_resolution_type ON alpha_constraint_violations(resolution_type);
CREATE INDEX IF NOT EXISTS idx_alpha_violations_outcome ON alpha_constraint_violations(outcome);
CREATE INDEX IF NOT EXISTS idx_alpha_violations_symbol ON alpha_constraint_violations(symbol);

CREATE INDEX IF NOT EXISTS idx_alpha_revisions_user_id ON alpha_revisions(user_id);
CREATE INDEX IF NOT EXISTS idx_alpha_revisions_created_at ON alpha_revisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alpha_revisions_alpha_revised ON alpha_revisions(alpha_revised);
CREATE INDEX IF NOT EXISTS idx_alpha_revisions_symbol ON alpha_revisions(symbol);

-- Enable RLS
ALTER TABLE alpha_constraint_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alpha_revisions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own constraint violations"
  ON alpha_constraint_violations FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own constraint violations"
  ON alpha_constraint_violations FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own constraint violations"
  ON alpha_constraint_violations FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own revisions"
  ON alpha_revisions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own revisions"
  ON alpha_revisions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own revisions"
  ON alpha_revisions FOR UPDATE TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE alpha_constraint_violations IS 'Tracks all constraint violations by Alpha and how they were resolved';
COMMENT ON TABLE alpha_revisions IS 'Detailed tracking of Alpha revision loop effectiveness';
