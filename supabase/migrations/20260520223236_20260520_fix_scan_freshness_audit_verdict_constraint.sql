/*
  # Fix scan_freshness_audit verdict CHECK constraint

  ## Summary
  The existing CHECK constraint only allows 'FRESH' and 'ABORTED_STALE' verdicts,
  but the orchestrator code legitimately writes 'H1_EXCLUDED' when the H1 timeframe
  is stale but the scan proceeds on M5 + M15 only. This caused silent 400 errors
  on every scan where H1 was excluded.

  ## Changes
  1. Drop existing verdict check constraint
  2. Recreate with 'H1_EXCLUDED' added as a valid value

  ## Impact
  - Non-destructive: only widens the allowed values
  - No data changes
*/

ALTER TABLE scan_freshness_audit DROP CONSTRAINT IF EXISTS scan_freshness_audit_verdict_chk;

ALTER TABLE scan_freshness_audit ADD CONSTRAINT scan_freshness_audit_verdict_chk
  CHECK (verdict IN ('FRESH', 'ABORTED_STALE', 'H1_EXCLUDED'));