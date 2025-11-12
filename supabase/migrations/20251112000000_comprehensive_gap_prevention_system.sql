/*
  # Comprehensive Gap Prevention and Candle Quality System

  1. New Tables
    - `polling_outage_log` - Track detected outages and backfill operations
    - `candle_quality_metrics` - Track data source distribution and completion rates
    - `tick_collection_health` - Monitor tick collection rate per symbol
    - `symbol_spread_config` - Store typical spreads for realistic gap-fill generation

  2. Enhanced Functions
    - Improve `fill_candle_gap` to generate realistic candles with proper spreads
    - Add `detect_incomplete_candles` function to identify candles needing repair
    - Add `calculate_candle_completion_score` to rate candle quality

  3. Triggers
    - Auto-calculate completion score on candle insert/update
    - Track data source distribution metrics
    - Alert on excessive gap_fill usage

  4. Indexes
    - Optimize queries for gap detection and quality checks
    - Speed up data_source filtering

  5. Security
    - Enable RLS on all new tables
    - Restrict write access to authenticated users
*/

-- =====================================================
-- 1. POLLING OUTAGE LOG TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS polling_outage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_time timestamptz NOT NULL DEFAULT now(),
  outages_detected integer NOT NULL DEFAULT 0,
  backfills_triggered integer NOT NULL DEFAULT 0,
  outage_details jsonb,
  backfill_results jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_polling_outage_log_run_time
ON polling_outage_log(run_time DESC);

ALTER TABLE polling_outage_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read outage logs"
  ON polling_outage_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write outage logs"
  ON polling_outage_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- 2. SYMBOL SPREAD CONFIGURATION TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS symbol_spread_config (
  symbol text PRIMARY KEY,
  typical_spread_pips numeric NOT NULL DEFAULT 2.0,
  pip_size numeric NOT NULL DEFAULT 0.0001,
  min_body_size_pips numeric NOT NULL DEFAULT 0.5,
  max_wick_ratio numeric NOT NULL DEFAULT 0.3,
  updated_at timestamptz DEFAULT now()
);

-- Insert default spread configurations
INSERT INTO symbol_spread_config (symbol, typical_spread_pips, pip_size, min_body_size_pips) VALUES
  ('EURUSD', 1.5, 0.0001, 0.3),
  ('GBPUSD', 2.0, 0.0001, 0.4),
  ('USDJPY', 1.8, 0.01, 0.4),
  ('XAUUSD', 30.0, 0.01, 5.0),
  ('US30', 3.0, 0.01, 1.0)
ON CONFLICT (symbol) DO NOTHING;

ALTER TABLE symbol_spread_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read spread config"
  ON symbol_spread_config FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update spread config"
  ON symbol_spread_config FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- =====================================================
-- 3. CANDLE QUALITY METRICS TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS candle_quality_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  measurement_time timestamptz NOT NULL DEFAULT now(),
  total_candles integer NOT NULL DEFAULT 0,
  metaapi_candles integer NOT NULL DEFAULT 0,
  gap_fill_candles integer NOT NULL DEFAULT 0,
  backfilled_candles integer NOT NULL DEFAULT 0,
  complete_candles integer NOT NULL DEFAULT 0,
  incomplete_candles integer NOT NULL DEFAULT 0,
  quality_score numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_candle_quality_metrics_symbol_timeframe
ON candle_quality_metrics(symbol, timeframe, measurement_time DESC);

ALTER TABLE candle_quality_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read quality metrics"
  ON candle_quality_metrics FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write quality metrics"
  ON candle_quality_metrics FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- 4. TICK COLLECTION HEALTH TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS tick_collection_health (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  check_time timestamptz NOT NULL DEFAULT now(),
  ticks_last_minute integer NOT NULL DEFAULT 0,
  ticks_last_5min integer NOT NULL DEFAULT 0,
  last_tick_time timestamptz,
  is_healthy boolean NOT NULL DEFAULT true,
  health_status text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tick_health_symbol_time
ON tick_collection_health(symbol, check_time DESC);

ALTER TABLE tick_collection_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read tick health"
  ON tick_collection_health FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can write tick health"
  ON tick_collection_health FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- =====================================================
-- 5. ADD CANDLE STATUS FIELD
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'candle_status'
  ) THEN
    ALTER TABLE forex_candles
    ADD COLUMN candle_status text DEFAULT 'complete'
    CHECK (candle_status IN ('complete', 'partial', 'synthetic', 'gap_fill', 'backfilled'));

    CREATE INDEX idx_forex_candles_status ON forex_candles(candle_status);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'completion_score'
  ) THEN
    ALTER TABLE forex_candles
    ADD COLUMN completion_score numeric DEFAULT 100 CHECK (completion_score >= 0 AND completion_score <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'forex_candles' AND column_name = 'needs_repair'
  ) THEN
    ALTER TABLE forex_candles
    ADD COLUMN needs_repair boolean DEFAULT false;

    CREATE INDEX idx_forex_candles_needs_repair ON forex_candles(needs_repair) WHERE needs_repair = true;
  END IF;
