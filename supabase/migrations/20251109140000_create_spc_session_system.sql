/*
  # Enhanced AI Learning Progress System with SPC

  ## Overview
  This migration implements the Session Profit Coefficient (SPC) system for granular
  session-based trading progress tracking with comeback detection and adaptive defensive mode.

  ## New Tables

  1. `trading_sessions`
     - Manual start/stop user trading sessions
     - Track session state (active, paused, ended)
     - Calculate session-level metrics (win rate, PF, avg R:R, SPC)
     - Link to trades via session_trades table

  2. `session_trades`
     - Join table linking trade_history to trading_sessions
     - Store SPC calculations per trade
     - Track comeback trades and profit weights
     - Enable session-level aggregations

  3. `session_reports`
     - Store formatted session learning reports
     - Track progress bars and visual metrics
     - Link to Pipnosis Thread for display

  ## SPC Fields Added to ai_skill_progression
     - cumulative_spc (total SPC across all sessions)
     - session_count (number of sessions completed)
     - average_session_spc (mean SPC per session)
     - best_session_spc (highest SPC achieved)
     - worst_session_spc (lowest SPC recorded)
     - consecutive_negative_sessions (for defensive mode trigger)
     - spc_contribution_weight (60% by default, combined with CSS 40%)

  ## Security
  - RLS enabled on all tables
  - Users can only access their own session data
  - Authenticated users can read and write their sessions
*/

-- =====================================================
-- TABLE: trading_sessions
-- =====================================================
CREATE TABLE IF NOT EXISTS trading_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Session Lifecycle
  session_start timestamptz DEFAULT now(),
  session_end timestamptz,
  session_status text NOT NULL DEFAULT 'active' CHECK (session_status IN ('active', 'paused', 'ended')),
  session_name text, -- Optional user-provided name
  session_notes text, -- User notes about trading conditions

  -- Session Metrics (calculated on session end)
  total_trades integer DEFAULT 0,
  winning_trades integer DEFAULT 0,
  losing_trades integer DEFAULT 0,
  breakeven_trades integer DEFAULT 0,
  win_rate numeric(5,2) DEFAULT 0,

  -- Profitability Metrics
  total_pnl numeric(15,2) DEFAULT 0,
  total_wins_pnl numeric(15,2) DEFAULT 0,
  total_losses_pnl numeric(15,2) DEFAULT 0,
  profit_factor numeric(10,2) DEFAULT 0,
  average_rr numeric(10,2) DEFAULT 0,

  -- SPC Calculation
  profit_weight numeric(5,2) DEFAULT 1.0, -- Based on profit factor tier
  base_spc numeric(10,2) DEFAULT 0, -- (wins - losses) * profit_weight
  comeback_bonus numeric(10,2) DEFAULT 0, -- Bonus from comeback trades
  session_spc numeric(10,2) DEFAULT 0, -- base_spc + comeback_bonus
  spc_tier text, -- 'exceptional', 'strong', 'positive', 'flat', 'negative'

  -- Comeback Trade Tracking
  comeback_trades_count integer DEFAULT 0,
  max_consecutive_losses integer DEFAULT 0,

  -- Drawdown & Risk
  max_drawdown_percent numeric(5,2) DEFAULT 0,
  max_drawdown_amount numeric(15,2) DEFAULT 0,
  defensive_mode_triggered boolean DEFAULT false,

  -- Session Mood/Grade
  session_grade text, -- 'A+', 'A', 'B', 'C', 'D', 'F'
  session_mood text, -- 'Strong Recovery', 'Steady Profits', 'Flat Day', 'Defensive Mode Active', 'Regression Risk'

  -- Metadata
  symbols_traded text[] DEFAULT ARRAY[]::text[],
  strategies_used text[] DEFAULT ARRAY[]::text[],

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trading_sessions_user_id ON trading_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_status ON trading_sessions(user_id, session_status);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_date ON trading_sessions(user_id, session_start DESC);
CREATE INDEX IF NOT EXISTS idx_trading_sessions_spc ON trading_sessions(user_id, session_spc DESC);

