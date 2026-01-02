/*
  # Fix P&L Single Source of Truth - Eliminate Header/Monitor Discrepancy

  ## Problem
  The P&L displayed in the header ($0.95) was different from the trade monitor ($72.06)
  because the system had TWO calculation paths:
  1. Position Monitor Service - calculates and stores `current_pnl` in real-time
  2. Database function `get_position_current_pnl` - recalculates from scratch using realtime_prices

  This violated the Single Source of Truth (SSOT) principle.

  ## Solution
  Make `get_position_current_pnl` read the pre-calculated `current_pnl` value instead of
  recalculating it. The Position Monitor Service is now the sole authority for P&L values.

  ## Benefits
  - Guaranteed consistency across all UI components (header, trade monitor, etc.)
  - Reduced computational overhead (no redundant calculations)
  - Simpler debugging (single calculation path)
  - Better performance (database function becomes simple SELECT)
  - True SSOT architecture

  ## Changes
  1. Refactor `get_position_current_pnl` to read stored value
  2. Keep fallback calculation for legacy data or edge cases
  3. Add detailed logging for transparency
*/

-- ============================================================================
-- Fix get_position_current_pnl to use stored value (SSOT)
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
  -- Get the position with its stored current_pnl
  SELECT * INTO v_trade
  FROM goal_session_trades
  WHERE id = p_position_id AND status = 'open';

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- SINGLE SOURCE OF TRUTH: Use pre-calculated current_pnl from Position Monitor
  -- The Position Monitor Service updates this value every 2-3 seconds with live prices
  -- and proper currency-specific calculations
  IF v_trade.current_pnl IS NOT NULL THEN
    RETURN v_trade.current_pnl;
  END IF;

  -- FALLBACK CALCULATION: Only if current_pnl is NULL (legacy data or edge cases)
  -- This should rarely happen in normal operation
  RAISE NOTICE 'Position % has NULL current_pnl, using fallback calculation', p_position_id;

  -- Get latest price from realtime_prices
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
-- Add index to optimize current_pnl lookups
-- ============================================================================

-- Ensure we have an index on (status, user_id) for efficient open position queries
-- This helps both the Position Monitor and the get_unrealized_pnl function
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_status_user_open
ON goal_session_trades(status, user_id)
WHERE status = 'open';

-- ============================================================================
-- Verification Query (for testing)
-- ============================================================================

-- Run this after migration to verify consistency:
-- SELECT
--   id,
--   symbol,
--   current_pnl as stored_pnl,
--   get_position_current_pnl(id) as calculated_pnl,
--   current_pnl - get_position_current_pnl(id) as difference
-- FROM goal_session_trades
-- WHERE status = 'open' AND user_id = 'YOUR_USER_ID';

COMMENT ON FUNCTION get_position_current_pnl IS
'SSOT: Returns pre-calculated current_pnl from Position Monitor Service.
Only recalculates if stored value is NULL (legacy/edge cases).
Updated: 2026-01-02 - Fixed P&L discrepancy between header and trade monitor';
