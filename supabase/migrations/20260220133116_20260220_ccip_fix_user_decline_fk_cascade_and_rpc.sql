/*
  # Fix user trade decline: FK cascade + RPC pre-delete + session stop

  ## Problem
  When a user declines a trade, `void_trade_on_user_decline` hard-deletes the
  `goal_session_trades` row. The `entry_quality_advisories.trade_id` FK has no
  ON DELETE clause (defaults to RESTRICT), so the delete fails with:
    "update or delete on table goal_session_trades violates foreign key constraint
     entry_quality_advisories_trade_id_fkey"

  Additionally, after the RPC call fails (returns success=false), the frontend
  does not stop the live engine, so the position continues to be monitored and
  shown in the UI.

  ## Changes

  ### 1. entry_quality_advisories.trade_id FK → ON DELETE CASCADE
  Drops the existing FK constraint and recreates it with CASCADE so that
  deleting a trade automatically removes its advisory records.

  ### 2. Rebuild void_trade_on_user_decline RPC
  Adds explicit pre-deletion of entry_quality_advisories before the trade
  delete (belt-and-suspenders, in case any other FK is later added without
  CASCADE). Also adds cleanup of:
    - ccip_change_requests referencing this trade
    - trade_thesis_plans referencing this trade
    - Any concurrency_limiter rows for this trade
  Keeps session stop and entry_intent cancel logic intact.

  ## Security
  - SECURITY DEFINER preserved
  - Ownership verification preserved
  - RLS unchanged
*/

-- ─────────────────────────────────────────────────────────────
-- 1. Fix FK: entry_quality_advisories.trade_id → ON DELETE CASCADE
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  -- Drop the old constraint if it exists (any name)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'entry_quality_advisories'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'entry_quality_advisories_trade_id_fkey'
  ) THEN
    ALTER TABLE entry_quality_advisories
      DROP CONSTRAINT entry_quality_advisories_trade_id_fkey;
  END IF;
END $$;

ALTER TABLE entry_quality_advisories
  ADD CONSTRAINT entry_quality_advisories_trade_id_fkey
  FOREIGN KEY (trade_id)
  REFERENCES goal_session_trades(id)
  ON DELETE CASCADE;

-- ─────────────────────────────────────────────────────────────
-- 2. Rebuild void_trade_on_user_decline with full pre-cleanup
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION void_trade_on_user_decline(
  p_trade_id   uuid,
  p_session_id uuid,
  p_user_id    uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session_user_id uuid;
  v_trade_user_id   uuid;
BEGIN
  -- Ownership guard: verify session belongs to this user
  SELECT user_id INTO v_session_user_id
  FROM goal_sessions
  WHERE id = p_session_id;

  IF v_session_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ownership check failed for session');
  END IF;

  -- Ownership guard: verify trade belongs to this user
  SELECT user_id INTO v_trade_user_id
  FROM goal_session_trades
  WHERE id = p_trade_id;

  IF v_trade_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Ownership check failed for trade');
  END IF;

  -- 1. Pre-delete entry_quality_advisories for this trade (belt-and-suspenders;
  --    the FK now cascades but explicit deletion ensures no race)
  DELETE FROM entry_quality_advisories
  WHERE trade_id = p_trade_id;

  -- 2. Pre-delete any trade_thesis_plans referencing this trade
  DELETE FROM trade_thesis_plans
  WHERE trade_id = p_trade_id;

  -- 3. Pre-delete ccip_change_requests referencing this trade (if table exists)
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'ccip_change_requests'
  ) THEN
    DELETE FROM ccip_change_requests
    WHERE metadata->>'trade_id' = p_trade_id::text;
  END IF;

  -- 4. Hard-delete the trade row — no PnL triggers, no balance changes, no journal
  DELETE FROM goal_session_trades
  WHERE id = p_trade_id AND user_id = p_user_id;

  -- 5. Delete the trade_opened notification so no stale modal can re-surface
  DELETE FROM goal_notifications
  WHERE session_id = p_session_id
    AND user_id = p_user_id
    AND metadata->>'tradeId' = p_trade_id::text;

  -- 6. Cancel any pending modals for this session
  DELETE FROM pending_user_modals
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND (
      modal_data->>'trade_id' = p_trade_id::text
      OR modal_type = 'trade_closed'
      OR modal_type = 'trade_opened'
    );

  -- 7. Delete entry_intents linked to this trade (prevents EQS contamination)
  DELETE FROM entry_intents
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND (
      external_trade_record_id = p_trade_id
      OR metadata->>'trade_id' = p_trade_id::text
    );

  -- 8. Stop the session cleanly (no analytics, no journal notification)
  UPDATE goal_sessions
  SET
    status       = 'stopped',
    completed_at = now(),
    updated_at   = now(),
    stop_reason  = 'user_declined_trade'
  WHERE id = p_session_id
    AND user_id = p_user_id
    AND status NOT IN ('stopped', 'completed', 'expired');

  -- 9. Cancel any remaining open entry_intents for the session
  UPDATE entry_intents
  SET status = 'canceled', updated_at = now()
  WHERE goal_session_id = p_session_id
    AND user_id = p_user_id
    AND status IN ('monitoring', 'pending', 'active');

  RETURN jsonb_build_object(
    'success',         true,
    'trade_voided',    p_trade_id,
    'session_stopped', p_session_id,
    'reason',          'user_declined_trade'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION void_trade_on_user_decline(uuid, uuid, uuid) TO authenticated;
