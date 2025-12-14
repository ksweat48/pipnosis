/*
  # Safe Data Quality System - Non-Destructive Cleanup
  
  ## Overview
  Creates a layered data quality system that prioritizes clean data sources
  without breaking existing functionality.
  
  ## Changes
  
  1. **New Columns**
     - `deprecated` flag on forex_candles (allows marking bad data without deletion)
     - `is_flat_candle` computed column for quick filtering
  
  2. **Data Source Priority System**
     - Ranks data sources by quality
     - Dukascopy (historical) > netlify_aggregator > gap_filler_prices > metaapi > gap_fill
  
  3. **Quality Views**
     - `forex_candles_clean` - Filters out deprecated and flat candles
     - `forex_candles_best` - Returns only highest quality source per candle
  
  4. **Helper Functions**
     - `get_candles_for_chart()` - Smart candle fetching with quality prioritization
     - `mark_low_quality_data()` - Safe deprecation function
  
  ## Safety Features
  - No data deletion
  - Existing queries continue to work
  - Gradual migration path
  - Rollback capability
*/

-- Add deprecation tracking (safe, non-breaking column)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'forex_candles' AND column_name = 'deprecated'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN deprecated boolean DEFAULT false;
    CREATE INDEX IF NOT EXISTS idx_forex_candles_deprecated ON forex_candles(deprecated) WHERE deprecated = false;
  END IF;
END $$;

-- Add flat candle detection column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'forex_candles' AND column_name = 'is_flat_candle'
  ) THEN
    ALTER TABLE forex_candles ADD COLUMN is_flat_candle boolean 
    GENERATED ALWAYS AS (open = high AND high = low AND low = close) STORED;
    CREATE INDEX IF NOT EXISTS idx_forex_candles_flat ON forex_candles(is_flat_candle) WHERE is_flat_candle = true;
  END IF;
END $$;

-- Create data source priority function
CREATE OR REPLACE FUNCTION get_data_source_priority(source text)
RETURNS integer
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  RETURN CASE source
    WHEN 'dukascopy_historical' THEN 100  -- Highest quality: tick-perfect historical
    WHEN 'dukascopy' THEN 95
    WHEN 'finnhub' THEN 90
    WHEN 'netlify_aggregator' THEN 85    -- Current working system
    WHEN 'gap_filler_prices' THEN 80
    WHEN 'metaapi' THEN 70
    WHEN 'gap_filler_M5' THEN 50
    WHEN 'interpolated' THEN 40
    WHEN 'gap_fill' THEN 10              -- Lowest quality: contaminated
    ELSE 50
  END;
END;
$$;

-- Create clean candles view (non-flat, non-deprecated)
CREATE OR REPLACE VIEW forex_candles_clean AS
SELECT 
  id,
  symbol,
  timeframe,
  open_time,
  close_time,
  open,
  high,
  low,
  close,
  volume,
  tick_volume,
  spread,
  data_source,
  quality_score,
  created_at,
  get_data_source_priority(data_source) as source_priority,
  CASE 
    WHEN high > GREATEST(open, close) OR low < LEAST(open, close) THEN true
    ELSE false
  END as has_wicks
FROM forex_candles
WHERE deprecated = false
  AND is_flat_candle = false;

-- Grant access to the view
GRANT SELECT ON forex_candles_clean TO authenticated, service_role, anon;

-- Create best-quality candles view (deduplicates by taking highest priority source)
CREATE OR REPLACE VIEW forex_candles_best AS
WITH ranked_candles AS (
  SELECT 
    *,
    ROW_NUMBER() OVER (
      PARTITION BY symbol, timeframe, open_time 
      ORDER BY get_data_source_priority(data_source) DESC, created_at DESC
    ) as rn
  FROM forex_candles
  WHERE deprecated = false
    AND is_flat_candle = false
)
SELECT 
  id,
  symbol,
  timeframe,
  open_time,
  close_time,
  open,
  high,
  low,
  close,
  volume,
  tick_volume,
  spread,
  data_source,
  quality_score,
  created_at
FROM ranked_candles
WHERE rn = 1;

-- Grant access to the view
GRANT SELECT ON forex_candles_best TO authenticated, service_role, anon;

