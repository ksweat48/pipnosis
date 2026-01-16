/*
  # Add TP1/TP2 Close Reasons
  
  ## Changes
  Update the close_reason check constraint to support new dual TP system:
  - Add 'take_profit_1' for partial TP
  - Add 'take_profit_2' for final TP
  
  This allows the trigger to properly track which TP level closed the trade.
*/

-- Drop existing constraint
ALTER TABLE goal_session_trades 
DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

-- Add new constraint with TP1/TP2 support
ALTER TABLE goal_session_trades
ADD CONSTRAINT goal_session_trades_close_reason_check
CHECK (close_reason = ANY (ARRAY[
  'manual'::text,
  'stop_loss'::text,
  'take_profit'::text,
  'take_profit_1'::text,  -- NEW: Partial TP hit
  'take_profit_2'::text,  -- NEW: Final TP hit
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
  'ai_decision'::text
]));
