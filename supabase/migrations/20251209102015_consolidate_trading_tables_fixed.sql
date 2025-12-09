/*
  # Consolidate Trading Tables - Enhance goal_session_trades
  
  1. Purpose
    - Make goal_session_trades the single source of truth for all positions
    - Add missing columns from simulated_positions for feature parity
    - Enable type-safe position management and closing
    
  2. New Columns Added to goal_session_trades
    - `current_price` (numeric) - Latest price for position monitoring
    - `current_pnl` (numeric) - Real-time P&L calculation
    - `order_type` (text) - Market or limit order type
    - `limit_price` (numeric) - For pending limit orders
    - `close_reason` (text) - Why position was closed
    - `user_id` (uuid) - Direct user reference (was indirect via goal_session)
    - `lot_size` (numeric) - Alias for position_size for compatibility
    - `position_type` (text) - Alias for direction for compatibility
    - `playbook_id` (uuid) - Strategy playbook tracking
    - `regime_bucket` (text) - Market regime classification
    - `risk_dollars` (numeric) - Dollar risk amount
    
  3. Indexes for Performance
    - Index on user_id for fast user position queries
    - Index on status + user_id for open position queries
    - Index on symbol + status for symbol-specific monitoring
    
  4. Security
    - RLS policies allow users to access their own trades
    - Service role can access all trades for background processing
*/

-- Add columns to goal_session_trades to match simulated_positions functionality
DO $$ 
BEGIN
  -- Add current_price for real-time position monitoring
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'current_price') THEN
    ALTER TABLE goal_session_trades ADD COLUMN current_price numeric(15,5);
  END IF;

  -- Add current_pnl for real-time P&L display (profit_loss is final, current_pnl is live)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'current_pnl') THEN
    ALTER TABLE goal_session_trades ADD COLUMN current_pnl numeric(15,2) DEFAULT 0;
  END IF;

  -- Add order_type (market or limit)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'order_type') THEN
    ALTER TABLE goal_session_trades ADD COLUMN order_type text DEFAULT 'market' CHECK (order_type IN ('market', 'limit'));
  END IF;

  -- Add limit_price for pending limit orders
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'limit_price') THEN
    ALTER TABLE goal_session_trades ADD COLUMN limit_price numeric(15,5);
  END IF;

  -- Add close_reason with expanded options
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'close_reason') THEN
    ALTER TABLE goal_session_trades ADD COLUMN close_reason text CHECK (close_reason IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop'));
  END IF;

  -- Add user_id for direct user reference (faster queries, no join needed)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'user_id') THEN
    ALTER TABLE goal_session_trades ADD COLUMN user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
    
    -- Backfill user_id from goal_sessions
    UPDATE goal_session_trades gst
    SET user_id = gs.user_id
    FROM goal_sessions gs
    WHERE gst.goal_session_id = gs.id AND gst.user_id IS NULL;
    
    -- Make it NOT NULL after backfill
    ALTER TABLE goal_session_trades ALTER COLUMN user_id SET NOT NULL;
  END IF;

  -- Add lot_size as alias for position_size (for compatibility)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'lot_size') THEN
    ALTER TABLE goal_session_trades ADD COLUMN lot_size numeric(10,2);
    
    -- Sync with position_size
    UPDATE goal_session_trades SET lot_size = position_size WHERE lot_size IS NULL;
  END IF;

  -- Add position_type as alias for direction (for compatibility)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'position_type') THEN
    ALTER TABLE goal_session_trades ADD COLUMN position_type text CHECK (position_type IN ('buy', 'sell'));
    
    -- Sync with direction
    UPDATE goal_session_trades SET position_type = direction WHERE position_type IS NULL;
  END IF;

  -- Add playbook_id for strategy tracking (may already exist from other migration)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'playbook_id') THEN
    ALTER TABLE goal_session_trades ADD COLUMN playbook_id uuid;
  END IF;

  -- Add regime_bucket for market regime classification
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'regime_bucket') THEN
    ALTER TABLE goal_session_trades ADD COLUMN regime_bucket text;
  END IF;

  -- Add risk_dollars for risk management
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'goal_session_trades' AND column_name = 'risk_dollars') THEN
    ALTER TABLE goal_session_trades ADD COLUMN risk_dollars numeric(15,2);
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_goal_trades_user_id ON goal_session_trades(user_id);
CREATE INDEX IF NOT EXISTS idx_goal_trades_status_user ON goal_session_trades(status, user_id) WHERE status IN ('open', 'pending');
CREATE INDEX IF NOT EXISTS idx_goal_trades_symbol_status ON goal_session_trades(symbol, status) WHERE status IN ('open', 'pending');
CREATE INDEX IF NOT EXISTS idx_goal_trades_goal_session ON goal_session_trades(goal_session_id);

