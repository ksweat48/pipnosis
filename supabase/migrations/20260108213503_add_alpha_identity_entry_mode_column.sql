/*
  # Add Entry Mode Column for Alpha Identity System
  
  ## Summary
  This migration adds the entry_mode column to goal_session_trades to support
  Alpha's new decision framework with explicit entry timing classification.
  
  ## Changes
  1. New Columns
    - `entry_mode` (text) - Alpha's entry timing classification:
      - 'immediate': Execute now (high EQS)
      - 'wait_pullback': Wait for better entry (moderate EQS)
      - 'wait_confirmation': Wait for structural confirmation (low EQS)
  
  2. Updates
    - Adds check constraint for valid entry_mode values
    - Default value is 'immediate' for backward compatibility
  
  ## Notes
  - existing entry_quality_score, resolved_style, ai_confidence columns are reused
  - No data migration needed - new column has default value
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'entry_mode'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN entry_mode text DEFAULT 'immediate';
    
    ALTER TABLE goal_session_trades 
    ADD CONSTRAINT goal_session_trades_entry_mode_check 
    CHECK (entry_mode IN ('immediate', 'wait_pullback', 'wait_confirmation'));
    
    COMMENT ON COLUMN goal_session_trades.entry_mode IS 
      'Alpha entry timing mode: immediate (execute now), wait_pullback (wait for better price), wait_confirmation (wait for structure)';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'trade_confidence'
  ) THEN
    ALTER TABLE goal_session_trades 
    ADD COLUMN trade_confidence integer DEFAULT NULL;
    
    ALTER TABLE goal_session_trades 
    ADD CONSTRAINT goal_session_trades_trade_confidence_check 
    CHECK (trade_confidence IS NULL OR (trade_confidence >= 0 AND trade_confidence <= 100));
    
    COMMENT ON COLUMN goal_session_trades.trade_confidence IS 
      'Alpha trade confidence 0-100 (60+ required for execution)';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'resolved_style'
  ) THEN
    UPDATE goal_session_trades 
    SET resolved_style = 'MICRO_INTRADAY' 
    WHERE resolved_style = 'micro' OR resolved_style = 'MICRO';
    
    UPDATE goal_session_trades 
    SET resolved_style = 'SCALP' 
    WHERE resolved_style = 'scalper' OR resolved_style = 'scalp';
    
    UPDATE goal_session_trades 
    SET resolved_style = 'INTRADAY' 
    WHERE resolved_style = 'intraday';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'requested_style'
  ) THEN
    UPDATE goal_session_trades 
    SET requested_style = 'MICRO_INTRADAY' 
    WHERE requested_style = 'micro' OR requested_style = 'MICRO';
    
    UPDATE goal_session_trades 
    SET requested_style = 'SCALP' 
    WHERE requested_style = 'scalper' OR requested_style = 'scalp';
    
    UPDATE goal_session_trades 
    SET requested_style = 'INTRADAY' 
    WHERE requested_style = 'intraday';
  END IF;
END $$;