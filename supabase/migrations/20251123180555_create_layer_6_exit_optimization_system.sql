/*
  # Layer 6: Exit Optimization System - Database Schema

  ## Overview
  Creates tables and columns for tracking LLM exit management decisions and KPIs.

  ## New Tables

  1. `llm_exit_decisions_log`
     - Tracks every exit optimization check
     - Stores decision context and LLM reasoning
     - Records safety validation results
     - Links to trades and sessions

  ## Modified Tables

  1. `llm_pipeline_execution_log`
     - Added Layer 6 execution tracking columns

  2. `trade_history`
     - Added exit optimizer tracking columns

  3. `simulated_positions`
     - Added exit adjustment tracking columns

  ## Security
  - RLS enabled on all new tables
  - Authenticated user read access for own data
  - System write access for logging
*/

-- =====================================================
-- TABLE: llm_exit_decisions_log
-- =====================================================

CREATE TABLE IF NOT EXISTS llm_exit_decisions_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id text NOT NULL,
  session_id uuid,

  symbol text NOT NULL,
  trade_duration_minutes integer,
  unrealized_pnl numeric(12,2),
  unrealized_pnl_percent numeric(8,4),

  action_recommended text NOT NULL,
  new_stop_loss numeric(12,5),
  new_take_profit numeric(12,5),
  partial_close_percent numeric(5,2),
  trailing_stop_distance numeric(8,2),

  reasoning text,
  risk_assessment text,
  market_condition_change text,
  skill_objective_alignment text,

  confidence numeric(5,2),
  urgency text,

  safety_validated boolean DEFAULT false,
  safety_violations text[],
  blocked boolean DEFAULT false,

  prevented_loss_estimate numeric(12,2),
  expected_improvement numeric(8,4),

  execution_applied boolean DEFAULT false,
  execution_timestamp timestamptz,
  execution_outcome text,

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exit_decisions_user_id
  ON llm_exit_decisions_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exit_decisions_trade_id
  ON llm_exit_decisions_log(trade_id);
CREATE INDEX IF NOT EXISTS idx_exit_decisions_action
  ON llm_exit_decisions_log(action_recommended);
CREATE INDEX IF NOT EXISTS idx_exit_decisions_blocked
  ON llm_exit_decisions_log(blocked) WHERE blocked = true;

ALTER TABLE llm_exit_decisions_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own exit decisions"
  ON llm_exit_decisions_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "System can insert exit decisions"
  ON llm_exit_decisions_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "System can update exit decisions"
  ON llm_exit_decisions_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- =====================================================
-- MODIFY: llm_pipeline_execution_log (add Layer 6 columns)
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'layer_6_executed'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN layer_6_executed boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'layer_6_exit_decision'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN layer_6_exit_decision text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'layer_6_safety_validated'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN layer_6_safety_validated boolean DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'llm_pipeline_execution_log'
    AND column_name = 'layer_6_tokens_used'
  ) THEN
    ALTER TABLE llm_pipeline_execution_log
    ADD COLUMN layer_6_tokens_used integer DEFAULT 0;
  END IF;
END $$;

-- =====================================================
-- MODIFY: trade_history (add exit optimizer columns)
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'exit_optimizer_active'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN exit_optimizer_active boolean DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'exit_adjustments_count'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN exit_adjustments_count integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'exit_adjustment_history'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN exit_adjustment_history jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'prevented_loss_amount'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN prevented_loss_amount numeric(12,2) DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'exit_optimizer_reasoning'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN exit_optimizer_reasoning text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'trade_history'
    AND column_name = 'final_exit_decision_type'
  ) THEN
    ALTER TABLE trade_history
    ADD COLUMN final_exit_decision_type text;
  END IF;
END $$;

