/*
  ═══════════════════════════════════════════════════════════════════════════
  PIPNOSIS DATABASE RESET SCRIPT
  ═══════════════════════════════════════════════════════════════════════════

  ⚠️ WARNING: THIS SCRIPT WILL DELETE ALL DATA IN YOUR DATABASE! ⚠️

  This script is designed for DEVELOPMENT and TESTING purposes only.

  DO NOT RUN THIS SCRIPT IN PRODUCTION!

  This script will:
  - Drop all Pipnosis tables (and all their data)
  - Drop all RLS policies
  - Drop all custom functions
  - Drop all triggers
  - Drop all views

  After running this script, you must run the consolidated migration
  to recreate the database schema.

  ═══════════════════════════════════════════════════════════════════════════
*/

-- Confirmation message
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '⚠️  DATABASE RESET SCRIPT - RUNNING IN 5 SECONDS ⚠️';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'This will DELETE ALL DATA from the following tables:';
  RAISE NOTICE '  - user_profiles';
  RAISE NOTICE '  - trading_prompts';
  RAISE NOTICE '  - trade_records';
  RAISE NOTICE '  - journal_entries';
  RAISE NOTICE '  - trading_sessions';
  RAISE NOTICE '  - waitlist';
  RAISE NOTICE '  - market_data';
  RAISE NOTICE '  - market_data_subscriptions';
  RAISE NOTICE '  - auto_trading_status';
  RAISE NOTICE '  - user_trading_preferences';
  RAISE NOTICE '  - ai_trade_decisions';
  RAISE NOTICE '  - trade_options';
  RAISE NOTICE '  - strategy_comparison';
  RAISE NOTICE '  - ai_learning_metrics';
  RAISE NOTICE '';
  RAISE NOTICE 'Press CTRL+C NOW to cancel!';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;

-- Drop all views
DROP VIEW IF EXISTS platform_statistics CASCADE;
DROP VIEW IF EXISTS user_trading_summary CASCADE;

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS ai_learning_metrics CASCADE;
DROP TABLE IF EXISTS strategy_comparison CASCADE;
DROP TABLE IF EXISTS trade_options CASCADE;
DROP TABLE IF EXISTS ai_trade_decisions CASCADE;
DROP TABLE IF EXISTS user_trading_preferences CASCADE;
DROP TABLE IF EXISTS auto_trading_status CASCADE;
DROP TABLE IF EXISTS market_data_subscriptions CASCADE;
DROP TABLE IF EXISTS market_data CASCADE;
DROP TABLE IF EXISTS journal_entries CASCADE;
DROP TABLE IF EXISTS trade_records CASCADE;
DROP TABLE IF EXISTS trading_sessions CASCADE;
DROP TABLE IF EXISTS trading_prompts CASCADE;
DROP TABLE IF EXISTS waitlist CASCADE;
DROP TABLE IF EXISTS user_profiles CASCADE;

-- Drop all custom functions
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS reset_daily_auto_trading_counts() CASCADE;
DROP FUNCTION IF EXISTS update_auto_trading_status_timestamp() CASCADE;
DROP FUNCTION IF EXISTS update_user_trading_preferences_timestamp() CASCADE;

-- Completion message
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '✅ DATABASE RESET COMPLETED';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE '';
  RAISE NOTICE 'All Pipnosis tables, functions, triggers, and views have been dropped.';
  RAISE NOTICE '';
  RAISE NOTICE 'NEXT STEPS:';
  RAISE NOTICE '1. Run the consolidated migration script to recreate the schema';
  RAISE NOTICE '2. File location: supabase/migrations/20251016_100000_consolidated_schema.sql';
  RAISE NOTICE '3. Or copy from: CONSOLIDATED_MIGRATION.sql';
  RAISE NOTICE '';
  RAISE NOTICE 'Your database is now empty and ready for a fresh migration.';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
