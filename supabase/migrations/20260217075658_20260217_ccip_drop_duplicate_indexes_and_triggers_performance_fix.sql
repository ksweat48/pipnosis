/*
  # Drop Duplicate forex_candles Indexes and Duplicate Trigger

  ## Problem
  1. forex_candles table has 928K rows (175 MB data) but 715 MB in indexes (4x data size).
     Five indexes are duplicates of the same (symbol, timeframe, open_time DESC) pattern.
     This causes query planner overhead, excessive I/O, and statement timeouts on candle fetches.
  2. validate_and_fix_profit_loss() function runs TWICE per INSERT/UPDATE on goal_session_trades
     via two separate triggers: validate_and_fix_profit_loss_trigger and validate_profit_loss_before_save.
     This doubles validation overhead on every trade update (33 triggers fire per UPDATE).

  ## Changes

  ### 1. Drop 4 Duplicate forex_candles Indexes
  Keeping: idx_forex_candles_chart_query (the primary composite index used by chart queries)
  Dropping duplicates that cover the same (symbol, timeframe, open_time DESC):
  - idx_candles_symbol_timeframe_open_time
  - idx_forex_candles_symbol_timeframe_open_time
  - idx_forex_candles_symbol_timeframe_time
  - idx_forex_candles_symbol_timeframe_time_desc

  Expected space savings: ~200-300 MB of index data freed.
  Expected performance improvement: Faster INSERT/UPDATE (fewer indexes to maintain),
  faster SELECT (planner picks optimal index immediately).

  ### 2. Drop Duplicate validate_profit_loss_before_save Trigger
  Both triggers call the same function validate_and_fix_profit_loss().
  Keeping: validate_and_fix_profit_loss_trigger (the original)
  Dropping: validate_profit_loss_before_save (the duplicate)

  ## Security
  No RLS changes. Index drops and trigger drops are safe operations.

  ## CCIP Protocol
  - System Map: Identified via pg_indexes and information_schema.triggers
  - Logic Contract: One index per access pattern, one trigger per function
  - Compatibility: No application code references specific index names
  - Staged: Indexes dropped individually to stay within migration transaction
*/

DROP INDEX IF EXISTS idx_candles_symbol_timeframe_open_time;
DROP INDEX IF EXISTS idx_forex_candles_symbol_timeframe_open_time;
DROP INDEX IF EXISTS idx_forex_candles_symbol_timeframe_time;
DROP INDEX IF EXISTS idx_forex_candles_symbol_timeframe_time_desc;

DROP TRIGGER IF EXISTS validate_profit_loss_before_save ON goal_session_trades;
