/*
  # Fix Close Reason Constraint Conflicts

  ## Problem
  The goal_session_trades table has TWO conflicting check constraints on close_reason:
  1. `goal_session_trades_close_reason_check` - Allows: manual, stop_loss, take_profit, goal_achieved, goal_expired, ai_decision
  2. `valid_close_reason` - Allows: timeout, safety_net, user_stopped, manual, goal_achieved, stop_loss, take_profit, breakeven, alpha_override
  
  The close_goal_session_trade() function uses values like 'session_ended', 'risk_limit', 'trailing_stop' 
  which are NOT in EITHER constraint, causing database errors.

  ## Solution
  1. Drop both conflicting constraints
  2. Create one unified constraint with ALL valid close_reason values
  3. Include all values used by functions and application code

  ## Valid Close Reasons
  - manual: User manually closed the trade
  - stop_loss: Trade hit stop loss
  - take_profit: Trade hit take profit
  - goal_achieved: Goal was achieved
  - goal_expired: Session time expired
  - session_ended: Session was ended
  - risk_limit: Risk limit exceeded
  - trailing_stop: Trailing stop triggered
  - timeout: Session timeout
  - safety_net: Safety net triggered
  - user_stopped: User stopped trading
  - breakeven: Trade closed at breakeven
  - alpha_override: Alpha brain override
  - ai_decision: AI decided to close
*/

-- Drop conflicting constraints
ALTER TABLE goal_session_trades 
  DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

ALTER TABLE goal_session_trades 
  DROP CONSTRAINT IF EXISTS valid_close_reason;

-- Create unified constraint with ALL valid values
ALTER TABLE goal_session_trades 
  ADD CONSTRAINT goal_session_trades_close_reason_check 
  CHECK (close_reason IN (
    'manual',
    'stop_loss',
    'take_profit',
    'goal_achieved',
    'goal_expired',
    'session_ended',
    'risk_limit',
    'trailing_stop',
    'timeout',
    'safety_net',
    'user_stopped',
    'breakeven',
    'alpha_override',
    'ai_decision'
  ));
