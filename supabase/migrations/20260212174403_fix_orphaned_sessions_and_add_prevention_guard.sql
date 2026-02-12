/*
  # Fix Orphaned Sessions and Add Prevention Guard

  1. Data Fixes
    - Close 3 orphaned active sessions that have zero open trades
    - Session 97c15a71 (user 91905a02, SL hit, 0 open trades)
    - Session 39c7accc (user 4c179046, SL hit, 0 open trades)
    - Session 68ad7b1a (user e2074e88, manual+TP closed, 0 open trades)
    - Sets status to 'user_stopped', completed_at = now(), closing_state = 'idle'

  2. New RPC Function
    - `cleanup_orphaned_sessions()` - detects and closes active sessions with no open trades/intents
    - Safety net callable periodically to prevent orphaned sessions
    - Returns count of sessions cleaned up

  3. Root Cause
    - State machine was writing 'stopped' but DB constraint requires 'user_stopped'
    - Trade closure coordinator was transitioning SL/TP to 'scanning' instead of stopping
    - Both issues fixed in application code

  4. CCIP Governance
    - All changes logged to ccip_change_tracking table
*/

-- Step 1: Close orphaned session 97c15a71 (user 91905a02)
UPDATE goal_sessions
SET status = 'user_stopped',
    completed_at = now(),
    closing_state = 'idle',
    updated_at = now()
WHERE id = '97c15a71-5ede-4e40-8583-77839044d66c'
  AND status = 'active';

INSERT INTO ccip_change_tracking (user_id, operation_type, table_name, record_id, change_details, governance_log_id)
SELECT
  '91905a02-cf9e-4537-9920-98a4b790830a'::uuid,
  'ORPHANED_SESSION_CLEANUP',
  'goal_sessions',
  '97c15a71-5ede-4e40-8583-77839044d66c'::uuid,
  jsonb_build_object(
    'reason', 'Session had 0 open trades but remained active after SL hit',
    'fix', 'Set to user_stopped via migration',
    'migration', 'fix_orphaned_sessions_and_add_prevention_guard'
  ),
  gen_random_uuid();

-- Step 2: Close orphaned session 39c7accc (user 4c179046)
UPDATE goal_sessions
SET status = 'user_stopped',
    completed_at = now(),
    closing_state = 'idle',
    updated_at = now()
WHERE id = '39c7accc-db1e-4087-a853-79c651af98e2'
  AND status = 'active';

INSERT INTO ccip_change_tracking (user_id, operation_type, table_name, record_id, change_details, governance_log_id)
SELECT
  '4c179046-f937-4291-a11b-152455a61885'::uuid,
  'ORPHANED_SESSION_CLEANUP',
  'goal_sessions',
  '39c7accc-db1e-4087-a853-79c651af98e2'::uuid,
  jsonb_build_object(
    'reason', 'Session had 0 open trades but remained active after SL hit',
    'fix', 'Set to user_stopped via migration',
    'migration', 'fix_orphaned_sessions_and_add_prevention_guard'
  ),
  gen_random_uuid();

-- Step 3: Close orphaned session 68ad7b1a (user e2074e88)
UPDATE goal_sessions
SET status = 'user_stopped',
    completed_at = now(),
    closing_state = 'idle',
    updated_at = now()
WHERE id = '68ad7b1a-de57-4eb1-8b2b-af9b6d55aee0'
  AND status = 'active';

INSERT INTO ccip_change_tracking (user_id, operation_type, table_name, record_id, change_details, governance_log_id)
SELECT
  'e2074e88-3e6f-4575-bb49-7bc23e9b948e'::uuid,
  'ORPHANED_SESSION_CLEANUP',
  'goal_sessions',
  '68ad7b1a-de57-4eb1-8b2b-af9b6d55aee0'::uuid,
  jsonb_build_object(
    'reason', 'Session had 0 open trades but remained active after manual+TP close',
    'fix', 'Set to user_stopped via migration',
    'migration', 'fix_orphaned_sessions_and_add_prevention_guard'
  ),
  gen_random_uuid();

-- Step 4: Create orphan prevention RPC function
CREATE OR REPLACE FUNCTION cleanup_orphaned_sessions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session record;
  v_cleaned_count INT := 0;
  v_session_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR v_session IN
    SELECT gs.id, gs.user_id, gs.status, gs.created_at
    FROM goal_sessions gs
    WHERE gs.status IN ('active', 'scanning')
      AND NOT EXISTS (
        SELECT 1 FROM goal_session_trades gst
        WHERE gst.goal_session_id = gs.id AND gst.status = 'open'
      )
      AND NOT EXISTS (
        SELECT 1 FROM entry_intents ei
        WHERE ei.session_id = gs.id AND ei.status = 'monitoring'
      )
      AND gs.updated_at < now() - interval '2 minutes'
  LOOP
    UPDATE goal_sessions
    SET status = 'user_stopped',
        completed_at = now(),
        closing_state = 'idle',
        updated_at = now()
    WHERE id = v_session.id;

    INSERT INTO ccip_change_tracking (user_id, operation_type, table_name, record_id, change_details, governance_log_id)
    VALUES (
      v_session.user_id,
      'ORPHANED_SESSION_AUTO_CLEANUP',
      'goal_sessions',
      v_session.id,
      jsonb_build_object(
        'reason', 'Active session with no open trades, no active intents, stale for >2 min',
        'original_status', v_session.status,
        'cleaned_at', now()::text
      ),
      gen_random_uuid()
    );

    v_cleaned_count := v_cleaned_count + 1;
    v_session_ids := v_session_ids || v_session.id;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'sessions_cleaned', v_cleaned_count,
    'session_ids', to_jsonb(v_session_ids)
  );
END;
$$;
