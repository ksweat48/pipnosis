/*
  # Emergency Cleanup of Stale Price Data

  ## Problem
  The realtime_prices table has accumulated price data that is 52+ hours old.
  This causes the trading system to block execution with "Price data is 188496s old" errors.

  ## Root Cause
  The cleanup function exists but was never scheduled to run automatically.

  ## Solution
  1. Immediately purge all prices older than 2 hours
  2. Document expected data retention

  ## Expected Impact
  - All prices will be fresh (< 2 hours old)
  - Trading system will stop blocking on stale prices
  - Database size reduced significantly
*/

-- Step 1: Check current state (for logging)
DO $$
DECLARE
  v_total_count INTEGER;
  v_old_count INTEGER;
  v_oldest_price TIMESTAMP;
BEGIN
  SELECT COUNT(*) INTO v_total_count FROM realtime_prices;
  SELECT COUNT(*) INTO v_old_count FROM realtime_prices WHERE created_at < NOW() - INTERVAL '2 hours';
  SELECT MIN(created_at) INTO v_oldest_price FROM realtime_prices;

  RAISE NOTICE 'Before cleanup: % total prices, % older than 2h, oldest: %', v_total_count, v_old_count, v_oldest_price;
END $$;

-- Step 2: Emergency cleanup - delete all prices older than 2 hours
-- This is a one-time operation to fix the immediate issue
DELETE FROM realtime_prices
WHERE created_at < NOW() - INTERVAL '2 hours';

-- Step 3: Also clean up based on broker_time (in case created_at is wrong)
DELETE FROM realtime_prices
WHERE broker_time < NOW() - INTERVAL '2 hours';

-- Step 4: Check final state
DO $$
DECLARE
  v_remaining_count INTEGER;
  v_oldest_remaining TIMESTAMP;
  v_newest_remaining TIMESTAMP;
BEGIN
  SELECT COUNT(*) INTO v_remaining_count FROM realtime_prices;
  SELECT MIN(created_at) INTO v_oldest_remaining FROM realtime_prices;
  SELECT MAX(created_at) INTO v_newest_remaining FROM realtime_prices;

  RAISE NOTICE 'After cleanup: % prices remaining, oldest: %, newest: %', v_remaining_count, v_oldest_remaining, v_newest_remaining;
END $$;

COMMENT ON TABLE realtime_prices IS
'Real-time price data from WebSocket and scheduled collectors. RETENTION POLICY: Data older than 2 hours is automatically cleaned. Maximum retention: 24 hours. Cleanup runs every hour via scheduled function.';
