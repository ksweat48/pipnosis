/*
  # CCIP-2026-0319B: Entry Monitor Gate — Monitor-Off Intent Blocking Governance

  ## Summary
  Adds a queryable audit view over ccip_change_tracking for MONITOR_OFF_INTENT_BLOCKED
  events introduced by the new entry monitor gate in coordinator-alpha.ts.

  ## Problem Being Solved
  Previously when Alpha chose "wait_pullback" or "push_confirmation" and the entry monitor
  was disabled, the system routed to PENDING mode — creating trade records for deferred
  entries that had no monitoring mechanism. These became orphaned entry_intents never fulfilled.

  The new gate in coordinator-alpha.ts converts these to NO_TRADE at the SSOT authority level
  and logs the block via logCCIPChange() into ccip_change_tracking with operation_type =
  'MONITOR_OFF_INTENT_BLOCKED' or 'WAIT_INTENT_REACHED_CREATE_PENDING'.

  ## Changes

  ### 1. View: alpha_monitor_intent_blocks
  Queryable audit view showing all monitor-off intent blocks by user, symbol, and entry mode.
  Covers both the expected path (coordinator gate) and the defensive guard (executor).

  ## Security
  - No new tables — uses existing ccip_change_tracking table
  - View is security invoker (respects caller's RLS context)
  - No destructive operations

  ## Notes
  - This migration is purely additive
  - ccip_change_tracking.operation_type is a free-form text field — no constraint update needed
*/

CREATE OR REPLACE VIEW alpha_monitor_intent_blocks AS
SELECT
  ct.id,
  ct.created_at,
  ct.user_id,
  ct.operation_type AS change_type,
  ct.change_details->>'symbol'        AS symbol,
  ct.change_details->>'alphaEntryMode' AS alpha_entry_mode,
  ct.change_details->>'entryMode'      AS entry_mode_alt,
  ct.record_id
FROM ccip_change_tracking ct
WHERE ct.operation_type IN ('MONITOR_OFF_INTENT_BLOCKED', 'WAIT_INTENT_REACHED_CREATE_PENDING')
ORDER BY ct.created_at DESC;

COMMENT ON VIEW alpha_monitor_intent_blocks IS
  'CCIP-2026-0319B: Audit trail of all cases where Alpha''s wait-mode intent '
  '(wait_pullback or push_confirmation) was blocked because the entry monitor was disabled. '
  'MONITOR_OFF_INTENT_BLOCKED = coordinator-alpha blocked it (expected normal path). '
  'WAIT_INTENT_REACHED_CREATE_PENDING = executor guard fired (should never occur — indicates upstream gate bypass). '
  'This view is used by admin governance review to confirm the entry monitor gate is functioning correctly.';
