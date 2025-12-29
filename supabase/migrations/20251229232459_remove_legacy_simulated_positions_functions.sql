/*
  # Remove Legacy Simulated Positions Functions

  ## Problem
  - Three functions reference non-existent `simulated_positions` table
  - These are from an old demo trading system that's been replaced
  - Functions: close_simulated_position_secure, update_simulated_position_secure, user_owns_position

  ## Solution
  - Drop all three functions that reference the obsolete table
*/

-- Drop legacy simulated positions functions
DROP FUNCTION IF EXISTS close_simulated_position_secure(uuid, numeric, text);
DROP FUNCTION IF EXISTS update_simulated_position_secure(uuid, numeric, numeric);
DROP FUNCTION IF EXISTS user_owns_position(uuid);
