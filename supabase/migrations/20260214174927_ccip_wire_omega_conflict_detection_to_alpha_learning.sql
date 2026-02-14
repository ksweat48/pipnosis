/*
  # CCIP: Wire Omega Conflict Detection to Alpha Learning System

  ## Summary
  Fixes SSOT violation where Omega conflict detection was disconnected from Alpha learning system.
  The orchestrator detected conflicts but never passed them to the learning tracker.

  ## Problem (Before)
  - Orchestrator's `detectOmegaConflicts()` generated conflict data
  - Goal-session-live-engine hardcoded `conflict_detected = FALSE`, `conflict_type = 'NONE'`
  - Learning system never saw actual conflicts
  - Alpha could not learn from conflict scenarios
  - Database columns existed but were never populated

  ## Solution (After)
  - Orchestrator attaches conflict data to `AlphaDecision.conflictInfo`
  - Goal-session-live-engine extracts real conflict data
  - Learning tracker receives actual conflict information
  - Database columns now populated with real data

  ## Changes
  1. **Types**: Added `ConflictInfo` interface to `alpha-thesis.ts`
  2. **Decision Object**: Added `conflictInfo?` field to `AlphaDecision` interface
  3. **Orchestrator**: Attaches conflict data to decisions before returning
  4. **Live Engine**: Extracts real conflict data instead of hardcoding FALSE
  5. **Database**: No schema changes (columns already exist)

  ## SSOT Compliance
  - **Orchestrator** = Single source of truth for conflict detection
  - **Learning Tracker** = Single source of truth for decision history
  - Data flows one direction: Orchestrator → Decision → Learning Tracker → Database

  ## Governance
  - Risk: LOW (no schema changes, backward compatible)
  - Breaking: NO (all fields optional with fallbacks)
  - Deployment: Single atomic push
  - Rollback: Simple git revert (no schema changes)

  ## Expected Outcomes
  - 10-20% of decisions will have `conflict_detected = TRUE`
  - `conflict_type` distribution: 60% NONE, 30% SOFT, 10% HARD
  - `override_reason` populated when Alpha overrides Omega consensus
  - Alpha learning system can analyze conflict patterns

  ## Files Changed
  - src/types/alpha-thesis.ts (+ ConflictInfo interface)
  - src/brains/coordinator-alpha.ts (+ conflictInfo field)
  - src/services/alpha-omega-orchestrator.ts (attach conflict data)
  - src/services/goal-session-live-engine.ts (extract real conflict data)
*/

-- =====================================================================
-- VERIFICATION: Confirm Database Columns Exist
-- =====================================================================

DO $$
BEGIN
  -- Verify alpha_decisions table has required columns
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_detected'
  ) THEN
    RAISE EXCEPTION 'MIGRATION FAILED: alpha_decisions.conflict_detected column does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'conflict_type'
  ) THEN
    RAISE EXCEPTION 'MIGRATION FAILED: alpha_decisions.conflict_type column does not exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions' AND column_name = 'override_reason'
  ) THEN
    RAISE EXCEPTION 'MIGRATION FAILED: alpha_decisions.override_reason column does not exist';
  END IF;

  RAISE NOTICE '✅ Verification passed: All required columns exist';
END $$;

-- =====================================================================
-- POST-DEPLOY VERIFICATION FUNCTION
-- =====================================================================

