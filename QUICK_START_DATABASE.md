# Pipnosis Database - Quick Start

## The Problem (SOLVED!)

You were getting this error:
```
ERROR: 42710: policy "Users can view own profile" already exists
```

This happened because multiple migration files were creating the same database policies.

## The Solution (IMPLEMENTED!)

All 40 individual migration files have been consolidated into ONE idempotent migration file that can be safely run multiple times.

## How to Fix Your Database (3 Easy Steps)

### Step 1: Open Supabase SQL Editor

1. Go to your Supabase dashboard
2. Click on "SQL Editor" in the left sidebar

### Step 2: Run the Consolidated Migration

1. Open this file in your project:
   ```
   supabase/migrations/20251016_100000_consolidated_schema.sql
   ```

2. Copy ALL the contents (it's about 830 lines)

3. Paste into the Supabase SQL Editor

4. Click "Run" (or press Ctrl+Enter)

The script will:
- Drop any existing conflicting policies
- Create all tables (if they don't exist)
- Create all policies, indexes, triggers, and functions
- Set up admin access for ksweat48@gmail.com

**The script is safe to run multiple times!**

### Step 3: Set Your Admin Status

After the migration runs successfully:

1. In Supabase, go to "Table Editor"
2. Click on the `user_profiles` table
3. Find your user record (search by your email)
4. Edit the record
5. Set `is_admin` to `true`
6. Save

That's it! Refresh your Pipnosis application and everything should work.

## What Changed in Your Project?

### Before
```
supabase/migrations/
├── 20250626014008_fancy_grove.sql
├── 20250626070754_divine_marsh.sql
├── ... (40 migration files causing conflicts)
```

### After
```
supabase/migrations/
└── 20251016_100000_consolidated_schema.sql  ← ONE file, no conflicts!

supabase/migrations_archive/
└── [40 old migrations saved for reference]
```

## What If I Get Errors?

### "Policy already exists" error?
The new migration file includes `DROP POLICY IF EXISTS` statements. Just run it again!

### "Table already exists" error?
The migration uses `CREATE TABLE IF NOT EXISTS`. Just run it again!

### Need a fresh start?
Run the reset script first (⚠️ deletes all data):
```
supabase/scripts/RESET_DATABASE.sql
```
Then run the consolidated migration.

## Documentation

For more details, see:
- `DATABASE_SETUP.md` - Detailed setup guide
- `supabase/README.md` - Full migration documentation
- `MIGRATION_CONSOLIDATION_SUMMARY.md` - What was changed and why

## Need Help?

The error you saw should be completely resolved now. The consolidated migration is designed to be idempotent and handle all edge cases.

If you still have issues:
1. Check the Supabase logs for specific error messages
2. Verify you're running the correct file (the one in migrations/, not migrations_archive/)
3. Make sure your Supabase project is accessible and not rate-limited

---

**Ready to go!** Just run the consolidated migration in Supabase SQL Editor and you're all set! 🚀
