/*
  # Add MONITOR_REQUIRED action to alpha_decisions

  ## Summary
  CCIP-2026-0429A: When Alpha identifies a deferred setup (wait_pullback or push_confirmation)
  but the user's Entry Monitor is offline, the result is now a first-class system state called
  MONITOR_REQUIRED rather than being silently discarded or force-executed at the wrong price.

  ## Changes
  - alpha_decisions.action constraint: adds 'MONITOR_REQUIRED' as a valid action value
  - This allows the live engine to write audit records for deferred setups that require
    the Entry Monitor to be active, which AlphaScanningFeed can then render as upgrade prompt cards.

  ## Notes
  - MONITOR_REQUIRED records are written by goal-session-live-engine when executionMode === 'MONITOR_REQUIRED'
  - They are rendered in AlphaScanningFeed alongside regular scan results
  - The action value is safe for the existing alpha_learning_tracker (it filters by BUY/SELL only)
*/

-- Drop and recreate the action constraint to include MONITOR_REQUIRED
ALTER TABLE alpha_decisions
  DROP CONSTRAINT IF EXISTS alpha_decisions_action_check;

ALTER TABLE alpha_decisions
  ADD CONSTRAINT alpha_decisions_action_check
  CHECK (action IN ('BUY', 'SELL', 'WAIT', 'NO_TRADE', 'MONITOR_REQUIRED'));
