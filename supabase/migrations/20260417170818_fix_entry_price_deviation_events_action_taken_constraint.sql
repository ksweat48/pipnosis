/*
  # Fix entry_price_deviation_events action_taken constraint

  ## Problem
  The code inserts two new action_taken values:
  - 'BLOCKED_GEOMETRY_INVALID' — when the geometry guard blocks a trade
  - 'AUDIT_ONLY' — when deviation is within stop distance (no action taken)

  The current constraint only allows: SHIFTED, BLOCKED, CANCELLED

  Both new values were rejected with a 400 Bad Request from PostgREST.

  ## Changes
  1. Drop the old action_taken check constraint
  2. Re-add it with all valid values:
     - SHIFTED (legacy — SL/TP shifted, now unused)
     - BLOCKED (generic block)
     - CANCELLED (legacy — deprecated since 2026-03-23)
     - BLOCKED_GEOMETRY_INVALID (CCIP-2026-0417: fill crossed or consumed entire stop)
     - AUDIT_ONLY (fill within stop distance; no action, just logged)
*/

ALTER TABLE entry_price_deviation_events
  DROP CONSTRAINT IF EXISTS entry_price_deviation_events_action_taken_check;

ALTER TABLE entry_price_deviation_events
  ADD CONSTRAINT entry_price_deviation_events_action_taken_check
  CHECK (action_taken IN ('SHIFTED', 'BLOCKED', 'CANCELLED', 'BLOCKED_GEOMETRY_INVALID', 'AUDIT_ONLY'));
