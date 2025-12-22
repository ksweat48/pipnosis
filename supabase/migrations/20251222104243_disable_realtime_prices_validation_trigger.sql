/*
  # Disable Realtime Prices Validation Trigger to Fix HEAD 500 Error

  1. Problem
    HEAD requests to realtime_prices return 500 Internal Server Error
    The validation trigger may be interfering with PostgREST HEAD requests

  2. Solution
    Temporarily disable the validation trigger to diagnose if it's the cause

  3. Safety
    - Only disabling trigger, not dropping it
    - Can be re-enabled easily
    - No data loss
*/

-- Disable the validation trigger
ALTER TABLE realtime_prices
  DISABLE TRIGGER validate_realtime_prices_trigger;

COMMENT ON TRIGGER validate_realtime_prices_trigger ON realtime_prices IS
  'DISABLED: Validation trigger temporarily disabled to fix HEAD request 500 errors';
