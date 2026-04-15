/*
  # Add Decision Origin Classification Columns to alpha_decisions

  ## Summary
  Adds 4 missing columns to the existing `alpha_decisions` table that the
  Decision Origin Classification System requires for full persistence.

  ## Context
  The `alpha-learning-tracker.ts` service was updated to write these fields,
  but the table migration was never applied. This caused HTTP 400 errors on
  every `logDecision()` call during live scanning sessions.

  ## New Columns
  - `decision_origin` (TEXT, nullable) — 13-value classification of why a
    NO_TRADE was issued. Values include ALPHA_GENUINE_NO_TRADE,
    SYSTEM_DEGENERATE, SYSTEM_TRUNCATED, SYSTEM_PARSE_FAILURE,
    SYSTEM_NETWORK_FAILURE, SYSTEM_DATA_MISSING, SYSTEM_FRESHNESS_BLOCK,
    ALPHA_BLOCKED_GEOMETRY, ALPHA_BLOCKED_COMPLIANCE, ALPHA_BLOCKED_SURVIVAL,
    ENGINE_RISK_BLOCKED, ENGINE_FEASIBILITY_BLOCKED, ENGINE_CAPACITY_BLOCKED
  - `execution_status` (TEXT, nullable) — Whether the decision was executed,
    blocked, or pending (e.g., 'executed', 'blocked_geometry', 'no_trade')
  - `response_fingerprint` (TEXT, nullable) — djb2 hash of GPT-4o response
    content used to detect KV-prefix cache contamination (identical responses
    served across symbols)
  - `alpha_original_action` (TEXT, nullable) — What Alpha originally wanted
    to do (BUY/SELL) before a system block overrode it to NO_TRADE. Only
    populated when decision_origin starts with ALPHA_BLOCKED_ or ENGINE_.

  ## Notes
  1. All 4 columns are nullable — no backfill or defaults needed.
     Existing rows are unaffected.
  2. `block_reason` column already exists in the table and is NOT modified.
  3. No RLS changes needed — these columns inherit the existing table policies.
  4. Schema cache will refresh automatically after this migration is applied.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'decision_origin'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN decision_origin TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'execution_status'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN execution_status TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'response_fingerprint'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN response_fingerprint TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'alpha_original_action'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN alpha_original_action TEXT;
  END IF;
END $$;
