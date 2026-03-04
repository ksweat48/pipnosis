/*
  # TP1 Modal Once-Per-Trade Governance

  ## Purpose
  Three cascading bugs allowed the TP1 modal to appear multiple times per trade and
  caused a blank "manual close" modal to appear alongside the correct TP1 modal when
  TP1 was hit.

  ## Changes

  ### 1. New column — goal_session_trades.tp1_modal_shown (boolean)
  - Tracks whether the TP1 Decision Modal has already been shown for this trade.
  - Set to TRUE when the modal is first displayed, preventing re-display after page reload.
  - Used by the GoalSessionDashboard "missed-event" guard query to skip already-shown modals.

  ### 2. New notification type — 'tp1_milestone'
  - Added to the goal_notifications valid_notification_type CHECK constraint.
  - Used exclusively by realtime-sltp-monitor when TP1 is detected (advisory milestone only,
    trade is NOT closed). Previously a 'take_profit_hit' notification was sent, which the
    realtime-trade-notification-listener misrouted as a closure modal (the blank modal bug).
  - The listener handles 'tp1_milestone' by playing a sound only — no modal is shown.
    The GoalSessionDashboard Realtime subscription on the tp1_hit column owns the TP1 modal.

  ### 3. New RPC — mark_tp1_modal_shown(trade_id, user_id)
  - Called by GoalSessionDashboard the moment the TP1 Decision Modal is first shown.
  - Uses optimistic update (.eq('tp1_modal_shown', false)) — returns TRUE on first call,
    FALSE on subsequent calls (idempotent guard).

  ## CCIP Governance Fix Summary
  - Bug 1: Two monitors (position-monitor + realtime-sltp-monitor) both call checkSLTP()
    independently; both can detect TP1 before the other has written tp1_hit=true to DB.
    Fix: markTP1Hit() in position-monitoring-authority now uses .eq('tp1_hit', false)
    optimistic lock so only one writer wins.
  - Bug 2: take_profit_hit notification fired by position-monitor triggered
    fetchAndShowTradeClosedModal() for a still-open trade (the blank/manual modal).
    Fix: position-monitor TP1 path retired; realtime-sltp-monitor uses new tp1_milestone type.
  - Bug 3: closureLocks dedup guard in handleClosureEvent() always evaluates false because
    the lock is deleted in the finally block before the Realtime event fires.
    Fix: dedicated shownDialogForTrade Set in trade-closure-coordinator.
  - Bug 4: checkMissedTP1 in GoalSessionDashboard could re-show modal after page reload.
    Fix: tp1_modal_shown column gates the missed-event guard query.
*/

-- 1. Add tp1_modal_shown column (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_modal_shown'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_modal_shown boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 2. Add 'tp1_milestone' to the valid_notification_type CHECK constraint
-- Drop old constraint and recreate with tp1_milestone included alongside all existing types
ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    type = ANY (ARRAY[
      'goal_achieved',
      'goal_progress',
      'trade_opened',
      'trade_entry',
      'trade_closed',
      'trade_signal',
      'stop_loss_hit',
      'take_profit_hit',
      'tp1_hit',
      'tp1_milestone',
      'sl_triggered',
      'session_started',
      'session_update',
      'session_paused',
      'session_ended',
      'session_auto_closed',
      'session_timeout',
      'scanning_timeout',
      'entry_abandoned',
      'entry_monitoring_started',
      'entry_quality_improving',
      'entry_quality_ready',
      'mid_trade_alert',
      'mid_trade_trigger',
      'mid_trade_evaluation',
      'mid_trade_action',
      'continuation',
      'continuation_required',
      'signal',
      'alert',
      'completion',
      'forecast',
      'general',
      'wellness_check',
      'progress',
      'system_alert',
      'balance_update',
      'referral_commission_earned',
      'referral_payout_requested',
      'referral_payout_approved',
      'referral_payout_rejected',
      'referral_payout_paid'
    ])
  );

-- 3. Create mark_tp1_modal_shown RPC (idempotent — only updates when tp1_modal_shown=false)
CREATE OR REPLACE FUNCTION mark_tp1_modal_shown(
  p_trade_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows_updated integer;
BEGIN
  UPDATE goal_session_trades
  SET tp1_modal_shown = true
  WHERE id = p_trade_id
    AND user_id = p_user_id
    AND tp1_modal_shown = false;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;
  RETURN v_rows_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION mark_tp1_modal_shown(uuid, uuid) TO authenticated;
