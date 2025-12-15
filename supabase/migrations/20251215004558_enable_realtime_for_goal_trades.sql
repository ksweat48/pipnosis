/*
  # Enable Realtime for Trade Closure Popup

  ## Problem
  The TradeClosedActionDialog popup was not appearing after trades closed because
  the goal_session_trades table was missing critical Supabase Realtime configuration.

  ## Root Cause
  1. Missing REPLICA IDENTITY FULL - Required for UPDATE events to include old row data
  2. Table not in supabase_realtime publication - Required for broadcasting events

  ## Impact
  - Users couldn't decide whether to continue, start fresh, or stop after trade closes
  - No user feedback after losing trades
  - goal_trade_actions data not being collected

  ## Solution
  1. Add REPLICA IDENTITY FULL to goal_session_trades
  2. Add table to supabase_realtime publication
  3. Also ensure goal_achievements table has same config
  4. Create diagnostic query for verification

  ## Expected Result
  - After any trade closes, popup appears within 1-2 seconds
  - User sees three options: Continue, Start Fresh, Close for Now
  - 5-minute auto-continue timer starts
  - User decisions logged to goal_trade_actions table
*/

-- CRITICAL FIX: Enable REPLICA IDENTITY FULL for goal_session_trades
-- This allows Supabase to broadcast both old and new row data in UPDATE events
ALTER TABLE goal_session_trades REPLICA IDENTITY FULL;

-- Add goal_session_trades to supabase_realtime publication (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'goal_session_trades'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE goal_session_trades;
    RAISE NOTICE '✅ goal_session_trades added to supabase_realtime publication';
  ELSE
    RAISE NOTICE '✓ goal_session_trades already in supabase_realtime publication';
  END IF;
END $$;

-- Also ensure goal_achievements table has realtime enabled
ALTER TABLE goal_achievements REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
    AND schemaname = 'public'
    AND tablename = 'goal_achievements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE goal_achievements;
    RAISE NOTICE '✅ goal_achievements added to supabase_realtime publication';
  ELSE
    RAISE NOTICE '✓ goal_achievements already in supabase_realtime publication';
  END IF;
END $$;

-- Create diagnostic view to verify realtime configuration
CREATE OR REPLACE FUNCTION check_goal_realtime_status()
RETURNS TABLE (
  table_name text,
  has_replica_identity boolean,
  replica_identity_type text,
  in_realtime_publication boolean,
  status text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    t.tablename::text,
    c.relreplident IS NOT NULL as has_replica_identity,
    CASE c.relreplident
      WHEN 'd' THEN 'DEFAULT'
      WHEN 'n' THEN 'NOTHING'
      WHEN 'f' THEN 'FULL'
      WHEN 'i' THEN 'INDEX'
      ELSE 'UNKNOWN'
    END::text as replica_identity_type,
    EXISTS(
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = t.tablename
    ) as in_realtime_publication,
    CASE
      WHEN c.relreplident = 'f' AND EXISTS(
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t.tablename
      ) THEN '✅ READY'
      ELSE '❌ NOT READY'
    END::text as status
  FROM pg_tables t
  LEFT JOIN pg_class c ON c.relname = t.tablename
  LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
  WHERE t.schemaname = 'public'
  AND t.tablename IN ('goal_session_trades', 'goal_achievements', 'goal_sessions')
  ORDER BY t.tablename;
$$;

-- Run diagnostic
SELECT * FROM check_goal_realtime_status();

-- Final confirmation
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ TRADE CLOSURE POPUP SYSTEM ENABLED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '📋 Configuration Applied:';
  RAISE NOTICE '  • goal_session_trades: REPLICA IDENTITY FULL';
  RAISE NOTICE '  • goal_session_trades: Added to supabase_realtime publication';
  RAISE NOTICE '  • goal_achievements: REPLICA IDENTITY FULL';
  RAISE NOTICE '  • goal_achievements: Added to supabase_realtime publication';
  RAISE NOTICE '';
  RAISE NOTICE '🎯 Expected Behavior:';
  RAISE NOTICE '  • Trade closes → Popup appears within 1-2 seconds';
  RAISE NOTICE '  • Three options: Continue, Start Fresh, Close for Now';
  RAISE NOTICE '  • Auto-continue timer: 5 minutes';
  RAISE NOTICE '  • User decisions logged to goal_trade_actions';
  RAISE NOTICE '';
  RAISE NOTICE '🧪 To Test:';
  RAISE NOTICE '  • Open a trade in goal session';
  RAISE NOTICE '  • Close trade (manually or hit SL/TP)';
  RAISE NOTICE '  • Popup should appear immediately';
  RAISE NOTICE '';
  RAISE NOTICE '🔍 Run this to verify: SELECT * FROM check_goal_realtime_status();';
  RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $$;