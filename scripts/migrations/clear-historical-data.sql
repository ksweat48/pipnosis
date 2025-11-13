-- Clear historical candles to prepare for fresh data pull with proper timing
-- This ensures no overlap or gaps between historical and live data

-- Delete all historical candles (we'll re-fetch with proper timing)
DELETE FROM forex_candles;
DELETE FROM market_data WHERE timeframe IN ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1');

-- Clear completion tracking
DELETE FROM candle_completion_tracking;
DELETE FROM candle_data_completeness;

SELECT 'Historical data cleared successfully' as status;
