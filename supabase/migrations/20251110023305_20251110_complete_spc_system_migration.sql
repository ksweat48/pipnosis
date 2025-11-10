/*
  # Complete SPC System Migration - Final Deployment
  
  ## Overview
  Completes the Session Profit Coefficient (SPC) system by ensuring all tables,
  columns, functions, and RLS policies are properly deployed.
  
  ## New Tables
  1. session_trades - Links trades to sessions with comeback detection
  2. session_reports - Stores formatted session reports
  
  ## Extended Tables
  - ai_skill_progression: 9 new SPC-related columns
  
  ## Helper Functions
  - calculate_profit_weight(profit_factor)
  - calculate_comeback_bonus(losses_before, realized_rr)
  - calculate_spc_tier(session_spc)
  - calculate_session_grade(win_rate, profit_factor, session_spc)
  - get_spc_target_for_level(skill_level)
  
  ## Security
  - RLS enabled on all tables
  - Users can only access their own session data
*/

-- =====================================================
-- TABLE: session_trades
-- =====================================================
CREATE TABLE IF NOT EXISTS session_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES trading_sessions(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid REFERENCES trade_history(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Trade Sequence in Session
  trade_number integer NOT NULL,

  -- Comeback Detection
  is_comeback_trade boolean DEFAULT false,
  losses_before_comeback integer DEFAULT 0,
  comeback_bonus_applied numeric(5,2) DEFAULT 0,

  -- Trade Outcome
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven')),
  realized_rr numeric(10,2),
  pnl numeric(15,2),

  -- SPC Contribution
  profit_weight numeric(5,2),
  trade_spc_contribution numeric(10,2),

  -- Running Metrics (at time of trade)
  running_win_rate numeric(5,2),
  running_profit_factor numeric(10,2),
  consecutive_losses_before integer DEFAULT 0,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_trades_session ON session_trades(session_id, trade_number);
CREATE INDEX IF NOT EXISTS idx_session_trades_user ON session_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_session_trades_comeback ON session_trades(user_id, is_comeback_trade) WHERE is_comeback_trade = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_trades_unique ON session_trades(session_id, trade_id);

-- =====================================================
-- TABLE: session_reports
-- =====================================================
CREATE TABLE IF NOT EXISTS session_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES trading_sessions(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Report Content
  report_title text NOT NULL,
  report_content text NOT NULL,

  -- Visual Metrics
  progress_bar_data jsonb,
  spc_breakdown jsonb,

  -- Key Highlights
  comeback_highlights text[],
  key_learnings text[],
  recommendations text[],

  -- Cumulative Progress
  cumulative_spc_before numeric(10,2),
  cumulative_spc_after numeric(10,2),
  progress_change numeric(10,2),

  -- Tier Progress
  current_tier text,
  progress_to_next_tier_percent numeric(5,2),

  -- Posted to Thread
  posted_to_thread boolean DEFAULT false,
  thread_message_id text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_reports_session ON session_reports(session_id);
CREATE INDEX IF NOT EXISTS idx_session_reports_user ON session_reports(user_id, created_at DESC);

-- =====================================================
-- EXTEND: ai_skill_progression (Add SPC fields)
-- =====================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'cumulative_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN cumulative_spc numeric(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'session_count'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN session_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'average_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN average_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'best_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN best_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'worst_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN worst_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'consecutive_negative_sessions'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN consecutive_negative_sessions integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'spc_contribution_weight'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN spc_contribution_weight numeric(5,2) DEFAULT 0.60;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'last_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN last_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'spc_tier_target'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN spc_tier_target numeric(10,2) DEFAULT 10;
  END IF;
END $$;

-- =====================================================
-- RLS POLICIES
-- =====================================================

-- session_trades
ALTER TABLE session_trades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own session trades"
  ON session_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session trades"
  ON session_trades FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own session trades"
  ON session_trades FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- session_reports
ALTER TABLE session_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own session reports"
  ON session_reports FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own session reports"
  ON session_reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_profit_weight(profit_factor numeric)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  IF profit_factor >= 1.5 THEN
    RETURN 1.25;
  ELSIF profit_factor >= 1.0 THEN
    RETURN 1.0;
  ELSIF profit_factor >= 0.8 THEN
    RETURN 0.75;
  ELSE
    RETURN 0.5;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_comeback_bonus(
  losses_before integer,
  realized_rr numeric
)
RETURNS numeric
LANGUAGE plpgsql
AS $$
DECLARE
  base_bonus numeric := 0.5;
  multiplier numeric := 1.0;
BEGIN
  IF losses_before < 2 OR realized_rr < 2.0 THEN
    RETURN 0;
  END IF;

  IF losses_before >= 3 THEN
    multiplier := 2.0;
  END IF;

  RETURN base_bonus * multiplier;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_spc_tier(session_spc numeric)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF session_spc >= 5.0 THEN
    RETURN 'exceptional';
  ELSIF session_spc >= 2.0 THEN
    RETURN 'strong';
  ELSIF session_spc > 0 THEN
    RETURN 'positive';
  ELSIF session_spc = 0 THEN
    RETURN 'flat';
  ELSE
    RETURN 'negative';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_session_grade(
  win_rate numeric,
  profit_factor numeric,
  session_spc numeric
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  IF win_rate >= 75 AND profit_factor >= 2.0 AND session_spc >= 5.0 THEN
    RETURN 'A+';
  ELSIF win_rate >= 70 AND profit_factor >= 1.5 AND session_spc >= 3.0 THEN
    RETURN 'A';
  ELSIF win_rate >= 60 AND profit_factor >= 1.2 AND session_spc >= 1.0 THEN
    RETURN 'B';
  ELSIF win_rate >= 50 AND profit_factor >= 1.0 AND session_spc >= 0 THEN
    RETURN 'C';
  ELSIF win_rate >= 40 AND profit_factor >= 0.8 THEN
    RETURN 'D';
  ELSE
    RETURN 'F';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION get_spc_target_for_level(skill_level text)
RETURNS numeric
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN CASE skill_level
    WHEN 'Novice' THEN 0
    WHEN 'Intermediate' THEN 10
    WHEN 'Pro' THEN 25
    WHEN 'Expert' THEN 50
    WHEN 'Master' THEN 100
    WHEN 'Exceptional' THEN 200
    ELSE 0
  END;
END;
$$;