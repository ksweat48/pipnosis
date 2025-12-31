/*
  # Single Source of Truth System

  ## Problem
  Data is calculated and stored in multiple places causing inconsistencies:
  - Balance calculated in frontend hooks and database
  - Unrealized P&L calculated in multiple components
  - Price data scattered across tables and services
  - No guaranteed consistency between frontend and backend

  ## Solution
  Establish database as SINGLE SOURCE OF TRUTH for all critical data:

  1. **Balance**: Always calculated from user_profiles.account_balance
  2. **Unrealized P&L**: Always calculated from open positions in real-time
  3. **Price Data**: Always fetched from realtime_prices table
  4. **Position Data**: Always from goal_session_trades table

  ## New Functions
  - `get_user_balance()` - Returns user's current balance
  - `get_unrealized_pnl()` - Calculates unrealized P&L from open positions
  - `get_total_balance()` - Returns balance + unrealized P&L
  - `get_latest_price()` - Gets latest price for a symbol
  - `get_position_current_pnl()` - Calculates real-time P&L for a position

  ## Benefits
  - Frontend just reads, never calculates
  - Guaranteed consistency
  - Single place to fix bugs
  - Easier testing and debugging
*/

-- ============================================================================
-- FUNCTION 1: Get User Balance (Realized)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_balance(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
BEGIN
  -- SINGLE SOURCE OF TRUTH: user_profiles.account_balance
  SELECT account_balance INTO v_balance
  FROM user_profiles
  WHERE id = p_user_id;

  RETURN COALESCE(v_balance, 10000.00);
END;
$$;

-- ============================================================================
-- FUNCTION 2: Get Latest Price for Symbol
-- ============================================================================

CREATE OR REPLACE FUNCTION get_latest_price(p_symbol text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_price_data jsonb;
BEGIN
  -- SINGLE SOURCE OF TRUTH: realtime_prices table
  SELECT jsonb_build_object(
    'symbol', symbol,
    'bid', bid,
    'ask', ask,
    'mid', mid,
    'spread', spread,
    'broker_time', broker_time,
    'age_seconds', EXTRACT(EPOCH FROM (NOW() - created_at))
  )
  INTO v_price_data
  FROM realtime_prices
  WHERE symbol = p_symbol
  ORDER BY created_at DESC
  LIMIT 1;

  -- If no price found, return null
  IF v_price_data IS NULL THEN
    RETURN jsonb_build_object(
      'symbol', p_symbol,
      'error', 'No price data available',
      'bid', NULL,
      'ask', NULL,
      'mid', NULL,
      'spread', NULL,
      'broker_time', NULL,
      'age_seconds', NULL
    );
  END IF;

  RETURN v_price_data;
END;
$$;

-- ============================================================================
-- FUNCTION 3: Calculate Position Current P&L
-- ============================================================================

CREATE OR REPLACE FUNCTION get_position_current_pnl(p_position_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_trade goal_session_trades;
  v_current_price numeric;
  v_price_diff numeric;
  v_pip_value numeric;
  v_pnl numeric;
BEGIN
  -- Get the position
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = p_position_id AND status = 'open';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- Get latest price from realtime_prices (SINGLE SOURCE OF TRUTH)
  SELECT mid INTO v_current_price
  FROM realtime_prices
  WHERE symbol = v_trade.symbol
  ORDER BY created_at DESC
  LIMIT 1;

  -- Fallback to current_price on position if no realtime price
  IF v_current_price IS NULL THEN
    v_current_price := v_trade.current_price;
  END IF;

  IF v_current_price IS NULL OR v_current_price <= 0 THEN
    RETURN 0;
  END IF;

  -- Calculate price difference
  v_price_diff := v_current_price - v_trade.entry_price;

  -- Calculate P&L based on instrument type (SAME LOGIC AS close_goal_session_trade)
  IF v_trade.symbol LIKE '%JPY%' THEN
    -- JPY pairs: 0.01 = 1 pip, $1000 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 1000);
  ELSIF v_trade.symbol IN ('US30', 'NAS100', 'SPX500', 'DJI', 'NDX') OR v_trade.symbol LIKE 'US30%' OR v_trade.symbol LIKE 'NAS100%' OR v_trade.symbol LIKE 'SPX500%' THEN
    -- Indices: 1 point = 1 pip, $1 per 1.0 lot
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSIF v_trade.symbol LIKE '%XAU%' OR v_trade.symbol LIKE '%GOLD%' THEN
    -- Gold: 0.01 = 1 pip, $100 per 1.0 lot
    v_pip_value := (v_price_diff / 0.01) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 100);
  ELSIF v_trade.symbol LIKE '%BTC%' OR v_trade.symbol LIKE '%ETH%' OR v_trade.symbol LIKE '%CRYPTO%' THEN
    -- Crypto: Direct price difference, $1 per 1.0 contract
    v_pip_value := v_price_diff * COALESCE(v_trade.lot_size, v_trade.position_size, 0.01);
  ELSE
    -- Standard Forex: 0.0001 = 1 pip, $10 per 1.0 lot
    v_pip_value := (v_price_diff / 0.0001) * (COALESCE(v_trade.lot_size, v_trade.position_size, 0.01) * 10);
  END IF;

  -- Apply direction (buy = positive when price up, sell = positive when price down)
  IF v_trade.direction = 'buy' OR v_trade.position_type = 'buy' THEN
    v_pnl := v_pip_value;
  ELSE
    v_pnl := -v_pip_value;
  END IF;

  RETURN ROUND(v_pnl, 2);
END;
$$;

-- ============================================================================
-- FUNCTION 4: Get Unrealized P&L for User
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unrealized_pnl(p_user_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_pnl numeric := 0;
  v_position_pnl numeric;
  v_position RECORD;
BEGIN
  -- SINGLE SOURCE OF TRUTH: Calculate from open positions in goal_session_trades
  FOR v_position IN
    SELECT id
    FROM goal_session_trades
    WHERE user_id = p_user_id AND status = 'open'
  LOOP
    v_position_pnl := get_position_current_pnl(v_position.id);
    v_total_pnl := v_total_pnl + COALESCE(v_position_pnl, 0);
  END LOOP;

  RETURN ROUND(v_total_pnl, 2);
END;
$$;

-- ============================================================================
-- FUNCTION 5: Get Total Balance (Realized + Unrealized)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_total_balance(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_unrealized_pnl numeric;
  v_total_balance numeric;
  v_open_positions_count int;
BEGIN
  -- Get realized balance
  v_balance := get_user_balance(p_user_id);

  -- Get unrealized P&L from open positions
  v_unrealized_pnl := get_unrealized_pnl(p_user_id);

  -- Calculate total
  v_total_balance := v_balance + v_unrealized_pnl;

  -- Get open positions count
  SELECT COUNT(*) INTO v_open_positions_count
  FROM goal_session_trades
  WHERE user_id = p_user_id AND status = 'open';

  RETURN jsonb_build_object(
    'balance', v_balance,
    'unrealized_pnl', v_unrealized_pnl,
    'total_balance', v_total_balance,
    'open_positions_count', v_open_positions_count,
    'calculated_at', NOW()
  );
END;
$$;

-- ============================================================================
-- FUNCTION 6: Get Open Positions Summary
-- ============================================================================

CREATE OR REPLACE FUNCTION get_open_positions_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_positions jsonb;
BEGIN
  -- Get all open positions with current P&L
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'symbol', t.symbol,
      'direction', t.direction,
      'entry_price', t.entry_price,
      'current_price', (
        SELECT mid FROM realtime_prices
        WHERE symbol = t.symbol
        ORDER BY created_at DESC
        LIMIT 1
      ),
      'lot_size', COALESCE(t.lot_size, t.position_size),
      'stop_loss', t.stop_loss,
      'take_profit', t.take_profit,
      'current_pnl', get_position_current_pnl(t.id),
      'opened_at', t.created_at
    )
  )
  INTO v_positions
  FROM goal_session_trades t
  WHERE t.user_id = p_user_id AND t.status = 'open';

  RETURN COALESCE(v_positions, '[]'::jsonb);
END;
$$;

-- ============================================================================
-- Grant Permissions
-- ============================================================================

GRANT EXECUTE ON FUNCTION get_user_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_latest_price(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_position_current_pnl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unrealized_pnl(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_total_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_open_positions_summary(uuid) TO authenticated;

-- ============================================================================
-- Create Indexes for Performance
-- ============================================================================

-- Ensure fast lookups for open positions
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_user_status
ON goal_session_trades(user_id, status)
WHERE status = 'open';

-- Ensure fast price lookups
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_latest
ON realtime_prices(symbol, created_at DESC);

-- ============================================================================
-- Documentation
-- ============================================================================

COMMENT ON FUNCTION get_user_balance(uuid) IS
  'SINGLE SOURCE OF TRUTH for user balance. Returns realized balance from user_profiles.';

COMMENT ON FUNCTION get_latest_price(text) IS
  'SINGLE SOURCE OF TRUTH for current prices. Returns latest price from realtime_prices table.';

COMMENT ON FUNCTION get_position_current_pnl(uuid) IS
  'SINGLE SOURCE OF TRUTH for position P&L. Calculates real-time P&L using latest price.';

COMMENT ON FUNCTION get_unrealized_pnl(uuid) IS
  'SINGLE SOURCE OF TRUTH for unrealized P&L. Calculates total from all open positions.';

COMMENT ON FUNCTION get_total_balance(uuid) IS
  'SINGLE SOURCE OF TRUTH for total balance. Returns balance + unrealized P&L + metadata.';

COMMENT ON FUNCTION get_open_positions_summary(uuid) IS
  'SINGLE SOURCE OF TRUTH for open positions. Returns all open positions with current prices and P&L.';

-- ============================================================================
-- Success Message
-- ============================================================================

DO $$
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '╔═══════════════════════════════════════════════════════════════╗';
  RAISE NOTICE '║     SINGLE SOURCE OF TRUTH SYSTEM CREATED                     ║';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
  RAISE NOTICE '';
  RAISE NOTICE 'DATABASE IS NOW THE SINGLE SOURCE OF TRUTH FOR:';
  RAISE NOTICE '';
  RAISE NOTICE '1. ✓ User Balance';
  RAISE NOTICE '   - get_user_balance(user_id) → Returns realized balance';
  RAISE NOTICE '   - Source: user_profiles.account_balance';
  RAISE NOTICE '';
  RAISE NOTICE '2. ✓ Unrealized P&L';
  RAISE NOTICE '   - get_unrealized_pnl(user_id) → Calculates from open positions';
  RAISE NOTICE '   - Source: goal_session_trades WHERE status = open';
  RAISE NOTICE '';
  RAISE NOTICE '3. ✓ Total Balance';
  RAISE NOTICE '   - get_total_balance(user_id) → Balance + unrealized P&L';
  RAISE NOTICE '   - Returns JSON with all details';
  RAISE NOTICE '';
  RAISE NOTICE '4. ✓ Current Prices';
  RAISE NOTICE '   - get_latest_price(symbol) → Latest market price';
  RAISE NOTICE '   - Source: realtime_prices table';
  RAISE NOTICE '';
  RAISE NOTICE '5. ✓ Position P&L';
  RAISE NOTICE '   - get_position_current_pnl(position_id) → Real-time P&L';
  RAISE NOTICE '   - Uses latest price from realtime_prices';
  RAISE NOTICE '';
  RAISE NOTICE 'FRONTEND RULE:';
  RAISE NOTICE '   - Call these functions, NEVER calculate locally';
  RAISE NOTICE '   - Database guarantees consistency';
  RAISE NOTICE '   - Single place to fix bugs';
  RAISE NOTICE '';
  RAISE NOTICE '╚═══════════════════════════════════════════════════════════════╝';
END $$;
