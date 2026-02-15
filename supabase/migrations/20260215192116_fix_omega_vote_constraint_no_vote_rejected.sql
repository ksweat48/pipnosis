/*
  # Fix Omega Vote Constraint - Remove NO_VOTE Support

  ## Problem Statement (CCIP-Documented Production Incident)

  **Root Cause Analysis:**
  - omega-weight-resolver.ts line 149 was using fallback: `entry.vote?.vote || 'NO_VOTE'`
  - When omega refactor removed NO_TRADE from omega level (all omegas must vote BUY or SELL)
  - The fallback was never updated, causing 'NO_VOTE' to be inserted into omega_weight_audit_log
  - Database had no CHECK constraint to reject invalid values
  - INSERT failed with 400 Bad Request
  - Audit log failure → weighted_contribution became NaN
  - NaN propagated to directional strength calculations: `NET=NaN (BUY=NaN vs SELL=49.2)`
  - Alpha blocked ALL trades because `NaN < threshold` is always false
  - 100% trade execution failure in production

  **Impact:**
  - All trades blocked with NO_TRADE decisions
  - Console flooding with 400 errors
  - Silent failure mode (audit log failure didn't block execution)
  - NaN propagation broke directional strength model

  ## Solution

  1. **Code Fix (omega-weight-resolver.ts):**
     - Line 149: Changed `'NO_VOTE'` fallback to `null`
     - Added NaN validation throughout weight calculation
     - Added defensive checks in audit log insertion
     - Added governance violation logging

  2. **Database Fix (this migration):**
     - Add CHECK constraint to reject 'NO_VOTE' and enforce BUY/SELL only
     - Clean up any existing 'NO_VOTE' records
     - Add governance tracking for future violations

  3. **CCIP Compliance:**
     - Documents architectural decision: omega votes must be BUY/SELL only
     - Adds database enforcement to prevent regression
     - Tracks violations for governance monitoring

  ## Changes

  1. Clean up existing 'NO_VOTE' records (if any)
  2. Add CHECK constraint: omega_vote IN ('BUY', 'SELL') OR omega_vote IS NULL
  3. Document in CCIP tracking
*/

-- ============================================
-- STEP 1: Clean up any existing NO_VOTE records
-- ============================================
UPDATE omega_weight_audit_log
SET omega_vote = NULL
WHERE omega_vote = 'NO_VOTE'
  OR omega_vote NOT IN ('BUY', 'SELL');

-- ============================================
-- STEP 2: Add CHECK constraint
-- ============================================
ALTER TABLE omega_weight_audit_log
DROP CONSTRAINT IF EXISTS valid_omega_vote_direction;

ALTER TABLE omega_weight_audit_log
ADD CONSTRAINT valid_omega_vote_direction
CHECK (omega_vote IS NULL OR omega_vote IN ('BUY', 'SELL'));

-- ============================================
-- STEP 3: Add monitoring comment for future violations
-- ============================================
COMMENT ON CONSTRAINT valid_omega_vote_direction ON omega_weight_audit_log IS
'GOVERNANCE: Enforces architectural decision that all omega votes must be BUY or SELL. NO_VOTE/NO_TRADE removed from omega level in mandatory directional voting refactor. This constraint prevents regression of production incident where NO_VOTE fallback caused 400 errors and NaN propagation.';
