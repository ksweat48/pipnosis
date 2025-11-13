/*
  # Diagnostic Script: Check ai_pattern_ev_tracking Schema
  
  Run this FIRST in Supabase SQL Editor to see current state before applying fix.
  This is read-only and safe to run.
*/

-- ============================================================================
-- Check if table exists
-- ============================================================================
SELECT 
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'ai_pattern_ev_tracking'
    ) THEN '✅ Table EXISTS'
    ELSE '❌ Table DOES NOT EXIST'
  END AS table_status;

-- ============================================================================
-- List all columns in current table
-- ============================================================================
SELECT 
  column_name,
  data_type,
  character_maximum_length,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'ai_pattern_ev_tracking'
ORDER BY ordinal_position;

-- ============================================================================
-- Check for critical missing columns
-- ============================================================================
SELECT
  'user_id' AS column_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'user_id'
  ) AS exists
UNION ALL
SELECT 'avg_loss_amount', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'avg_loss_amount'
  )
UNION ALL
SELECT 'win_probability', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'win_probability'
  )
UNION ALL
SELECT 'volatility_regime', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'volatility_regime'
  )
UNION ALL
SELECT 'avg_win_amount', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'avg_win_amount'
  )
UNION ALL
SELECT 'pattern_status', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'pattern_status'
  )
UNION ALL
SELECT 'ev_confidence_level', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'ev_confidence_level'
  );

-- ============================================================================
-- Check for wrong columns (from bad migration)
-- ============================================================================
SELECT
  'win_rate (WRONG)' AS column_name,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'win_rate'
  ) AS exists
UNION ALL
SELECT 'avg_profit (WRONG)', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'avg_profit'
  )
UNION ALL
SELECT 'avg_loss (WRONG)', EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_pattern_ev_tracking' AND column_name = 'avg_loss'
  );

-- ============================================================================
-- Check constraints
-- ============================================================================
SELECT
  con.conname AS constraint_name,
  con.contype AS constraint_type,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class rel ON rel.oid = con.conrelid
WHERE rel.relname = 'ai_pattern_ev_tracking';

-- ============================================================================
-- Check indexes
-- ============================================================================
SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ai_pattern_ev_tracking';

-- ============================================================================
-- Check RLS policies
-- ============================================================================
SELECT
  polname AS policy_name,
  polcmd AS command,
  polpermissive AS permissive,
  pg_get_expr(polqual, polrelid) AS using_expression,
  pg_get_expr(polwithcheck, polrelid) AS with_check_expression
FROM pg_policy
JOIN pg_class ON pg_policy.polrelid = pg_class.oid
WHERE pg_class.relname = 'ai_pattern_ev_tracking';

-- ============================================================================
-- Check if there's any data in the table
-- ============================================================================
SELECT 
  COUNT(*) AS row_count,
  CASE 
    WHEN COUNT(*) > 0 THEN '⚠️ Table has data - will be backed up'
    ELSE '✅ Table is empty - safe to recreate'
  END AS data_status
FROM ai_pattern_ev_tracking;

-- ============================================================================
-- Check if get_pattern_ev function exists
-- ============================================================================
SELECT
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM pg_proc 
      WHERE proname = 'get_pattern_ev'
    ) THEN '✅ Function EXISTS'
    ELSE '❌ Function MISSING'
  END AS function_status;

-- ============================================================================
-- Summary
-- ============================================================================
SELECT '
╔════════════════════════════════════════════════════════════════╗
║                   DIAGNOSTIC SUMMARY                           ║
╚════════════════════════════════════════════════════════════════╝

Review the results above to understand the current schema state.

Expected columns that SHOULD exist:
  ✓ user_id (uuid, NOT NULL)
  ✓ avg_loss_amount (numeric 12,2)
  ✓ win_probability (numeric 5,2)
  ✓ avg_win_amount (numeric 12,2)
  ✓ volatility_regime (text with CHECK)
  ✓ pattern_status (text with CHECK)
  ✓ ev_confidence_level (text with CHECK)

Wrong columns that should NOT exist:
  ✗ win_rate (should be win_probability)
  ✗ avg_profit (should be avg_win_amount)
  ✗ avg_loss (should be avg_loss_amount)

If you see missing columns or wrong columns, run the fix migration:
  20251115000000_fix_ai_pattern_ev_tracking_schema.sql

' AS diagnostic_info;