-- Create smart chart data fetching function
CREATE OR REPLACE FUNCTION get_candles_for_chart(
  p_symbol text,
  p_timeframe text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_limit integer DEFAULT 1000
)
RETURNS TABLE (
  id bigint,
  symbol text,
  timeframe text,
  open_time timestamptz,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  volume numeric,
  data_source text,
  quality_score numeric
)
LANGUAGE plpgsql STABLE
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.id,
    c.symbol,
    c.timeframe,
    c.open_time,
    c.open,
    c.high,
    c.low,
    c.close,
    c.volume,
    c.data_source,
    c.quality_score
  FROM forex_candles_best c
  WHERE c.symbol = p_symbol
    AND c.timeframe = p_timeframe
    AND c.open_time >= p_start_time
    AND c.open_time <= p_end_time
  ORDER BY c.open_time ASC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_candles_for_chart TO authenticated, service_role, anon;

-- Create safe deprecation function (marks data, doesn't delete)
CREATE OR REPLACE FUNCTION mark_low_quality_data()
RETURNS TABLE (
  marked_count bigint,
  affected_symbols text[],
  affected_sources text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_marked_count bigint;
  v_symbols text[];
  v_sources text[];
BEGIN
  -- Mark flat candles from gap_fill as deprecated
  WITH updated AS (
    UPDATE forex_candles
    SET deprecated = true
    WHERE deprecated = false
      AND (
        (data_source = 'gap_fill' AND is_flat_candle = true)
        OR (data_source = 'gap_fill' AND 
            open_time < NOW() - INTERVAL '7 days' AND 
            is_flat_candle = true)
      )
    RETURNING symbol, data_source
  )
  SELECT 
    COUNT(*),
    ARRAY_AGG(DISTINCT symbol),
    ARRAY_AGG(DISTINCT data_source)
  INTO v_marked_count, v_symbols, v_sources
  FROM updated;
  
  marked_count := COALESCE(v_marked_count, 0);
  affected_symbols := COALESCE(v_symbols, ARRAY[]::text[]);
  affected_sources := COALESCE(v_sources, ARRAY[]::text[]);
  
  RETURN NEXT;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION mark_low_quality_data TO service_role;

-- Create data quality monitoring table
CREATE TABLE IF NOT EXISTS data_quality_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_time timestamptz DEFAULT now(),
  total_candles bigint,
  deprecated_candles bigint,
  flat_candles bigint,
  quality_by_source jsonb,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE data_quality_log ENABLE ROW LEVEL SECURITY;

-- RLS policies for data_quality_log
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'data_quality_log' 
    AND policyname = 'Service role can manage quality logs'
  ) THEN
    CREATE POLICY "Service role can manage quality logs"
      ON data_quality_log
      FOR ALL
      TO service_role
      USING (true)
      WITH CHECK (true);
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'data_quality_log' 
    AND policyname = 'Authenticated users can view quality logs'
  ) THEN
    CREATE POLICY "Authenticated users can view quality logs"
      ON data_quality_log
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

-- Create quality monitoring function
CREATE OR REPLACE FUNCTION log_data_quality()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total bigint;
  v_deprecated bigint;
  v_flat bigint;
  v_by_source jsonb;
BEGIN
  -- Count totals
  SELECT COUNT(*) INTO v_total FROM forex_candles;
  SELECT COUNT(*) INTO v_deprecated FROM forex_candles WHERE deprecated = true;
  SELECT COUNT(*) INTO v_flat FROM forex_candles WHERE is_flat_candle = true;
  
  -- Quality by source
  SELECT jsonb_object_agg(
    data_source,
    jsonb_build_object(
      'total', total,
      'flat_count', flat_count,
      'flat_pct', ROUND((flat_count::numeric / NULLIF(total, 0) * 100), 1)
    )
  )
  INTO v_by_source
  FROM (
    SELECT 
      data_source,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE is_flat_candle) as flat_count
    FROM forex_candles
    WHERE deprecated = false
    GROUP BY data_source
  ) src;
  
  -- Insert log
  INSERT INTO data_quality_log (
    total_candles,
    deprecated_candles,
    flat_candles,
    quality_by_source
  ) VALUES (
    v_total,
    v_deprecated,
    v_flat,
    v_by_source
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION log_data_quality TO service_role;

-- Create initial quality log
SELECT log_data_quality();

-- Add helpful comments
COMMENT ON VIEW forex_candles_clean IS 'Filtered view excluding deprecated and flat candles. Use this for chart displays and AI training.';
COMMENT ON VIEW forex_candles_best IS 'Best quality candle per timestamp, automatically selecting highest priority data source.';
COMMENT ON FUNCTION get_candles_for_chart IS 'Smart function for fetching chart data with automatic quality filtering and source prioritization.';
COMMENT ON COLUMN forex_candles.deprecated IS 'Marks low-quality data without deletion. Allows safe rollback.';
COMMENT ON COLUMN forex_candles.is_flat_candle IS 'Auto-computed: true when open=high=low=close (invalid candle data).';
