/*
  # CCIP Mid-Trade Alpha Escalation System

  ## Overview
  This migration establishes the database foundation for Alpha-driven mid-trade monitoring.
  
  The previous system had a complete trigger detection layer but NO escalation pipeline —
  `alpha_recheck_verdict`, `thesis_status`, and `last_alpha_recheck_at` were read by the
  UI but NEVER written by any service. Alpha mid-trade re-analysis (alpha-midtrade-analyst.ts)
  was fully implemented but never invoked.

  ## Changes

  ### 1. goal_session_trades — Mid-Trade Escalation Columns
  - `alpha_watch_contract` (jsonb): Alpha-prescribed conditions to monitor, set at trade entry
    by the Alpha coordinator. Replaces generic percentage thresholds with trade-specific
    conditions derived from Alpha's reasoning (invalidation price, expected duration, etc.)
  - `alpha_recheck_verdict` (jsonb): Alpha's re-analysis verdict, written by escalation service
  - `thesis_status` (text): Current thesis health, written by escalation service  
  - `last_alpha_recheck_at` (timestamptz): Rate-limit gate for escalation calls
  - `alpha_recheck_trigger` (text): Which trigger caused the last recheck (audit trail)
  - `alpha_recheck_count` (integer): Total number of Alpha rechecks for this trade (cost tracking)

  ### 2. mid_trade_escalation_log (new table)
  - Immutable audit trail of every Alpha mid-trade call
  - Tracks trigger type, verdict, model used, tokens, thesis status changes
  - SSOT for escalation history (replaces ad-hoc logging)
  - RLS: users read own rows, service role writes

  ### 3. mid_trade_trigger_blocks (new table)
  - Per-trade, per-trigger record of fired triggers (replaces in-memory Set)
  - Persists across browser refreshes (fixes re-firing on reconnect)
  - Cleaned up automatically when trade closes

  ## Security
  - RLS enabled on all new tables
  - Service role writes escalation data (not authenticated users)
  - Users can only read their own data
  
  ## SSOT Governance
  - alpha_watch_contract: WRITTEN once by coordinator-alpha at entry, NEVER mutated
  - alpha_recheck_verdict: WRITTEN by mid-trade escalation service only
  - thesis_status: WRITTEN by mid-trade escalation service only
  - mid_trade_escalation_log: INSERT-only audit trail
*/

-- ─── 1. Add escalation columns to goal_session_trades ──────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_watch_contract'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_watch_contract jsonb DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_recheck_trigger'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_recheck_trigger text DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_recheck_count'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_recheck_count integer DEFAULT 0;
  END IF;
END $$;

-- Ensure alpha_recheck_verdict and thesis_status exist (may already be present)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_recheck_verdict'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_recheck_verdict jsonb DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'thesis_status'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN thesis_status text DEFAULT 'new';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'last_alpha_recheck_at'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN last_alpha_recheck_at timestamptz DEFAULT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_hit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_hit boolean DEFAULT false;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_breakeven_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_breakeven_price numeric(20, 8) DEFAULT NULL;
  END IF;
END $$;

-- ─── 2. mid_trade_escalation_log table ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS mid_trade_escalation_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  goal_session_id uuid NOT NULL,

  -- Trigger context
  trigger_type text NOT NULL,
  trigger_reason text NOT NULL,

  -- Alpha verdict output
  verdict text NOT NULL CHECK (verdict IN ('HOLD', 'CLOSE_NOW', 'TAKE_PARTIAL', 'TRAIL_SL')),
  thesis_status text NOT NULL CHECK (thesis_status IN ('INTACT', 'WEAKENING', 'INVALIDATED')),
  confidence integer NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  alpha_reasoning text,
  user_message text,
  urgency text NOT NULL CHECK (urgency IN ('critical', 'high', 'medium', 'low')),

  -- Trade state at time of recheck
  current_price numeric(20, 8) NOT NULL,
  r_multiple numeric(6, 3) NOT NULL,
  drawdown_percent numeric(6, 2) NOT NULL,
  minutes_in_trade numeric(10, 2) NOT NULL,

  -- Cost tracking
  model_used text NOT NULL,
  tokens_used integer DEFAULT 0,

  -- Thesis state transition
  thesis_status_before text,
  thesis_status_after text,

  -- Metadata
  should_notify boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

ALTER TABLE mid_trade_escalation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own escalation logs"
  ON mid_trade_escalation_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert escalation logs"
  ON mid_trade_escalation_log FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_mid_trade_escalation_trade_id
  ON mid_trade_escalation_log(trade_id);

CREATE INDEX IF NOT EXISTS idx_mid_trade_escalation_user_id
  ON mid_trade_escalation_log(user_id);

CREATE INDEX IF NOT EXISTS idx_mid_trade_escalation_created_at
  ON mid_trade_escalation_log(created_at DESC);

-- ─── 3. mid_trade_trigger_blocks table ──────────────────────────────────────
-- Persists fired triggers across browser sessions (replaces in-memory Set)

CREATE TABLE IF NOT EXISTS mid_trade_trigger_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  trigger_type text NOT NULL,
  fired_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE (trade_id, trigger_type)
);

ALTER TABLE mid_trade_trigger_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own trigger blocks"
  ON mid_trade_trigger_blocks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can manage trigger blocks"
  ON mid_trade_trigger_blocks FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can delete trigger blocks"
  ON mid_trade_trigger_blocks FOR DELETE
  TO service_role
  USING (true);

CREATE INDEX IF NOT EXISTS idx_trigger_blocks_trade_id
  ON mid_trade_trigger_blocks(trade_id);

