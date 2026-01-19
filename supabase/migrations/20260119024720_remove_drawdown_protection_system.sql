/*
  # Remove Drawdown Protection System

  1. Changes
    - Drop `drawdown_protection_log` table - No longer needed as drawdown protection removed
    - Drop `critical_risk_events` table - No longer needed as drawdown protection removed

  2. Reason
    - Drawdown protection was causing platform-wide trading blocks
    - Users should always be able to trade without balance-based restrictions
    - Risk management is now handled through other mechanisms (Kelly, EV, volatility, etc.)
*/

-- Drop drawdown protection log table
DROP TABLE IF EXISTS drawdown_protection_log CASCADE;

-- Drop critical risk events table
DROP TABLE IF EXISTS critical_risk_events CASCADE;