-- Create a verification function for easy testing
CREATE OR REPLACE FUNCTION verify_omega_conflict_detection_active()
RETURNS TABLE (
  test_name TEXT,
  status TEXT,
  details TEXT
) AS $$
BEGIN
  -- Test 1: Check if conflict_detected is being populated with TRUE
  RETURN QUERY
  SELECT
    'Conflict Detection Active'::TEXT,
    CASE
      WHEN COUNT(*) > 0 THEN '✅ PASS'
      ELSE '⚠️ PENDING'
    END::TEXT,
    FORMAT('Found %s decisions with conflict_detected=TRUE in last 24h', COUNT(*))::TEXT
  FROM alpha_decisions
  WHERE conflict_detected = TRUE
    AND created_at > NOW() - INTERVAL '24 hours';

  -- Test 2: Check conflict_type distribution
  RETURN QUERY
  SELECT
    'Conflict Type Distribution'::TEXT,
    '✅ INFO'::TEXT,
    FORMAT('NONE: %s, SOFT: %s, HARD: %s',
      COUNT(*) FILTER (WHERE conflict_type = 'NONE'),
      COUNT(*) FILTER (WHERE conflict_type = 'SOFT'),
      COUNT(*) FILTER (WHERE conflict_type = 'HARD')
    )::TEXT
  FROM alpha_decisions
  WHERE created_at > NOW() - INTERVAL '24 hours';

  -- Test 3: Check override_reason population
  RETURN QUERY
  SELECT
    'Override Reason Populated'::TEXT,
    CASE
      WHEN COUNT(*) FILTER (WHERE override_reason IS NOT NULL) > 0 THEN '✅ PASS'
      WHEN COUNT(*) FILTER (WHERE alpha_override = TRUE) = 0 THEN '⚠️ NO OVERRIDES YET'
      ELSE '❌ FAIL'
    END::TEXT,
    FORMAT('%s of %s overrides have reason populated',
      COUNT(*) FILTER (WHERE override_reason IS NOT NULL),
      COUNT(*) FILTER (WHERE alpha_override = TRUE)
    )::TEXT
  FROM alpha_decisions
  WHERE created_at > NOW() - INTERVAL '24 hours'
    AND alpha_override = TRUE;

  -- Test 4: Check for hardcoded FALSE pattern (should decrease over time)
  RETURN QUERY
  SELECT
    'Hardcoded FALSE Detection'::TEXT,
    CASE
      WHEN pct < 90 THEN '✅ PASS'
      WHEN pct >= 90 THEN '❌ STILL HARDCODED'
      ELSE '⚠️ PENDING'
    END::TEXT,
    FORMAT('%.1f%% of recent decisions have conflict_detected=FALSE (expect <90%% after deploy)', pct)::TEXT
  FROM (
    SELECT
      CASE
        WHEN COUNT(*) = 0 THEN 0
        ELSE (COUNT(*) FILTER (WHERE conflict_detected = FALSE) * 100.0 / COUNT(*))
      END as pct
    FROM alpha_decisions
    WHERE created_at > NOW() - INTERVAL '1 hour'
  ) stats;

END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users (admins can check post-deploy)
GRANT EXECUTE ON FUNCTION verify_omega_conflict_detection_active() TO authenticated;
GRANT EXECUTE ON FUNCTION verify_omega_conflict_detection_active() TO service_role;

COMMENT ON FUNCTION verify_omega_conflict_detection_active() IS 
'CCIP 2026-02-14: Verifies Omega conflict detection is flowing to Alpha learning system. 
Run after deployment to confirm fix is working.';

-- =====================================================================
-- DEPLOYMENT NOTES
-- =====================================================================

/*
  ## CCIP Compliance Summary
  - Tier: 3 (Critical Intelligence Pipeline Fix)
  - SSOT Fix: YES (Reconnects orchestrator → learning tracker)
  - Breaking Change: NO
  - Schema Change: NO (columns already exist)
  - Backward Compatible: YES
  - Risk Level: LOW

  ## How to Verify Post-Deploy

  1. Run verification function:
     SELECT * FROM verify_omega_conflict_detection_active();

  2. Check recent decisions:
     SELECT
       symbol,
       action,
       confidence,
       conflict_detected,
       conflict_type,
       alpha_override,
       override_reason,
       created_at
     FROM alpha_decisions
     WHERE created_at > NOW() - INTERVAL '1 hour'
     ORDER BY created_at DESC
     LIMIT 20;

  3. Monitor conflict distribution:
     SELECT
       conflict_type,
       COUNT(*) as count,
       AVG(confidence) as avg_confidence,
       COUNT(CASE WHEN alpha_override THEN 1 END) as overrides
     FROM alpha_decisions
     WHERE created_at > NOW() - INTERVAL '24 hours'
     GROUP BY conflict_type;

  ## Success Criteria
  - ✅ At least some decisions have conflict_detected = TRUE
  - ✅ conflict_type has values other than 'NONE'
  - ✅ override_reason is populated when alpha_override = TRUE
  - ✅ No errors in application logs
  - ✅ Hardcoded FALSE percentage drops below 90%

  ## Rollback Plan
  If issues arise:
  - Code rollback: git revert <commit-hash>
  - No database rollback needed (no schema changes)
  - System will resume hardcoding FALSE values (original behavior)
*/

-- Final notice
DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ CCIP Migration Complete: Omega Conflict Detection';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE '📊 Verification: SELECT * FROM verify_omega_conflict_detection_active();';
  RAISE NOTICE '📈 Monitor: Alpha learning system now receives conflict data';
  RAISE NOTICE '🎯 Expected: 10-20%% decisions with conflict_detected=TRUE';
  RAISE NOTICE '🔍 SSOT: Orchestrator → Decision → Learning Tracker → Database';
  RAISE NOTICE '';
END $$;