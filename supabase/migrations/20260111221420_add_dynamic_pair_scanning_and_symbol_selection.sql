/*
  # Add Dynamic Pair Scanning and Symbol Selection System

  1. New Columns
    - `goal_sessions.active_pairs_count` (integer, nullable)
      - Real-time count of scannable pairs considering market hours
      - Updates on every scan cycle
      - Used for accurate UI display (e.g., "Scanning 2 pairs" vs "Scanning 9 pairs")
    
    - `goal_sessions.asset_class_filter` (jsonb, nullable)
      - User's asset class preferences: ['forex', 'crypto', 'indices', 'gold']
      - Used to filter watchlist by category
    
    - `goal_sessions.specific_symbols` (jsonb, nullable)
      - User-selected specific symbols from UI or detected from prompt
      - Takes priority over asset class filter
      - Example: ["EURUSD"] for single-pair targeting
    
    - `goal_sessions.custom_instructions` (text, nullable)
      - User's custom trading instructions
      - Appended to goal prompt for LLM context
      - Max 200 characters
    
    - `goal_sessions.symbol_selection_source` (text, nullable)
      - How symbols were chosen: 'prompt', 'ui', 'asset_filter', 'default'
      - Used for UI display and debugging
    
    - `goal_sessions.last_pairs_update` (timestamptz, nullable)
      - Timestamp of last active_pairs_count update
      - Used to track scanning freshness

  2. Purpose
    - Enable dynamic pair count display based on market hours
    - Support natural language symbol detection ("make $100 with EURUSD")
    - Allow users to filter by asset class or select specific symbols
    - Provide clear UI feedback on what's being scanned

  3. SSOT Compliance
    - All symbol selection logic flows through these fields
    - No duplicate watchlist filtering logic in multiple places
    - Single source of truth for what pairs are actively scanned
*/

-- Add new columns to goal_sessions table
ALTER TABLE goal_sessions 
  ADD COLUMN IF NOT EXISTS active_pairs_count integer,
  ADD COLUMN IF NOT EXISTS asset_class_filter jsonb,
  ADD COLUMN IF NOT EXISTS specific_symbols jsonb,
  ADD COLUMN IF NOT EXISTS custom_instructions text,
  ADD COLUMN IF NOT EXISTS symbol_selection_source text,
  ADD COLUMN IF NOT EXISTS last_pairs_update timestamptz;

-- Add check constraint for symbol_selection_source
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'valid_symbol_selection_source' 
    AND conrelid = 'goal_sessions'::regclass
  ) THEN
    ALTER TABLE goal_sessions 
      ADD CONSTRAINT valid_symbol_selection_source 
      CHECK (symbol_selection_source IN ('prompt', 'ui', 'asset_filter', 'default') OR symbol_selection_source IS NULL);
  END IF;
END $$;

-- Add check constraint for custom_instructions length
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'custom_instructions_length' 
    AND conrelid = 'goal_sessions'::regclass
  ) THEN
    ALTER TABLE goal_sessions 
      ADD CONSTRAINT custom_instructions_length 
      CHECK (length(custom_instructions) <= 200 OR custom_instructions IS NULL);
  END IF;
END $$;

-- Create index for faster filtering by active pairs
CREATE INDEX IF NOT EXISTS idx_goal_sessions_active_pairs 
  ON goal_sessions(user_id, active_pairs_count) 
  WHERE status NOT IN ('completed', 'goal_achieved', 'expired', 'user_stopped');

-- Create index for symbol selection source analytics
CREATE INDEX IF NOT EXISTS idx_goal_sessions_symbol_source 
  ON goal_sessions(symbol_selection_source) 
  WHERE symbol_selection_source IS NOT NULL;
