/*
  # CCIP: Fix Entry Intent Cleanup for Session Transitions

  ## Change Control Intelligence Protocol (CCIP)

  **Change ID**: CCIP-20260129-002
  **Severity**: High
  **Impact**: Fixes critical bug blocking session continuation prompts
  **Rollback**: Can disable trigger if issues arise

  ## Problem

  When trades hit TP/SL, session should transition to 'awaiting_continuation' and show
  user a modal to decide next step. However, stale entry_intents stuck in 'monitoring'
  status block the transition because allChannelsEmpty check fails.

  Root causes:
  1. Entry intents stay "monitoring" even after trade executes
  2. No automatic cleanup when trade opens
  3. No expiration timeout for monitoring intents
  4. trade-closure-coordinator checks for active intents but they're never cleaned

  ## Solution

  1. **Auto-mark intents as 'executed' when trade opens**
  2. **Add function to expire stale monitoring intents** (>15 min old)
  3. **Call cleanup before checking allChannelsEmpty in session transitions**
  4. **Add RPC for manual cleanup in admin panel**

  ## SSOT Compliance

  - entry_intents is SSOT for execution intent lifecycle
  - Trade execution is authoritative trigger for status change
  - No duplicate cleanup logic across services

  ## Governance

  - Only system can auto-transition intent statuses
  - Admin can manually trigger cleanup via RPC
  - Logging for all status transitions
*/

-- Function: Mark entry intent as executed when trade opens
CREATE OR REPLACE FUNCTION mark_intent_executed_on_trade_open()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  intent_record RECORD;
BEGIN
  -- Find matching monitoring intent for this trade
  SELECT * INTO intent_record
  FROM entry_intents
  WHERE session_id = NEW.goal_session_id
    AND symbol = NEW.symbol
    AND direction = NEW.direction
    AND status = 'monitoring'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Mark as executed if found
  IF intent_record.id IS NOT NULL THEN
    UPDATE entry_intents
    SET
      status = 'executed',
      trade_id = NEW.id,
      executed_at = NEW.opened_at,
      updated_at = now()
    WHERE id = intent_record.id;

    RAISE LOG '[IntentCleanup] Marked intent % as executed for trade %', intent_record.id, NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger: Auto-mark intent executed when trade opens
DROP TRIGGER IF EXISTS trigger_mark_intent_executed ON goal_session_trades;
CREATE TRIGGER trigger_mark_intent_executed
  AFTER INSERT ON goal_session_trades
  FOR EACH ROW
  WHEN (NEW.status = 'open')
  EXECUTE FUNCTION mark_intent_executed_on_trade_open();

-- Function: Expire stale monitoring intents (>15 minutes old)
CREATE OR REPLACE FUNCTION expire_stale_monitoring_intents(
  p_session_id UUID DEFAULT NULL
)
RETURNS TABLE(
  expired_count INTEGER,
  expired_intent_ids UUID[]
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_count INTEGER;
  v_expired_ids UUID[];
BEGIN
  -- Expire intents that have been monitoring for >15 minutes
  WITH expired AS (
    UPDATE entry_intents
    SET
      status = 'expired',
      expired_reason = 'Monitoring timeout - no entry after 15 minutes',
      updated_at = now()
    WHERE status = 'monitoring'
      AND created_at < (now() - INTERVAL '15 minutes')
      AND (p_session_id IS NULL OR session_id = p_session_id)
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER, ARRAY_AGG(id)
  INTO v_expired_count, v_expired_ids
  FROM expired;

  RAISE LOG '[IntentCleanup] Expired % stale monitoring intents', v_expired_count;

  RETURN QUERY SELECT v_expired_count, v_expired_ids;
END;
$$;

-- Function: Cleanup orphaned intents for a session
CREATE OR REPLACE FUNCTION cleanup_orphaned_intents(p_session_id UUID)
RETURNS TABLE(
  cleaned_count INTEGER,
  action TEXT
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired_count INTEGER := 0;
  v_cancelled_count INTEGER := 0;
BEGIN
  -- 1. Expire stale monitoring intents
  WITH expired AS (
    UPDATE entry_intents
    SET
      status = 'expired',
      expired_reason = 'Session transition cleanup',
      updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'monitoring'
      AND created_at < (now() - INTERVAL '5 minutes')
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_expired_count FROM expired;

  -- 2. Cancel pending intents that never started monitoring
  WITH cancelled AS (
    UPDATE entry_intents
    SET
      status = 'cancelled',
      cancelled_reason = 'Session transition cleanup',
      updated_at = now()
    WHERE session_id = p_session_id
      AND status = 'pending'
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_cancelled_count FROM cancelled;

  RAISE LOG '[IntentCleanup] Session % cleanup: expired=%, cancelled=%',
    p_session_id, v_expired_count, v_cancelled_count;

  -- Return results
  IF v_expired_count > 0 THEN
    RETURN QUERY SELECT v_expired_count, 'expired'::TEXT;
  END IF;

  IF v_cancelled_count > 0 THEN
    RETURN QUERY SELECT v_cancelled_count, 'cancelled'::TEXT;
  END IF;

  -- Return 0 if nothing cleaned
  IF v_expired_count = 0 AND v_cancelled_count = 0 THEN
    RETURN QUERY SELECT 0, 'none'::TEXT;
  END IF;
END;
$$;

-- RPC: Admin function to clean up all stale intents system-wide
CREATE OR REPLACE FUNCTION admin_cleanup_all_stale_intents()
RETURNS TABLE(
  total_expired INTEGER,
  total_cancelled INTEGER
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_expired INTEGER := 0;
  v_cancelled INTEGER := 0;
BEGIN
  -- Only allow admins
  IF NOT EXISTS (
    SELECT 1 FROM user_profiles
    WHERE id = auth.uid() AND is_admin = true
  ) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  -- Expire monitoring intents >15 min old
  WITH expired AS (
    UPDATE entry_intents
    SET
      status = 'expired',
      expired_reason = 'Admin cleanup - monitoring timeout',
      updated_at = now()
    WHERE status = 'monitoring'
      AND created_at < (now() - INTERVAL '15 minutes')
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_expired FROM expired;

  -- Cancel old pending intents >1 hour old
  WITH cancelled AS (
    UPDATE entry_intents
    SET
      status = 'cancelled',
      cancelled_reason = 'Admin cleanup - stale pending',
      updated_at = now()
    WHERE status = 'pending'
      AND created_at < (now() - INTERVAL '1 hour')
    RETURNING id
  )
  SELECT COUNT(*)::INTEGER INTO v_cancelled FROM cancelled;

  RAISE LOG '[Admin] Cleaned up stale intents: expired=%, cancelled=%', v_expired, v_cancelled;

  RETURN QUERY SELECT v_expired, v_cancelled;
END;
$$;

-- Add indexes for cleanup performance
CREATE INDEX IF NOT EXISTS idx_entry_intents_monitoring_created
  ON entry_intents(created_at)
  WHERE status = 'monitoring';

CREATE INDEX IF NOT EXISTS idx_entry_intents_session_status
  ON entry_intents(session_id, status);

-- Add expired_reason and cancelled_reason columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'expired_reason'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN expired_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'cancelled_reason'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN cancelled_reason TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'executed_at'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN executed_at TIMESTAMPTZ;
  END IF;
END $$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION expire_stale_monitoring_intents TO authenticated;
GRANT EXECUTE ON FUNCTION cleanup_orphaned_intents TO authenticated;
GRANT EXECUTE ON FUNCTION admin_cleanup_all_stale_intents TO authenticated;