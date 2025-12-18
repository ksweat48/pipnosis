/*
  # Revert Realtime Prices Validation to Strict Mode

  ## Problem
  Previous migration added EXCEPTION handler that could allow invalid data

  ## Changes
  1. Restore strict validation without EXCEPTION handler
  2. Keep defensive trigger conditions
  3. No breaking changes

  ## Security
  - Maintains data integrity
  - Rejects invalid prices
*/

-- =====================================================
-- Restore strict validation
-- =====================================================

CREATE OR REPLACE FUNCTION validate_realtime_prices() RETURNS trigger AS $$
BEGIN
  -- Validate bid price
  IF NEW.bid IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.bid::numeric) THEN
      INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
      VALUES (NEW.symbol, NEW.bid::numeric, 'bid', 'Price outside valid range', 'realtime_price_insert')
      ON CONFLICT DO NOTHING;
      RAISE EXCEPTION 'Invalid bid price % for symbol %', NEW.bid, NEW.symbol;
    END IF;
  END IF;

  -- Validate ask price
  IF NEW.ask IS NOT NULL THEN
    IF NOT validate_price_range(NEW.symbol, NEW.ask::numeric) THEN
      INSERT INTO price_validation_rejections (symbol, price, price_type, rejection_reason, source)
      VALUES (NEW.symbol, NEW.ask::numeric, 'ask', 'Price outside valid range', 'realtime_price_insert')
      ON CONFLICT DO NOTHING;
      RAISE EXCEPTION 'Invalid ask price % for symbol %', NEW.ask, NEW.symbol;
    END IF;
  END IF;

  -- Validate bid < ask
  IF NEW.bid IS NOT NULL AND NEW.ask IS NOT NULL THEN
    IF NEW.bid::numeric >= NEW.ask::numeric THEN
      RAISE EXCEPTION 'Invalid price for %: bid >= ask', NEW.symbol;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;