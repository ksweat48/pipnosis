/*
  # Mid-Trade Alpha Re-Analysis System

  ## Summary
  Adds infrastructure for Alpha to re-analyze live trades at important trigger points
  (not on a fixed timer — only when a deterministic trigger fires).

  ## New Columns on goal_session_trades
  - `thesis_status` (text) — Alpha's current verdict on the original thesis:
      'INTACT' | 'WEAKENING' | 'INVALIDATED' | null (null = not yet evaluated)
  - `last_alpha_recheck_at` (timestamptz) — when Alpha last ran a re-analysis
  - `alpha_recheck_verdict` (jsonb) — Alpha's last structured verdict for UI display
  - `alpha_recheck_count` (int) — total times Alpha was called mid-trade (governance audit)

  ## New Table: mid_trade_alpha_rechecks
  Full audit log of every Alpha mid-trade re-analysis. Used by UI to display
  Alpha's reasoning history and by the analyst to prevent duplicate calls.

  ## Security
  - RLS enabled on mid_trade_alpha_rechecks
  - Users can only read their own recheck records
  - Service role can insert (called from Netlify functions)

  ## Notes
  - All changes are additive — zero destructive operations
  - thesis_status defaults to NULL, populated only when Alpha runs
  - alpha_recheck_count defaults to 0
*/

