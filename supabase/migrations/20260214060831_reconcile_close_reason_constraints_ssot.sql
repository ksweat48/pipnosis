/*
  # Reconcile Close Reason Constraints - SSOT Compliance

  ## Problem
  Two overlapping CHECK constraints on `goal_session_trades.close_reason` with
  inconsistent allowed values. Both constraints must pass for any update, creating
  a silent rejection of legitimate close reasons:
  
  - `goal_session_trades_close_reason_check`: includes 'market_closed', 'weekend_protection', 'holiday_closure'
  - `valid_close_reason`: does NOT include those values, but includes 'goal_met', 'weekend_shutdown', 'force_close'
  
  This means 'market_closed' and 'weekend_protection' writes would be rejected by the database,
  breaking both the weekend-protection-service and the new market-close auto-closure system.

  ## Fix
  Drop BOTH constraints and replace with a SINGLE authoritative constraint containing
  the union of all legitimate close reason values.

  ## Changes
  1. Drop `valid_close_reason` constraint
  2. Drop `goal_session_trades_close_reason_check` constraint
  3. Create single `close_reason_ssot` constraint with ALL valid values
  
  ## CCIP Governance
  - Authority: goal_session_trades.close_reason column
  - Single constraint replaces two conflicting ones
  - All existing close reasons preserved (no data loss)
  - New values aligned with RPC function internal validation
*/

-- Step 1: Drop the conflicting constraints
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS valid_close_reason;
ALTER TABLE goal_session_trades DROP CONSTRAINT IF EXISTS goal_session_trades_close_reason_check;

-- Step 2: Create single authoritative constraint with union of all values
ALTER TABLE goal_session_trades ADD CONSTRAINT close_reason_ssot CHECK (
  close_reason = ANY (ARRAY[
    'manual',
    'stop_loss',
    'take_profit',
    'take_profit_1',
    'take_profit_2',
    'goal_achieved',
    'goal_expired',
    'goal_met',
    'session_ended',
    'timeout',
    'risk_limit',
    'trailing_stop',
    'safety_net',
    'user_stopped',
    'breakeven',
    'alpha_override',
    'ai_decision',
    'weekend_protection',
    'weekend_shutdown',
    'holiday_closure',
    'market_closed',
    'force_close',
    'force_closed'
  ]::text[])
);
