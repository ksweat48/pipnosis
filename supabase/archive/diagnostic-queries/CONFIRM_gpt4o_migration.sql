-- ============================================================================
-- CONFIRMATION: Verify GPT-4o Migration Was Successful
-- ============================================================================

-- 1. Check all 3 tables exist
SELECT '=== TABLE EXISTENCE CHECK ===' AS check_type;
SELECT
  'ai_meta_learning_insights' AS table_name,
  EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_meta_learning_insights') AS exists,
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'ai_meta_learning_insights') AS column_count
UNION ALL
SELECT 
  'ai_pattern_interpretations',
  EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'ai_pattern_interpretations'),
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'ai_pattern_interpretations')
UNION ALL
SELECT 
  'gpt4o_usage_tracking',
  EXISTS (SELECT FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'gpt4o_usage_tracking'),
  (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'gpt4o_usage_tracking');

-- 2. Check all 3 helper functions exist
SELECT '=== HELPER FUNCTIONS CHECK ===' AS check_type;
SELECT
  'get_recent_meta_insights' AS function_name,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_recent_meta_insights') AS exists
UNION ALL
SELECT 
  'get_pattern_interpretations_for_symbol',
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_pattern_interpretations_for_symbol')
UNION ALL
SELECT 
  'calculate_gpt4o_costs',
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'calculate_gpt4o_costs');

-- 3. Count indexes on each table
SELECT '=== INDEXES CHECK ===' AS check_type;
SELECT
  'ai_meta_learning_insights' AS table_name,
  COUNT(*) AS index_count
FROM pg_indexes
WHERE tablename = 'ai_meta_learning_insights'
UNION ALL
SELECT 
  'ai_pattern_interpretations',
  COUNT(*)
FROM pg_indexes
WHERE tablename = 'ai_pattern_interpretations'
UNION ALL
SELECT 
  'gpt4o_usage_tracking',
  COUNT(*)
FROM pg_indexes
WHERE tablename = 'gpt4o_usage_tracking';

-- 4. Check RLS is enabled
SELECT '=== RLS (Row Level Security) CHECK ===' AS check_type;
SELECT
  relname AS table_name,
  relrowsecurity AS rls_enabled
FROM pg_class
WHERE relname IN ('ai_meta_learning_insights', 'ai_pattern_interpretations', 'gpt4o_usage_tracking')
ORDER BY relname;

-- 5. Count RLS policies
SELECT '=== RLS POLICIES COUNT ===' AS check_type;
SELECT
  pg_class.relname AS table_name,
  COUNT(pg_policy.polname) AS policy_count
FROM pg_policy
JOIN pg_class ON pg_policy.polrelid = pg_class.oid
WHERE pg_class.relname IN ('ai_meta_learning_insights', 'ai_pattern_interpretations', 'gpt4o_usage_tracking')
GROUP BY pg_class.relname
ORDER BY pg_class.relname;

-- 6. Check triggers exist
SELECT '=== TRIGGERS CHECK ===' AS check_type;
SELECT
  event_object_table AS table_name,
  trigger_name,
  event_manipulation AS fires_on
FROM information_schema.triggers
WHERE event_object_table IN ('ai_meta_learning_insights', 'ai_pattern_interpretations')
  AND trigger_schema = 'public'
ORDER BY event_object_table;

-- 7. Final verification summary
SELECT '=== FINAL VERIFICATION ===' AS check_type;
SELECT
  CASE 
    WHEN (
      SELECT COUNT(*) FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('ai_meta_learning_insights', 'ai_pattern_interpretations', 'gpt4o_usage_tracking')
    ) = 3 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS tables_check,
  CASE 
    WHEN (
      SELECT COUNT(*) FROM pg_proc 
      WHERE proname IN ('get_recent_meta_insights', 'get_pattern_interpretations_for_symbol', 'calculate_gpt4o_costs')
    ) = 3 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS functions_check,
  CASE 
    WHEN (
      SELECT COUNT(*) FROM pg_indexes 
      WHERE tablename IN ('ai_meta_learning_insights', 'ai_pattern_interpretations', 'gpt4o_usage_tracking')
    ) >= 15 THEN '✅ PASS'
    ELSE '⚠️ PARTIAL'
  END AS indexes_check,
  CASE 
    WHEN (
      SELECT COUNT(*) FROM pg_policy 
      JOIN pg_class ON pg_policy.polrelid = pg_class.oid
      WHERE pg_class.relname IN ('ai_meta_learning_insights', 'ai_pattern_interpretations', 'gpt4o_usage_tracking')
    ) >= 6 THEN '✅ PASS'
    ELSE '❌ FAIL'
  END AS rls_policies_check;

-- 8. Success message
SELECT '
╔═══════════════════════════════════════════════════════════════════╗
║                  ✅ MIGRATION VERIFICATION COMPLETE                ║
╚═══════════════════════════════════════════════════════════════════╝

Review the results above. If all checks show:
  ✅ PASS - Migration was executed successfully
  
Expected results:
  • 3 tables exist with correct column counts
  • 3 helper functions exist
  • ~15 indexes created (5 per table)
  • RLS enabled on all tables
  • RLS policies in place
  • Update triggers on 2 tables

If you see all PASS marks, the GPT-4o meta-learning system is ready!

Your code in these files can now work properly:
  - src/services/meta-learning-strategist.ts
  - src/services/pattern-interpreter.ts
  - src/components/MetaLearningInsightsCard.tsx

' AS confirmation_message;
