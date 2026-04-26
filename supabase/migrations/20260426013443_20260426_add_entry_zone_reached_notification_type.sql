/*
  # Add entry_zone_reached to goal_notifications type constraint

  ## Purpose
  The client-side entry countdown system (Fix 3 / CCIP-2026-0426A) inserts
  goal_notifications rows with type = 'entry_zone_reached' when the price
  enters the pullback zone. This type was not in the valid_notification_type
  CHECK constraint, causing insert failures.

  ## Change
  - Drops and recreates the valid_notification_type constraint on goal_notifications
    to include 'entry_zone_reached'

  ## CCIP Reference
  CCIP-2026-0426A — Entry zone countdown notification type
*/

ALTER TABLE goal_notifications
  DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (type = ANY (ARRAY[
    'goal_achieved', 'goal_progress',
    'trade_opened', 'trade_entry', 'trade_closed', 'trade_signal',
    'stop_loss_hit', 'take_profit_hit', 'tp1_hit', 'tp1_milestone', 'sl_triggered',
    'session_started', 'session_update', 'session_paused', 'session_ended',
    'session_auto_closed', 'session_timeout', 'scanning_timeout',
    'entry_abandoned', 'entry_monitoring_started', 'entry_quality_improving',
    'entry_quality_ready', 'entry_zone_reached',
    'mid_trade_alert', 'mid_trade_trigger', 'mid_trade_evaluation', 'mid_trade_action',
    'continuation', 'continuation_required',
    'signal', 'alert', 'completion', 'forecast', 'general',
    'wellness_check', 'progress', 'system_alert', 'balance_update',
    'referral_commission_earned', 'referral_payout_requested', 'referral_payout_approved',
    'referral_payout_rejected', 'referral_payout_paid'
  ]::text[]));
