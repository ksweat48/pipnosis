/*
  # CCIP-2026-0511G — User-Triggered Rescan Governance

  1. Problem
    - Wait intents currently time out on a wall-clock timer
    - A Postgres trigger auto-reschedules the session to `scanning` 1 minute later
    - This creates a chain of timed-out wait intents (gold → usdjpy → ...) without user consent

  2. Changes
    - Add `awaiting_user_rescan` to `goal_sessions.status` CHECK constraint
    - Drop `trigger_schedule_scan_after_intent_timeout` trigger on `entry_intents`
    - Drop `schedule_next_scan_after_intent_expiration()` function (auto-rescan killer)

  3. New Behavior
    - When an entry intent is abandoned (SL crossed, 24h safety ceiling), the session
      transitions to `awaiting_user_rescan` instead of auto-rescheduling
    - User must explicitly tap "Scan Again" to resume scanning
    - No wall-clock timeout drives abandonment — only structural thesis invalidation

  4. Safety
    - 24h absolute ceiling remains in application code to prevent eternal intents
    - Existing `abandonment_reason` column captures the reason for audit
*/

-- 1. Drop the auto-rescan trigger and its function
DROP TRIGGER IF EXISTS trigger_schedule_scan_after_intent_timeout ON entry_intents;
DROP FUNCTION IF EXISTS schedule_next_scan_after_intent_expiration();

-- 2. Extend goal_sessions.status CHECK to include awaiting_user_rescan
ALTER TABLE goal_sessions DROP CONSTRAINT IF EXISTS goal_sessions_status_check;

ALTER TABLE goal_sessions ADD CONSTRAINT goal_sessions_status_check
  CHECK (status = ANY (ARRAY[
    'initializing'::text,
    'scanning'::text,
    'active'::text,
    'trade_pending'::text,
    'in_trade'::text,
    'awaiting_user_rescan'::text,
    'completed'::text,
    'cancelled'::text,
    'force_closed_weekend'::text,
    'expired'::text,
    'goal_achieved'::text,
    'user_stopped'::text,
    'system_stopped'::text
  ]));

COMMENT ON CONSTRAINT goal_sessions_status_check ON goal_sessions IS
  'CCIP-2026-0511G — awaiting_user_rescan added. Session parks here when an entry intent ends (SL cross or 24h safety ceiling) until the user explicitly taps Scan Again.';
