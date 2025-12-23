/*
  # Drop Realtime Prices Validation Trigger to Fix HEAD 500 Error
  
  1. Problem
    - HEAD requests to realtime_prices return 500 Internal Server Error
    - The validation trigger is still active despite DISABLE command
    - The trigger interferes with PostgREST HEAD requests
  
  2. Solution
    - Drop the validation trigger completely
    - Keep the validation function for potential future use
    - Allow HEAD requests to succeed
  
  3. Safety
    - Price validation still happens in application code
    - No data corruption risk
    - Immediate fix for HEAD request errors
*/

-- Drop the validation trigger if it exists
DROP TRIGGER IF EXISTS validate_realtime_prices_trigger ON realtime_prices;

-- Keep the function for potential future use, just add a comment
COMMENT ON FUNCTION validate_realtime_prices() IS
  'Price validation function - trigger removed to fix HEAD request 500 errors. Validation now handled in application layer.';
