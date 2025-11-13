# Fix EV Calculator Database Schema

## Problem Summary
The EV Calculator is completely broken due to a database schema conflict. Your code expects columns that don't exist in the database.

### Error You're Seeing
```
POST .../ai_pattern_ev_tracking 400 (Bad Request)
Could not find the 'avg_loss_amount' column of 'ai_pattern_ev_tracking' in the schema cache
```

## Root Cause
Migration `20251111063000` created a simplified version of `ai_pattern_ev_tracking` that overwrote the proper schema from migration `20251110000000`.

### What's Wrong
- Missing `user_id` column (breaks RLS)
- Wrong column names: `win_rate` instead of `win_probability`
- Wrong column names: `avg_profit`/`avg_loss` instead of `avg_win_amount`/`avg_loss_amount`
- Missing `volatility_regime` column
- Missing quality tracking columns

## How to Fix

### Step 1: Run Diagnostic (Optional but Recommended)
In Supabase SQL Editor, run:
```
DIAGNOSTIC_check_ai_pattern_ev_tracking.sql
```

This shows you the current broken state.

### Step 2: Apply the Fix
In Supabase SQL Editor, run:
```
20251115000000_fix_ai_pattern_ev_tracking_schema.sql
```

This will:
1. Backup any existing data automatically
2. Drop the broken table
3. Recreate with correct schema
4. Add proper indexes
5. Set up RLS policies
6. Recreate the `get_pattern_ev()` function
7. Verify everything is correct

### Step 3: Verify Fix Worked
At the end of the migration, you'll see:
```
✅ Schema verification passed! All critical columns present.
```

### Step 4: Test in Browser
Refresh your app and check the console. The errors should be gone:
- No more 400 errors
- No more "Could not find 'avg_loss_amount' column" errors
- EV Calculator should successfully save pattern tracking data

## What Gets Fixed

### Before (Broken)
```sql
CREATE TABLE ai_pattern_ev_tracking (
  id uuid,
  pattern_name text,
  symbol text,
  timeframe text,
  expected_value numeric(10,2),
  occurrences integer,
  win_rate numeric(5,2),      -- WRONG
  avg_profit numeric(10,2),    -- WRONG
  avg_loss numeric(10,2),      -- WRONG
  -- Missing: user_id, volatility_regime, pattern_status, etc.
);
```

### After (Fixed)
```sql
CREATE TABLE ai_pattern_ev_tracking (
  id uuid,
  user_id uuid NOT NULL,                    -- ADDED
  pattern_name text,
  symbol text,
  timeframe text,
  volatility_regime text,                   -- ADDED
  expected_value numeric(12,2),
  win_probability numeric(5,2),             -- FIXED
  avg_win_amount numeric(12,2),             -- FIXED
  avg_loss_amount numeric(12,2),            -- FIXED
  sample_size integer,
  win_count integer,
  loss_count integer,
  avg_rr numeric(10,2),
  profit_factor numeric(10,2),
  ev_confidence_level text,                 -- ADDED
  is_statistically_significant boolean,     -- ADDED
  pattern_status text,                      -- ADDED
  first_seen_at timestamptz,                -- ADDED
  last_updated_at timestamptz,              -- ADDED
  last_trade_at timestamptz,                -- ADDED
  -- Plus proper unique constraint, indexes, RLS
);
```

## Safety
- Any existing data will be automatically backed up to `ai_pattern_ev_tracking_backup_20251115`
- The migration is idempotent (safe to run multiple times)
- Includes built-in verification that confirms success

## Expected Results After Fix
1. No more 400 errors in console
2. Pattern EV tracking works properly
3. Learning system can track which patterns are profitable
4. Defensive mode can activate when patterns degrade
5. Your AI can learn from completed trades
