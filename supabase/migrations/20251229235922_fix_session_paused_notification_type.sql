/*
  # Fix Session Paused Notification Type

  ## Problem
  - Trigger `notify_session_paused_for_user_action` tries to insert 'session_paused' type
  - This type is not in the valid_notification_type constraint
  - Causes 400 errors when updating goal_sessions to 'awaiting_user_action' status

  ## Solution
  - Add 'session_paused' to the valid notification types
*/

ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications ADD CONSTRAINT valid_notification_type CHECK (
  type = ANY (ARRAY[
    'alert',
    'completion',
    'progress',
    'scanning_timeout',
    'session_ended',
    'session_started',
    'session_paused',
    'signal',
    'sl_triggered',
    'trade_closed',
    'trade_entry',
    'trade_signal',
    'goal_achieved',
    'goal_progress',
    'risk_warning',
    'session_timeout',
    'stop_loss_hit',
    'take_profit_hit',
    'milestone_achieved',
    'learning_insight',
    'market_alert',
    'system_message',
    'continuation_prompt',
    'mid_trade_alert',
    'mid_trade_update',
    'wellness_check',
    'position_update',
    'entry_monitoring',
    'entry_executed',
    'no_trades_found',
    'tp_triggered'
  ]::text[])
);
