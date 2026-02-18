/*
  # CCIP: Wire process-trade-closures Invoker + Governance Fix

  ## Summary
  Two CCIP-compliant fixes applied 2026-02-18:

  ### Change 1: Orphaned Edge Function — Invoker Gap Closed
  The `process-trade-closures` Supabase Edge Function was deployed but had no
  scheduled invoker. It guarantees post-trade processing (notifications, session
  state, journal entries) when the browser is offline — but was never being called.
  Fix: new Netlify scheduled function `process-trade-closures-invoker` calls it
  every 60 seconds.

  ### Change 2: CCIP Governance Violation — Session Auto-Scanning Removed
  The edge function set session status back to `scanning` after TP/SL trade closures,
  directly violating the 2026-02-18 CCIP governance policy:
    "After all trades close, the session MUST stop. No auto-scanning. Users start new sessions."
  Fix: `targetStatus = "scanning"` branch removed. All sessions now transition to
  `user_stopped` when the last open trade closes.

  ## SSOT Compliance
  - close_goal_session_trade() RPC: sole trade closure authority (unchanged)
  - trade_closure_events: sole event log (unchanged)
  - process-trade-closures edge function: sole batch processor (governance fixed)
  - process-trade-closures-invoker: sole scheduler for that edge function (new)

  ## Affected Files
  - supabase/functions/process-trade-closures/index.ts (governance fix)
  - netlify/functions/process-trade-closures-invoker.ts (new invoker)
  - netlify.toml (new schedule entry)

  ## Security
  - No RLS changes required — existing policies cover all access patterns
  - Invoker uses service_role key server-side only

  ## Data Repair
  - One-time correction of sessions incorrectly left in 'scanning' after last trade closed
*/

-- Record both fixes in governance_change_log using SSOT-compliant schema
-- entity_type='system_configuration', operation='ccip_migration_applied'
-- entity_id uses a deterministic nil-equivalent UUID for system-level events
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  metadata,
  created_at
)
VALUES
(
  'system_configuration',
  '00000000-0000-0000-0000-000000000001'::uuid,
  'ccip_migration_applied',
  jsonb_build_object('status', 'orphaned', 'invoker', null),
  jsonb_build_object('status', 'wired', 'invoker', 'process-trade-closures-invoker', 'schedule', '* * * * *'),
  'process-trade-closures edge function was deployed but had no scheduled invoker. New Netlify function process-trade-closures-invoker wires the schedule gap. Post-trade processing now guaranteed within 60s even when browser is offline.',
  jsonb_build_object(
    'governance_impact', 'high',
    'component', 'process-trade-closures-invoker',
    'fix_type', 'infrastructure_gap'
  ),
  now()
),
(
  'system_configuration',
  '00000000-0000-0000-0000-000000000002'::uuid,
  'ccip_migration_applied',
  jsonb_build_object('session_transition_after_tp_sl', 'scanning'),
  jsonb_build_object('session_transition_after_tp_sl', 'user_stopped'),
  'process-trade-closures edge function was auto-restarting sessions to scanning after TP/SL closure, violating CCIP governance policy 2026-02-18. Fixed: all sessions now stop when last trade closes.',
  jsonb_build_object(
    'governance_impact', 'high',
    'component', 'process-trade-closures',
    'fix_type', 'governance_violation',
    'policy', 'no_auto_scan_after_trade_closure_2026-02-18'
  ),
  now()
);

-- One-time data repair: correct sessions incorrectly left in 'scanning' after
-- their last trade closed (caused by the now-fixed governance violation).
-- Safe: only affects sessions with no open trades and at least one closed trade.
UPDATE goal_sessions gs
SET
  status = 'user_stopped',
  completed_at = now(),
  updated_at = now()
WHERE gs.status = 'scanning'
  AND gs.completed_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM goal_session_trades gst
    WHERE gst.goal_session_id = gs.id
      AND gst.status = 'open'
  )
  AND EXISTS (
    SELECT 1 FROM goal_session_trades gst2
    WHERE gst2.goal_session_id = gs.id
      AND gst2.status = 'closed'
  );
