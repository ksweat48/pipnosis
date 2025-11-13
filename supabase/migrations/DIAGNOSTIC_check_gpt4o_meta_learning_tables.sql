/*
  # Diagnostic: Check GPT-4o Meta-Learning Tables
  
  Run this in Supabase SQL Editor to verify if the GPT-4o meta-learning 
  migration was executed successfully.
*/

-- ============================================================================
-- Check if all three main tables exist
-- ============================================================================
SELECT
  'ai_meta_learning_insights' AS table_name,
  EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'ai_meta_learning_insights'
  ) AS exists
UNION ALL
SELECT 'ai_pattern_interpretations', EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'ai_pattern_interpretations'
  )
UNION ALL
SELECT 'gpt4o_usage_tracking', EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'gpt4o_usage_tracking'
  );

-- ============================================================================
-- Check ai_meta_learning_insights table structure
-- ============================================================================
SELECT '=== ai_meta_learning_insights columns ===' AS info;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'ai_meta_learning_insights'
ORDER BY ordinal_position;

-- ============================================================================
-- Check ai_pattern_interpretations table structure
-- ============================================================================
SELECT '=== ai_pattern_interpretations columns ===' AS info;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'ai_pattern_interpretations'
ORDER BY ordinal_position;

-- ============================================================================
-- Check gpt4o_usage_tracking table structure
-- ============================================================================
SELECT '=== gpt4o_usage_tracking columns ===' AS info;

SELECT 
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_name = 'gpt4o_usage_tracking'
ORDER BY ordinal_position;

-- ============================================================================
-- Check if helper functions exist
-- ============================================================================
SELECT '=== Helper Functions ===' AS info;

SELECT
  'get_recent_meta_insights' AS function_name,
  EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_recent_meta_insights'
  ) AS exists
UNION ALL
SELECT 'get_pattern_interpretations_for_symbol', EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'get_pattern_interpretations_for_symbol'
  )
UNION ALL
SELECT 'calculate_gpt4o_costs', EXISTS (
    SELECT 1 FROM pg_proc 
    WHERE proname = 'calculate_gpt4o_costs'
  );

-- ============================================================================
-- Check indexes on ai_meta_learning_insights
-- ============================================================================
SELECT '=== ai_meta_learning_insights indexes ===' AS info;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ai_meta_learning_insights';

-- ============================================================================
-- Check indexes on ai_pattern_interpretations
-- ============================================================================
SELECT '=== ai_pattern_interpretations indexes ===' AS info;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'ai_pattern_interpretations';

-- ============================================================================
-- Check indexes on gpt4o_usage_tracking
-- ============================================================================
SELECT '=== gpt4o_usage_tracking indexes ===' AS info;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE tablename = 'gpt4o_usage_tracking';

-- ============================================================================
-- Check RLS policies
-- ============================================================================
SELECT '=== RLS Policies for ai_meta_learning_insights ===' AS info;

SELECT
  polname AS policy_name,
  polcmd AS command,
  pg_get_expr(polqual, polrelid) AS using_expression
FROM pg_policy
JOIN pg_class ON pg_policy.polrelid = pg_class.oid
WHERE pg_class.relname = 'ai_meta_learning_insights';

-- ============================================================================
-- Check for any data in the tables
-- ============================================================================
SELECT '=== Data Check ===' AS info;

SELECT
  'ai_meta_learning_insights' AS table_name,
  (SELECT COUNT(*) FROM ai_meta_learning_insights) AS row_count
UNION ALL
SELECT 'ai_pattern_interpretations',
  (SELECT COUNT(*) FROM ai_pattern_interpretations)
UNION ALL
SELECT 'gpt4o_usage_tracking',
  (SELECT COUNT(*) FROM gpt4o_usage_tracking);

-- ============================================================================
-- Check for triggers
-- ============================================================================
SELECT '=== Triggers ===' AS info;

SELECT
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE event_object_table IN ('ai_meta_learning_insights', 'ai_pattern_interpretations')
  AND trigger_schema = 'public';

-- ============================================================================
-- Final Summary
-- ============================================================================
SELECT '
╔════════════════════════════════════════════════════════════════╗
║         GPT-4o Meta-Learning Migration Status Check            ║
╚════════════════════════════════════════════════════════════════╝

Review the results above to determine if migration was executed.

EXPECTED STATE (if migration was executed):
  ✓ 3 tables exist (ai_meta_learning_insights, ai_pattern_interpretations, gpt4o_usage_tracking)
  ✓ All columns present in each table
  ✓ 3 helper functions exist
  ✓ Indexes created on all tables
  ✓ RLS policies in place
  ✓ Update triggers on insights and interpretations tables

MISSING STATE (if migration NOT executed):
  ✗ Tables do not exist
  ✗ Functions missing
  ✗ No indexes or policies

If tables are missing, you need to run:
  20251114000000_create_gpt4o_meta_learning_system.sql
  or
  20251113100353_create_gpt4o_meta_learning_system.sql

' AS summary;
