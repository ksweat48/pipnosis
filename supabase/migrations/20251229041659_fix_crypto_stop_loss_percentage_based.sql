/*
  # Fix Crypto Stop Loss Calculation - Percentage-Based Stops

  ## Problem
  Crypto trades (BTC, ETH, etc.) are closing immediately after opening because
  the stop loss calculator treats crypto the same as forex using pip-based stops.
  
  Example: BTC at $90,000 with 20 pip stop = $20 = 0.023% distance
  This gets hit instantly by normal market noise!

  ## Root Cause
  The risk-aware-stop-calculator.ts uses:
  - Forex: 0.0001 pip = 0.01% at typical prices (good)
  - Crypto: 1.0 pip = $1 (WAY too tight at high prices)

  ## Comparison
  EURUSD at 1.0800:
  - 20 pips = 0.0020 = 0.185% (reasonable for scalping)
  
  BTC at $90,000:
  - 20 pips = $20 = 0.022% (microscopic!)
  - Should be: 0.5-1.5% minimum for scalping = $450-$1350

  ## Solution
  Create crypto-specific stop loss ranges based on PERCENTAGE of price, not pips:
  - High Risk (Scalp): 0.5% - 1.5%
  - Medium Risk (Day): 1.0% - 2.5%
  - Low Risk (Swing): 2.0% - 4.0%

  ## Implementation
  Add helper function to calculate crypto stops that will be used by both
  database functions and TypeScript application code.
*/

-- Create helper function to calculate crypto stop loss
CREATE OR REPLACE FUNCTION calculate_crypto_stop_loss(
  p_symbol text,
  p_entry_price numeric,
  p_direction text,
  p_risk_mode text,
  p_atr numeric DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_stop_percent_min numeric;
  v_stop_percent_max numeric;
  v_stop_percent_actual numeric;
  v_stop_distance numeric;
  v_stop_price numeric;
  v_reasoning text;
BEGIN
  -- Determine percentage ranges based on risk mode
  CASE p_risk_mode
    WHEN 'high' THEN
      -- Aggressive/Scalp: Tighter percentage stops
      v_stop_percent_min := 0.5;
      v_stop_percent_max := 1.5;
      v_reasoning := 'AGGRESSIVE crypto scalp';
    WHEN 'medium' THEN
      -- Balanced/Day Trading: Medium stops
      v_stop_percent_min := 1.0;
      v_stop_percent_max := 2.5;
      v_reasoning := 'BALANCED crypto day trade';
    WHEN 'low' THEN
      -- Conservative/Swing: Wider stops
      v_stop_percent_min := 2.0;
      v_stop_percent_max := 4.0;
      v_reasoning := 'CONSERVATIVE crypto swing';
    ELSE
      -- Default to medium
      v_stop_percent_min := 1.0;
      v_stop_percent_max := 2.5;
      v_reasoning := 'DEFAULT crypto';
  END CASE;

  -- Use ATR if provided, otherwise use middle of range
  IF p_atr IS NOT NULL AND p_atr > 0 THEN
    -- ATR-based: Convert ATR to percentage and scale
    v_stop_percent_actual := (p_atr / p_entry_price) * 100 * 1.5;
    
    -- Clamp to min/max range
    v_stop_percent_actual := GREATEST(v_stop_percent_min, 
                                      LEAST(v_stop_percent_max, v_stop_percent_actual));
    v_reasoning := v_reasoning || ' (ATR-adjusted)';
  ELSE
    -- No ATR: Use middle of range
    v_stop_percent_actual := (v_stop_percent_min + v_stop_percent_max) / 2.0;
    v_reasoning := v_reasoning || ' (default range)';
  END IF;

  -- Calculate stop distance and price
  v_stop_distance := p_entry_price * (v_stop_percent_actual / 100.0);
  
  IF p_direction = 'buy' THEN
    v_stop_price := p_entry_price - v_stop_distance;
  ELSE
    v_stop_price := p_entry_price + v_stop_distance;
  END IF;

  -- Return as JSON
  RETURN jsonb_build_object(
    'stop_price', v_stop_price,
    'stop_distance', v_stop_distance,
    'stop_percent', v_stop_percent_actual,
    'stop_distance_dollars', v_stop_distance,
    'min_percent', v_stop_percent_min,
    'max_percent', v_stop_percent_max,
    'reasoning', v_reasoning || format(': %.2f%% = $%.2f', v_stop_percent_actual, v_stop_distance),
    'is_crypto', true
  );
END;
$$;

-- Add comment
COMMENT ON FUNCTION calculate_crypto_stop_loss IS 
  'Calculate percentage-based stop loss for crypto assets (BTC, ETH, etc.) instead of pip-based stops. Returns stop price, distance, and percentage.';
