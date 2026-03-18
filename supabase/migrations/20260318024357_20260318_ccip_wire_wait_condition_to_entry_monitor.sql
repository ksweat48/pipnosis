/*
  # CCIP-2026-0318A: Wire wait_condition to Entry Monitor — Database Schema

  ## Title
  Add wait_reasoning and expected_wait_minutes to entry_intents

  ## Summary
  Alpha produces a structured wait_condition block (target zone, invalidation price,
  reasoning text, and estimated wait time) when it selects wait_pullback or
  push_confirmation entry modes. Previously, the coordinator parser discarded this
  block — the zone values were re-derived from a secondary source (entry_advisory)
  and the reasoning and time estimate were silently lost.

  This migration adds the two missing columns to entry_intents so the full
  wait_condition can be persisted exactly as Alpha stated it.

  ## New Columns — entry_intents

  | Column | Type | Nullable | Description |
  |--------|------|----------|-------------|
  | wait_reasoning | text | YES | Alpha's stated reason for deferring entry (from wait_condition.wait_reasoning) |
  | expected_wait_minutes | integer | YES | Alpha's estimated time to wait before zone is reached (from wait_condition.expected_wait_minutes) |

  ## Modified Tables
  - entry_intents: two new nullable columns added

  ## Security
  - No RLS changes required — entry_intents already has correct RLS policies
  - Both columns are nullable (no impact on existing rows or insert logic)

  ## CCIP Compliance Notes
  - SSOT: coordinator-alpha.ts is sole parse point for the LLM response
  - These columns are populated by alpha-trade-executor.ts createMonitored() after
    coordinator-alpha.ts extracts wait_condition from the parsed LLM response
  - The autonomous-entry-monitor.ts (Netlify function) can use expected_wait_minutes
    for observability; it does not alter monitoring logic
  - intent_mode column (pullback_to_zone / push_confirmation_zone) remains the
    operational authority for the monitor — it is derived from entry_mode, not from
    wait_condition.intent_mode (which is now removed from the prompt to eliminate
    the redundant field)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'wait_reasoning'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN wait_reasoning text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents' AND column_name = 'expected_wait_minutes'
  ) THEN
    ALTER TABLE entry_intents ADD COLUMN expected_wait_minutes integer;
  END IF;
END $$;
