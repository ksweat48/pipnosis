/*
  # Multi-Symbol Strategy Memory and AI Concurrency System
  
  This migration enables:
  1. Per-symbol strategy memory tracking (EURUSD, XAUUSD, etc.)
  2. AI-driven concurrency decision system (final, no manual override)
  3. Symbol ranking logs with explanations
  
  ## Changes
  
  1. **alpha_strategy_memory** - Add symbol tracking
     - Add `symbol` column to track which pair each strategy applies to
     - Add index for efficient per-symbol lookups
  
  2. **goal_sessions** - Add AI concurrency decision
     - Add `max_concurrent_trades` (AI's final decision: 1, 2, or 3)
     - Add `concurrency_reasoning` (AI's explanation)
  
  3. **goal_symbol_rankings** - New table for transparency
     - Logs each market scan with all symbol rankings
     - Shows why AI chose EURUSD over XAUUSD, etc.
     - Provides audit trail of decision-making
  
  ## Security
  
  - All tables maintain existing RLS policies
  - New table follows authenticated user pattern
*/

-- 1. Add symbol to alpha_strategy_memory
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'alpha_strategy_memory' AND column_name = 'symbol'
  ) THEN
    -- Symbol column already exists in the schema, but let's make sure it's consistent
    ALTER TABLE alpha_strategy_memory 
      ALTER COLUMN symbol SET NOT NULL;
    
    -- Create index for per-symbol lookups
    CREATE INDEX IF NOT EXISTS idx_alpha_strategy_memory_symbol 
      ON alpha_strategy_memory(user_id, symbol, strategy_mode, win_rate DESC);
  END IF;
END $$;

-- 2. Add AI concurrency decision to goal_sessions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'max_concurrent_trades'
  ) THEN
    ALTER TABLE goal_sessions 
      ADD COLUMN max_concurrent_trades INTEGER DEFAULT 1 CHECK (max_concurrent_trades BETWEEN 1 AND 3),
      ADD COLUMN concurrency_reasoning TEXT;
      
    COMMENT ON COLUMN goal_sessions.max_concurrent_trades IS 'AI-determined max concurrent positions (1, 2, or 3). This is a final decision - no user override.';
    COMMENT ON COLUMN goal_sessions.concurrency_reasoning IS 'AI explanation of why it chose this concurrency level based on goal analysis.';
  END IF;
END $$;

-- 3. Create goal_symbol_rankings table
CREATE TABLE IF NOT EXISTS goal_symbol_rankings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  goal_session_id UUID REFERENCES goal_sessions(id) ON DELETE CASCADE NOT NULL,
  scan_time TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Rankings array: [{symbol, rank, confidence, reasoning, stats}, ...]
  rankings JSONB NOT NULL DEFAULT '[]'::jsonb,
  
  -- Selected symbol and reasoning
  selected_symbol TEXT,
  selected_rank INTEGER, -- Where it ranked (1, 2, 3, etc.)
  selected_confidence NUMERIC, -- Confidence score of selected symbol
  selected_reasoning TEXT,
  
  -- Scan metadata
  total_symbols_scanned INTEGER DEFAULT 0,
  symbols_above_threshold INTEGER DEFAULT 0,
  highest_confidence NUMERIC,
  lowest_confidence NUMERIC,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_goal_symbol_rankings_session 
  ON goal_symbol_rankings(goal_session_id, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_goal_symbol_rankings_user 
  ON goal_symbol_rankings(user_id, scan_time DESC);
CREATE INDEX IF NOT EXISTS idx_goal_symbol_rankings_selected 
  ON goal_symbol_rankings(selected_symbol, scan_time DESC);

-- Enable RLS
ALTER TABLE goal_symbol_rankings ENABLE ROW LEVEL SECURITY;

-- RLS Policies for goal_symbol_rankings
CREATE POLICY "Users can view own symbol rankings"
  ON goal_symbol_rankings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own symbol rankings"
  ON goal_symbol_rankings FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to symbol rankings"
  ON goal_symbol_rankings FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT SELECT, INSERT ON goal_symbol_rankings TO authenticated;

-- Add helpful comments
COMMENT ON TABLE goal_symbol_rankings IS 'Logs AI symbol ranking decisions for transparency. Shows why AI chose one pair over another with confidence scores and reasoning. Critical for understanding AI decision-making process.';

COMMENT ON COLUMN goal_symbol_rankings.rankings IS 'JSON array of all symbols evaluated: [{symbol: "EURUSD", rank: 1, confidence: 85, reasoning: "...", stats: {...}}, ...]';

COMMENT ON COLUMN goal_symbol_rankings.selected_reasoning IS 'AI explanation of why this specific symbol was chosen over others. Example: "EURUSD selected due to strong trend + my 72% win rate on this pair vs 58% on XAUUSD"';
