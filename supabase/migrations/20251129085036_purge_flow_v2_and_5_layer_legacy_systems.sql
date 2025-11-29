/*
  # Purge Flow V2 and 5-Layer Legacy Systems

  Complete architectural cleanup - removing all references to deprecated trading systems.

  ## Changes

  1. **Remove Layer Constraints**
     - Updates `llm_decision_log` decision_layer constraint
     - Removes references to layer1-5
     - Adds new Alpha-specific decision types

  2. **Drop Legacy Tables**
     - Removes any Flow V2 specific tables
     - Removes layer decision tracking tables

  3. **Update Comments**
     - Documents that Pipnosis Alpha is the ONLY trading system

  ## Pipnosis Alpha Architecture

  The unified autonomous trading brain with:
  - Strategy Planning (GPT-4o, every ~100 candles)
  - Condition Monitoring (local rules, zero cost)
  - Execution Decision (GPT-4o, per trigger)
  - Safety Validation (hard rules, zero cost)

  NO Flow V2, NO 5-layer system, NO fallback paths.
*/

-- ============================================================================
-- 1. Update llm_decision_log constraint to remove layer references
-- ============================================================================

DO $$
BEGIN
  -- Drop old constraint if exists
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'llm_decision_log_decision_layer_check'
  ) THEN
    ALTER TABLE llm_decision_log
    DROP CONSTRAINT llm_decision_log_decision_layer_check;
  END IF;

  -- Add new constraint with Alpha-specific decision types
  ALTER TABLE llm_decision_log
  ADD CONSTRAINT llm_decision_log_decision_layer_check
  CHECK (decision_layer IN (
    'strategy_planning',
    'condition_monitoring',
    'execution_decision',
    'safety_validation',
    'mid_trade_evaluation',
    'position_closure'
  ));
END $$;

-- ============================================================================
-- 2. Drop legacy tables if they exist
-- ============================================================================

DROP TABLE IF EXISTS flow_v2_signals CASCADE;
DROP TABLE IF EXISTS layer_decisions CASCADE;
DROP TABLE IF EXISTS layer_execution_log CASCADE;
DROP TABLE IF EXISTS regime_validation_cache CASCADE;

-- ============================================================================
-- 3. Add documentation comments
-- ============================================================================

COMMENT ON TABLE llm_decision_log IS
'Pipnosis Alpha Brain decision log - Unified autonomous trading system with strategy planning, condition monitoring, execution decisions, and safety validation. NO legacy systems.';

COMMENT ON COLUMN llm_decision_log.decision_layer IS
'Alpha decision phase: strategy_planning | condition_monitoring | execution_decision | safety_validation | mid_trade_evaluation | position_closure';

-- ============================================================================
-- 4. Clean up any orphaned indexes or functions related to legacy systems
-- ============================================================================

DROP INDEX IF EXISTS idx_layer_decisions_timestamp;
DROP INDEX IF EXISTS idx_flow_v2_signals_symbol;

DROP FUNCTION IF EXISTS calculate_layer_performance CASCADE;
DROP FUNCTION IF EXISTS aggregate_flow_v2_stats CASCADE;

-- ============================================================================
-- Success message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '✅ Pipnosis Alpha Purge Complete';
  RAISE NOTICE '   - Flow V2 system removed';
  RAISE NOTICE '   - 5-Layer pipeline removed';
  RAISE NOTICE '   - Legacy tables dropped';
  RAISE NOTICE '   - Pipnosis Alpha is the ONLY trading brain';
END $$;
