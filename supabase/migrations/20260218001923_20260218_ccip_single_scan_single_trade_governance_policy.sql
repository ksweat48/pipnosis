/*
  # CCIP Governance: Single-Scan-Single-Trade Policy

  ## Summary
  Establishes the "Single-Scan-Single-Trade" governance policy across all execution paths.
  Once a trade is executed in a goal session, no further scanning or auto-execution is permitted.
  Scanning can ONLY be re-initiated by a user explicitly starting a new session.

  ## Policy Details
  1. After any trade executes in a session, scanning is permanently halted
  2. After any trade closes (SL, TP, manual), the session MUST stop
  3. No auto-continuation, no auto-restart scanning after trade closure
  4. Server-side monitors (goal, position, entry) enforce the same policy
  5. Client-side live engine enforces via in-memory flag + DB-level gate

  ## Code Changes (5 files)
  - `goal-session-live-engine.ts`: Added tradeExecutedInSession flag, DB governance gate, session stop on trade close
  - `goal-session-core-engine.ts`: Added governance gate blocking scanning when trades exist
  - `autonomous-goal-monitor.ts`: Honors shouldContinue=false from core engine
  - `autonomous-position-monitor.ts`: Stops session after SL/TP/market-close closure
  - `autonomous-entry-monitor.ts`: Abandons intents if session already has trades

  ## Incident Context
  - User fourthdimension7 had SINGLE mode session execute 2 trades (US30 + auto XAUUSD)
  - User ksweat48 had SINGLE mode session execute 2 trades (2x NAS100)
  - Root cause: continuation modal removal (2026-01-30) left polling loop running after trade closure

  ## Safety
  - Defense-in-depth: 5 independent enforcement points
  - No destructive operations (no DROP, no DELETE of user data)
  - Stops currently active sessions that already have closed trades (preventing further damage)
*/

-- Step 1: Log the governance policy change
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata
) VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'policy', 'multi_trade_auto_continuation',
    'behavior', 'After trade closure, polling loop continued scanning and could auto-execute new trades',
    'continuation_modal', 'Removed on 2026-01-30, leaving scanning unrestricted'
  ),
  jsonb_build_object(
    'policy', 'single_scan_single_trade',
    'behavior', 'Once a trade executes, scanning is permanently halted. Session stops after trade closure.',
    'enforcement_points', jsonb_build_array(
      'goal-session-live-engine:tradeExecutedInSession flag',
      'goal-session-live-engine:processCandleAutonomous DB gate',
      'goal-session-core-engine:processGoalSessionIteration governance gate',
      'autonomous-goal-monitor:shouldContinue enforcement',
      'autonomous-position-monitor:session stop after closure',
      'autonomous-entry-monitor:intent abandonment if trades exist'
    ),
    'user_action_required', 'Start a new session to scan again'
  ),
  'CCIP: Single-Scan-Single-Trade governance policy. Prevents auto-scanning after trade execution or closure. Addresses incident where SINGLE mode sessions executed multiple trades.',
  jsonb_build_object(
    'ccip_protocol', true,
    'incident_users', jsonb_build_array('fourthdimension7@yahoo.com', 'ksweat48@gmail.com'),
    'incident_date', '2026-02-18',
    'files_modified', jsonb_build_array(
      'src/services/goal-session-live-engine.ts',
      'src/services/goal-session-core-engine.ts',
      'netlify/functions/autonomous-goal-monitor.ts',
      'netlify/functions/autonomous-position-monitor.ts',
      'netlify/functions/autonomous-entry-monitor.ts'
    )
  )
);

-- Step 2: Safety net - Stop any currently active sessions that already have closed trades
-- This prevents the old behavior from causing more damage before deployment
DO $$
DECLARE
  stopped_count integer := 0;
  session_rec record;
BEGIN
  FOR session_rec IN
    SELECT DISTINCT gs.id, gs.user_id, gs.status
    FROM goal_sessions gs
    WHERE gs.status IN ('scanning', 'active', 'initializing')
    AND EXISTS (
      SELECT 1 FROM goal_session_trades gst
      WHERE gst.goal_session_id = gs.id
      AND gst.status = 'closed'
    )
    AND NOT EXISTS (
      SELECT 1 FROM goal_session_trades gst2
      WHERE gst2.goal_session_id = gs.id
      AND gst2.status = 'open'
    )
  LOOP
    UPDATE goal_sessions
    SET status = 'user_stopped',
        completed_at = now()
    WHERE id = session_rec.id;

    stopped_count := stopped_count + 1;

    INSERT INTO governance_change_log (
      entity_type,
      entity_id,
      operation,
      old_value,
      new_value,
      reason,
      metadata
    ) VALUES (
      'goal_sessions',
      session_rec.id,
      'status_transition',
      jsonb_build_object('status', session_rec.status),
      jsonb_build_object('status', 'user_stopped'),
      'Auto-stopped: Session had closed trades but was still in scanning/active state',
      jsonb_build_object('ccip_policy', 'single_scan_single_trade', 'user_id', session_rec.user_id::text)
    );
  END LOOP;

  IF stopped_count > 0 THEN
    RAISE NOTICE 'CCIP: Stopped % sessions that had closed trades but were still active', stopped_count;
  END IF;
END $$;
