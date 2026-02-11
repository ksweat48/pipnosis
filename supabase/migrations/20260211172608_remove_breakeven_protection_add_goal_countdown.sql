/*
  # CCIP-20260211-001: Remove Breakeven Protection & Add Goal Achievement Countdown

  ## Overview
  This migration implements CCIP-20260211-001 which removes all automatic breakeven
  protection and converts TP1 to advisory-only. Adds a 1-minute goal achievement
  countdown modal system.

  ## Changes

  ### 1. Remove Breakeven-Related Columns from goal_sessions
    - Remove user_choice column (stored breakeven decision)
    - Remove goal_achieved_pnl column (stored profit when goal hit)
    - Remove awaiting_user_action column (tracked if waiting for user)

  ### 2. Add Goal Achievement Countdown Tracking
    - goal_countdown_started_at: When 1-minute countdown began
    - goal_countdown_user_action: User's decision (continue/close/timeout_continue)

  ### 3. Update Modal Type Constraint
    - Add 'goal_achieved_countdown' to valid_modal_type constraint
    - This enables the new 1-minute countdown modal

  ### 4. Update Notification Type Constraint
    - Add 'goal_achieved_countdown' to valid_notification_type constraint
    - This enables push notifications for goal achievement

  ### 5. Enhance TP1/TP2 Tracking (Advisory Only)
    - Ensure tp1_hit, tp1_action_taken, tp2_hit columns exist
    - Add comment clarifying TP1 is advisory only (no partial close)

  ## Security
    - No RLS policy changes required
    - All changes are schema-only
    - Backward compatible with existing trades

  ## Important Notes
    - TP1 will NO LONGER trigger partial closes (50%)
    - Position stays 100% open when TP1 is hit
    - TP1 data is logged for Alpha learning only
    - Goal achievement triggers 1-minute countdown (not 5 minutes)
    - Default action after timeout: CONTINUE unchanged (no SL modification)
    - Weekend protection remains unchanged
*/

-- ============================================================================
-- STEP 1: Remove Breakeven-Related Columns from goal_sessions
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
    AND column_name = 'user_choice'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN user_choice CASCADE;
    RAISE NOTICE 'Removed user_choice column from goal_sessions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
    AND column_name = 'goal_achieved_pnl'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN goal_achieved_pnl CASCADE;
    RAISE NOTICE 'Removed goal_achieved_pnl column from goal_sessions';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
    AND column_name = 'awaiting_user_action'
  ) THEN
    ALTER TABLE goal_sessions DROP COLUMN awaiting_user_action CASCADE;
    RAISE NOTICE 'Removed awaiting_user_action column from goal_sessions';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add Goal Achievement Countdown Tracking
-- ============================================================================

ALTER TABLE goal_sessions
  ADD COLUMN IF NOT EXISTS goal_countdown_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS goal_countdown_user_action TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_goal_countdown_action'
  ) THEN
    ALTER TABLE goal_sessions
      ADD CONSTRAINT valid_goal_countdown_action CHECK (
        goal_countdown_user_action IN ('continue', 'close', 'timeout_continue')
      );
  END IF;
END $$;

COMMENT ON COLUMN goal_sessions.goal_countdown_started_at IS
  'Timestamp when 1-minute goal achievement countdown started. NULL if countdown never triggered.';

COMMENT ON COLUMN goal_sessions.goal_countdown_user_action IS
  'User action during goal achievement countdown: continue (user chose to continue), close (user chose to close), timeout_continue (auto-continue after 1 minute)';

-- ============================================================================
-- STEP 3: Update Modal Type Constraint
-- ============================================================================

ALTER TABLE pending_user_modals DROP CONSTRAINT IF EXISTS valid_modal_type;

ALTER TABLE pending_user_modals ADD CONSTRAINT valid_modal_type CHECK (
  modal_type IN (
    'goal_achieved',
    'goal_achieved_countdown',
    'session_ended',
    'trade_closed',
    'continuation',
    'entry_edge_loss',
    'mid_trade_alert',
    'system_notification'
  )
);

COMMENT ON CONSTRAINT valid_modal_type ON pending_user_modals IS
  'Valid modal types. goal_achieved_countdown triggers 1-minute countdown when goal is reached.';