-- ─── Step 1: Add new columns to goal_session_trades ────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'thesis_status'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN thesis_status text
        CHECK (thesis_status IN ('INTACT', 'WEAKENING', 'INVALIDATED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'last_alpha_recheck_at'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN last_alpha_recheck_at timestamptz;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_recheck_verdict'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN alpha_recheck_verdict jsonb;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_recheck_count'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD COLUMN alpha_recheck_count integer DEFAULT 0;
  END IF;
END $$;

-- ─── Step 2: Create mid_trade_alpha_rechecks audit table ────────────────────
CREATE TABLE IF NOT EXISTS mid_trade_alpha_rechecks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id uuid NOT NULL REFERENCES goal_session_trades(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  goal_session_id uuid NOT NULL,

  -- What fired this re-analysis
  trigger_type text NOT NULL,
  trigger_reason text NOT NULL,

  -- Trade state at time of recheck
  current_price numeric NOT NULL,
  r_multiple numeric NOT NULL,
  drawdown_percent numeric NOT NULL,
  minutes_in_trade integer NOT NULL,
  thesis_intact_before boolean NOT NULL DEFAULT true,

  -- Alpha's verdict
  verdict text NOT NULL CHECK (verdict IN ('HOLD', 'CLOSE_NOW', 'TAKE_PARTIAL', 'TRAIL_SL')),
  thesis_status text NOT NULL CHECK (thesis_status IN ('INTACT', 'WEAKENING', 'INVALIDATED')),
  confidence integer NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  alpha_reasoning text NOT NULL,
  user_message text NOT NULL,

  -- Model used
  model_used text NOT NULL DEFAULT 'gpt-4o-mini',
  tokens_used integer DEFAULT 0,

  -- Notification created
  notification_id uuid,
  notification_type text,

  created_at timestamptz DEFAULT now()
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_mid_trade_alpha_rechecks_trade_id
  ON mid_trade_alpha_rechecks(trade_id);

CREATE INDEX IF NOT EXISTS idx_mid_trade_alpha_rechecks_user_id
  ON mid_trade_alpha_rechecks(user_id);

CREATE INDEX IF NOT EXISTS idx_mid_trade_alpha_rechecks_created_at
  ON mid_trade_alpha_rechecks(created_at DESC);

-- ─── Step 3: RLS on mid_trade_alpha_rechecks ───────────────────────────────
ALTER TABLE mid_trade_alpha_rechecks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own recheck records"
  ON mid_trade_alpha_rechecks FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert recheck records"
  ON mid_trade_alpha_rechecks FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Authenticated users can insert own recheck records"
  ON mid_trade_alpha_rechecks FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- ─── Step 4: RPC to write Alpha re-analysis result ─────────────────────────
CREATE OR REPLACE FUNCTION record_alpha_midtrade_recheck(
  p_trade_id uuid,
  p_user_id uuid,
  p_goal_session_id uuid,
  p_trigger_type text,
  p_trigger_reason text,
  p_current_price numeric,
  p_r_multiple numeric,
  p_drawdown_percent numeric,
  p_minutes_in_trade integer,
  p_thesis_intact_before boolean,
  p_verdict text,
  p_thesis_status text,
  p_confidence integer,
  p_alpha_reasoning text,
  p_user_message text,
  p_model_used text DEFAULT 'gpt-4o-mini',
  p_tokens_used integer DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recheck_id uuid;
  v_notification_id uuid;
  v_notification_type text;
BEGIN
  -- Insert recheck audit record
  INSERT INTO mid_trade_alpha_rechecks (
    trade_id, user_id, goal_session_id,
    trigger_type, trigger_reason,
    current_price, r_multiple, drawdown_percent, minutes_in_trade,
    thesis_intact_before,
    verdict, thesis_status, confidence,
    alpha_reasoning, user_message,
    model_used, tokens_used
  ) VALUES (
    p_trade_id, p_user_id, p_goal_session_id,
    p_trigger_type, p_trigger_reason,
    p_current_price, p_r_multiple, p_drawdown_percent, p_minutes_in_trade,
    p_thesis_intact_before,
    p_verdict, p_thesis_status, p_confidence,
    p_alpha_reasoning, p_user_message,
    p_model_used, p_tokens_used
  ) RETURNING id INTO v_recheck_id;

  -- Update trade with latest recheck state
  UPDATE goal_session_trades
  SET
    thesis_status = p_thesis_status,
    last_alpha_recheck_at = now(),
    alpha_recheck_verdict = jsonb_build_object(
      'verdict', p_verdict,
      'thesis_status', p_thesis_status,
      'confidence', p_confidence,
      'alpha_reasoning', p_alpha_reasoning,
      'user_message', p_user_message,
      'trigger_type', p_trigger_type,
      'checked_at', now()
    ),
    alpha_recheck_count = COALESCE(alpha_recheck_count, 0) + 1
  WHERE id = p_trade_id;

  -- Create notification for non-HOLD verdicts
  IF p_verdict != 'HOLD' THEN
    v_notification_type := CASE p_verdict
      WHEN 'CLOSE_NOW'     THEN 'midtrade_exit_immediately'
      WHEN 'TAKE_PARTIAL'  THEN 'midtrade_take_profit_early'
      WHEN 'TRAIL_SL'      THEN 'midtrade_trail_sl'
      ELSE 'midtrade_alert'
    END;

    INSERT INTO goal_notifications (
      user_id,
      type,
      title,
      message,
      metadata,
      requires_user_alert,
      send_push,
      created_at
    ) VALUES (
      p_user_id,
      v_notification_type,
      CASE p_verdict
        WHEN 'CLOSE_NOW'    THEN 'Alpha: Close Trade Now'
        WHEN 'TAKE_PARTIAL' THEN 'Alpha: Consider Taking Profit'
        WHEN 'TRAIL_SL'     THEN 'Alpha: Trail Your Stop Loss'
        ELSE 'Alpha Mid-Trade Update'
      END,
      p_user_message,
      jsonb_build_object(
        'trade_id', p_trade_id,
        'recheck_id', v_recheck_id,
        'verdict', p_verdict,
        'thesis_status', p_thesis_status,
        'confidence', p_confidence,
        'trigger_type', p_trigger_type,
        'r_multiple', p_r_multiple,
        'alpha_reasoning', p_alpha_reasoning
      ),
      p_verdict IN ('CLOSE_NOW', 'TAKE_PARTIAL'),
      p_verdict = 'CLOSE_NOW',
      now()
    ) RETURNING id INTO v_notification_id;

    -- Back-fill notification_id on the recheck record
    UPDATE mid_trade_alpha_rechecks
    SET notification_id = v_notification_id,
        notification_type = v_notification_type
    WHERE id = v_recheck_id;
  END IF;

  RETURN v_recheck_id;
END;
$$;

-- ─── Step 5: RPC to fetch latest recheck for a trade (used by UI) ──────────
CREATE OR REPLACE FUNCTION get_latest_midtrade_recheck(p_trade_id uuid)
RETURNS TABLE (
  id uuid,
  verdict text,
  thesis_status text,
  confidence integer,
  alpha_reasoning text,
  user_message text,
  trigger_type text,
  r_multiple numeric,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    r.id, r.verdict, r.thesis_status, r.confidence,
    r.alpha_reasoning, r.user_message, r.trigger_type,
    r.r_multiple, r.created_at
  FROM mid_trade_alpha_rechecks r
  WHERE r.trade_id = p_trade_id
  ORDER BY r.created_at DESC
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION record_alpha_midtrade_recheck TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_latest_midtrade_recheck TO authenticated, service_role;
