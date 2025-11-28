/*
  # Nuclear Data Reset & Price Validation System

  1. Data Cleanup
    - Truncate forex_candles table (removes all historical candles)
    - Truncate realtime_prices table (removes all live price data)
    - Clear any price-related caches

  2. Price Validation
    - Add check constraints to validate price ranges per symbol
    - Add trigger to log rejected inserts
    - Create validation function for symbol-price combinations

  3. Monitoring
    - Create table to track validation rejections
    - Add indexes for performance

  CRITICAL: This migration will DELETE ALL CANDLE AND PRICE DATA
*/

-- ============================================================================
-- STEP 1: DATA CLEANUP (NUCLEAR RESET)
-- ============================================================================

-- Truncate all price and candle data
TRUNCATE TABLE forex_candles RESTART IDENTITY CASCADE;
TRUNCATE TABLE realtime_prices RESTART IDENTITY CASCADE;

-- Clear any aggregation state if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'candle_aggregation_state') THEN
    TRUNCATE TABLE candle_aggregation_state RESTART IDENTITY CASCADE;
  END IF;
END $$;

-- Clear tick buffer if exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tick_buffer') THEN
    TRUNCATE TABLE tick_buffer RESTART IDENTITY CASCADE;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: PRICE VALIDATION INFRASTRUCTURE
-- ============================================================================

-- Create table to track price validation rejections
CREATE TABLE IF NOT EXISTS price_validation_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  price numeric NOT NULL,
  price_type text NOT NULL,
  expected_min numeric,
  expected_max numeric,
  rejection_reason text NOT NULL,
  suspected_symbol text,
  source text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_price_validation_rejections_symbol_time
  ON price_validation_rejections(symbol, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_price_validation_rejections_suspected
  ON price_validation_rejections(suspected_symbol)
  WHERE suspected_symbol IS NOT NULL;

-- Enable RLS
ALTER TABLE price_validation_rejections ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view price validation rejections" ON price_validation_rejections;
DROP POLICY IF EXISTS "Service role can insert rejections" ON price_validation_rejections;

-- Create policies
CREATE POLICY "Users can view price validation rejections"
  ON price_validation_rejections FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can insert rejections"
  ON price_validation_rejections FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ============================================================================
-- STEP 3: VALIDATION FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_price_range(
  p_symbol text,
  p_price numeric
) RETURNS boolean AS $$
DECLARE
  v_min numeric;
  v_max numeric;
BEGIN
  CASE p_symbol
    WHEN 'EURUSD' THEN v_min := 0.50; v_max := 2.00;
    WHEN 'GBPUSD' THEN v_min := 0.50; v_max := 3.00;
    WHEN 'USDJPY' THEN v_min := 50; v_max := 200;
    WHEN 'AUDUSD' THEN v_min := 0.40; v_max := 1.50;
    WHEN 'USDCAD' THEN v_min := 0.80; v_max := 2.00;
    WHEN 'NZDUSD' THEN v_min := 0.40; v_max := 1.50;
    WHEN 'USDCHF' THEN v_min := 0.60; v_max := 1.50;
    WHEN 'EURGBP' THEN v_min := 0.60; v_max := 1.20;
    WHEN 'EURJPY' THEN v_min := 80; v_max := 220;
    WHEN 'GBPJPY' THEN v_min := 100; v_max := 250;
    WHEN 'AUDJPY' THEN v_min := 50; v_max := 150;
    WHEN 'EURAUD' THEN v_min := 1.00; v_max := 2.00;
    WHEN 'XAUUSD' THEN v_min := 1000; v_max := 10000;
    WHEN 'XAGUSD' THEN v_min := 10; v_max := 100;
    WHEN 'XPTUSD' THEN v_min := 500; v_max := 2000;
    WHEN 'XPDUSD' THEN v_min := 500; v_max := 3500;
    WHEN 'US30' THEN v_min := 10000; v_max := 60000;
    WHEN 'NAS100' THEN v_min := 5000; v_max := 25000;
    WHEN 'SPX500' THEN v_min := 2000; v_max := 7000;
    WHEN 'UK100' THEN v_min := 4000; v_max := 10000;
    WHEN 'GER40' THEN v_min := 8000; v_max := 20000;
    WHEN 'BTCUSD' THEN v_min := 10000; v_max := 150000;
    WHEN 'ETHUSD' THEN v_min := 500; v_max := 10000;
    WHEN 'USOIL' THEN v_min := 20; v_max := 200;
    WHEN 'UKOIL' THEN v_min := 20; v_max := 200;
    ELSE
      RETURN true;
  END CASE;

  IF p_price < v_min OR p_price > v_max THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- STEP 4: VALIDATION TRIGGER FOR FOREX_CANDLES
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_candle_prices() RETURNS trigger AS $$
BEGIN
  IF NOT validate_price_range(NEW.symbol, NEW.open) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.open, 'open', 'Price outside valid range', 'database_insert');
    RAISE EXCEPTION 'Invalid open price % for symbol %', NEW.open, NEW.symbol;
  END IF;

  IF NOT validate_price_range(NEW.symbol, NEW.high) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.high, 'high', 'Price outside valid range', 'database_insert');
    RAISE EXCEPTION 'Invalid high price % for symbol %', NEW.high, NEW.symbol;
  END IF;

  IF NOT validate_price_range(NEW.symbol, NEW.low) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.low, 'low', 'Price outside valid range', 'database_insert');
    RAISE EXCEPTION 'Invalid low price % for symbol %', NEW.low, NEW.symbol;
  END IF;

  IF NOT validate_price_range(NEW.symbol, NEW.close) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.close, 'close', 'Price outside valid range', 'database_insert');
    RAISE EXCEPTION 'Invalid close price % for symbol %', NEW.close, NEW.symbol;
  END IF;

  IF NEW.high < NEW.low THEN
    RAISE EXCEPTION 'Invalid candle for %: high < low', NEW.symbol;
  END IF;

  IF NEW.open < NEW.low OR NEW.open > NEW.high THEN
    RAISE EXCEPTION 'Invalid candle for %: open outside range', NEW.symbol;
  END IF;

  IF NEW.close < NEW.low OR NEW.close > NEW.high THEN
    RAISE EXCEPTION 'Invalid candle for %: close outside range', NEW.symbol;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_candle_prices_trigger ON forex_candles;

