# Pipnosis Database Setup Guide

## Quick Start

To set up your Pipnosis database in Supabase, follow these simple steps:

### 1. Run the Consolidated Migration

1. Open your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Open the file: `supabase/migrations/20251016_100000_consolidated_schema.sql`
4. Copy all contents
5. Paste into the Supabase SQL Editor
6. Click **Run** (or press Ctrl+Enter)

The migration is idempotent, so you can safely run it multiple times without errors.

### 2. Set Admin Privileges

After running the migration:

1. Go to **Table Editor** in Supabase
2. Select the `user_profiles` table
3. Find your user record (search by your email)
4. Edit the record and set `is_admin = true`
5. Save the change

### 3. Refresh Your Application

Refresh your Pipnosis application, and all features should now work correctly!

## What Gets Created

The consolidated migration creates:

### Core Tables (6)
- `user_profiles` - User accounts and settings
- `trading_prompts` - AI trading prompts
- `trade_records` - Trade execution history
- `journal_entries` - Trading journal
- `trading_sessions` - Session tracking
- `waitlist` - Beta access queue

### Market Data Tables (2)
- `market_data` - Live price cache
- `market_data_subscriptions` - Active subscriptions

### Auto Trading Tables (2)
- `auto_trading_status` - Auto trading state
- `user_trading_preferences` - User preferences

### AI Trading Brain Tables (4)
- `ai_trade_decisions` - All AI decisions
- `trade_options` - Risk variant options
- `strategy_comparison` - Strategy performance
- `ai_learning_metrics` - Learning outcomes

### Additional Components
- **36 RLS Policies** for data security
- **20+ Indexes** for performance
- **5 Functions** for automation
- **7 Triggers** for timestamps
- **2 Views** for analytics

## Auto-Configured Admins

These emails are automatically granted admin privileges:
- ksweat48@gmail.com
- admin@pipnosis.com

## Troubleshooting

### Policy Already Exists Error

If you see an error like:
```
ERROR: policy "Users can view own profile" already exists
```

**Solution**: The consolidated migration now includes `DROP POLICY IF EXISTS` statements. Simply re-run the migration from `supabase/migrations/20251016_100000_consolidated_schema.sql`.

### Need to Reset Database?

For development environments only:

1. Run `supabase/scripts/RESET_DATABASE.sql` to drop all tables
2. Then run the consolidated migration to recreate everything

**⚠️ Warning: Reset script deletes ALL data!**

## Migration History

The project previously used 40 incremental migration files, which have been archived to `supabase/migrations_archive/`. These are kept for historical reference but should NOT be run.

The current approach uses a single consolidated migration file for simplicity and reliability.

## Need Help?

- Check `supabase/README.md` for detailed documentation
- Review Supabase logs for RLS policy errors
- Verify your user has admin privileges for admin features
- Ensure you're running the consolidated migration, not archived files

## File Locations

```
CONSOLIDATED_MIGRATION.sql                    # Original (project root)
supabase/migrations/20251016_100000_consolidated_schema.sql  # Active migration
supabase/migrations_archive/                  # Old migrations (archived)
supabase/scripts/RESET_DATABASE.sql          # Reset script (dev only)
supabase/README.md                           # Full documentation
```

---

**Last Updated**: October 16, 2025
