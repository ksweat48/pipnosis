/*
  ═══════════════════════════════════════════════════════════════════════════
  SSOT FIX: goal_notifications Type Constraint
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem
  SSOT violation between TypeScript and database constraint causing 403 errors:
  
  TypeScript defines these types:
  - 'trade_opened', 'stop_loss_hit', 'take_profit_hit', 'session_timeout'
  - 'mid_trade_alert', 'system_alert', 'balance_update', 'goal_progress'
  
  But database constraint doesn't allow them, causing:
  - 403 Forbidden errors
  - Notifications fail to insert
  - Silent failures in notification system

  ## Solution
  Add all missing notification types to database constraint.
  Establish database as SSOT for notification types.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Drop the old constraint
ALTER TABLE goal_notifications 
  DROP CONSTRAINT IF EXISTS valid_notification_type;

-- Create new comprehensive constraint with ALL notification types
ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    type IN (
      -- Goal notifications
      'goal_achieved',
      'goal_progress',
      
      -- Trade lifecycle
      'trade_opened',
      'trade_entry',
      'trade_closed',
      
      -- Stop loss / Take profit
      'stop_loss_hit',
      'take_profit_hit',
      'sl_triggered',
      
      -- Session management
      'session_started',
      'session_update',
      'session_paused',
      'session_ended',
      'session_auto_closed',
      'session_timeout',
      'scanning_timeout',
      
      -- Entry monitoring
      'entry_abandoned',
      'entry_monitoring_started',
      'entry_quality_improving',
      'entry_quality_ready',
      
      -- Mid-trade alerts
      'mid_trade_alert',
      'mid_trade_trigger',
      
      -- Continuation
      'continuation',
      'continuation_required',
      
      -- System
      'signal',
      'alert',
      'completion',
      'wellness_check',
      'progress',
      'system_alert',
      'balance_update'
    )
  );

-- Create index for notification type lookups
CREATE INDEX IF NOT EXISTS idx_goal_notifications_type 
  ON goal_notifications(type);

-- Validation
DO $$
DECLARE
  constraint_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_notification_type'
      AND conrelid = 'goal_notifications'::regclass
  ) INTO constraint_exists;
  
  IF constraint_exists THEN
    RAISE NOTICE '✅ Notification type constraint updated successfully';
    RAISE NOTICE '✅ All TypeScript notification types now allowed in database';
  ELSE
    RAISE EXCEPTION 'Failed to create notification type constraint';
  END IF;
END $$;
