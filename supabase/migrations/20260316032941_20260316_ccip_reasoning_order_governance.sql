/*
  # CCIP-2026-03-16A: Alpha Reasoning Order Governance

  ## Summary
  Adds database-level support for the Q7 coherence cross-check introduced by
  CCIP-2026-03-16A. The cross-check in coordinator-alpha.parseDecision writes
  a row to ssot_violations with violation_type = 'Q7_COHERENCE_CONTRADICTION'
  whenever Alpha outputs BUY/SELL despite Q7_confluence_judgment declaring
  insufficient confluence (internal reasoning contradiction).

  ## Changes
  1. Partial index on ssot_violations for fast lookup of Q7 coherence violations
     in governance dashboards and monitoring queries.

  ## Affected Tables
  - ssot_violations (index only — no schema or data changes)

  ## Security
  No new tables. Existing RLS policies unchanged.

  ## Important Notes
  - Additive only. Safe to re-run (IF NOT EXISTS).
  - ssot_violations.violation_type is free-text — no enum/constraint update needed.
  - The full architectural change record is documented in the migration filename
    and in ARCHITECTURAL_DECISIONS.md (CCIP-2026-03-16A).
*/

CREATE INDEX IF NOT EXISTS idx_ssot_violations_q7_coherence
  ON ssot_violations (created_at DESC)
  WHERE violation_type = 'Q7_COHERENCE_CONTRADICTION';