CREATE TRIGGER validate_candle_prices_trigger
  BEFORE INSERT OR UPDATE ON forex_candles
  FOR EACH ROW
  EXECUTE FUNCTION validate_candle_prices();

-- ============================================================================
-- STEP 5: VALIDATION TRIGGER FOR REALTIME_PRICES
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
BEGIN
  IF NOT validate_price_range(NEW.symbol, NEW.bid::numeric) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert');
    RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
  END IF;

  IF NOT validate_price_range(NEW.symbol, NEW.ask::numeric) THEN
    INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
    VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert');
    RAISE EXCEPTION 'Invalid ask price % for symbol %', NEW.ask, NEW.symbol;
  END IF;

  IF NEW.bid::numeric >= NEW.ask::numeric THEN
    RAISE EXCEPTION 'Invalid price for %: bid >= ask', NEW.symbol;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS validate_realtime_prices_trigger ON realtime_prices;

CREATE TRIGGER validate_realtime_prices_trigger
  BEFORE INSERT OR UPDATE ON realtime_prices
  FOR EACH ROW
  EXECUTE FUNCTION validate_realtime_prices();

-- ============================================================================
-- STEP 6: HELPER VIEWS
-- ============================================================================

CREATE OR REPLACE VIEW recent_price_rejections AS
SELECT
  symbol,
  price,
  price_type,
  rejection_reason,
  suspected_symbol,
  source,
  created_at
FROM price_validation_rejections
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC;

CREATE OR REPLACE VIEW price_rejection_stats AS
SELECT
  symbol,
  COUNT(*) as rejection_count,
  COUNT(DISTINCT suspected_symbol) as suspected_symbols_count,
  array_agg(DISTINCT suspected_symbol) FILTER (WHERE suspected_symbol IS NOT NULL) as suspected_symbols,
  MIN(created_at) as first_rejection,
  MAX(created_at) as last_rejection
FROM price_validation_rejections
WHERE created_at > now() - interval '7 days'
GROUP BY symbol
ORDER BY rejection_count DESC;