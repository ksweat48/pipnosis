/*
  # Add take_profit_1 and take_profit_2 to Close Reason Constraint

  ## Overview
  This migration updates the close_reason constraint to include 'take_profit_1' and 'take_profit_2'
  as valid close reasons. These are used by the dual TP system where:
  - take_profit_1 = Conservative high-probability target (TP1)
  - take_profit_2 = Full profit target (TP2)

  ## Learning System Impact
  Both TP1 and TP2 are MILESTONE closes - they represent fully executed trades
  and SHOULD be included in Alpha's learning systems.

  ## Changes
  1. Drop existing close_reason constraint
  2. Add new constraint including take_profit_1 and take_profit_2
  3. Update constraint comment to document milestone vs system closures

  ## Safety
  - Uses IF EXISTS to prevent errors
  - Maintains backward compatibility with existing close reasons
  - No data changes - only constraint update
*/

-- Drop existing constraint
ALTER TABLE goal_session_trades
DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

-- Add new constraint with take_profit_1 and take_profit_2
ALTER TABLE goal_session_trades
ADD CONSTRAINT goal_session_trades_close_reason_check
CHECK (close_reason = ANY (ARRAY[
  -- Manual and goal-based closures
  'manual'::text,
  'goal_achieved'::text,
  'goal_expired'::text,

  -- Milestone closures (INCLUDED in Alpha learning)
  'stop_loss'::text,
  'take_profit'::text,
  'take_profit_1'::text,
  'take_profit_2'::text,
  'trailing_stop'::text,

  -- Session/time-based closures
  'session_ended'::text,
  'timeout'::text,
  'risk_limit'::text,

  -- System closures (EXCLUDED from Alpha learning)
  'weekend_protection'::text,
  'holiday_closure'::text,
  'force_closed'::text,
  'market_closed'::text,

  -- Legacy/other closures
  'safety_net'::text,
  'user_stopped'::text,
  'breakeven'::text,
  'alpha_override'::text,
  'ai_decision'::text
]));

-- Update constraint comment with learning rules
COMMENT ON CONSTRAINT goal_session_trades_close_reason_check ON goal_session_trades IS
'Close reason constraint with learning eligibility rules:

MILESTONE CLOSURES (included in learning):
- stop_loss, take_profit, take_profit_1, take_profit_2, trailing_stop
- These represent fully executed trades where Alpha''s decision reached a natural conclusion

SYSTEM CLOSURES (excluded from learning):
- weekend_protection, holiday_closure, force_closed, market_closed
- These are external factors, NOT Alpha''s trading decisions

MANUAL CLOSURES (conditional inclusion):
- manual: Only included in learning if trade reached a milestone first (TP1, TP2, SL)
- If closed before any milestone = excluded (user impatience, not Alpha''s fault)

This ensures Alpha only learns from complete trade outcomes, not premature interventions.';

-- Create index for learning eligibility queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_goal_session_trades_learning_eligibility
  ON goal_session_trades(close_reason, status, tp1_hit, tp2_hit)
  WHERE status = 'closed';

COMMENT ON INDEX idx_goal_session_trades_learning_eligibility IS
'Optimizes queries for learning system that filters trades by close reason and milestone status';
