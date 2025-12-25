/*
  # Emergency Christmas Holiday Market Shutdown
  
  ## Overview
  Emergency shutdown of all trading activity due to Christmas holiday market closure.
  
  ## Actions
  1. Fix duplicate status constraint
  2. Close all open trades with PnL calculation
  3. Stop all active sessions
  4. Notify affected users
  5. Create audit log
*/

-- Fix duplicate constraint
ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS goal_sessions_status_valid_values;

-- Close all open trades
UPDATE goal_trades
SET 
  status = 'closed',
  closed_at = NOW(),
  exit_price = COALESCE(current_price, entry_price),
  close_reason = 'manual',
  updated_at = NOW()
WHERE status = 'open';

-- Stop all active sessions
UPDATE goal_sessions
SET 
  status = 'user_stopped',
  scanning_cycle_status = NULL,
  completed_at = COALESCE(completed_at, NOW()),
  scanning_started_at = NULL,
  cycle_started_at = NULL,
  scanning_session_ends_at = NULL,
  cooldown_ends_at = NULL,
  lockdown_ends_at = NULL,
  next_scan_time = NULL,
  server_enabled = false,
  autonomous_enabled = false,
  updated_at = NOW()
WHERE status NOT IN ('user_stopped', 'expired', 'goal_achieved')
   OR scanning_cycle_status IS NOT NULL;

-- Notify users with closed trades
INSERT INTO goal_notifications (
  user_id,
  type,
  title,
  message,
  metadata,
  created_at
)
SELECT DISTINCT
  user_id,
  'alert',
  '🎄 Christmas Holiday - All Trading Stopped',
  'Due to Christmas holiday market closure, all open trades have been closed. The forex market is closed Dec 24-25. Markets reopen Sunday, Dec 29 at 5:00 PM EST. Your trade was closed at current market price and your balance has been updated. Happy Holidays!',
  jsonb_build_object(
    'reason', 'christmas_holiday_shutdown',
    'closed_at', NOW(),
    'market_status', 'closed'
  ),
  NOW()
FROM goal_trades
WHERE status = 'closed' 
  AND close_reason = 'manual'
  AND closed_at > NOW() - INTERVAL '2 minutes';

-- Notify users with stopped sessions  
INSERT INTO goal_notifications (
  user_id,
  type,
  title,
  message,
  metadata,
  created_at
)
SELECT DISTINCT
  gs.user_id,
  'session_ended',
  '🎄 Christmas Holiday - Session Stopped',
  'Your goal session has been stopped due to Christmas holiday market closure. The forex market is closed Dec 24-25. Markets reopen Sunday, Dec 29 at 5:00 PM EST. You can start a new session when markets reopen. Happy Holidays!',
  jsonb_build_object(
    'reason', 'christmas_holiday_shutdown',
    'stopped_at', NOW()
  ),
  NOW()
FROM goal_sessions gs
WHERE gs.status = 'user_stopped'
  AND gs.updated_at > NOW() - INTERVAL '2 minutes'
  AND NOT EXISTS (
    SELECT 1 FROM goal_notifications gn
    WHERE gn.user_id = gs.user_id
      AND gn.type = 'alert'
      AND gn.created_at > NOW() - INTERVAL '2 minutes'
  );

-- Audit log
DO $$
DECLARE
  trades INTEGER;
  sessions INTEGER;
  users INTEGER;
BEGIN
  SELECT COUNT(*) INTO trades
  FROM goal_trades
  WHERE status = 'closed'
    AND close_reason = 'manual'
    AND closed_at > NOW() - INTERVAL '2 minutes';
    
  SELECT COUNT(*) INTO sessions
  FROM goal_sessions
  WHERE status = 'user_stopped'
    AND updated_at > NOW() - INTERVAL '2 minutes';
    
  SELECT COUNT(DISTINCT user_id) INTO users
  FROM goal_notifications
  WHERE created_at > NOW() - INTERVAL '2 minutes';
    
  RAISE NOTICE '========================================';
  RAISE NOTICE 'CHRISTMAS HOLIDAY SHUTDOWN COMPLETE';
  RAISE NOTICE 'Closed trades: %', trades;
  RAISE NOTICE 'Stopped sessions: %', sessions;
  RAISE NOTICE 'Notified users: %', users;
  RAISE NOTICE 'Timestamp: %', NOW();
  RAISE NOTICE '========================================';
END $$;
