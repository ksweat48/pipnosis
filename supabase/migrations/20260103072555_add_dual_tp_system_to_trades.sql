/*
  # Dual Take Profit System for Individual Trades

  1. New Fields Added to `goal_session_trades`:
    - `tp1_price` (numeric): Conservative high-probability target based on technical factors
    - `tp2_price` (numeric): Full profit target (replaces single take_profit)
    - `tp1_confidence` (numeric): Alpha's probability estimate (0-100) that TP1 will be hit
    - `tp1_reasoning` (text): Alpha's explanation for TP1 placement
    - `tp2_reasoning` (text): Alpha's explanation for TP2 placement
    - `tp1_hit` (boolean): Whether TP1 has been reached
    - `tp1_hit_at` (timestamptz): Timestamp when TP1 was hit
    - `tp1_action_taken` (text): User's choice: 'continued' or 'closed_early'
    - `tp2_hit` (boolean): Whether TP2 has been reached
    - `tp2_hit_at` (timestamptz): Timestamp when TP2 was hit
    - `max_profit_after_tp1` (numeric): Highest profit reached after TP1 (for learning)
    - `alpha_tp1_recommendation` (text): Alpha's recommendation when TP1 hit ('CLOSE_NOW' or 'CONTINUE_TO_TP2')
    - `alpha_tp1_recommendation_reasoning` (text): Why Alpha recommended that action

  2. Purpose:
    - TP1 is a conservative, high-probability target (80%+ likely) based on ATR and liquidity
    - TP2 is the full profit target (standard TP)
    - Trade broker TP is set to TP2; TP1 is for internal monitoring only
    - When TP1 is hit, Alpha evaluates market and recommends close or continue
    - User gets popup dialog with Alpha's recommendation
    - All outcomes feed into Alpha's learning system

  3. Backward Compatibility:
    - Existing `take_profit` field remains for legacy support
    - New trades will populate both `tp2_price` and `take_profit` with same value
    - TP1 is optional (NULL if no high-probability target exists)

  4. Security:
    - All fields have sensible defaults
    - RLS policies inherited from goal_session_trades table
*/

-- Add TP1 conservative target fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_price numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp1_price IS 'Conservative high-probability profit target (80%+ likely) based on technical factors (ATR, liquidity zones)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_confidence'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_confidence numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp1_confidence IS 'Alpha probability estimate (0-100) that TP1 will be hit';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_reasoning'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_reasoning text DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp1_reasoning IS 'Alpha explanation for TP1 placement (e.g., "1.0x ATR at strong psychological level")';
  END IF;
END $$;

-- Add TP2 full target fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp2_price'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp2_price numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp2_price IS 'Full profit target (standard TP) - this is what broker TP is set to';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp2_reasoning'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp2_reasoning text DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp2_reasoning IS 'Alpha explanation for TP2 placement (e.g., "2.5:1 R:R at major liquidity pool")';
  END IF;
END $$;

-- Add TP1 hit tracking fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_hit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_hit boolean DEFAULT false;
    COMMENT ON COLUMN goal_session_trades.tp1_hit IS 'Whether TP1 (conservative target) has been reached';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_hit_at'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_hit_at timestamptz DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp1_hit_at IS 'Timestamp when TP1 was achieved';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp1_action_taken'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp1_action_taken text DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp1_action_taken IS 'User decision when TP1 hit: "continued" or "closed_early"';
  END IF;
END $$;

-- Add TP2 hit tracking fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp2_hit'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp2_hit boolean DEFAULT false;
    COMMENT ON COLUMN goal_session_trades.tp2_hit IS 'Whether TP2 (full target) has been reached';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'tp2_hit_at'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN tp2_hit_at timestamptz DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.tp2_hit_at IS 'Timestamp when TP2 was achieved';
  END IF;
END $$;

-- Add learning/tracking fields
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'max_profit_after_tp1'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN max_profit_after_tp1 numeric DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.max_profit_after_tp1 IS 'Highest profit reached after TP1 was hit - used for learning whether continuing was correct';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_tp1_recommendation'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_tp1_recommendation text DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.alpha_tp1_recommendation IS 'Alpha real-time recommendation when TP1 hit: "CLOSE_NOW" or "CONTINUE_TO_TP2"';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'alpha_tp1_recommendation_reasoning'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN alpha_tp1_recommendation_reasoning text DEFAULT NULL;
    COMMENT ON COLUMN goal_session_trades.alpha_tp1_recommendation_reasoning IS 'Why Alpha recommended that action (e.g., "Momentum weakening" or "Strong follow-through")';
  END IF;
END $$;

-- Create index for TP1/TP2 monitoring performance
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_tp1_monitoring
  ON goal_session_trades(user_id, status, tp1_hit, tp2_hit)
  WHERE status = 'open' AND tp1_price IS NOT NULL;

COMMENT ON INDEX idx_goal_session_trades_tp1_monitoring IS 'Optimizes TP1/TP2 monitoring for open trades with dual TP system';

-- Create index for TP1 learning queries
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_tp1_learning
  ON goal_session_trades(tp1_hit, tp1_action_taken, status)
  WHERE tp1_price IS NOT NULL;

COMMENT ON INDEX idx_goal_session_trades_tp1_learning IS 'Optimizes queries for TP1 learning and outcome analysis';

-- Backfill tp2_price from take_profit for existing trades
UPDATE goal_session_trades
SET tp2_price = take_profit
WHERE tp2_price IS NULL AND take_profit IS NOT NULL;

-- Add constraint: tp1_action_taken must be valid value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_tp1_action_taken'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT valid_tp1_action_taken
      CHECK (tp1_action_taken IS NULL OR tp1_action_taken IN ('continued', 'closed_early'));
  END IF;
END $$;

-- Add constraint: alpha_tp1_recommendation must be valid value
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'valid_alpha_tp1_recommendation'
  ) THEN
    ALTER TABLE goal_session_trades
      ADD CONSTRAINT valid_alpha_tp1_recommendation
      CHECK (alpha_tp1_recommendation IS NULL OR alpha_tp1_recommendation IN ('CLOSE_NOW', 'CONTINUE_TO_TP2'));
  END IF;
END $$;

-- Create function to update max_profit_after_tp1 when trade is in profit after TP1
CREATE OR REPLACE FUNCTION update_max_profit_after_tp1()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only update if TP1 has been hit and trade is still open
  IF NEW.tp1_hit = true
     AND NEW.status = 'open'
     AND NEW.current_pnl IS NOT NULL THEN

    -- Update max_profit_after_tp1 if current PnL is higher
    IF NEW.max_profit_after_tp1 IS NULL OR NEW.current_pnl > NEW.max_profit_after_tp1 THEN
      NEW.max_profit_after_tp1 := NEW.current_pnl;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Create trigger to track max profit after TP1
DROP TRIGGER IF EXISTS track_max_profit_after_tp1 ON goal_session_trades;
CREATE TRIGGER track_max_profit_after_tp1
  BEFORE UPDATE ON goal_session_trades
  FOR EACH ROW
  WHEN (OLD.current_pnl IS DISTINCT FROM NEW.current_pnl)
  EXECUTE FUNCTION update_max_profit_after_tp1();

-- Grant necessary permissions
GRANT EXECUTE ON FUNCTION update_max_profit_after_tp1() TO authenticated;
