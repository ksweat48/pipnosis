/*
  # Add Trade Styles System

  1. New Columns
    - `trade_style` (text) - The trading style: scalper, swing, day
    - `dollar_risk` (numeric) - Fixed dollar amount user wants to risk per trade
  
  2. Changes
    - Make `risk_mode` nullable as it's being deprecated
    - Add check constraint for trade_style values
    - Add default values for backward compatibility

  3. Migration Strategy
    - Existing sessions with risk_mode will continue to work
    - New sessions will use trade_style + dollar_risk
    - System will handle both during transition
*/

-- Add trade_style column with constraint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'trade_style'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN trade_style TEXT
      CHECK (trade_style IN ('scalper', 'swing', 'day'));
  END IF;
END $$;

-- Add dollar_risk column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions' AND column_name = 'dollar_risk'
  ) THEN
    ALTER TABLE goal_sessions ADD COLUMN dollar_risk NUMERIC;
  END IF;
END $$;

-- Make risk_mode nullable for backward compatibility during transition
DO $$
BEGIN
  ALTER TABLE goal_sessions ALTER COLUMN risk_mode DROP NOT NULL;
END $$;

-- Add comment explaining the new system
COMMENT ON COLUMN goal_sessions.trade_style IS 'Trading style chosen by user: scalper (seconds-minutes), swing (days-weeks), day (intraday)';
COMMENT ON COLUMN goal_sessions.dollar_risk IS 'Fixed dollar amount user wants to risk per trade (e.g., $50, $100, $200)';
COMMENT ON COLUMN goal_sessions.risk_mode IS 'DEPRECATED: Use trade_style + dollar_risk instead. Kept for backward compatibility.';