-- ============================================================================
-- STEP 4: Update Notification Type Constraint
-- ============================================================================

ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications ADD CONSTRAINT valid_notification_type CHECK (
  type = ANY (ARRAY[
    'goal_achieved', 'goal_achieved_countdown', 'goal_progress',
    'trade_opened', 'trade_entry', 'trade_closed', 'trade_signal',
    'stop_loss_hit', 'take_profit_hit', 'sl_triggered',
    'session_started', 'session_update', 'session_paused',
    'session_ended', 'session_auto_closed', 'session_timeout',
    'scanning_timeout',
    'entry_abandoned', 'entry_monitoring_started',
    'entry_quality_improving', 'entry_quality_ready',
    'mid_trade_alert', 'mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action',
    'continuation', 'continuation_required',
    'signal', 'alert', 'completion', 'forecast', 'general',
    'wellness_check', 'progress',
    'system_alert', 'balance_update'
  ])
);

-- ============================================================================
-- STEP 5: Enhance TP1/TP2 Tracking (Advisory Only)
-- ============================================================================

ALTER TABLE goal_session_trades
  ADD COLUMN IF NOT EXISTS tp1_hit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp1_hit_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS tp1_action_taken TEXT,
  ADD COLUMN IF NOT EXISTS tp2_hit BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS tp2_hit_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_tp1_action'
  ) THEN
    ALTER TABLE goal_session_trades DROP CONSTRAINT valid_tp1_action;
  END IF;

  ALTER TABLE goal_session_trades
    ADD CONSTRAINT valid_tp1_action CHECK (
      tp1_action_taken IN ('continued', 'advisory_only')
    );
END $$;

ALTER TABLE goal_session_trades
  ALTER COLUMN tp1_action_taken SET DEFAULT 'continued';

COMMENT ON COLUMN goal_session_trades.tp1_hit IS
  'CRITICAL: TP1 is ADVISORY ONLY. Position NEVER partially closes at TP1. When TP1 is hit, the full position (100%) continues monitoring to TP2. TP1 data is logged for Alpha learning and progress tracking only. NO POSITION SIZE MODIFICATION.';

COMMENT ON COLUMN goal_session_trades.tp1_action_taken IS
  'Action taken when TP1 hit. Valid values: "continued" (default, position stayed 100% open) or "advisory_only" (flagged but no action). NEVER "partial_close" - partial closes are DISABLED.';

COMMENT ON COLUMN goal_session_trades.tp2_hit IS
  'True when TP2 (second take profit) is hit. This triggers FULL position closure (100%).';

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'goal_sessions'
  AND column_name IN ('user_choice', 'goal_achieved_pnl', 'awaiting_user_action');

  IF v_count > 0 THEN
    RAISE WARNING 'Breakeven columns still exist! Expected: 0, Found: %', v_count;
  ELSE
    RAISE NOTICE '✅ Breakeven columns successfully removed';
  END IF;
END $$;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'goal_sessions'
  AND column_name IN ('goal_countdown_started_at', 'goal_countdown_user_action');

  IF v_count = 2 THEN
    RAISE NOTICE '✅ Goal countdown columns created successfully';
  ELSE
    RAISE WARNING 'Goal countdown columns missing! Expected: 2, Found: %', v_count;
  END IF;
END $$;

DO $$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM information_schema.columns
  WHERE table_name = 'goal_session_trades'
  AND column_name IN ('tp1_hit', 'tp1_action_taken', 'tp2_hit');

  IF v_count = 3 THEN
    RAISE NOTICE '✅ TP1/TP2 tracking columns verified';
  ELSE
    RAISE WARNING 'TP1/TP2 tracking columns missing! Expected: 3, Found: %', v_count;
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '   CCIP-20260211-001: Migration Complete';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ Breakeven protection columns removed';
  RAISE NOTICE '✅ Goal achievement countdown tracking added (1-minute)';
  RAISE NOTICE '✅ TP1 converted to advisory-only (no partial close)';
  RAISE NOTICE '✅ Modal and notification types updated';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️  IMPORTANT: Deploy matching code changes for:';
  RAISE NOTICE '   - trade-lifecycle-manager.ts (remove breakeven logic)';
  RAISE NOTICE '   - autonomous-position-monitor.ts (TP1 advisory only)';
  RAISE NOTICE '   - goal-achievement-coordinator.ts (1-minute countdown)';
  RAISE NOTICE '════════════════════════════════════════════════════════════════════';
END $$;
