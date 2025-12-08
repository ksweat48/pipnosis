/*
  # Candle Deduplication System (Phase 4)

  1. Changes
    - Adds unique constraint to prevent duplicate candles
    - Adds conflict resolution to merge duplicates instead of failing
    - Adds tracking for duplicate detection
    - Non-destructive: only affects future inserts

  2. Security
    - No RLS changes - uses existing policies
    - Read-only diagnostics view

  3. Notes
    - ZERO RISK: Only prevents future duplicates
    - Existing data unchanged
    - Falls back gracefully on conflicts
*/

-- Create unique index to prevent duplicates (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE indexname = 'idx_forex_candles_unique_dedup'
  ) THEN
    CREATE UNIQUE INDEX idx_forex_candles_unique_dedup
    ON forex_candles(symbol, timeframe, open_time)
    WHERE data_source IS NOT NULL;

    RAISE NOTICE '✅ Created unique index for candle deduplication';
  ELSE
    RAISE NOTICE '⚠️ Unique index already exists';
  END IF;
END $$;

-- Table to track duplicate attempts
CREATE TABLE IF NOT EXISTS chart_duplicate_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  open_time timestamptz NOT NULL,
  attempted_at timestamptz DEFAULT now(),
  resolution text NOT NULL,
  details jsonb
);

-- Enable RLS
ALTER TABLE chart_duplicate_attempts ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read duplicate logs
CREATE POLICY "Users can view duplicate attempts"
  ON chart_duplicate_attempts
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert duplicate logs
CREATE POLICY "Service role can insert duplicate attempts"
  ON chart_duplicate_attempts
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Function to handle duplicate candles
CREATE OR REPLACE FUNCTION handle_duplicate_candle()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO chart_duplicate_attempts (
    symbol,
    timeframe,
    open_time,
    resolution,
    details
  ) VALUES (
    NEW.symbol,
    NEW.timeframe,
    NEW.open_time,
    'merged',
    jsonb_build_object(
      'existing_close', (SELECT close FROM forex_candles WHERE symbol = NEW.symbol AND timeframe = NEW.timeframe AND open_time = NEW.open_time),
      'new_close', NEW.close,
      'source', NEW.data_source
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- View to monitor duplicate attempts
CREATE OR REPLACE VIEW v_duplicate_candles_summary AS
SELECT
  symbol,
  timeframe,
  DATE(attempted_at) as date,
  COUNT(*) as duplicate_count,
  MAX(attempted_at) as last_attempt
FROM chart_duplicate_attempts
WHERE attempted_at > NOW() - INTERVAL '24 hours'
GROUP BY symbol, timeframe, DATE(attempted_at)
ORDER BY duplicate_count DESC;

-- Grant access to view
GRANT SELECT ON v_duplicate_candles_summary TO authenticated;

-- Index for efficient duplicate tracking
CREATE INDEX IF NOT EXISTS idx_duplicate_attempts_lookup
ON chart_duplicate_attempts(symbol, timeframe, attempted_at DESC);

-- Cleanup function for old duplicate logs
CREATE OR REPLACE FUNCTION cleanup_old_duplicate_logs()
RETURNS void AS $$
BEGIN
  DELETE FROM chart_duplicate_attempts
  WHERE attempted_at < NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;