/*
  ═══════════════════════════════════════════════════════════════════════════
  CCIP: Fix Alpha Decisions Schema Compliance
  ═══════════════════════════════════════════════════════════════════════════

  ## Problem Statement
  Production errors show TypeScript code inserting `market_context` field into
  `alpha_decisions` table, but the column doesn't exist, causing:
  - 400 Bad Request errors on every Alpha decision
  - Learning system completely broken
  - No decision logging (AI cannot learn)
  - Error: "Could not find the 'market_context' column of 'alpha_decisions' in the schema cache"

  ## Root Cause (SSOT Violation)
  - Code Location: alpha-learning-tracker.ts:93
  - Code tries to insert `market_context: marketContext` (JSONB data)
  - Database table missing `market_context` column
  - SSOT broken: TypeScript interface doesn't match database schema

  ## CCIP Compliance Analysis

  ### Change Type
  Schema Extension (Non-Breaking)

  ### System Map
  - Database: alpha_decisions table (SSOT for decision storage)
  - Service: alpha-learning-tracker.ts (decision logger)
  - Service: coordinator-alpha.ts (calls logger with marketContext)
  - Downstream: AI learning queries, analytics, meta-learning

  ### Logic Contract
  - alpha_decisions.market_context stores JSONB snapshot of market conditions
  - Contains: price, atr, regime, volatility, indicators, candles
  - Used by: Learning system to correlate decisions with market state
  - Nullable: Yes (backward compatible with existing rows)

  ### Impact Assessment
  - Breaking: NO (column is nullable with default)
  - Data Loss Risk: NONE (additive only)
  - Existing Code: Compatible (ignores new column if not used)
  - New Code: Fixed (can now insert market_context)

  ### Compatibility
  - Backward: ✅ Existing inserts work (column is nullable)
  - Forward: ✅ New inserts use the column
  - Migration Safety: ✅ No data transformation required

  ## Changes
  1. Add `market_context` JSONB column to alpha_decisions
  2. Add GIN index for efficient JSONB queries
  3. Verify column exists before completing

  ## Post-Deployment Verification
  - Errors should stop immediately
  - Alpha decisions should log successfully
  - Verify with: SELECT market_context FROM alpha_decisions LIMIT 1;

  ═══════════════════════════════════════════════════════════════════════════
*/

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 1: Add market_context column (JSONB)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  -- Check if column already exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions'
    AND column_name = 'market_context'
  ) THEN
    -- Add market_context column
    ALTER TABLE alpha_decisions
    ADD COLUMN market_context jsonb DEFAULT '{}'::jsonb;

    RAISE NOTICE '✅ Added market_context column to alpha_decisions';
  ELSE
    RAISE NOTICE 'ℹ️ market_context column already exists';
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 2: Add GIN index for JSONB queries (Performance Optimization)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_alpha_decisions_market_context
ON alpha_decisions USING GIN (market_context);

COMMENT ON INDEX idx_alpha_decisions_market_context IS
'GIN index for efficient querying of market_context JSONB field (e.g., filtering by regime, volatility)';

-- ═══════════════════════════════════════════════════════════════════════════
-- STEP 3: Verification (CCIP Post-Deployment Check)
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  column_exists boolean;
  index_exists boolean;
BEGIN
  -- Verify column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_decisions'
    AND column_name = 'market_context'
  ) INTO column_exists;

  -- Verify index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'alpha_decisions'
    AND indexname = 'idx_alpha_decisions_market_context'
  ) INTO index_exists;

  IF NOT column_exists THEN
    RAISE EXCEPTION '❌ CCIP Verification Failed: market_context column not created';
  END IF;

  IF NOT index_exists THEN
    RAISE WARNING '⚠️ CCIP Warning: GIN index not created (non-critical)';
  END IF;

  RAISE NOTICE '🎯 CCIP Migration Complete: Alpha Decisions schema compliance restored';
  RAISE NOTICE 'ℹ️ Production errors should stop immediately';
END $$;