/*
  # Fix notification type constraint and ccip_change_tracking RLS

  1. Modified Tables
    - `goal_notifications`: Expanded `valid_notification_type` CHECK constraint to include
      all types used in application code: 'general', 'trade_signal', 'forecast',
      'mid_trade_evaluation', 'mid_trade_action'
    - `ccip_change_tracking`: Added INSERT policy for authenticated users

  2. Security Changes
    - Added INSERT policy on `ccip_change_tracking` allowing authenticated users to insert
      their own change tracking records (user_id must match auth.uid())

  3. Important Notes
    - The notification type constraint was blocking inserts from modal-notification-bridge
      and goal-session-live-engine
    - The ccip_change_tracking table had no INSERT policy for authenticated users, causing
      403 errors on all client-side inserts
*/

ALTER TABLE goal_notifications DROP CONSTRAINT IF EXISTS valid_notification_type;

ALTER TABLE goal_notifications ADD CONSTRAINT valid_notification_type CHECK (
  type = ANY (ARRAY[
    'goal_achieved', 'goal_progress',
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'ccip_change_tracking'::regclass
    AND polname = 'Authenticated users can insert own changes'
  ) THEN
    CREATE POLICY "Authenticated users can insert own changes"
      ON ccip_change_tracking
      FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