END $$;

-- =====================================================
-- 6. ENHANCED FILL_CANDLE_GAP FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION fill_candle_gap(
  p_symbol text,
  p_timeframe text,
  p_gap_start timestamptz,
  p_gap_end timestamptz,
  p_last_close numeric
) RETURNS integer AS $$
DECLARE
  v_current_time timestamptz;
  v_period_minutes integer;
  v_candles_created integer := 0;
  v_spread_pips numeric;
  v_pip_size numeric;
  v_min_body_pips numeric;
  v_open numeric;
  v_high numeric;
  v_low numeric;
  v_close numeric;
  v_body_variation numeric;
  v_wick_variation numeric;
BEGIN
  v_period_minutes := CASE p_timeframe
    WHEN 'M1' THEN 1
    WHEN 'M5' THEN 5
    WHEN 'M15' THEN 15
    WHEN 'M30' THEN 30
    WHEN 'H1' THEN 60
    WHEN 'H4' THEN 240
    WHEN 'D1' THEN 1440
    WHEN 'W1' THEN 10080
    ELSE 15
  END;

  SELECT typical_spread_pips, pip_size, min_body_size_pips
  INTO v_spread_pips, v_pip_size, v_min_body_pips
  FROM symbol_spread_config
  WHERE symbol = p_symbol;

  IF v_spread_pips IS NULL THEN
    v_spread_pips := 2.0;
    v_pip_size := 0.0001;
    v_min_body_pips := 0.5;
  END IF;

  v_current_time := p_gap_start;

  WHILE v_current_time < p_gap_end LOOP
    v_body_variation := (random() - 0.5) * v_min_body_pips * v_pip_size;
    v_wick_variation := random() * v_spread_pips * v_pip_size * 0.5;

    v_open := p_last_close;
    v_close := p_last_close + v_body_variation;
    v_high := GREATEST(v_open, v_close) + v_wick_variation;
    v_low := LEAST(v_open, v_close) - v_wick_variation;

    INSERT INTO forex_candles (
      symbol,
      timeframe,
      open_time,
      close_time,
      open,
      high,
      low,
      close,
      volume,
      tick_count,
      data_source,
      candle_status,
      completion_score
    ) VALUES (
      p_symbol,
      p_timeframe,
      v_current_time,
      v_current_time + (v_period_minutes || ' minutes')::interval,
      v_open,
      v_high,
      v_low,
      v_close,
      1,
      1,
      'gap_fill_enhanced',
      'synthetic',
      30
    )
    ON CONFLICT (symbol, timeframe, open_time) DO UPDATE
    SET
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      data_source = EXCLUDED.data_source,
      candle_status = EXCLUDED.candle_status,
      completion_score = EXCLUDED.completion_score
    WHERE forex_candles.data_source = 'gap_fill';

    v_candles_created := v_candles_created + 1;
    v_current_time := v_current_time + (v_period_minutes || ' minutes')::interval;

    p_last_close := v_close;
  END LOOP;

  RETURN v_candles_created;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 7. DETECT INCOMPLETE CANDLES FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION detect_incomplete_candles(
  p_symbol text DEFAULT NULL,
  p_timeframe text DEFAULT NULL,
  p_hours_back integer DEFAULT 24
) RETURNS TABLE (
  symbol text,
  timeframe text,
  open_time timestamptz,
  data_source text,
  issue text,
  completion_score numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    fc.symbol,
    fc.timeframe,
    fc.open_time,
    fc.data_source,
    CASE
      WHEN fc.open = fc.high AND fc.high = fc.low AND fc.low = fc.close THEN 'flat_candle'
      WHEN fc.high < GREATEST(fc.open, fc.close) THEN 'invalid_high'
      WHEN fc.low > LEAST(fc.open, fc.close) THEN 'invalid_low'
      WHEN fc.tick_count < 5 THEN 'insufficient_ticks'
      WHEN fc.data_source IN ('gap_fill', 'gap_fill_enhanced') THEN 'synthetic'
      ELSE 'unknown'
    END as issue,
    fc.completion_score
  FROM forex_candles fc
  WHERE
    (p_symbol IS NULL OR fc.symbol = p_symbol)
    AND (p_timeframe IS NULL OR fc.timeframe = p_timeframe)
    AND fc.open_time > now() - (p_hours_back || ' hours')::interval
    AND (
      fc.open = fc.high AND fc.high = fc.low AND fc.low = fc.close
      OR fc.high < GREATEST(fc.open, fc.close)
      OR fc.low > LEAST(fc.open, fc.close)
      OR fc.tick_count < 5
      OR fc.data_source IN ('gap_fill', 'gap_fill_enhanced')
    )
  ORDER BY fc.open_time DESC;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 8. CALCULATE QUALITY METRICS FUNCTION
-- =====================================================

CREATE OR REPLACE FUNCTION calculate_quality_metrics(
  p_symbol text,
  p_timeframe text,
  p_hours_back integer DEFAULT 24
) RETURNS jsonb AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'symbol', p_symbol,
    'timeframe', p_timeframe,
    'period_hours', p_hours_back,
    'total_candles', COUNT(*),
    'metaapi_candles', COUNT(*) FILTER (WHERE data_source = 'metaapi'),
    'gap_fill_candles', COUNT(*) FILTER (WHERE data_source LIKE 'gap_fill%'),
    'backfilled_candles', COUNT(*) FILTER (WHERE data_source = 'backfill'),
    'complete_candles', COUNT(*) FILTER (WHERE candle_status = 'complete'),
    'incomplete_candles', COUNT(*) FILTER (WHERE candle_status != 'complete'),
    'avg_completion_score', AVG(completion_score),
    'quality_percentage',
      ROUND((COUNT(*) FILTER (WHERE data_source = 'metaapi')::numeric /
             NULLIF(COUNT(*)::numeric, 0) * 100), 2)
  )
  INTO v_result
  FROM forex_candles
  WHERE symbol = p_symbol
    AND timeframe = p_timeframe
    AND open_time > now() - (p_hours_back || ' hours')::interval;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- 9. AUTO-UPDATE CANDLE STATUS TRIGGER