-- =====================================================
-- MODIFY: simulated_positions (add exit optimizer columns)
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'exit_optimizer_checks'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN exit_optimizer_checks integer DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'exit_adjustments_made'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN exit_adjustments_made jsonb DEFAULT '[]'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'exit_optimizer_decision'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN exit_optimizer_decision text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'original_stop_loss'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN original_stop_loss numeric(12,5);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'simulated_positions'
    AND column_name = 'original_take_profit'
  ) THEN
    ALTER TABLE simulated_positions
    ADD COLUMN original_take_profit numeric(12,5);
  END IF;
END $$;

-- Update existing records to store original SL/TP
UPDATE simulated_positions
SET original_stop_loss = stop_loss,
    original_take_profit = take_profit
WHERE original_stop_loss IS NULL
  AND status = 'open';

-- =====================================================
-- HELPER FUNCTIONS
-- =====================================================

-- Function to get exit optimizer KPIs for a user
CREATE OR REPLACE FUNCTION get_exit_optimizer_kpis(
  p_user_id uuid,
  p_start_date timestamptz DEFAULT now() - interval '30 days',
  p_end_date timestamptz DEFAULT now()
) RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'total_checks', COUNT(*),
    'exit_early_count', COUNT(*) FILTER (WHERE action_recommended = 'close_now'),
    'partial_exit_count', COUNT(*) FILTER (WHERE action_recommended = 'partial_close'),
    'sl_tightened_count', COUNT(*) FILTER (WHERE action_recommended = 'tighten_sl'),
    'trailing_stop_activations', COUNT(*) FILTER (WHERE action_recommended = 'activate_trailing_stop'),
    'early_tp_count', COUNT(*) FILTER (WHERE action_recommended = 'early_tp'),
    'tp_reduced_count', COUNT(*) FILTER (WHERE action_recommended = 'reduce_tp'),
    'hold_decisions', COUNT(*) FILTER (WHERE action_recommended = 'hold'),
    'safety_violations_count', COUNT(*) FILTER (WHERE NOT safety_validated),
    'blocked_decisions_count', COUNT(*) FILTER (WHERE blocked = true),
    'total_prevented_loss', COALESCE(SUM(prevented_loss_estimate), 0),
    'avg_confidence', COALESCE(AVG(confidence), 0),
    'high_urgency_count', COUNT(*) FILTER (WHERE urgency = 'high' OR urgency = 'critical'),
    'executions_applied', COUNT(*) FILTER (WHERE execution_applied = true)
  )
  INTO result
  FROM llm_exit_decisions_log
  WHERE user_id = p_user_id
    AND created_at BETWEEN p_start_date AND p_end_date;

  RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to calculate exit success rate
CREATE OR REPLACE FUNCTION calculate_exit_success_rate(
  p_user_id uuid,
  p_start_date timestamptz DEFAULT now() - interval '30 days'
) RETURNS numeric AS $$
DECLARE
  success_rate numeric;
BEGIN
  WITH exit_adjusted_trades AS (
    SELECT
      th.id,
      th.pnl,
      th.outcome,
      th.exit_adjustments_count > 0 AS had_exit_adjustment
    FROM trade_history th
    WHERE th.user_id = p_user_id
      AND th.opened_at >= p_start_date
      AND th.status = 'closed'
  )
  SELECT
    CASE
      WHEN COUNT(*) FILTER (WHERE had_exit_adjustment) = 0 THEN 0
      ELSE (COUNT(*) FILTER (WHERE had_exit_adjustment AND outcome = 'win')::numeric /
            COUNT(*) FILTER (WHERE had_exit_adjustment)::numeric * 100)
    END
  INTO success_rate
  FROM exit_adjusted_trades;

  RETURN COALESCE(success_rate, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- ENABLE REALTIME
-- =====================================================

ALTER PUBLICATION supabase_realtime ADD TABLE llm_exit_decisions_log;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE llm_exit_decisions_log IS 'Layer 6 - Exit optimization decisions with safety validation';
COMMENT ON FUNCTION get_exit_optimizer_kpis IS 'Aggregate exit optimizer KPIs for dashboard';
COMMENT ON FUNCTION calculate_exit_success_rate IS 'Calculate win rate of exit-adjusted trades';
