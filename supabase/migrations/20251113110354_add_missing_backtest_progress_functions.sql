/*
  # Add Missing Backtest Progress Functions
  
  This migration adds the three missing RPC functions that are causing 404 errors:
  - initialize_backtest_progress
  - update_backtest_progress_with_trade  
  - complete_backtest_progress
  
  These functions are required for the auto-backtest flow to work correctly.
*/

-- Ensure required columns exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'session_name'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN session_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'winning_trades'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN winning_trades integer DEFAULT 0 NOT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'backtest_progress_tracking' AND column_name = 'losing_trades'
  ) THEN
    ALTER TABLE backtest_progress_tracking ADD COLUMN losing_trades integer DEFAULT 0 NOT NULL;
  END IF;
END $$;

-- Function: Initialize Backtest Progress
CREATE OR REPLACE FUNCTION initialize_backtest_progress(
  p_backtest_id uuid,
  p_user_id uuid,
  p_session_name text DEFAULT 'Backtest Session',
  p_total_candles integer DEFAULT 1000
)
RETURNS uuid AS $$
DECLARE
  v_progress_id uuid;
BEGIN
  -- Use the existing update_backtest_progress to initialize
  -- This ensures compatibility with the existing system
  PERFORM update_backtest_progress(
    p_backtest_id := p_backtest_id,
    p_user_id := p_user_id,
    p_current_step := 'Initializing',
    p_progress_percentage := 0,
    p_current_candle := 0,
    p_total_candles := p_total_candles,
    p_phase := 'initializing',
    p_trades_executed := 0,
    p_winning_trades := 0,
    p_losing_trades := 0,
    p_status := 'running'
  );
  
  -- Update session name separately if column exists
  UPDATE backtest_progress_tracking
  SET session_name = p_session_name
  WHERE backtest_id = p_backtest_id;
  
  -- Return the progress tracking ID
  SELECT id INTO v_progress_id
  FROM backtest_progress_tracking
  WHERE backtest_id = p_backtest_id;
  
  RETURN v_progress_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Update Backtest Progress with Trade Result
CREATE OR REPLACE FUNCTION update_backtest_progress_with_trade(
  p_backtest_id uuid,
  p_trade_outcome text,
  p_profit_loss numeric DEFAULT 0
)
RETURNS void AS $$
DECLARE
  v_new_trades integer;
  v_new_wins integer;
  v_new_losses integer;
BEGIN
  -- Get current counts
  SELECT 
    trades_executed + 1,
    CASE WHEN p_trade_outcome = 'win' THEN winning_trades + 1 ELSE winning_trades END,
    CASE WHEN p_trade_outcome = 'loss' THEN losing_trades + 1 ELSE losing_trades END
  INTO v_new_trades, v_new_wins, v_new_losses
  FROM backtest_progress_tracking
  WHERE backtest_id = p_backtest_id;
  
  -- Update using the existing function
  PERFORM update_backtest_progress(
    p_backtest_id := p_backtest_id,
    p_user_id := NULL, -- Not required for existing function when updating
    p_trades_executed := v_new_trades,
    p_winning_trades := v_new_wins,
    p_losing_trades := v_new_losses,
    p_status := 'running'
  );
  
  -- Update profit/loss separately
  UPDATE backtest_progress_tracking
  SET current_profit_loss = current_profit_loss + p_profit_loss
  WHERE backtest_id = p_backtest_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: Complete Backtest Progress
CREATE OR REPLACE FUNCTION complete_backtest_progress(
  p_backtest_id uuid,
  p_status text DEFAULT 'completed',
  p_error_message text DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE backtest_progress_tracking
  SET
    status = p_status,
    progress_percentage = CASE WHEN p_status = 'completed' THEN 100 ELSE progress_percentage END,
    completed_at = now(),
    error_message = p_error_message,
    last_updated_at = now()
  WHERE backtest_id = p_backtest_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant permissions to both authenticated and anon (for edge functions)
GRANT EXECUTE ON FUNCTION initialize_backtest_progress(uuid, uuid, text, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION update_backtest_progress_with_trade(uuid, text, numeric) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION complete_backtest_progress(uuid, text, text) TO authenticated, anon;
