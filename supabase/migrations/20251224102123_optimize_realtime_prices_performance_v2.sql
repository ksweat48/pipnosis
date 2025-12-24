/*
  # Optimize realtime_prices Performance (v2 - No Immediate Cleanup)
  
  1. Problem
    - Query timeout errors (57014) on realtime_prices table
    - Table has accumulated too much data
    - Missing composite indexes for common query patterns
    
  2. Changes
    - Add composite index for (symbol, broker_time) queries
    - Add batched cleanup function
    - Add trigger to prevent old data inserts
    - NO immediate cleanup (table has too much data)
    
  3. Performance Impact
    - Faster queries with composite index
    - Gradual cleanup through batched function
    - Prevents future data accumulation
*/

-- Add composite index for common query pattern (symbol + broker_time)
CREATE INDEX IF NOT EXISTS idx_realtime_prices_symbol_broker_time 
ON realtime_prices(symbol, broker_time DESC);

-- Drop existing function if it exists
DROP FUNCTION IF EXISTS cleanup_old_realtime_prices();

-- Batched cleanup function (deletes in chunks to avoid timeouts)
CREATE OR REPLACE FUNCTION cleanup_old_realtime_prices_batch(batch_size INTEGER DEFAULT 10000)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  total_deleted INTEGER := 0;
  batch_deleted INTEGER;
BEGIN
  LOOP
    -- Delete in batches
    DELETE FROM realtime_prices
    WHERE id IN (
      SELECT id FROM realtime_prices
      WHERE broker_time < NOW() - INTERVAL '24 hours'
      LIMIT batch_size
    );
    
    GET DIAGNOSTICS batch_deleted = ROW_COUNT;
    total_deleted := total_deleted + batch_deleted;
    
    -- Exit if no more rows to delete
    EXIT WHEN batch_deleted = 0;
    
    -- Small delay between batches
    PERFORM pg_sleep(0.1);
  END LOOP;
  
  RAISE NOTICE 'Cleaned up % realtime_prices records older than 24 hours', total_deleted;
  RETURN total_deleted;
END;
$$;

-- Grant execute to service role and authenticated users
GRANT EXECUTE ON FUNCTION cleanup_old_realtime_prices_batch(INTEGER) TO service_role;

-- Add a trigger to prevent inserts of very old data
CREATE OR REPLACE FUNCTION prevent_old_realtime_prices()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Reject prices older than 48 hours (prevents backfilling old data)
  IF NEW.broker_time < NOW() - INTERVAL '48 hours' THEN
    RETURN NULL; -- Silently ignore instead of erroring
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_prevent_old_realtime_prices ON realtime_prices;
CREATE TRIGGER trigger_prevent_old_realtime_prices
  BEFORE INSERT ON realtime_prices
  FOR EACH ROW
  EXECUTE FUNCTION prevent_old_realtime_prices();

-- Add comment
COMMENT ON FUNCTION cleanup_old_realtime_prices_batch(INTEGER) IS 
'Batched cleanup function for realtime_prices table. Deletes data older than 24 hours in batches to avoid timeouts. Call periodically (e.g., every 6 hours). Default batch size: 10000 records.';
