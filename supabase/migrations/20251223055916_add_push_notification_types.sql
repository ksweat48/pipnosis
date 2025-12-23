/*
  # Add Push Notification Types to goal_notifications

  1. Changes
    - Add missing notification types: trade_entry, trade_closed, goal_achieved, session_started
    - These are needed for auto-push-notification-service.ts to dispatch push notifications
    - Extends existing valid_notification_type constraint

  2. Security
    - No RLS changes
    - Only updating CHECK constraint to support new notification types

  3. Context
    - trade_entry: When Alpha executes a trade (currently uses 'signal' incorrectly)
    - trade_closed: When trade hits TP/SL (already working but needs proper type)
    - goal_achieved: When goal target is reached
    - session_started: When Smart Goal scanning begins
*/

-- Drop existing constraint
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

-- Recreate with ALL required types for complete push notification coverage
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type
  CHECK (type IN (
    'forecast',
    'signal',
    'progress',
    'alert',
    'completion',
    'mid_trade_trigger',
    'mid_trade_evaluation',
    'mid_trade_action',
    'session_ended',
    'continuation_required',
    'trade_entry',           -- NEW: When trade is executed by Alpha
    'trade_closed',          -- NEW: When trade hits TP/SL
    'goal_achieved',         -- NEW: When goal target is reached
    'session_started'        -- NEW: When Smart Goal scanning begins
  ));

COMMENT ON CONSTRAINT valid_notification_type ON goal_notifications IS
  'Valid notification types: forecast, signal, progress, alert, completion, mid_trade_trigger, mid_trade_evaluation, mid_trade_action, session_ended, continuation_required, trade_entry, trade_closed, goal_achieved, session_started';
