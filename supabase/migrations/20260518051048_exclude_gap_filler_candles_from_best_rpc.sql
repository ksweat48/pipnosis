/*
  # Exclude gap-filler candles from get_best_candles RPC

  1. Changes
    - Modified `get_best_candles` RPC to exclude candles with `data_source` containing 'gap_fill'
    - Gap-filler candles are synthetic interpolations that create false market structure
    - They were already deprioritized (rank 7) but could still appear when no other source existed for a time slot
    - This change ensures Alpha and all systems using this RPC never receive synthetic gap-filler data

  2. Affected Systems
    - Alpha scan pipeline (coordinator-alpha.ts via MarketDataService)
    - Hunt readiness monitor (now uses get_best_candles after data source unification)
    - Any future consumer of get_best_candles

  3. Safety
    - Gap-filler candles remain in the table for historical reference
    - Only the RPC output is filtered — no data deletion
*/

DROP FUNCTION IF EXISTS get_best_candles(text, text, int);

CREATE FUNCTION get_best_candles(p_symbol text, p_timeframe text, p_limit int)
RETURNS SETOF forex_candles
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
/*
* Bounded-window strategy:
* 1. Narrow to most recent (p_limit * 6) rows using the partial index on (symbol, open_time DESC)
* 2. Deduplicate within that bounded set — vastly cheaper than scanning all rows
* 3. Return final p_limit rows newest-first
*
* CCIP-2026-0518: Gap-filler candles excluded — synthetic interpolations create false structure.
*/
WITH candidates AS (
SELECT fc.*
FROM forex_candles fc
WHERE fc.symbol = p_symbol
AND fc.timeframe = p_timeframe
AND (fc.is_flat_candle = false OR fc.is_flat_candle IS NULL)
AND (fc.deprecated = false OR fc.deprecated IS NULL)
AND fc.data_source NOT LIKE 'gap_fill%'
AND fc.data_source != 'gap_fill'
AND fc.open  > 0
AND fc.high  > 0
AND fc.low   > 0
AND fc.close > 0
AND fc.high  >= fc.low
AND fc.open  >= fc.low
AND fc.open  <= fc.high
AND fc.close >= fc.low
AND fc.close <= fc.high
ORDER BY fc.open_time DESC
LIMIT (p_limit * 6)
),
deduped AS (
SELECT DISTINCT ON (c.open_time) c.*
FROM candidates c
ORDER BY
c.open_time DESC,
CASE
WHEN c.data_source = 'netlify_aggregator' THEN 1
WHEN c.data_source = 'metaapi_deadman'    THEN 2
WHEN c.data_source = 'metaapi'            THEN 3
WHEN c.data_source = 'dukascopy'          THEN 4
WHEN c.data_source = 'twelve_data'        THEN 5
WHEN c.data_source = 'browser_aggregated' THEN 6
ELSE 7
END,
c.quality_score DESC NULLS LAST,
c.created_at DESC
)
SELECT
d.id, d.symbol, d.timeframe, d.open_time, d.close_time,
d.open, d.high, d.low, d.close, d.volume,
d.created_at, d.tick_count, d.data_source, d.tick_volume, d.spread,
d.quality_score, d.deprecated, d.is_flat_candle
FROM deduped d
ORDER BY d.open_time DESC
LIMIT p_limit;
$$;
