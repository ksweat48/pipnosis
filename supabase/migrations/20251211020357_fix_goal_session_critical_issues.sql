/*
  # Fix Goal Session Critical Issues

  1. Problem: Cannot close trades manually
     - close_goal_session_trade doesn't verify goal_session_id
     - Multiple sessions' trades can interfere with each other

  2. Problem: Multiple trades entered despite max = 1
     - Race condition allows exceeding max_concurrent_trades
     - No database-level enforcement

  3. Problem: TP is thousands away from $200 goal
     - AI sets TP based on technical analysis only
     - Doesn't constrain to actual goal target amount

  Solutions:
  - Add database trigger to enforce max concurrent trades
  - Add goal_session_id filtering to close function
  - Add indexes for session-based filtering
  - Add check constraint for reasonable trade limits
*/

-- ============================================================================
-- STEP 1: Add missing columns to goal_sessions if needed
-- ============================================================================

DO $$
BEGIN
  -- Add trades_in_session counter
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
    AND column_name = 'trades_in_session'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN trades_in_session integer DEFAULT 0;

    COMMENT ON COLUMN goal_sessions.trades_in_session IS
      'Current number of trades taken in this session (incremented on trade open)';
  END IF;

  -- Add last_trade_id for tracking
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_sessions'
    AND column_name = 'last_trade_id'
  ) THEN
    ALTER TABLE goal_sessions
    ADD COLUMN last_trade_id uuid REFERENCES goal_session_trades(id) ON DELETE SET NULL;

    COMMENT ON COLUMN goal_sessions.last_trade_id IS
      'Reference to the most recent trade opened in this session';
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Create function to enforce max concurrent trades
-- ============================================================================

CREATE OR REPLACE FUNCTION check_max_concurrent_trades()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_open_count integer;
  v_max_trades integer;
  v_session_status text;
BEGIN
  -- Only check for new open/pending trades
  IF NEW.status NOT IN ('open', 'pending') THEN
    RETURN NEW;
  END IF;

  -- Get session settings and status
  SELECT max_concurrent_trades, status
  INTO v_max_trades, v_session_status
  FROM goal_sessions
  WHERE id = NEW.goal_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Goal session % not found', NEW.goal_session_id;
  END IF;

  -- Don't allow trades in completed/expired sessions
  IF v_session_status NOT IN ('active', 'scanning') THEN
    RAISE EXCEPTION 'Cannot open trades in session with status: %', v_session_status;
  END IF;

  -- Count existing open/pending trades for this session
  SELECT COUNT(*)
  INTO v_open_count
  FROM goal_session_trades
  WHERE goal_session_id = NEW.goal_session_id
    AND status IN ('open', 'pending')
    AND id != NEW.id; -- Exclude current record for updates

  -- Enforce max concurrent trades
  IF v_open_count >= v_max_trades THEN
    RAISE EXCEPTION 'Max concurrent trades (%) exceeded for session %. Current open: %',
      v_max_trades, NEW.goal_session_id, v_open_count;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS enforce_max_concurrent_trades_trigger ON goal_session_trades;

-- Create trigger for INSERT and UPDATE
CREATE TRIGGER enforce_max_concurrent_trades_trigger
  BEFORE INSERT OR UPDATE OF status
  ON goal_session_trades
  FOR EACH ROW
  EXECUTE FUNCTION check_max_concurrent_trades();

COMMENT ON FUNCTION check_max_concurrent_trades() IS
  'Enforces max_concurrent_trades limit at database level to prevent race conditions';

-- ============================================================================
-- STEP 3: Update close_goal_session_trade to verify goal_session_id
-- ============================================================================

-- Drop and recreate with enhanced security
DROP FUNCTION IF EXISTS close_goal_session_trade(uuid, numeric, text);

CREATE OR REPLACE FUNCTION close_goal_session_trade(
  p_trade_id uuid,
  p_close_price numeric,
  p_close_reason text DEFAULT 'manual',
  p_goal_session_id uuid DEFAULT NULL
) RETURNS jsonb
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
  v_trade goal_session_trades;
  v_calculated_pnl numeric;
  v_current_balance numeric;
  v_new_balance numeric;
  v_pip_distance numeric;
  v_dollar_per_pip numeric;
  v_result jsonb;
