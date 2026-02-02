/*
  # Correct Expected Profit Values for Existing Trades (SSOT FIX 2026-02-03)

  ## Problem
  Existing trades have expected_profit_for_session calculated WITHOUT pip conversion:
  - Formula (WRONG): (TP - Entry) * lotSize = (7017.9 - 6991.3) * 0.05 = 1.33
  - Formula (CORRECT): (TP - Entry) / pipValue * dollarPerPipPerLot * lotSize = 26.6 * 100 * 0.05 = 133

  ## Solution
  Update expected_profit_for_session for trades with suspiciously low values,
  using the correct pip-to-dollar conversion based on symbol type.

  ## Key Symbol Conversions
  - SPX500, US30, NAS100: pipValue=1.0, dollarPerPip=100
  - XAUUSD: pipValue=1.0, dollarPerPip=100
  - ETHUSD, BTCUSD: pipValue=1.0, dollarPerPip=1.0
  - Standard Forex: pipValue=0.0001, dollarPerPip=10
  - JPY pairs: pipValue=0.01, dollarPerPip=10

  ## Impact
  - SPX500 trades: expected_profit ~$1 → ~$133
  - Indices: expected_profit proportional correction
  - All future trades use correct calculation (from coordinator)
*/

-- Correct SPX500 and US30 trades (indices)
UPDATE goal_session_trades
SET 
  expected_profit_at_tp_dollars = ABS(take_profit - entry_price) * 100 * lot_size,
  expected_profit_for_session = ABS(take_profit - entry_price) * 100 * lot_size
WHERE symbol IN ('SPX500', 'US30', 'NAS100', 'SPXUSD')
  AND take_profit > 0
  AND expected_profit_for_session IS NOT NULL
  AND expected_profit_for_session < 50
  AND status IN ('open', 'closed');

-- Correct XAUUSD trades (gold)
UPDATE goal_session_trades
SET 
  expected_profit_at_tp_dollars = ABS(take_profit - entry_price) * 100 * lot_size,
  expected_profit_for_session = ABS(take_profit - entry_price) * 100 * lot_size
WHERE symbol IN ('XAUUSD', 'GOLD')
  AND take_profit > 0
  AND expected_profit_for_session IS NOT NULL
  AND expected_profit_for_session < 50
  AND status IN ('open', 'closed');

-- Correct ETHUSD trades (crypto)
UPDATE goal_session_trades
SET 
  expected_profit_at_tp_dollars = ABS(take_profit - entry_price) * 1.0 * lot_size,
  expected_profit_for_session = ABS(take_profit - entry_price) * 1.0 * lot_size
WHERE symbol IN ('ETHUSD', 'ETHUSDT')
  AND take_profit > 0
  AND expected_profit_for_session IS NOT NULL
  AND expected_profit_for_session < 50
  AND status IN ('open', 'closed');

-- Correct standard forex trades (4-decimal pairs)
UPDATE goal_session_trades
SET 
  expected_profit_at_tp_dollars = ABS(take_profit - entry_price) / 0.0001 * 10 * lot_size,
  expected_profit_for_session = ABS(take_profit - entry_price) / 0.0001 * 10 * lot_size
WHERE symbol NOT IN ('SPX500', 'US30', 'NAS100', 'SPXUSD', 'XAUUSD', 'GOLD', 'ETHUSD', 'ETHUSDT')
  AND symbol NOT ILIKE '%JPY%'
  AND take_profit > 0
  AND expected_profit_for_session IS NOT NULL
  AND expected_profit_for_session < 50
  AND status IN ('open', 'closed');

-- Correct JPY pair trades (2-decimal pairs)
UPDATE goal_session_trades
SET 
  expected_profit_at_tp_dollars = ABS(take_profit - entry_price) / 0.01 * 10 * lot_size,
  expected_profit_for_session = ABS(take_profit - entry_price) / 0.01 * 10 * lot_size
WHERE symbol ILIKE '%JPY%'
  AND take_profit > 0
  AND expected_profit_for_session IS NOT NULL
  AND expected_profit_for_session < 50
  AND status IN ('open', 'closed');
