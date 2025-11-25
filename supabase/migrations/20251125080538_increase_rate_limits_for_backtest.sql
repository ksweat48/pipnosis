/*
  # Increase Rate Limits for Backtest Mode

  ## Overview
  Increases OpenAI API rate limits to support backtesting workloads.
  Backtesting requires 3-5 LLM calls per candle, and with 120 candles
  per backtest, we need much higher limits than the default 100/hour.

  ## Changes
  - Increase default hourly limit: 100 → 2000
  - Increase default daily limit: 500 → 10000
  - Existing users will be updated to new limits
  - Admin limits remain higher for monitoring

  ## Why These Numbers?
  - 120 candles × 5 calls = 600 calls per backtest
  - 2000/hour allows ~3 backtests per hour
  - 10000/day allows ~16 backtests per day
  - Prevents rate limit errors during normal backtest operations

  ## Security
  - Limits can still be adjusted per user if needed
  - Block functionality remains available for abuse prevention
  - Cost tracking continues to monitor actual usage
*/

-- Update default limits in the table definition
ALTER TABLE openai_rate_limits
  ALTER COLUMN hourly_limit SET DEFAULT 2000,
  ALTER COLUMN daily_limit SET DEFAULT 10000;

-- Update existing users to new limits
UPDATE openai_rate_limits
SET
  hourly_limit = 2000,
  daily_limit = 10000,
  updated_at = now()
WHERE hourly_limit = 100 AND daily_limit = 500;

-- Log the update
DO $$
BEGIN
  RAISE NOTICE 'Rate limits increased: 100/hour → 2000/hour, 500/day → 10000/day';
  RAISE NOTICE 'Existing users updated to new limits';
END $$;
