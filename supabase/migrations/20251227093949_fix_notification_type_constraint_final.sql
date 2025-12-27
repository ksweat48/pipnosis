/*
  # Fix goal_notifications type constraint - DEFINITIVE FIX

  ## Problem
  The SL/TP trigger on realtime_prices is trying to insert notifications with
  type 'trade_closed', but the constraint is rejecting it.

  Error: "new row for relation 'goal_notifications' violates check constraint 'valid_notification_type'"

  ## Root Cause
  Multiple migrations have created/modified the valid_notification_type constraint,
  but some types are missing from the final version.

  ## Solution
  Drop ALL type constraints and create a single comprehensive one with ALL types
  used anywhere in the codebase.

  ## Types Added
  - trade_closed (used by SL/TP trigger)
  - trade_entry (used by trade entry system)
  - goal_achieved (used by goal completion)
  - session_started (used by session start)
  - scanning_timeout (used by scanning system)
  - mid_trade_alert (used by mid-trade alerts)
  - price_alert (for future use)
  - sl_triggered (for SL notifications)
  - tp_triggered (for TP notifications)
*/

-- Drop ALL possible type constraints to start fresh
ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS goal_notifications_type_check;

ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS notification_type_check;

-- Create the DEFINITIVE constraint with ALL notification types
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    type = ANY (ARRAY[
      -- Core notification types
      'forecast',
      'signal',
      'progress',
      'alert',
      'completion',
      
      -- Mid-trade types
      'mid_trade_trigger',
      'mid_trade_evaluation',
      'mid_trade_action',
      'mid_trade_alert',
      
      -- Session types
      'session_ended',
      'session_started',
      'continuation_required',
      'scanning_timeout',
      
      -- Trade types (CRITICAL - used by SL/TP trigger)
      'trade_entry',
      'trade_closed',
      'goal_achieved',
      
      -- Price alert types
      'price_alert',
      'sl_triggered',
      'tp_triggered',
      
      -- System types
      'system_alert',
      'warning',
      'info'
    ]::text[])
  );

-- Add comment documenting all valid types
COMMENT ON CONSTRAINT valid_notification_type ON goal_notifications IS
  'Valid notification types: forecast, signal, progress, alert, completion, mid_trade_trigger, mid_trade_evaluation, mid_trade_action, mid_trade_alert, session_ended, session_started, continuation_required, scanning_timeout, trade_entry, trade_closed, goal_achieved, price_alert, sl_triggered, tp_triggered, system_alert, warning, info';
