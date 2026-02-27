/*
  # CCIP Governance: Deprecate goal_achieved_countdown Modal Type

  ## Summary
  Removes the goal_achieved_countdown modal type from the system as part of the
  risk-based session model migration. Users now set dollar_risk per trade instead
  of profit targets. Trades run to their natural TP/SL without any countdown
  interruption. The TradeClosedActionDialog fires on actual trade closure.

  ## Changes
  1. Dismiss all outstanding goal_achieved_countdown pending_user_modals rows
  2. Remove goal_achieved_countdown from the modal_type CHECK constraint
  3. Record architectural removal in ccip_change_tracking for audit trail

  ## Affected Tables
  - pending_user_modals: constraint updated, outstanding rows dismissed
  - ccip_change_tracking: audit record inserted

  ## Security
  - No RLS changes
  - Existing policies unchanged

  ## Notes
  - GoalAchievedCountdownModal component removed from App.tsx (frontend)
  - goal-achievement-coordinator.ts no longer creates countdown modals
  - The goal_countdown_started_at / goal_countdown_user_action columns in
    goal_sessions are retained for historical data integrity
*/

-- Step 1: Dismiss all outstanding goal_achieved_countdown modals
UPDATE pending_user_modals
SET dismissed_at = now()
WHERE modal_type = 'goal_achieved_countdown'
  AND dismissed_at IS NULL;

-- Step 2: Update the modal_type CHECK constraint to remove goal_achieved_countdown
ALTER TABLE pending_user_modals
  DROP CONSTRAINT IF EXISTS pending_user_modals_modal_type_check;

ALTER TABLE pending_user_modals
  ADD CONSTRAINT pending_user_modals_modal_type_check
  CHECK (modal_type IN (
    'trade_closed',
    'goal_achieved',
    'session_update',
    'continuation',
    'session_ended',
    'entry_edge_loss'
  ));

-- Step 3: CCIP audit record (system migration — uses first admin user as actor)
INSERT INTO ccip_change_tracking (
  user_id,
  operation_type,
  table_name,
  record_id,
  change_details
)
SELECT
  (SELECT id FROM auth.users ORDER BY created_at LIMIT 1),
  'ARCHITECTURE_REMOVAL',
  'pending_user_modals',
  gen_random_uuid(),
  jsonb_build_object(
    'component', 'GoalAchievedCountdownModal',
    'modal_type_removed', 'goal_achieved_countdown',
    'reason', 'Users set dollar_risk per trade, not profit targets. Trades run to natural TP/SL. TradeClosedActionDialog fires on actual closure.',
    'files_changed', array['src/App.tsx', 'src/services/coordinators/goal-achievement-coordinator.ts', 'src/components/TradeClosedActionDialog.tsx', 'src/hooks/useGlobalDialog.tsx', 'src/services/coordinators/trade-closure-coordinator.ts', 'src/services/realtime-trade-notification-listener.ts'],
    'deployed_at', '2026-02-27',
    'migration', '20260227_ccip_deprecate_goal_achieved_countdown_modal'
  );
