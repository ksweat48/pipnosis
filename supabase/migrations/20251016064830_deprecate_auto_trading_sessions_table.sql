/*
  # Deprecate auto_trading_sessions table
  
  1. Changes
    - Add comment to auto_trading_sessions table marking it as deprecated
    - The table is kept for backwards compatibility with existing hooks and components
    - All new auto-trading functionality should use auto_trading_status table instead
    
  2. Notes
    - The autoTradingController system has been removed
    - All auto-trading now uses autoTradingScanner and auto_trading_status table
    - This table may be removed in a future migration after all references are updated
*/

COMMENT ON TABLE auto_trading_sessions IS 'DEPRECATED: Use auto_trading_status table instead. This table is kept for backwards compatibility with useAutoTradingStatus hook.';