-- =====================================================
-- TABLE: session_trades
-- =====================================================
CREATE TABLE IF NOT EXISTS session_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES trading_sessions(id) ON DELETE CASCADE NOT NULL,
  trade_id uuid REFERENCES trade_history(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- Trade Sequence in Session
  trade_number integer NOT NULL, -- 1st, 2nd, 3rd trade in session

  -- Comeback Detection
  is_comeback_trade boolean DEFAULT false,
  losses_before_comeback integer DEFAULT 0, -- Number of losses before this comeback
  comeback_bonus_applied numeric(5,2) DEFAULT 0, -- 0.5 base, 1.0 if 3+ losses

  -- Trade Outcome
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven')),
  realized_rr numeric(10,2), -- Actual R:R achieved
  pnl numeric(15,2),

  -- SPC Contribution
  profit_weight numeric(5,2), -- Session's profit weight at time of trade
  trade_spc_contribution numeric(10,2), -- This trade's SPC impact

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
  report_content text NOT NULL, -- Formatted markdown report

  -- Visual Metrics
  progress_bar_data jsonb, -- Progress bar segments with colors
  spc_breakdown jsonb, -- Detailed SPC calculation breakdown

  -- Key Highlights
  comeback_highlights text[], -- List of comeback trade celebrations
  key_learnings text[],
  recommendations text[],

  -- Cumulative Progress
  cumulative_spc_before numeric(10,2),
  cumulative_spc_after numeric(10,2),
  progress_change numeric(10,2), -- Difference

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
  -- Add cumulative_spc if not exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'cumulative_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN cumulative_spc numeric(10,2) DEFAULT 0;
  END IF;

  -- Add session_count
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'session_count'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN session_count integer DEFAULT 0;
  END IF;

  -- Add average_session_spc
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'average_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN average_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  -- Add best_session_spc
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'best_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN best_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  -- Add worst_session_spc
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'worst_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN worst_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  -- Add consecutive_negative_sessions
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'consecutive_negative_sessions'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN consecutive_negative_sessions integer DEFAULT 0;
  END IF;

  -- Add spc_contribution_weight
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'spc_contribution_weight'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN spc_contribution_weight numeric(5,2) DEFAULT 0.60;
  END IF;

  -- Add last_session_spc
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression' AND column_name = 'last_session_spc'
  ) THEN
    ALTER TABLE ai_skill_progression ADD COLUMN last_session_spc numeric(10,2) DEFAULT 0;
  END IF;

  -- Add spc_tier_target for current skill level
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

-- trading_sessions
ALTER TABLE trading_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trading sessions"
  ON trading_sessions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own trading sessions"
  ON trading_sessions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own trading sessions"
  ON trading_sessions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own trading sessions"
  ON trading_sessions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

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

-- Calculate profit weight based on profit factor
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

-- Calculate comeback bonus
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
  -- Must have at least 2 losses and R:R >= 2.0 to qualify
  IF losses_before < 2 OR realized_rr < 2.0 THEN
    RETURN 0;
  END IF;

  -- Double bonus if 3+ losses
  IF losses_before >= 3 THEN
    multiplier := 2.0;
  END IF;

  RETURN base_bonus * multiplier;
END;
$$;

-- Calculate SPC tier based on session SPC value
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

-- Calculate session grade
CREATE OR REPLACE FUNCTION calculate_session_grade(
  win_rate numeric,
  profit_factor numeric,
  session_spc numeric
)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
  -- A+ Grade: WR >= 75%, PF >= 2.0, SPC >= 5
  IF win_rate >= 75 AND profit_factor >= 2.0 AND session_spc >= 5.0 THEN
    RETURN 'A+';
  -- A Grade: WR >= 70%, PF >= 1.5, SPC >= 3
  ELSIF win_rate >= 70 AND profit_factor >= 1.5 AND session_spc >= 3.0 THEN
    RETURN 'A';
  -- B Grade: WR >= 60%, PF >= 1.2, SPC >= 1
  ELSIF win_rate >= 60 AND profit_factor >= 1.2 AND session_spc >= 1.0 THEN
    RETURN 'B';
  -- C Grade: WR >= 50%, PF >= 1.0, SPC >= 0
  ELSIF win_rate >= 50 AND profit_factor >= 1.0 AND session_spc >= 0 THEN
    RETURN 'C';
  -- D Grade: WR >= 40%, PF >= 0.8
  ELSIF win_rate >= 40 AND profit_factor >= 0.8 THEN
    RETURN 'D';
  -- F Grade: Below minimum standards
  ELSE
    RETURN 'F';
  END IF;
END;
$$;

-- Get SPC target for skill level
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
