/*
  # CCIP-2026-04-01: Omega Vote Data Integrity — Mark Corrupted alpha_decisions Rows

  ## Summary
  Since CCIP-2026-02-24, the OmegaVote interface removed the `vote` and `confidence`
  fields (Omegas became intelligence providers, not directional voters). However, two
  logging paths — omega-alpha-logger.ts and alpha-learning-tracker.ts — continued to
  compute buy_votes and sell_votes by filtering on `v.vote === 'BUY'` / `v.vote === 'SELL'`.
  Because `.vote` is undefined on OmegaVote, both values were silently written as 0
  into every alpha_decisions row since that date, even when Omega intelligence WAS present.

  ## Changes

  ### 1. New column: alpha_decisions.data_integrity_compromised (boolean)
  - Marks rows where buy_votes and sell_votes are structurally false zeros
  - Identification rule: omega_votes_count >= 1 AND buy_votes = 0 AND sell_votes = 0
  - These rows cannot be trusted for any learning or performance analysis that
    uses vote counts as a signal.

  ### 2. Backfill: flag all historical corrupted rows
  - Any row with omega_votes_count >= 1 AND buy_votes = 0 AND sell_votes = 0
    gets data_integrity_compromised = true
  - Rows with omega_votes_count = 0 (no Omegas ran) are legitimately zero — not flagged
  - Rows from after this migration (new inserts omit buy_votes/sell_votes) get false by default

  ### 3. Index for fast filtering
  - Partial index on compromised rows to support efficient exclusion in learning queries

  ## Security
  - No RLS changes required — column inherits table's existing policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'data_integrity_compromised'
  ) THEN
    ALTER TABLE alpha_decisions ADD COLUMN data_integrity_compromised boolean NOT NULL DEFAULT false;
  END IF;
END $$;

UPDATE alpha_decisions
SET data_integrity_compromised = true
WHERE
  omega_votes_count >= 1
  AND (buy_votes IS NOT NULL AND buy_votes = 0)
  AND (sell_votes IS NOT NULL AND sell_votes = 0)
  AND data_integrity_compromised = false;

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_integrity_compromised
  ON alpha_decisions (data_integrity_compromised)
  WHERE data_integrity_compromised = true;
