/*
  # Add Data Source and Quality Tracking to Forex Candles

  ## Purpose
  Track the origin and quality of each candle to prevent mixing of data sources
  and enable intelligent data prioritization during backfills.

  ## Changes
  1. Add `data_source` column to track where candle data came from
  2. Add `quality_score` column to prioritize data sources (higher = better)
  3. Add `is_backfilled` flag for quick filtering
  4. Add `backfill_batch_id` to track backfill operations
  5. Create index for efficient data source queries
  6. Update existing candles with default values

  ## Data Source Types
  - 'dukascopy' = Historical data from Dukascopy (quality: 100)
  - 'metaapi' = Real-time data from MetaAPI (quality: 90)
  - 'tick_aggregation' = Aggregated from realtime_prices (quality: 70)
  - 'gap_fill' = Synthetic gap fill (quality: 50)
  - 'unknown' = Legacy data (quality: 60)

  ## Notes
  - Higher quality scores indicate more authoritative data
  - During conflicts, keep the candle with the highest quality_score
  - Backfill operations should overwrite lower quality data
*/

-- Add new columns to forex_candles table
ALTER TABLE forex_candles
ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS quality_score integer DEFAULT 60,
ADD COLUMN IF NOT EXISTS is_backfilled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS backfill_batch_id uuid,
ADD COLUMN IF NOT EXISTS backfill_timestamp timestamptz;

-- Create index for efficient data source queries
CREATE INDEX IF NOT EXISTS idx_forex_candles_data_source
  ON forex_candles(symbol, timeframe, data_source);

