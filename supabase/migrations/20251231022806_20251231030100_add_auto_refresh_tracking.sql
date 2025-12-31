/*
  # Add Auto-Refresh Tracking

  ## Changes
  1. Add `was_auto_refreshed` boolean to entry_intents table
  2. Add `refresh_attempted` boolean to track refresh attempts
  3. Add indexes for analytics queries

  ## Purpose
  Track soft-refresh flow effectiveness:
  - How often does auto-refresh succeed vs. hard block?
  - Which symbols/timeframes need the most refreshes?
  - Optimize cache TTLs based on refresh success rates

  ## Analytics Queries Enabled
  ```sql
  -- Auto-refresh success rate
  SELECT 
    COUNT(*) FILTER (WHERE was_auto_refreshed = true) as refreshed,
    COUNT(*) FILTER (WHERE refresh_attempted = true AND was_auto_refreshed = false) as hard_blocks,
    COUNT(*) as total
  FROM entry_intents
  WHERE created_at > now() - interval '24 hours';

  -- Most refreshed symbols
  SELECT symbol, COUNT(*) 
  FROM entry_intents 
  WHERE was_auto_refreshed = true
  GROUP BY symbol
  ORDER BY COUNT(*) DESC;
  ```
*/

-- Add was_auto_refreshed column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'was_auto_refreshed'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN was_auto_refreshed boolean DEFAULT false;
  END IF;
END $$;

-- Add refresh_attempted column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'entry_intents'
    AND column_name = 'refresh_attempted'
  ) THEN
    ALTER TABLE entry_intents
    ADD COLUMN refresh_attempted boolean DEFAULT false;
  END IF;
END $$;

-- Create index for refresh analytics
CREATE INDEX IF NOT EXISTS idx_entry_intents_auto_refresh
ON entry_intents(was_auto_refreshed, created_at)
WHERE was_auto_refreshed = true;

-- Create index for hard block analytics
CREATE INDEX IF NOT EXISTS idx_entry_intents_hard_blocks
ON entry_intents(refresh_attempted, was_auto_refreshed, created_at)
WHERE refresh_attempted = true AND was_auto_refreshed = false;

-- Comment for documentation
COMMENT ON COLUMN entry_intents.was_auto_refreshed IS 'True if freshness gate auto-refreshed stale data and passed on second attempt';
COMMENT ON COLUMN entry_intents.refresh_attempted IS 'True if freshness gate attempted to auto-refresh (may or may not have succeeded)';
