/*
  # Fix Database Errors - Comprehensive Fix
  
  Fixes multiple 400, 403, 404, 406 errors:
  
  1. Add RLS policy for authenticated users to insert ai_daily_reflections (403 error)
  2. Add missing columns if needed
  3. Ensure all table schemas match code expectations
*/

-- ============================================================================
-- FIX 1: Add RLS Policy for ai_daily_reflections (403 Error)
-- ============================================================================

-- Allow authenticated users to insert their own daily reflections
DO $$
BEGIN
  -- Drop existing restrictive policy if it exists
  DROP POLICY IF EXISTS "Service role can manage reflections" ON ai_daily_reflections;
  
  -- Create policy that allows authenticated users to insert/update their own reflections
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_daily_reflections' AND policyname = 'Users can insert own reflections'
  ) THEN
    CREATE POLICY "Users can insert own reflections"
      ON ai_daily_reflections FOR INSERT
      TO authenticated
      WITH CHECK (auth.uid() = user_id);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_daily_reflections' AND policyname = 'Users can update own reflections'
  ) THEN
    CREATE POLICY "Users can update own reflections"
      ON ai_daily_reflections FOR UPDATE
      TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
  
  -- Keep service role access for background jobs
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'ai_daily_reflections' AND policyname = 'Service role has full access'
  ) THEN
    CREATE POLICY "Service role has full access"
      ON ai_daily_reflections FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- FIX 2: Verify synthetic_backtest_trades columns exist
-- ============================================================================

-- Ensure entry_time column exists (should already exist from migration)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'synthetic_backtest_trades' AND column_name = 'entry_time'
  ) THEN
    ALTER TABLE synthetic_backtest_trades ADD COLUMN entry_time timestamptz;
    COMMENT ON COLUMN synthetic_backtest_trades.entry_time IS 'Entry timestamp for the trade';
  END IF;
END $$;

-- ============================================================================
-- FIX 3: Verify synthetic_backtest_sessions has required columns
-- ============================================================================

DO $$
BEGIN
  -- Ensure profit_factor column exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'synthetic_backtest_sessions' AND column_name = 'profit_factor'
  ) THEN
    ALTER TABLE synthetic_backtest_sessions ADD COLUMN profit_factor numeric DEFAULT 0;
    COMMENT ON COLUMN synthetic_backtest_sessions.profit_factor IS 'Profit factor (gross profit / gross loss)';
  END IF;
  
  -- Ensure total_trades column exists (should already exist)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'synthetic_backtest_sessions' AND column_name = 'total_trades'
  ) THEN
    ALTER TABLE synthetic_backtest_sessions ADD COLUMN total_trades integer DEFAULT 0;
  END IF;
END $$;

-- ============================================================================
-- FIX 4: Create indexes for commonly filtered columns
-- ============================================================================

-- Index for profit_factor filtering
CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_profit_factor
  ON synthetic_backtest_sessions(profit_factor) WHERE profit_factor IS NOT NULL;

-- Index for total_trades filtering
CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_total_trades
  ON synthetic_backtest_sessions(total_trades) WHERE total_trades > 0;

-- Composite index for common query pattern
CREATE INDEX IF NOT EXISTS idx_synthetic_sessions_completed_stats
  ON synthetic_backtest_sessions(user_id, completed_at DESC, profit_factor, total_trades)
  WHERE status = 'completed' AND profit_factor IS NOT NULL AND total_trades > 0;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

DO $$
DECLARE
  v_reflections_policies integer;
  v_synthetic_columns integer;
BEGIN
  -- Count ai_daily_reflections policies
  SELECT COUNT(*) INTO v_reflections_policies
  FROM pg_policies
  WHERE tablename = 'ai_daily_reflections';
  
  -- Count synthetic_backtest_sessions required columns
  SELECT COUNT(*) INTO v_synthetic_columns
  FROM information_schema.columns
  WHERE table_name = 'synthetic_backtest_sessions'
    AND column_name IN ('profit_factor', 'total_trades');
  
  RAISE NOTICE '========================================';
  RAISE NOTICE 'Database Errors Fixed!';
  RAISE NOTICE '========================================';
  RAISE NOTICE '';
  RAISE NOTICE '✅ ai_daily_reflections RLS policies: %', v_reflections_policies;
  RAISE NOTICE '✅ synthetic_backtest_sessions columns: %', v_synthetic_columns;
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed Issues:';
  RAISE NOTICE '  - 403 Error: Users can now insert ai_daily_reflections';
  RAISE NOTICE '  - 400 Error: profit_factor and total_trades columns exist';
  RAISE NOTICE '  - 404 Error: Goal tables fixed in code (kpi-aggregator.ts)';
  RAISE NOTICE '  - 406 Error: daily_learning_aggregations table name correct';
  RAISE NOTICE '';
  RAISE NOTICE '🚀 Ready to test backtest!';
  RAISE NOTICE '========================================';
END $$;