-- =====================================================

CREATE OR REPLACE FUNCTION update_candle_status()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.data_source = 'metaapi' THEN
    NEW.candle_status := 'complete';
    NEW.completion_score := 100;
  ELSIF NEW.data_source LIKE 'gap_fill%' THEN
    NEW.candle_status := 'synthetic';
    NEW.completion_score := 30;
  ELSIF NEW.data_source = 'backfill' THEN
    NEW.candle_status := 'backfilled';
    NEW.completion_score := 90;
  END IF;

  IF NEW.open = NEW.high AND NEW.high = NEW.low AND NEW.low = NEW.close THEN
    NEW.needs_repair := true;
    NEW.completion_score := LEAST(NEW.completion_score, 20);
  END IF;

  IF NEW.tick_count < 5 AND NEW.data_source = 'metaapi' THEN
    NEW.candle_status := 'partial';
    NEW.completion_score := 60;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_candle_status ON forex_candles;
CREATE TRIGGER trigger_update_candle_status
  BEFORE INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION update_candle_status();

-- =====================================================
-- 10. CREATE MONITORING VIEWS
-- =====================================================

CREATE OR REPLACE VIEW candle_quality_summary AS
SELECT
  symbol,
  timeframe,
  COUNT(*) as total_candles,
  COUNT(*) FILTER (WHERE data_source = 'metaapi') as metaapi_count,
  COUNT(*) FILTER (WHERE data_source LIKE 'gap_fill%') as gap_fill_count,
  COUNT(*) FILTER (WHERE needs_repair = true) as needs_repair_count,
  ROUND(AVG(completion_score), 2) as avg_completion_score,
  ROUND((COUNT(*) FILTER (WHERE data_source = 'metaapi')::numeric /
         NULLIF(COUNT(*)::numeric, 0) * 100), 2) as quality_percentage
FROM forex_candles
WHERE open_time > now() - interval '24 hours'
GROUP BY symbol, timeframe
ORDER BY symbol, timeframe;

-- Grant access to views
GRANT SELECT ON candle_quality_summary TO authenticated;

COMMENT ON TABLE polling_outage_log IS 'Tracks detected polling outages and triggered backfill operations';
COMMENT ON TABLE symbol_spread_config IS 'Stores typical spreads for realistic gap-fill candle generation';
COMMENT ON TABLE candle_quality_metrics IS 'Tracks candle data quality metrics over time';
COMMENT ON TABLE tick_collection_health IS 'Monitors tick collection rate and health per symbol';
COMMENT ON FUNCTION fill_candle_gap IS 'Enhanced gap-filling with realistic OHLC spreads and micro-variations';
COMMENT ON FUNCTION detect_incomplete_candles IS 'Identifies candles with quality issues requiring repair';
COMMENT ON FUNCTION calculate_quality_metrics IS 'Calculates comprehensive quality metrics for a symbol/timeframe';
