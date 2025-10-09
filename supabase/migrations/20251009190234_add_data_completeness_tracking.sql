/*
  # Add Data Completeness Tracking

  ## Overview
  This migration adds tracking for data completeness across all symbol-timeframe combinations.
  This enables the system to validate data health before displaying charts and triggers automatic
  gap-filling when incomplete data is detected.

  ## 1. New Tables

  ### `market_data_completeness`
  Tracks data completeness metrics for each symbol-timeframe combination
  - `id` (uuid, primary key) - Unique identifier
  - `symbol` (text, required) - Trading pair (e.g., EURUSD, GBPUSD, XAUUSD)
  - `timeframe` (text, required) - Candle interval (M1, M5, M15, M30, H1, H4, D1, W1, MN1)
  - `total_candles` (integer) - Total number of candles stored
  - `date_range_start` (timestamptz) - Earliest candle timestamp
  - `date_range_end` (timestamptz) - Latest candle timestamp
  - `gaps_detected` (integer) - Number of gaps currently detected
  - `completeness_percentage` (numeric) - Calculated completeness (0-100)
  - `last_validated` (timestamptz) - Last time data was validated
  - `last_backfill` (timestamptz) - Last time gaps were filled
  - `backfill_status` (text) - Current backfill status (complete, in_progress, pending, error)
  - `created_at` (timestamptz) - Record creation time
  - `updated_at` (timestamptz) - Last update time

  ## 2. Indexes
  - Unique composite index on (symbol, timeframe) for fast lookups
  - Index on last_validated for monitoring queries
  - Index on backfill_status for queue management

  ## 3. Security
  - Enable RLS on market_data_completeness table
  - Public read access (completeness metrics are useful for all users)
  - Insert/update restricted to authenticated users (service operations)

  ## 4. Functions
  - Function to calculate expected candle count for a date range
  - Function to update completeness percentage automatically
*/

-- Create market_data_completeness table
CREATE TABLE IF NOT EXISTS market_data_completeness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  timeframe text NOT NULL,
  total_candles integer DEFAULT 0,
  date_range_start timestamptz,
  date_range_end timestamptz,
  gaps_detected integer DEFAULT 0,
  completeness_percentage numeric(5, 2) DEFAULT 0,
  last_validated timestamptz DEFAULT now(),
  last_backfill timestamptz,
  backfill_status text DEFAULT 'pending',
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(symbol, timeframe)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_completeness_symbol_timeframe
  ON market_data_completeness(symbol, timeframe);

CREATE INDEX IF NOT EXISTS idx_completeness_last_validated
  ON market_data_completeness(last_validated DESC);

CREATE INDEX IF NOT EXISTS idx_completeness_backfill_status
  ON market_data_completeness(backfill_status);

CREATE INDEX IF NOT EXISTS idx_completeness_gaps
  ON market_data_completeness(gaps_detected) WHERE gaps_detected > 0;

-- Enable RLS
ALTER TABLE market_data_completeness ENABLE ROW LEVEL SECURITY;

-- Anyone can read completeness data
CREATE POLICY "Anyone can read completeness data"
  ON market_data_completeness FOR SELECT
  TO anon, authenticated
  USING (true);

-- Authenticated users can insert/update completeness data
CREATE POLICY "Authenticated users can insert completeness data"
  ON market_data_completeness FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update completeness data"
  ON market_data_completeness FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Function to calculate expected candle count
CREATE OR REPLACE FUNCTION calculate_expected_candles(
  p_timeframe text,
  p_start_date timestamptz,
  p_end_date timestamptz
) RETURNS integer AS $$
DECLARE
  timeframe_minutes integer;
  total_minutes bigint;
  trading_days_ratio numeric := 5.0 / 7.0;
  trading_hours_ratio numeric := 1.0;
BEGIN
  timeframe_minutes := CASE p_timeframe
    WHEN 'M1' THEN 1
    WHEN 'M5' THEN 5
    WHEN 'M15' THEN 15
    WHEN 'M30' THEN 30
    WHEN 'H1' THEN 60
    WHEN 'H4' THEN 240
    WHEN 'D1' THEN 1440
    WHEN 'W1' THEN 10080
    WHEN 'MN1' THEN 43200
    ELSE 15
  END;

  total_minutes := EXTRACT(EPOCH FROM (p_end_date - p_start_date)) / 60;

  RETURN FLOOR((total_minutes / timeframe_minutes) * trading_days_ratio * trading_hours_ratio);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to update completeness percentage
CREATE OR REPLACE FUNCTION update_completeness_percentage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.date_range_start IS NOT NULL AND NEW.date_range_end IS NOT NULL THEN
    DECLARE
      expected_candles integer;
    BEGIN
      expected_candles := calculate_expected_candles(
        NEW.timeframe,
        NEW.date_range_start,
        NEW.date_range_end
      );

      IF expected_candles > 0 THEN
        NEW.completeness_percentage := LEAST(100, (NEW.total_candles::numeric / expected_candles::numeric) * 100);
      ELSE
        NEW.completeness_percentage := 0;
      END IF;
    END;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update completeness percentage
DROP TRIGGER IF EXISTS update_completeness_trigger ON market_data_completeness;
CREATE TRIGGER update_completeness_trigger
  BEFORE INSERT OR UPDATE ON market_data_completeness
  FOR EACH ROW
  EXECUTE FUNCTION update_completeness_percentage();

-- Function to get data health summary
CREATE OR REPLACE FUNCTION get_data_health_summary()
RETURNS TABLE (
  symbol text,
  timeframe text,
  completeness_percentage numeric,
  gaps_detected integer,
  last_validated timestamptz,
  backfill_status text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.symbol,
    c.timeframe,
    c.completeness_percentage,
    c.gaps_detected,
    c.last_validated,
    c.backfill_status
  FROM market_data_completeness c
  ORDER BY c.symbol, c.timeframe;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