CREATE INDEX IF NOT EXISTS idx_forex_candles_quality
  ON forex_candles(symbol, timeframe, quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_forex_candles_backfill_batch
  ON forex_candles(backfill_batch_id)
  WHERE backfill_batch_id IS NOT NULL;

-- Add comment to document the schema
COMMENT ON COLUMN forex_candles.data_source IS 'Source of candle data: dukascopy, metaapi, tick_aggregation, gap_fill, unknown';
COMMENT ON COLUMN forex_candles.quality_score IS 'Data quality score (0-100): higher = more authoritative';
COMMENT ON COLUMN forex_candles.is_backfilled IS 'True if candle was created by backfill operation';
COMMENT ON COLUMN forex_candles.backfill_batch_id IS 'UUID of the backfill batch that created/updated this candle';

-- Create a function to update quality score based on data source
CREATE OR REPLACE FUNCTION set_quality_score_from_source()
RETURNS TRIGGER AS $$
BEGIN
  -- Automatically set quality_score based on data_source if not explicitly provided
  IF NEW.quality_score = 60 AND NEW.data_source IS NOT NULL THEN
    NEW.quality_score := CASE NEW.data_source
      WHEN 'dukascopy' THEN 100
      WHEN 'metaapi' THEN 90
      WHEN 'tick_aggregation' THEN 70
      WHEN 'gap_fill' THEN 50
      ELSE 60
    END;
  END IF;

  -- Set is_backfilled flag
  IF NEW.data_source IN ('dukascopy', 'gap_fill') OR NEW.backfill_batch_id IS NOT NULL THEN
    NEW.is_backfilled := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically set quality scores
DROP TRIGGER IF EXISTS trigger_set_quality_score ON forex_candles;
CREATE TRIGGER trigger_set_quality_score
  BEFORE INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION set_quality_score_from_source();

-- Update existing candles with default quality scores based on patterns
-- (This helps classify legacy data)
UPDATE forex_candles
SET
  data_source = CASE
    WHEN volume > 0 AND volume < 10 THEN 'tick_aggregation'
    WHEN volume >= 10 THEN 'metaapi'
    ELSE 'unknown'
  END,
  quality_score = CASE
    WHEN volume > 0 AND volume < 10 THEN 70
    WHEN volume >= 10 THEN 90
    ELSE 60
  END
WHERE data_source = 'unknown';

-- Create a view for high-quality candles only
CREATE OR REPLACE VIEW forex_candles_high_quality AS
SELECT * FROM forex_candles
WHERE quality_score >= 80
ORDER BY symbol, timeframe, open_time DESC;

-- Create a view to identify potential duplicate candles
CREATE OR REPLACE VIEW forex_candles_duplicates AS
SELECT
  symbol,
  timeframe,
  open_time,
  COUNT(*) as duplicate_count,
  ARRAY_AGG(DISTINCT data_source) as sources,
  MAX(quality_score) as best_quality,
  MIN(quality_score) as worst_quality
FROM forex_candles
GROUP BY symbol, timeframe, open_time
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, symbol, timeframe, open_time DESC;

-- Create a function to clean up duplicate candles (keep highest quality)
CREATE OR REPLACE FUNCTION remove_duplicate_candles(
  p_symbol text DEFAULT NULL,
  p_timeframe text DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  action text,
  symbol text,
  timeframe text,
  open_time timestamptz,
  removed_count bigint,
  kept_source text,
  kept_quality integer
) AS $$
DECLARE
  v_deleted_count bigint := 0;
BEGIN
  -- Find and remove duplicate candles, keeping only the highest quality one
  IF p_dry_run THEN
    -- Dry run: just show what would be deleted
    RETURN QUERY
    WITH duplicates AS (
      SELECT
        fc.symbol,
        fc.timeframe,
        fc.open_time,
        COUNT(*) as dup_count,
        MAX(quality_score) as max_quality
      FROM forex_candles fc
      WHERE (p_symbol IS NULL OR fc.symbol = p_symbol)
        AND (p_timeframe IS NULL OR fc.timeframe = p_timeframe)
      GROUP BY fc.symbol, fc.timeframe, fc.open_time
      HAVING COUNT(*) > 1
    ),
    to_keep AS (
      SELECT DISTINCT ON (fc.symbol, fc.timeframe, fc.open_time)
        fc.id,
        fc.symbol,
        fc.timeframe,
        fc.open_time,
        fc.data_source,
        fc.quality_score
      FROM forex_candles fc
      INNER JOIN duplicates d ON
        fc.symbol = d.symbol AND
        fc.timeframe = d.timeframe AND
        fc.open_time = d.open_time
      ORDER BY fc.symbol, fc.timeframe, fc.open_time, fc.quality_score DESC, fc.created_at DESC
    )
    SELECT
      'DRY_RUN' as action,
      d.symbol::text,
      d.timeframe::text,
      d.open_time,
      (d.dup_count - 1) as removed_count,
      tk.data_source::text as kept_source,
      tk.quality_score as kept_quality
    FROM duplicates d
    INNER JOIN to_keep tk ON
      d.symbol = tk.symbol AND
      d.timeframe = tk.timeframe AND
      d.open_time = tk.open_time;
  ELSE
    -- Actual deletion
    WITH duplicates AS (
      SELECT
        fc.symbol,
        fc.timeframe,
        fc.open_time,
        COUNT(*) as dup_count,
        MAX(quality_score) as max_quality
      FROM forex_candles fc
      WHERE (p_symbol IS NULL OR fc.symbol = p_symbol)
        AND (p_timeframe IS NULL OR fc.timeframe = p_timeframe)
      GROUP BY fc.symbol, fc.timeframe, fc.open_time
      HAVING COUNT(*) > 1
    ),
    to_keep AS (
      SELECT DISTINCT ON (fc.symbol, fc.timeframe, fc.open_time)
        fc.id,
        fc.symbol,
        fc.timeframe,
        fc.open_time,
        fc.data_source,
        fc.quality_score
      FROM forex_candles fc
      INNER JOIN duplicates d ON
        fc.symbol = d.symbol AND
        fc.timeframe = d.timeframe AND
        fc.open_time = d.open_time
      ORDER BY fc.symbol, fc.timeframe, fc.open_time, fc.quality_score DESC, fc.created_at DESC
    ),
    deleted AS (
      DELETE FROM forex_candles fc
      WHERE EXISTS (
        SELECT 1 FROM duplicates d
        WHERE fc.symbol = d.symbol
          AND fc.timeframe = d.timeframe
          AND fc.open_time = d.open_time
      )
      AND fc.id NOT IN (SELECT id FROM to_keep)
      RETURNING fc.symbol, fc.timeframe, fc.open_time
    )
    SELECT
      'DELETED' as action,
      d.symbol::text,
      d.timeframe::text,
      d.open_time,
      (d.dup_count - 1) as removed_count,
      tk.data_source::text as kept_source,
      tk.quality_score as kept_quality
    FROM duplicates d
    INNER JOIN to_keep tk ON
      d.symbol = tk.symbol AND
      d.timeframe = tk.timeframe AND
      d.open_time = tk.open_time;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Grant necessary permissions
GRANT SELECT ON forex_candles_high_quality TO authenticated;
GRANT SELECT ON forex_candles_duplicates TO authenticated;
