/*
  # Fix Modal Auto-Cleanup on Refresh

  PROBLEM: Old notifications keep showing up every time user refreshes the page.
  - Default modal expiry was 7 days (too long!)
  - Auto-cleanup was 24 hours (still too long!)
  - Users see stale "Stop Loss Hit" modals from days ago

  SOLUTION: Aggressive auto-cleanup on every page load
  - Change auto-dismiss from 24 hours to 15 minutes
  - Change default expiry from 7 days to 15 minutes
  - Immediately clear all existing stale modals (older than 15 mins)

  This ensures users only see FRESH notifications relevant to their current session.
*/

-- Step 1: Update the auto-dismiss function to use 15 minutes instead of 24 hours
CREATE OR REPLACE FUNCTION auto_dismiss_stale_pending_modals()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  dismissed_count INTEGER;
BEGIN
  -- Auto-dismiss modals older than 15 minutes (reduced from 24 hours)
  UPDATE pending_user_modals
  SET
    dismissed_at = NOW(),
    user_action = 'auto_dismissed_stale'
  WHERE dismissed_at IS NULL
    AND created_at < NOW() - INTERVAL '15 minutes';

  GET DIAGNOSTICS dismissed_count = ROW_COUNT;

  RETURN dismissed_count;
END;
$$;

-- Step 2: Update default expiry from 7 days to 15 minutes
ALTER TABLE pending_user_modals
ALTER COLUMN expires_at SET DEFAULT (NOW() + INTERVAL '15 minutes');

-- Step 3: Immediately clean up all existing stale modals (older than 15 minutes)
UPDATE pending_user_modals
SET
  dismissed_at = NOW(),
  user_action = 'auto_dismissed_stale'
WHERE dismissed_at IS NULL
  AND created_at < NOW() - INTERVAL '15 minutes';

-- Step 4: Update expired modals to reflect new 15-minute expiry
UPDATE pending_user_modals
SET expires_at = created_at + INTERVAL '15 minutes'
WHERE expires_at > created_at + INTERVAL '15 minutes';

-- Grant permissions
GRANT EXECUTE ON FUNCTION auto_dismiss_stale_pending_modals() TO authenticated;

-- Update comment
COMMENT ON FUNCTION auto_dismiss_stale_pending_modals IS 'Auto-dismisses pending modals older than 15 minutes to keep notifications fresh and prevent backlog on refresh';
COMMENT ON COLUMN pending_user_modals.expires_at IS 'Modal expires after 15 minutes - ensures only fresh notifications are shown';

-- Log the fix
DO $$
DECLARE
  v_dismissed_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_dismissed_count
  FROM pending_user_modals
  WHERE dismissed_at IS NOT NULL
    AND user_action = 'auto_dismissed_stale';

  RAISE NOTICE '';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '  MODAL AUTO-CLEANUP FIX COMPLETE';
  RAISE NOTICE '════════════════════════════════════════════════════════';
  RAISE NOTICE '✓ Auto-dismiss time: 24 hours → 15 minutes';
  RAISE NOTICE '✓ Default expiry: 7 days → 15 minutes';
  RAISE NOTICE '✓ Stale modals dismissed: %', v_dismissed_count;
  RAISE NOTICE '✓ Users will now only see fresh notifications';
  RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;