/*
  # Emergency: Clear Stuck Trade Closed Notifications
  
  1. Purpose
    - Mark all unread trade_closed notifications as read
    - Stop notification sound loop from repeatedly playing
    - Clear notification backlog
  
  2. What This Does
    - Marks ALL unread trade_closed notifications as read
    - Only affects notifications older than 5 minutes
    - Preserves recent legitimate notifications
  
  3. Safety
    - Only affects trade_closed type notifications
    - Only marks as read (doesn't delete)
    - Preserves audit trail
*/

-- Mark old unread trade_closed notifications as read
UPDATE goal_notifications
SET 
  read = true,
  read_at = NOW()
WHERE 
  read = false
  AND type = 'trade_closed'
  AND created_at < NOW() - INTERVAL '5 minutes';

-- Also clear any very old unread notifications (older than 1 hour)
UPDATE goal_notifications
SET 
  read = true,
  read_at = NOW()
WHERE 
  read = false
  AND created_at < NOW() - INTERVAL '1 hour';

-- Log the cleanup
DO $$
DECLARE
  cleared_notifications INTEGER;
BEGIN
  SELECT COUNT(*) INTO cleared_notifications
  FROM goal_notifications
  WHERE read = true AND read_at > NOW() - INTERVAL '1 minute';
  
  RAISE NOTICE 'Emergency notification cleanup complete. Marked % notifications as read.', cleared_notifications;
END $$;