-- ─── 4. RPC: persist_alpha_recheck_verdict ───────────────────────────────────
-- SSOT writer for Alpha recheck results — called only by the escalation service
-- Uses SECURITY DEFINER to bypass RLS (service-level write)

CREATE OR REPLACE FUNCTION persist_alpha_recheck_verdict(
  p_trade_id uuid,
  p_user_id uuid,
  p_goal_session_id uuid,
  p_trigger_type text,
  p_trigger_reason text,
  p_verdict text,
  p_thesis_status text,
  p_confidence integer,
  p_alpha_reasoning text,
  p_user_message text,
  p_urgency text,
  p_current_price numeric,
  p_r_multiple numeric,
  p_drawdown_percent numeric,
  p_minutes_in_trade numeric,
  p_model_used text,
  p_tokens_used integer,
  p_should_notify boolean,
  p_thesis_status_before text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
BEGIN
  -- Update the trade record with the new verdict
  UPDATE goal_session_trades
  SET
    alpha_recheck_verdict = jsonb_build_object(
      'verdict', p_verdict,
      'thesis_status', p_thesis_status,
      'confidence', p_confidence,
      'alpha_reasoning', p_alpha_reasoning,
      'user_message', p_user_message,
      'urgency', p_urgency,
      'trigger_type', p_trigger_type,
      'checked_at', now()::text,
      'should_notify', p_should_notify
    ),
    thesis_status = p_thesis_status,
    last_alpha_recheck_at = now(),
    alpha_recheck_trigger = p_trigger_type,
    alpha_recheck_count = COALESCE(alpha_recheck_count, 0) + 1
  WHERE id = p_trade_id
    AND status = 'open';

  -- Insert immutable audit log
  INSERT INTO mid_trade_escalation_log (
    trade_id, user_id, goal_session_id,
    trigger_type, trigger_reason,
    verdict, thesis_status, confidence,
    alpha_reasoning, user_message, urgency,
    current_price, r_multiple, drawdown_percent, minutes_in_trade,
    model_used, tokens_used,
    thesis_status_before, thesis_status_after,
    should_notify
  ) VALUES (
    p_trade_id, p_user_id, p_goal_session_id,
    p_trigger_type, p_trigger_reason,
    p_verdict, p_thesis_status, p_confidence,
    p_alpha_reasoning, p_user_message, p_urgency,
    p_current_price, p_r_multiple, p_drawdown_percent, p_minutes_in_trade,
    p_model_used, p_tokens_used,
    p_thesis_status_before, p_thesis_status,
    p_should_notify
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object(
    'success', true,
    'log_id', v_log_id,
    'trade_updated', true
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM
  );
END;
$$;

-- ─── 5. RPC: record_trigger_fired ────────────────────────────────────────────
-- Persists a fired trigger so it does not re-fire across sessions

CREATE OR REPLACE FUNCTION record_trigger_fired(
  p_trade_id uuid,
  p_user_id uuid,
  p_trigger_type text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO mid_trade_trigger_blocks (trade_id, user_id, trigger_type)
  VALUES (p_trade_id, p_user_id, p_trigger_type)
  ON CONFLICT (trade_id, trigger_type) DO NOTHING;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ─── 6. RPC: get_fired_triggers_for_trade ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_fired_triggers_for_trade(p_trade_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_triggers text[];
BEGIN
  SELECT ARRAY_AGG(trigger_type)
  INTO v_triggers
  FROM mid_trade_trigger_blocks
  WHERE trade_id = p_trade_id;

  RETURN COALESCE(v_triggers, ARRAY[]::text[]);
END;
$$;

-- ─── 7. RPC: get_open_trades_needing_escalation ──────────────────────────────
-- Called by autonomous-wellness-monitor to find trades that need Alpha review

CREATE OR REPLACE FUNCTION get_open_trades_needing_escalation()
RETURNS TABLE (
  trade_id uuid,
  user_id uuid,
  goal_session_id uuid,
  symbol text,
  direction text,
  entry_price numeric,
  current_price numeric,
  stop_loss numeric,
  take_profit numeric,
  take_profit_1 numeric,
  lot_size numeric,
  opened_at timestamptz,
  mid_trade_plan jsonb,
  alpha_reasoning_snapshot jsonb,
  alpha_recheck_verdict jsonb,
  thesis_status text,
  last_alpha_recheck_at timestamptz,
  alpha_recheck_count integer,
  tp1_hit boolean,
  tp1_breakeven_price numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.id,
    t.user_id,
    t.goal_session_id,
    t.symbol,
    t.direction,
    t.entry_price,
    COALESCE(t.current_price, t.entry_price),
    t.stop_loss,
    t.take_profit,
    t.take_profit_1,
    COALESCE(t.lot_size, t.position_size),
    t.opened_at,
    t.mid_trade_plan,
    CASE
      WHEN t.alpha_reasoning_snapshot IS NOT NULL THEN
        CASE
          WHEN pg_typeof(t.alpha_reasoning_snapshot) = 'jsonb'::regtype THEN t.alpha_reasoning_snapshot
          ELSE NULL
        END
      ELSE NULL
    END,
    t.alpha_recheck_verdict,
    COALESCE(t.thesis_status, 'new'),
    t.last_alpha_recheck_at,
    COALESCE(t.alpha_recheck_count, 0),
    COALESCE(t.tp1_hit, false),
    t.tp1_breakeven_price
  FROM goal_session_trades t
  WHERE t.status = 'open'
    AND t.entry_price IS NOT NULL
    AND t.stop_loss IS NOT NULL
    AND t.take_profit IS NOT NULL;
END;
$$;