-- Create trigger to keep lot_size and position_size in sync
CREATE OR REPLACE FUNCTION sync_lot_size_and_position_size()
RETURNS TRIGGER AS $$
BEGIN
  -- If lot_size changes, update position_size
  IF NEW.lot_size IS DISTINCT FROM OLD.lot_size THEN
    NEW.position_size := NEW.lot_size;
  END IF;
  
  -- If position_size changes, update lot_size
  IF NEW.position_size IS DISTINCT FROM OLD.position_size THEN
    NEW.lot_size := NEW.position_size;
  END IF;
  
  -- If position_type changes, update direction
  IF NEW.position_type IS DISTINCT FROM OLD.position_type THEN
    NEW.direction := NEW.position_type;
  END IF;
  
  -- If direction changes, update position_type
  IF NEW.direction IS DISTINCT FROM OLD.direction THEN
    NEW.position_type := NEW.direction;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_sync_lot_size ON goal_session_trades;
CREATE TRIGGER trigger_sync_lot_size
  BEFORE INSERT OR UPDATE ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION sync_lot_size_and_position_size();

-- Update RLS policies to allow user access via user_id
DROP POLICY IF EXISTS "Users can view their own goal trades via user_id" ON goal_session_trades;
CREATE POLICY "Users can view their own goal trades via user_id"
  ON goal_session_trades FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own goal trades via user_id" ON goal_session_trades;
CREATE POLICY "Users can update their own goal trades via user_id"
  ON goal_session_trades FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role can access all for background processing
DROP POLICY IF EXISTS "Service role full access to goal trades" ON goal_session_trades;
CREATE POLICY "Service role full access to goal trades"
  ON goal_session_trades FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Create RPC function for safe position closing
CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual'
) RETURNS goal_session_trades AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
BEGIN
  -- Validate close reason
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %. Must be one of: manual, stop_loss, take_profit, goal_achieved, goal_expired, session_ended, risk_limit, trailing_stop', p_close_reason;
  END IF;

  -- Calculate P&L and update position
  UPDATE goal_session_trades
  SET 
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = CASE 
      WHEN direction = 'buy' THEN (p_close_price - entry_price) * COALESCE(position_size, lot_size, 0.01) * 100000
      WHEN direction = 'sell' THEN (entry_price - p_close_price) * COALESCE(position_size, lot_size, 0.01) * 100000
      ELSE 0
    END,
    current_pnl = CASE 
      WHEN direction = 'buy' THEN (p_close_price - entry_price) * COALESCE(position_size, lot_size, 0.01) * 100000
      WHEN direction = 'sell' THEN (entry_price - p_close_price) * COALESCE(position_size, lot_size, 0.01) * 100000
      ELSE 0
    END
  WHERE id = p_trade_id
    AND status IN ('open', 'pending', 'soft_closing')  -- Allow closing from any active state
    AND (user_id = auth.uid() OR auth.jwt() ->> 'role' = 'service_role')  -- User owns it or service role
  RETURNING * INTO v_trade;

  IF v_trade IS NULL THEN
    RAISE EXCEPTION 'Trade % not found, already closed, or access denied', p_trade_id;
  END IF;

  RETURN v_trade;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated users and service role
GRANT EXECUTE ON FUNCTION close_goal_session_trade TO authenticated, service_role;

-- Add comment explaining this is now the primary table
COMMENT ON TABLE goal_session_trades IS 'Primary table for all trading positions (AI goal sessions). Contains both goal-tracking and position-management columns. Replaces simulated_positions.';
