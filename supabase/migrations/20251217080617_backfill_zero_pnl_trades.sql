/*
  # Backfill Zero PnL Trades

  1. Problem
    - Some closed trades have profit_loss = 0 when they should have non-zero values
    - This occurs due to race conditions in the trade closure system

  2. Solution
    - Recalculate profit_loss for all affected trades using entry_price, exit_price, and position_size
    - Update goal_sessions.current_progress to reflect corrected cumulative profits

  3. Safety
    - Only updates trades where:
      - status = 'closed'
      - profit_loss = 0
      - entry_price != exit_price (should have non-zero PnL)
      - position_size > 0
*/

-- Create a function to calculate dollar per pip for a given symbol and position size
CREATE OR REPLACE FUNCTION calculate_dollar_per_pip(symbol_param text, position_size_param numeric)
RETURNS numeric AS $$
DECLARE
  dollar_per_pip numeric;
BEGIN
  -- XAUUSD (Gold): 0.01 lot = $1/pip, 1.0 lot = $100/pip
  IF symbol_param = 'XAUUSD' THEN
    RETURN position_size_param * 100;
  END IF;

  -- Forex pairs: 0.01 lot = $0.10/pip, 1.0 lot = $10/pip
  -- This is standard for all major and minor forex pairs
  RETURN position_size_param * 10;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Create a function to calculate pip distance between two prices
CREATE OR REPLACE FUNCTION calculate_pip_distance(symbol_param text, price1 numeric, price2 numeric)
RETURNS numeric AS $$
DECLARE
  pip_value numeric;
BEGIN
  -- XAUUSD (Gold) uses 0.01 as pip value
  IF symbol_param = 'XAUUSD' THEN
    RETURN (price2 - price1) / 0.01;
  END IF;

  -- Most forex pairs use 0.0001 as pip value (4 decimal places)
  -- JPY pairs use 0.01 (2 decimal places)
  IF symbol_param LIKE '%JPY%' THEN
    RETURN (price2 - price1) / 0.01;
  END IF;

  -- Default: standard forex pip value
  RETURN (price2 - price1) / 0.0001;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Backfill zero PnL trades with correct calculations
DO $$
DECLARE
  trade_record RECORD;
  pip_distance numeric;
  dollar_per_pip numeric;
  calculated_pnl numeric;
  updated_count integer := 0;
BEGIN
  -- Loop through all affected trades
  FOR trade_record IN
    SELECT
      id,
      symbol,
      direction,
      entry_price,
      exit_price,
      position_size,
      goal_session_id
    FROM goal_session_trades
    WHERE status = 'closed'
      AND profit_loss = 0
      AND entry_price IS NOT NULL
      AND exit_price IS NOT NULL
      AND entry_price != exit_price
      AND position_size > 0
  LOOP
    -- Calculate pip distance
    pip_distance := calculate_pip_distance(
      trade_record.symbol,
      trade_record.entry_price,
      trade_record.exit_price
    );

    -- Calculate dollar per pip
    dollar_per_pip := calculate_dollar_per_pip(
      trade_record.symbol,
      trade_record.position_size
    );

    -- Calculate final PnL based on direction
    IF trade_record.direction = 'buy' THEN
      calculated_pnl := pip_distance * dollar_per_pip;
    ELSE
      calculated_pnl := -pip_distance * dollar_per_pip;
    END IF;

    -- Update the trade with correct PnL
    UPDATE goal_session_trades
    SET profit_loss = calculated_pnl
    WHERE id = trade_record.id;

    updated_count := updated_count + 1;

    RAISE NOTICE 'Updated trade %: % % @ % -> % | PnL: $%',
      trade_record.id,
      trade_record.symbol,
      trade_record.direction,
      trade_record.entry_price,
      trade_record.exit_price,
      ROUND(calculated_pnl, 2);
  END LOOP;

  RAISE NOTICE 'Backfill complete: % trades updated', updated_count;
END $$;

-- Recalculate goal_sessions.current_progress based on corrected trade PnL
DO $$
DECLARE
  session_record RECORD;
  cumulative_profit numeric;
BEGIN
  FOR session_record IN
    SELECT DISTINCT goal_session_id
    FROM goal_session_trades
    WHERE status = 'closed'
      AND goal_session_id IS NOT NULL
  LOOP
    -- Calculate cumulative profit for this session
    SELECT COALESCE(SUM(profit_loss), 0)
    INTO cumulative_profit
    FROM goal_session_trades
    WHERE goal_session_id = session_record.goal_session_id
      AND status = 'closed';

    -- Update goal session progress
    UPDATE goal_sessions
    SET current_progress = cumulative_profit
    WHERE id = session_record.goal_session_id;

    RAISE NOTICE 'Updated goal session %: cumulative profit = $%',
      session_record.goal_session_id,
      ROUND(cumulative_profit, 2);
  END LOOP;
END $$;

-- Add a comment to document this migration
COMMENT ON FUNCTION calculate_dollar_per_pip IS 'Calculates dollar value per pip for a given symbol and position size';
COMMENT ON FUNCTION calculate_pip_distance IS 'Calculates pip distance between two prices for a given symbol';
