/*
  # Make chart indicator preferences global (remove per-symbol settings)

  This migration transforms the chart_indicator_preferences table from per-symbol
  to global user preferences. When a user toggles an indicator off, it will be
  hidden across ALL trading pairs/symbols.

  1. Changes
    - Drop the symbol column from chart_indicator_preferences
    - Remove the old unique index on (user_id, symbol)
    - Create new unique index on user_id only (one preference row per user)
    - Consolidate existing per-symbol preferences into single global preference per user

  2. Data Migration
    - For users with multiple symbol-specific preferences, keep the most permissive settings
    - If any symbol has an indicator enabled, enable it globally
    - This ensures no user loses access to indicators they were using

  3. Security
    - RLS policies remain the same (users can only manage their own preferences)
    - No changes needed to existing policies
*/

-- Step 1: Consolidate existing data before schema changes
-- For each user, create a single preference record with the most permissive settings
-- (if ANY symbol has an indicator enabled, enable it globally)
CREATE TEMP TABLE temp_consolidated_preferences AS
SELECT
  user_id,
  bool_or(vwap_visible) as vwap_visible,
  bool_or(ema20_visible) as ema20_visible,
  bool_or(ema50_visible) as ema50_visible,
  bool_or(ema200_visible) as ema200_visible,
  min(created_at) as created_at,
  max(updated_at) as updated_at
FROM chart_indicator_preferences
GROUP BY user_id;

-- Step 2: Drop the old unique index
DROP INDEX IF EXISTS idx_chart_indicator_preferences_user_symbol;

-- Step 3: Clear the existing table
TRUNCATE TABLE chart_indicator_preferences;

-- Step 4: Remove the symbol column
ALTER TABLE chart_indicator_preferences DROP COLUMN IF EXISTS symbol;

-- Step 5: Create new unique index on user_id only
CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_indicator_preferences_user_id_unique
  ON chart_indicator_preferences(user_id);

-- Step 6: Restore consolidated preferences
INSERT INTO chart_indicator_preferences (user_id, vwap_visible, ema20_visible, ema50_visible, ema200_visible, created_at, updated_at)
SELECT user_id, vwap_visible, ema20_visible, ema50_visible, ema200_visible, created_at, updated_at
FROM temp_consolidated_preferences
ON CONFLICT (user_id) DO NOTHING;

-- Clean up temp table
DROP TABLE temp_consolidated_preferences;
