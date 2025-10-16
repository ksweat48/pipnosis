# Pipnosis Database Migrations

This directory contains the database schema and migration strategy for the Pipnosis AI Trading Platform.

## Migration Strategy

As of October 2025, this project uses a **consolidated migration approach** with a single source of truth for the entire database schema.

### Active Migration

The only active migration file is:

```
migrations/20251016_100000_consolidated_schema.sql
```

This file contains the complete database schema including:
- Core user and trading tables
- Market data storage
- Auto trading status and preferences
- AI trading brain tables (decisions, options, learning metrics)
- Admin role system with analytics views
- All RLS policies for security
- Performance indexes
- Triggers and functions

### Archived Migrations

All previous incremental migration files (40 files) have been archived to:

```
migrations_archive/
```

These files are preserved for historical reference but should NOT be run. They are superseded by the consolidated migration.

## How to Use

### First Time Setup

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the contents of `migrations/20251016_100000_consolidated_schema.sql`
4. Paste into the SQL Editor and run
5. After successful execution, set admin status:
   - Go to Table Editor > `user_profiles`
   - Find your user record by email
   - Set `is_admin = true` for your account
   - Refresh your application

### Running Migrations Again

The consolidated migration is **idempotent** and can be safely run multiple times. It includes:
- `IF NOT EXISTS` clauses for table creation
- `DROP POLICY IF EXISTS` for all policies
- `DROP TRIGGER IF EXISTS` for all triggers
- `CREATE OR REPLACE` for all functions

This means you can re-run it without errors if needed.

## Database Reset (Development Only)

If you need to completely reset your database during development:

1. Open `scripts/RESET_DATABASE.sql`
2. Copy its contents to Supabase SQL Editor
3. **⚠️ WARNING: This will delete ALL data!**
4. Run the script
5. Then run the consolidated migration to recreate the schema

**DO NOT use the reset script in production!**

## Schema Overview

### Core Tables

- **user_profiles** - User accounts and trading configuration
- **trading_prompts** - User trading prompts and AI analysis
- **trade_records** - Executed trades and their results
- **journal_entries** - Trading journal and AI decision logs
- **trading_sessions** - Trading session tracking
- **waitlist** - Beta access waitlist

### Market Data Tables

- **market_data** - Live price caching for all timeframes
- **market_data_subscriptions** - Active market data subscriptions

### Auto Trading Tables

- **auto_trading_status** - User auto trading status and settings
- **user_trading_preferences** - Trading preferences per user

### AI Trading Brain Tables

- **ai_trade_decisions** - All AI trading decisions (manual + auto)
- **trade_options** - Three risk variants (low, medium, high) per decision
- **strategy_comparison** - FX Flow vs AI Independent vs Hybrid comparison
- **ai_learning_metrics** - Learning outcomes for continuous improvement

## Security

All tables have Row Level Security (RLS) enabled with appropriate policies:

- Users can only access their own data
- Admins can view all user profiles
- Market data is publicly readable for authenticated users
- Strict authentication checks on all operations

Admin emails auto-configured in the migration:
- ksweat48@gmail.com
- admin@pipnosis.com

## Performance

The schema includes comprehensive indexes for optimal query performance:

- User and timestamp indexes on all major tables
- Composite indexes for common query patterns
- Partial indexes for admin lookups
- Symbol/timeframe/timestamp indexes for market data

## Support

For questions or issues with database migrations:

1. Check that you're running the consolidated migration file
2. Verify all policies were created without errors
3. Confirm your user has admin privileges if accessing admin features
4. Review the Supabase logs for any RLS policy denials

## Version History

- **October 16, 2025** - Consolidated all migrations into single idempotent file
- **October 2025** - Incremental migrations (now archived)
- **June 2025** - Initial schema setup
