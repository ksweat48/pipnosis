/*
  # Add M15, H1, H4, D1 indexes for forex_candles_best view performance

  ## Problem
  The forex_candles_best view times out (error 57014) when queried for M15, H1, H4
  timeframes. M5 and M1 already have dedicated priority indexes. M15/H1/H4/D1 do not,
  forcing full scans through 86k-5k rows per symbol per query.

  During a scan cycle, 9 symbols x multiple timeframes = many concurrent queries hit
  the view simultaneously with no index support for these timeframes.

  ## Fix
  Add partial indexes matching the exact WHERE conditions and ORDER BY expression
  used by forex_candles_best so the planner can use efficient index scans.
  Uses CREATE INDEX (not CONCURRENTLY) to run inside migration transaction.
*/

CREATE INDEX IF NOT EXISTS idx_forex_candles_best_m15_priority
  ON public.forex_candles USING btree (
    symbol,
    timeframe,
    open_time,
    (CASE
      WHEN data_source = 'netlify_aggregator' THEN 1
      WHEN data_source = 'metaapi_deadman' THEN 2
      WHEN data_source = 'metaapi' THEN 3
      WHEN data_source = 'dukascopy' THEN 4
      WHEN data_source = 'twelve_data' THEN 5
      WHEN data_source = 'browser_aggregated' THEN 6
      ELSE 7
    END),
    quality_score DESC NULLS LAST,
    created_at DESC
  )
  WHERE (
    timeframe = 'M15'
    AND (is_flat_candle = false OR is_flat_candle IS NULL)
    AND (deprecated = false OR deprecated IS NULL)
    AND open > 0 AND high > 0 AND low > 0 AND close > 0
    AND high >= low AND open >= low AND open <= high AND close >= low AND close <= high
  );

CREATE INDEX IF NOT EXISTS idx_forex_candles_best_h1_priority
  ON public.forex_candles USING btree (
    symbol,
    timeframe,
    open_time,
    (CASE
      WHEN data_source = 'netlify_aggregator' THEN 1
      WHEN data_source = 'metaapi_deadman' THEN 2
      WHEN data_source = 'metaapi' THEN 3
      WHEN data_source = 'dukascopy' THEN 4
      WHEN data_source = 'twelve_data' THEN 5
      WHEN data_source = 'browser_aggregated' THEN 6
      ELSE 7
    END),
    quality_score DESC NULLS LAST,
    created_at DESC
  )
  WHERE (
    timeframe = 'H1'
    AND (is_flat_candle = false OR is_flat_candle IS NULL)
    AND (deprecated = false OR deprecated IS NULL)
    AND open > 0 AND high > 0 AND low > 0 AND close > 0
    AND high >= low AND open >= low AND open <= high AND close >= low AND close <= high
  );

CREATE INDEX IF NOT EXISTS idx_forex_candles_best_h4_priority
  ON public.forex_candles USING btree (
    symbol,
    timeframe,
    open_time,
    (CASE
      WHEN data_source = 'netlify_aggregator' THEN 1
      WHEN data_source = 'metaapi_deadman' THEN 2
      WHEN data_source = 'metaapi' THEN 3
      WHEN data_source = 'dukascopy' THEN 4
      WHEN data_source = 'twelve_data' THEN 5
      WHEN data_source = 'browser_aggregated' THEN 6
      ELSE 7
    END),
    quality_score DESC NULLS LAST,
    created_at DESC
  )
  WHERE (
    timeframe = 'H4'
    AND (is_flat_candle = false OR is_flat_candle IS NULL)
    AND (deprecated = false OR deprecated IS NULL)
    AND open > 0 AND high > 0 AND low > 0 AND close > 0
    AND high >= low AND open >= low AND open <= high AND close >= low AND close <= high
  );

CREATE INDEX IF NOT EXISTS idx_forex_candles_best_d1_priority
  ON public.forex_candles USING btree (
    symbol,
    timeframe,
    open_time,
    (CASE
      WHEN data_source = 'netlify_aggregator' THEN 1
      WHEN data_source = 'metaapi_deadman' THEN 2
      WHEN data_source = 'metaapi' THEN 3
      WHEN data_source = 'dukascopy' THEN 4
      WHEN data_source = 'twelve_data' THEN 5
      WHEN data_source = 'browser_aggregated' THEN 6
      ELSE 7
    END),
    quality_score DESC NULLS LAST,
    created_at DESC
  )
  WHERE (
    timeframe = 'D1'
    AND (is_flat_candle = false OR is_flat_candle IS NULL)
    AND (deprecated = false OR deprecated IS NULL)
    AND open > 0 AND high > 0 AND low > 0 AND close > 0
    AND high >= low AND open >= low AND open <= high AND close >= low AND close <= high
  );
