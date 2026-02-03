/*
  # Emergency: Clear Orphaned Trade Closed Modals
  
  1. Purpose
    - Clear all stuck "trade_closed" modals that are causing notification loop
    - Mark them as dismissed with system action
    - Prevent notification sound spam
  
  2. What This Does
    - Marks ALL pending trade_closed modals as dismissed
    - Sets dismissed_at to NOW()
    - Sets user_action to 'system_auto_dismissed'
    - This will stop the notification loop immediately
  
  3. Safety
    - Only affects undismissed modals
    - Preserves audit trail with user_action field
*/

-- Mark all pending trade_closed modals as dismissed
UPDATE pending_user_modals
SET 
  dismissed_at = NOW(),
  user_action = 'system_auto_dismissed_emergency_cleanup'
WHERE 
  dismissed_at IS NULL
  AND modal_type = 'trade_closed';

-- Also clear any very old undismissed modals (older than 1 hour)
UPDATE pending_user_modals
SET 
  dismissed_at = NOW(),
  user_action = 'system_auto_dismissed_stale'
WHERE 
  dismissed_at IS NULL
  AND created_at < NOW() - INTERVAL '1 hour';

-- Log the cleanup
DO $$
DECLARE
  cleared_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO cleared_count
  FROM pending_user_modals
  WHERE user_action LIKE 'system_auto_dismissed%';
  
  RAISE NOTICE 'Emergency modal cleanup complete. Cleared % orphaned modals.', cleared_count;
END $$;