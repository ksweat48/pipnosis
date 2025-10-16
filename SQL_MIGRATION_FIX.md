# SQL Migration Fix - Reserved Keyword Issue

> **Note:** This document describes a historical issue that has been resolved in the consolidated migration. As of October 16, 2025, all individual migrations have been archived and replaced with a single consolidated migration file. See `DATABASE_SETUP.md` for current setup instructions.

---

## Problem

The initial SQL migration failed with the error:
```
ERROR: 42601: syntax error at or near "exists"
LINE 125: exists boolean,
```

## Root Cause

PostgreSQL has reserved keywords that cannot be used as column names without quoting. The word `exists` is a reserved SQL keyword used in `EXISTS` clauses.

In the function `check_historical_candles_exist()`, we attempted to return a column named `exists`:

```sql
-- BROKEN VERSION
RETURNS TABLE (
  exists boolean,  -- ❌ This is a reserved keyword!
  candle_count bigint
)
```

## Solution

Renamed the column from `exists` to `data_exists`:

```sql
-- FIXED VERSION
RETURNS TABLE (
  data_exists boolean,  -- ✅ No longer a reserved keyword
  candle_count bigint
)
```

## Files Updated

### 1. SQL Migration
**File:** `supabase/migrations/20251012000000_create_historical_candles.sql`

**Change:**
```sql
-- Before (line 125)
exists boolean,

-- After (line 126)
data_exists boolean,
```

### 2. TypeScript Service
**File:** `src/services/fetchHistoricalCandles.ts`

**Change:**
```typescript
// Before (line 111)
exists: data[0].exists || false,

// After (line 111)
exists: data[0].data_exists || false,
```

Note: The return type interface still uses `exists` (not a reserved word in TypeScript), but we map from the SQL `data_exists` column.

## Testing

After applying the migration, test with these SQL commands:

```sql
-- 1. Verify table was created
SELECT table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'historical_candles';

-- 2. Test the stats function
SELECT * FROM get_historical_candle_stats('EURUSD', '5m');

-- 3. Test the existence check function (should return data_exists column)
SELECT * FROM check_historical_candles_exist(
  'EURUSD', 
  '5m', 
  '2024-01-01'::timestamptz, 
  '2024-12-31'::timestamptz
);
```

Expected result from test #3:
```
 data_exists | candle_count 
-------------+--------------
 f           |            0
```

## How to Apply the Fixed Migration

### Option 1: Supabase Dashboard
1. Go to your Supabase project
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the entire contents of `supabase/migrations/20251012000000_create_historical_candles.sql`
5. Paste into the editor
6. Click **Run** or press `Ctrl+Enter`

### Option 2: Supabase CLI
```bash
# Make sure you're in the project directory
cd /path/to/pipnosis-ai-trading

# Push migrations to database
supabase db push
```

## Verification

After successful migration, you should see:
- ✅ Table `historical_candles` created
- ✅ 5 indexes created
- ✅ RLS policies enabled
- ✅ 3 functions created:
  - `update_historical_candles_updated_at()`
  - `get_historical_candle_stats()`
  - `check_historical_candles_exist()`

## Common PostgreSQL Reserved Keywords to Avoid

When creating database schemas, avoid these common reserved words:
- `exists`, `select`, `from`, `where`, `order`, `group`
- `user`, `role`, `session`, `current`
- `table`, `index`, `view`, `function`
- `value`, `values`, `default`
- `null`, `true`, `false`

If you must use them, wrap in double quotes:
```sql
-- This works but is not recommended
"exists" boolean
```

## Status

✅ **FIXED** - Migration should now run successfully without syntax errors.

## Related Documentation

- [PostgreSQL Reserved Keywords](https://www.postgresql.org/docs/current/sql-keywords-appendix.html)
- [Supabase SQL Editor](https://supabase.com/docs/guides/database/overview)
- Main implementation guide: `README_HISTORICAL_CANDLES.md`
