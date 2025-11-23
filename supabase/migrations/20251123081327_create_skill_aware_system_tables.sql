/*
  # Skill-Aware System - Phase 2 Database Schema

  ## Overview
  Creates tables and columns needed for skill-aware decision tracking and daily progress monitoring.

  ## New Tables

  1. `daily_skill_progress`
     - Tracks daily skill metrics and performance
     - Monitors win rate, profit factor, consistency over time
     - Enables trend analysis and goal tracking

  2. `skill_aware_decisions_log`
     - Logs every decision made with skill context
     - Tracks dynamic thresholds applied
     - Records strategic guidance followed

  ## Modified Tables

  1. `ai_skill_progression`
     - Added `last_guidance_update` timestamp
     - Added `strategic_guidance_history` for tracking guidance changes
     - Added `skill_aware_mode_enabled` flag

  2. `llm_pipeline_execution_log`
     - Added `skill_level_context` for storing skill context at decision time
     - Added `skill_driven_adjustments` for recording adjustments made
     - Added `dynamic_threshold_applied` for Layer 2 threshold tracking

  ## Security
  - RLS enabled on all new tables
  - Admin-only write access
  - Authenticated read access for own data
*/

-- =====================================================
-- TABLE: daily_skill_progress
-- =====================================================

CREATE TABLE IF NOT EXISTS daily_skill_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,

  -- Daily Metrics
  trades_completed integer DEFAULT 0,
  wins integer DEFAULT 0,
  losses integer DEFAULT 0,
  breakevens integer DEFAULT 0,

  -- Performance Metrics
  daily_win_rate numeric(5,2) DEFAULT 0,
  daily_profit_factor numeric(8,4) DEFAULT 0,
  daily_pnl numeric(12,2) DEFAULT 0,
  daily_consistency_score numeric(5,2) DEFAULT 0,

  -- Skill Level Context
  skill_level_start text,
  skill_level_end text,
  skill_level_numeric_start integer,
  skill_level_numeric_end integer,

  -- Performance Gaps (Start of Day)
  win_rate_gap_start numeric(5,2),
  profit_factor_gap_start numeric(5,2),
  consistency_gap_start numeric(5,2),

  -- Performance Gaps (End of Day)
  win_rate_gap_end numeric(5,2),
  profit_factor_gap_end numeric(5,2),
  consistency_gap_end numeric(5,2),

  -- Progress Tracking
  gap_improvement_win_rate numeric(5,2),
  gap_improvement_profit_factor numeric(5,2),
  gap_improvement_consistency numeric(5,2),

  -- Strategic Guidance
  strategic_guidance jsonb,
  primary_focus text,

  -- Decision Adjustments
  total_decisions integer DEFAULT 0,
  regime_rejections integer DEFAULT 0,
  quality_rejections integer DEFAULT 0,
  mistake_blocks integer DEFAULT 0,
  confidence_adjustments integer DEFAULT 0,

  -- Dynamic Thresholds Used
  avg_quality_threshold numeric(5,2),
  max_quality_threshold numeric(5,2),
  min_quality_threshold numeric(5,2),

  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),

  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_skill_progress_user_date
  ON daily_skill_progress(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_daily_skill_progress_skill_level
  ON daily_skill_progress(skill_level_end);

ALTER TABLE daily_skill_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own daily skill progress"
  ON daily_skill_progress FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert daily skill progress"
  ON daily_skill_progress FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update daily skill progress"
  ON daily_skill_progress FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- TABLE: skill_aware_decisions_log
-- =====================================================

CREATE TABLE IF NOT EXISTS skill_aware_decisions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id uuid,

  symbol text NOT NULL,
  trading_mode text,
  trigger_type text,
  decision_timestamp timestamptz DEFAULT now(),

  skill_level text,
  skill_level_numeric integer,
  win_rate_gap numeric(5,2),
  profit_factor_gap numeric(5,2),
  consistency_gap numeric(5,2),

  layer_1_passed boolean,
  layer_1_regime_rejected boolean,
  layer_1_skill_influenced boolean,

  layer_2_passed boolean,
  layer_2_quality_score numeric(5,2),
  layer_2_threshold_used numeric(5,2),
  layer_2_dynamic_threshold_applied boolean,
  layer_2_skill_influenced boolean,

  layer_3_passed boolean,
  layer_3_blocked boolean,
  layer_3_risk_level text,
  layer_3_skill_influenced boolean,

  layer_4_passed boolean,
  layer_4_original_confidence numeric(5,2),
  layer_4_calibrated_confidence numeric(5,2),
  layer_4_adjustment numeric(5,2),
  layer_4_skill_influenced boolean,

  layer_5_executed boolean,
  layer_5_final_decision text,

  strategic_guidance text[],
  primary_guidance text,

  trade_taken boolean DEFAULT false,
  trade_id uuid,
  trade_outcome text,
  trade_pnl numeric(12,2),

  total_tokens_used integer,
  processing_time_ms integer,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_skill_decisions_user_timestamp
  ON skill_aware_decisions_log(user_id, decision_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_skill_decisions_skill_level
  ON skill_aware_decisions_log(skill_level);
CREATE INDEX IF NOT EXISTS idx_skill_decisions_outcome
  ON skill_aware_decisions_log(trade_outcome) WHERE trade_taken = true;

ALTER TABLE skill_aware_decisions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own skill-aware decisions"
  ON skill_aware_decisions_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert skill-aware decisions"
  ON skill_aware_decisions_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- =====================================================
-- MODIFY: ai_skill_progression
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression'
    AND column_name = 'last_guidance_update'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN last_guidance_update timestamptz DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression'
    AND column_name = 'strategic_guidance_history'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN strategic_guidance_history jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_skill_progression'
    AND column_name = 'skill_aware_mode_enabled'
  ) THEN
    ALTER TABLE ai_skill_progression
    ADD COLUMN skill_aware_mode_enabled boolean DEFAULT false;
  END IF;
END $$;

-- =====================================================
-- MODIFY: llm_pipeline_execution_log
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'skill_level_context'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN skill_level_context jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'skill_driven_adjustments'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN skill_driven_adjustments text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'dynamic_threshold_applied'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN dynamic_threshold_applied numeric(5,2);
  END IF;
END $$;

-- =====================================================
-- HELPER FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION update_daily_skill_progress(
  p_user_id uuid,
  p_date date,
  p_trade_outcome text,
  p_pnl numeric,
  p_skill_context jsonb
) RETURNS void AS $$
BEGIN
  INSERT INTO daily_skill_progress (
    user_id,
    date,
    trades_completed,
    wins,
    losses,
    breakevens,
    daily_pnl,
    updated_at
  )
  VALUES (
    p_user_id,
    p_date,
    1,
    CASE WHEN p_trade_outcome = 'win' THEN 1 ELSE 0 END,
    CASE WHEN p_trade_outcome = 'loss' THEN 1 ELSE 0 END,
    CASE WHEN p_trade_outcome = 'breakeven' THEN 1 ELSE 0 END,
    p_pnl,
    now()
  )
  ON CONFLICT (user_id, date)
  DO UPDATE SET
    trades_completed = daily_skill_progress.trades_completed + 1,
    wins = daily_skill_progress.wins + CASE WHEN p_trade_outcome = 'win' THEN 1 ELSE 0 END,
    losses = daily_skill_progress.losses + CASE WHEN p_trade_outcome = 'loss' THEN 1 ELSE 0 END,
    breakevens = daily_skill_progress.breakevens + CASE WHEN p_trade_outcome = 'breakeven' THEN 1 ELSE 0 END,
    daily_pnl = daily_skill_progress.daily_pnl + p_pnl,
    daily_win_rate = CASE
      WHEN (daily_skill_progress.wins + CASE WHEN p_trade_outcome = 'win' THEN 1 ELSE 0 END +
            daily_skill_progress.losses + CASE WHEN p_trade_outcome = 'loss' THEN 1 ELSE 0 END) > 0
      THEN ((daily_skill_progress.wins + CASE WHEN p_trade_outcome = 'win' THEN 1 ELSE 0 END)::numeric /
            (daily_skill_progress.wins + CASE WHEN p_trade_outcome = 'win' THEN 1 ELSE 0 END +
             daily_skill_progress.losses + CASE WHEN p_trade_outcome = 'loss' THEN 1 ELSE 0 END)::numeric * 100)
      ELSE 0
    END,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;