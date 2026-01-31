/*
  # Force Close All Remaining Open Sessions Including In-Trade

  1. Issue
    - Previous migration missed sessions with status='in_trade'
    - ksweat48@gmail.com still has active session: 12e1c19d-2326-4769-a590-2c908b43c325

  2. Fix
    - Close all sessions with status IN ('in_trade', 'ready', ...) 
    - Mark with completed_at timestamp
    - Log to governance audit

  3. Operations
    - UPDATE goal_sessions: Close all remaining open states
    - INSERT to ccip_change_log: Audit trail
*/

-- Force close all sessions that are still open (including 'in_trade')
UPDATE goal_sessions
SET 
  status = 'completed',
  completed_at = now(),
  updated_at = now()
WHERE completed_at IS NULL
AND status NOT IN ('completed', 'goal_achieved', 'system_stopped', 'user_stopped');

-- Log to governance audit
DO $$
DECLARE
  v_closed_count INT;
BEGIN
  SELECT COUNT(*) INTO v_closed_count
  FROM goal_sessions
  WHERE status = 'completed'
  AND updated_at >= now() - interval '2 seconds';

  IF v_closed_count > 0 THEN
    BEGIN
      INSERT INTO ccip_change_log (
        change_type,
        table_name,
        change_details,
        metadata,
        created_at,
        created_by
      )
      VALUES (
        'force_close_remaining_sessions',
        'goal_sessions',
        jsonb_build_object(
          'operation', 'force_close_all_remaining_including_in_trade',
          'total_closed', v_closed_count::text,
          'reason', 'Emergency force close - all remaining open sessions',
          'timestamp_utc', now()::text
        ),
        jsonb_build_object(
          'affected_users', (SELECT COUNT(DISTINCT user_id) FROM goal_sessions WHERE status = 'completed' AND updated_at >= now() - interval '2 seconds')::text
        ),
        now(),
        'system_admin'
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'CCIP log error: %', SQLERRM;
    END;
  END IF;

  RAISE NOTICE 'Remaining sessions force closed: %', v_closed_count;
END $$;

-- Verify all sessions are closed
SELECT 
  COUNT(*) as total_sessions,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_sessions,
  COUNT(CASE WHEN completed_at IS NULL THEN 1 END) as sessions_still_open,
  STRING_AGG(DISTINCT status, ', ') as remaining_statuses
FROM goal_sessions
WHERE completed_at IS NULL;
