-- Simple check: Do the GPT-4o tables exist?
-- Copy and run this in Supabase SQL Editor

SELECT
  'ai_meta_learning_insights' AS table_name,
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'ai_meta_learning_insights'
    ) THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END AS status
UNION ALL
SELECT 
  'ai_pattern_interpretations',
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'ai_pattern_interpretations'
    ) THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END
UNION ALL
SELECT 
  'gpt4o_usage_tracking',
  CASE 
    WHEN EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'gpt4o_usage_tracking'
    ) THEN '✅ EXISTS'
    ELSE '❌ MISSING'
  END;
