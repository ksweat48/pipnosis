/*
  # Fix Database Schema Errors - Final

  ## Issues Fixed
  1. ai_trade_analysis: Missing 'entry_price' column (400 Bad Request)
  2. goal_notifications: Missing notification types in constraint
  3. trade_accuracy_tracking: Missing RLS policies for authenticated users
  4. Add missing indexes for performance

  ## Changes
  1. Add entry_price column to ai_trade_analysis if missing
  2. Update goal_notifications valid_notification_type constraint with ALL types
  3. Fix trade_accuracy_tracking RLS policies
  4. Add performance indexes
*/

-- 1. Fix ai_trade_analysis table - add entry_price column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_trade_analysis' AND column_name = 'entry_price'
  ) THEN
    ALTER TABLE ai_trade_analysis ADD COLUMN entry_price numeric;
    RAISE NOTICE '✓ Added entry_price column to ai_trade_analysis';
  ELSE
    RAISE NOTICE '  entry_price column already exists in ai_trade_analysis';
  END IF;
END $$;

-- 2. Fix goal_notifications constraint to allow ALL notification types
DO $$
BEGIN
  -- Drop existing constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_notification_type'
    AND conrelid = 'goal_notifications'::regclass
  ) THEN
    ALTER TABLE goal_notifications DROP CONSTRAINT valid_notification_type;
    RAISE NOTICE '✓ Dropped old valid_notification_type constraint';
  END IF;

  -- Add comprehensive constraint with ALL notification types (existing + new)
  ALTER TABLE goal_notifications
  ADD CONSTRAINT valid_notification_type CHECK (
    type IN (
      -- Existing types from database
      'alert',
      'completion',
      'progress',
      'scanning_timeout',
      'session_ended',
      'session_started',
      'signal',
      'sl_triggered',
      'trade_closed',
      'trade_entry',
      -- New types needed by the application
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
    )
  );
  
  RAISE NOTICE '✓ Added comprehensive valid_notification_type constraint';
END $$;

-- 3. Fix trade_accuracy_tracking RLS policies
DO $$
BEGIN
  -- Enable RLS if not already enabled
  ALTER TABLE trade_accuracy_tracking ENABLE ROW LEVEL SECURITY;

  -- Drop existing policies if they exist
  DROP POLICY IF EXISTS "Users can view own accuracy data" ON trade_accuracy_tracking;
  DROP POLICY IF EXISTS "Users can insert own accuracy data" ON trade_accuracy_tracking;
  DROP POLICY IF EXISTS "Users can update own accuracy data" ON trade_accuracy_tracking;

  -- Create comprehensive RLS policies
  CREATE POLICY "Users can view own accuracy data"
    ON trade_accuracy_tracking FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

  CREATE POLICY "Users can insert own accuracy data"
    ON trade_accuracy_tracking FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

  CREATE POLICY "Users can update own accuracy data"
    ON trade_accuracy_tracking FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

  RAISE NOTICE '✓ Fixed trade_accuracy_tracking RLS policies';
END $$;

-- 4. Add performance indexes if they don't exist
CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_user_id 
  ON ai_trade_analysis(user_id);

CREATE INDEX IF NOT EXISTS idx_ai_trade_analysis_live_trade_id 
  ON ai_trade_analysis(live_trade_id);

CREATE INDEX IF NOT EXISTS idx_goal_notifications_user_id_viewed 
  ON goal_notifications(user_id, viewed);

CREATE INDEX IF NOT EXISTS idx_trade_accuracy_tracking_user_id 
  ON trade_accuracy_tracking(user_id);

-- 5. Grant necessary permissions
GRANT SELECT, INSERT, UPDATE ON ai_trade_analysis TO authenticated;
GRANT SELECT, INSERT, UPDATE ON trade_accuracy_tracking TO authenticated;
GRANT SELECT, INSERT, UPDATE ON goal_notifications TO authenticated;

-- Summary
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '  DATABASE SCHEMA FIXES COMPLETE';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ ai_trade_analysis: Added entry_price column';
  RAISE NOTICE '✓ goal_notifications: Fixed notification type constraint';
  RAISE NOTICE '✓ trade_accuracy_tracking: Fixed RLS policies';
  RAISE NOTICE '✓ Performance indexes created';
  RAISE NOTICE '══════════════════════════════════════════════════════════';
END $$;
