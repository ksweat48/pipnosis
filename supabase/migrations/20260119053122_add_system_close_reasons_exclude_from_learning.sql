/*
  # Add System Close Reasons and Exclude from Alpha Learning
  
  ## Overview
  This migration adds system-caused close reasons (weekend_protection, holiday_closure, etc.)
  that should NOT affect Alpha's learning or confidence calibration.
  
  ## Changes
  
  1. **Database Schema Updates**
     - Add 'weekend_protection' to close_reason constraint
     - Add 'holiday_closure' to close_reason constraint
     - Add 'force_closed' to close_reason constraint
     - Add 'market_closed' to close_reason constraint
  
  2. **Rationale**
     - Trades closed due to market closure are NOT Alpha's fault
     - These closures should not penalize Alpha's confidence
     - These closures should not be used in learning systems
     - Alpha's performance should only reflect trading decisions, not system requirements
  
  ## System Close Reasons
  - `weekend_protection`: Trade closed automatically for weekend
  - `holiday_closure`: Trade closed automatically for holiday
  - `force_closed`: Trade force-closed by system/admin
  - `market_closed`: Trade closed due to market hours
*/

-- Drop existing constraint
ALTER TABLE goal_session_trades 
DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

-- Add new constraint with system close reasons
ALTER TABLE goal_session_trades
ADD CONSTRAINT goal_session_trades_close_reason_check
CHECK (close_reason = ANY (ARRAY[
  'manual'::text,
  'stop_loss'::text,
  'take_profit'::text,
  'take_profit_1'::text,
  'take_profit_2'::text,
  'goal_achieved'::text,
  'goal_expired'::text,
  'session_ended'::text,
  'risk_limit'::text,
  'trailing_stop'::text,
  'timeout'::text,
  'safety_net'::text,
  'user_stopped'::text,
  'breakeven'::text,
  'alpha_override'::text,
  'ai_decision'::text,
  -- NEW: System-caused closures (should NOT affect Alpha learning)
  'weekend_protection'::text,
  'holiday_closure'::text,
  'force_closed'::text,
  'market_closed'::text
]));

-- Add comment explaining system close reasons
COMMENT ON CONSTRAINT goal_session_trades_close_reason_check ON goal_session_trades IS 
'Close reason constraint. System close reasons (weekend_protection, holiday_closure, force_closed, market_closed) should be excluded from Alpha learning and confidence calibration as they are not Alpha''s fault.';