BEGIN
  -- Validate close reason
  IF p_close_reason NOT IN ('manual', 'stop_loss', 'take_profit', 'goal_achieved', 'goal_expired', 'session_ended', 'risk_limit', 'trailing_stop') THEN
    RAISE EXCEPTION 'Invalid close_reason: %. Must be one of: manual, stop_loss, take_profit, goal_achieved, goal_expired, session_ended, risk_limit, trailing_stop', p_close_reason;
  END IF;

  -- Get trade details with goal_session_id verification
  IF p_goal_session_id IS NOT NULL THEN
    -- Verify trade belongs to specified session
    SELECT * INTO v_trade
    FROM goal_session_trades
    WHERE id = p_trade_id
      AND goal_session_id = p_goal_session_id
      AND status IN ('open', 'pending', 'soft_closing');
  ELSE
    -- Fallback for backward compatibility (but still verify ownership)
    SELECT * INTO v_trade
    FROM goal_session_trades
    WHERE id = p_trade_id
      AND status IN ('open', 'pending', 'soft_closing');
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Trade % not found, already closed, wrong session, or not in valid state', p_trade_id;
  END IF;

  -- Verify access (user owns it or service role)
  IF v_trade.user_id != auth.uid() AND (auth.jwt() ->> 'role') != 'service_role' THEN
    RAISE EXCEPTION 'Access denied: trade belongs to different user';
  END IF;

  -- Calculate P&L using proper forex pip calculation
  IF v_trade.symbol LIKE '%JPY%' THEN
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.01;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000;
  ELSE
    v_pip_distance := (p_close_price - v_trade.entry_price) / 0.0001;
    v_dollar_per_pip := COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10;
  END IF;

  -- Calculate P&L based on direction
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_calculated_pnl := v_pip_distance * v_dollar_per_pip;
  ELSE
    v_calculated_pnl := -v_pip_distance * v_dollar_per_pip;
  END IF;

  v_calculated_pnl := ROUND(v_calculated_pnl, 2);

  -- Update the trade record
  UPDATE goal_session_trades
  SET
    status = 'closed',
    exit_price = p_close_price,
    closed_at = now(),
    close_reason = p_close_reason,
    current_price = p_close_price,
    profit_loss = v_calculated_pnl,
    current_pnl = v_calculated_pnl,
    updated_at = now()
  WHERE id = p_trade_id;

  -- Get current balance
  SELECT account_balance INTO v_current_balance
  FROM user_profiles
  WHERE id = v_trade.user_id;

  IF v_current_balance IS NULL THEN
    RAISE EXCEPTION 'User profile not found for user_id: %', v_trade.user_id;
  END IF;

  -- Calculate new balance
  v_new_balance := v_current_balance + v_calculated_pnl;

  -- Update user balance
  UPDATE user_profiles
  SET account_balance = v_new_balance,
      updated_at = now()
  WHERE id = v_trade.user_id;

  -- Create balance transaction record
  INSERT INTO balance_transactions (
    user_id,
    transaction_type,
    amount,
    balance_before,
    balance_after,
    goal_trade_id,
    source_type,
    description,
    metadata
  ) VALUES (
    v_trade.user_id,
    'trade_pnl',
    v_calculated_pnl,
    v_current_balance,
    v_new_balance,
    p_trade_id,
    'goal_trade',
    format('Goal trade closed (%s): %s %s %s lots',
      p_close_reason,
      v_trade.symbol,
      COALESCE(v_trade.direction, v_trade.position_type),
      COALESCE(v_trade.lot_size, v_trade.position_size)
    ),
    jsonb_build_object(
      'symbol', v_trade.symbol,
      'direction', COALESCE(v_trade.direction, v_trade.position_type),
      'entry_price', v_trade.entry_price,
      'exit_price', p_close_price,
      'close_reason', p_close_reason,
      'goal_session_id', v_trade.goal_session_id
    )
  );

  -- Return result with all details
  v_result := jsonb_build_object(
    'id', v_trade.id,
    'symbol', v_trade.symbol,
    'direction', COALESCE(v_trade.direction, v_trade.position_type),
    'entry_price', v_trade.entry_price,
    'exit_price', p_close_price,
    'profit_loss', v_calculated_pnl,
    'close_reason', p_close_reason,
    'balance_before', v_current_balance,
    'balance_after', v_new_balance
  );

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION close_goal_session_trade(uuid, numeric, text, uuid) IS
  'Closes a goal session trade with session verification and automatic balance updates';

