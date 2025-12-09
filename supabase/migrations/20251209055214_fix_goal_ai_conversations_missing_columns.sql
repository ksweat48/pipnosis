/*
  # Fix Goal AI Conversations Missing Columns

  ## Problem
  The GoalSessionDashboard component expects `technical_data` and `market_snapshot`
  columns in the `goal_ai_conversations` table, but these columns may not exist in
  all deployments, causing 406 errors.

  ## Solution
  Add these columns if they don't exist, with safe defaults.

  ## Changes
  - Add `technical_data` column (jsonb) - Technical indicators (EMA, VWAP, ATR, etc)
  - Add `market_snapshot` column (jsonb) - Market conditions at time of message

  ## Safety
  - Uses IF NOT EXISTS pattern to avoid conflicts
  - Sets safe defaults (empty jsonb objects)
  - No data loss or disruption to existing records
*/

-- Add technical_data column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'technical_data'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN technical_data jsonb DEFAULT '{}'::jsonb;

    RAISE NOTICE 'Added technical_data column to goal_ai_conversations';
  ELSE
    RAISE NOTICE 'technical_data column already exists in goal_ai_conversations';
  END IF;
END $$;

-- Add market_snapshot column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'goal_ai_conversations'
    AND column_name = 'market_snapshot'
  ) THEN
    ALTER TABLE goal_ai_conversations
    ADD COLUMN market_snapshot jsonb DEFAULT '{}'::jsonb;

    RAISE NOTICE 'Added market_snapshot column to goal_ai_conversations';
  ELSE
    RAISE NOTICE 'market_snapshot column already exists in goal_ai_conversations';
  END IF;
END $$;

-- Add helpful comments
COMMENT ON COLUMN goal_ai_conversations.technical_data IS
  'Technical indicators (EMA20, EMA50, VWAP, ATR, etc) at time of AI message';

COMMENT ON COLUMN goal_ai_conversations.market_snapshot IS
  'Market conditions (trend, volatility, confidence) at time of AI message';
