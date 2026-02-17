/*
  # Fix check_server_side_aggregation Timeout and Drop Redundant Indexes

  ## Problem
  1. check_server_side_aggregation() RPC returns 500 (timeout).
     It queries: WHERE data_source = 'netlify_aggregator' ORDER BY open_time DESC LIMIT 1
     But the only available index is idx_forex_candles_data_source on (data_source) alone,
     which cannot serve the ORDER BY. Postgres must sort all 192K matching rows.

  2. Three additional redundant indexes remain on forex_candles:
     - idx_forex_candles_gap_detection (symbol, timeframe, open_time) -- duplicate of unique constraint
     - idx_forex_candles_symbol (symbol) -- redundant, covered by chart_query index leading column
     - idx_forex_candles_timeframe (timeframe) -- low cardinality (~5 values), planner rarely uses

  ## Changes

  ### 1. Replace data_source Index with Composite
  - Drop: idx_forex_candles_data_source (data_source only)
  - Create: idx_forex_candles_data_source_time (data_source, open_time DESC)
  - This lets check_server_side_aggregation() use index-only scan: instant result

  ### 2. Drop 3 Redundant Indexes
  - idx_forex_candles_gap_detection -- exact duplicate of unique constraint columns
  - idx_forex_candles_symbol -- leading column already in idx_forex_candles_chart_query
  - idx_forex_candles_timeframe -- single low-cardinality column, never useful alone

  ## Expected Impact
  - check_server_side_aggregation: from timeout to <1ms
  - ~100MB additional index space freed
  - Faster INSERTs (fewer indexes to maintain)

  ## Security
  No RLS changes. Index operations only.

  ## CCIP Protocol
  - System Map: Identified via EXPLAIN ANALYZE and pg_indexes
  - Logic Contract: One useful index per access pattern
  - Compatibility: No application code references index names
*/

DROP INDEX IF EXISTS idx_forex_candles_data_source;
DROP INDEX IF EXISTS idx_forex_candles_gap_detection;
DROP INDEX IF EXISTS idx_forex_candles_symbol;
DROP INDEX IF EXISTS idx_forex_candles_timeframe;

CREATE INDEX IF NOT EXISTS idx_forex_candles_data_source_time
  ON forex_candles (data_source, open_time DESC);