-- ============================================================================
-- STEP 4: Add indexes for performance
-- ============================================================================

-- Index for fetching open trades by session (critical for max trades check)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_session_status
  ON goal_session_trades(goal_session_id, status)
  WHERE status IN ('open', 'pending');

-- Index for user + session queries (for filtering positions)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_session
  ON goal_session_trades(user_id, goal_session_id, status);

-- Index for close_at queries (for session history)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_closed_at
  ON goal_session_trades(goal_session_id, closed_at DESC)
  WHERE status = 'closed';

-- ============================================================================
-- STEP 5: Add check constraint for reasonable limits
-- ============================================================================

-- Ensure max_concurrent_trades is between 1 and 10
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goal_sessions_max_concurrent_trades_check'
  ) THEN
    ALTER TABLE goal_sessions
    ADD CONSTRAINT goal_sessions_max_concurrent_trades_check
    CHECK (max_concurrent_trades >= 1 AND max_concurrent_trades <= 10);
  END IF;
END $$;

-- ============================================================================
-- STEP 6: Create helper function to get session progress
-- ============================================================================

CREATE OR REPLACE FUNCTION get_goal_session_progress(p_session_id uuid)
RETURNS TABLE (
  total_trades integer,
  open_trades integer,
  closed_trades integer,
  total_pnl numeric,
  target_amount numeric,
  current_balance numeric,
  progress_percent numeric,
  remaining_amount numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::integer AS total_trades,
    COUNT(*) FILTER (WHERE t.status IN ('open', 'pending'))::integer AS open_trades,
    COUNT(*) FILTER (WHERE t.status = 'closed')::integer AS closed_trades,
    COALESCE(SUM(t.profit_loss) FILTER (WHERE t.status = 'closed'), 0) AS total_pnl,
    gs.target_value AS target_amount,
    gs.initial_balance + COALESCE(SUM(t.profit_loss) FILTER (WHERE t.status = 'closed'), 0) AS current_balance,
    CASE
      WHEN gs.target_value > 0 THEN
        ROUND((COALESCE(SUM(t.profit_loss) FILTER (WHERE t.status = 'closed'), 0) / gs.target_value) * 100, 2)
      ELSE 0
    END AS progress_percent,
    gs.target_value - COALESCE(SUM(t.profit_loss) FILTER (WHERE t.status = 'closed'), 0) AS remaining_amount
  FROM goal_sessions gs
  LEFT JOIN goal_session_trades t ON t.goal_session_id = gs.id
  WHERE gs.id = p_session_id
  GROUP BY gs.id, gs.target_value, gs.initial_balance;
END;
$$;

COMMENT ON FUNCTION get_goal_session_progress(uuid) IS
  'Returns comprehensive progress metrics for a goal session including P&L and completion percentage';

-- ============================================================================
-- STEP 7: Update RLS policies to ensure session isolation
-- ============================================================================

-- Drop and recreate policies for goal_session_trades
DROP POLICY IF EXISTS "Users can view their own goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Users can insert their own goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Users can update their own goal session trades" ON goal_session_trades;
DROP POLICY IF EXISTS "Service role has full access to goal session trades" ON goal_session_trades;

-- Select policy - users can only see their own trades
CREATE POLICY "Users can view their own goal session trades"
  ON goal_session_trades
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Insert policy - users can only create trades for their own sessions
CREATE POLICY "Users can insert their own goal session trades"
  ON goal_session_trades
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM goal_sessions
      WHERE id = goal_session_id
      AND user_id = auth.uid()
    )
  );

-- Update policy - users can only update their own trades
CREATE POLICY "Users can update their own goal session trades"
  ON goal_session_trades
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Service role policy - full access for background processing
CREATE POLICY "Service role has full access to goal session trades"
  ON goal_session_trades
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
