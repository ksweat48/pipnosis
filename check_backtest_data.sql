-- Check synthetic candle availability for backtesting
SELECT 
  symbol,
  COUNT(*) as total_candles,
  MIN(open_time) as earliest_candle,
  MAX(open_time) as latest_candle,
  COUNT(DISTINCT DATE(open_time)) as days_of_data
FROM forex_candles
WHERE symbol IN ('EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30')
  AND timeframe = 'H1'
  AND open_time >= NOW() - INTERVAL '30 days'
GROUP BY symbol
ORDER BY symbol;
