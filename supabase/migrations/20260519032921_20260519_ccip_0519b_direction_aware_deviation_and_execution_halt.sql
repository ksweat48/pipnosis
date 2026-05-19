/*
  # CCIP-2026-0519B: Direction-Aware Deviation Gate & Execution Failure Halt

  1. Changes
    - Persists doctrine row for CCIP-2026-0519B in alpha_engineering_doctrine
    - Documents: PRE_EXECUTION_DEVIATION is now direction-aware (only blocks unfavorable drift)
    - Documents: Session halts permanently on execution failure (no infinite re-scan loops)
    - Documents: Alpha receives prompt guidance for max_entry_deviation_pips calibration

  2. Rationale
    - A XAUUSD SELL was incorrectly blocked because price moved 2.5 pips DOWN (favorable
      for a SELL = better fill price). The old gate used Math.abs() treating ALL drift as bad.
    - Alpha set max_entry_deviation_pips=2 for gold (absurdly tight) because no prompt
      guidance existed for this field.
    - When execution failed, the session re-scanned every 60s forever, burning API costs
      with no circuit breaker.

  3. Fixes Applied (code-level, documented here for audit)
    - alpha-trade-executor.ts: Deviation check now direction-aware. BUY: only blocks if
      price ROSE (worse fill). SELL: only blocks if price FELL (worse fill).
    - alpha-identity.ts: Added calibration guidance for max_entry_deviation_pips per asset class.
    - goal-session-live-engine.ts: Session halts immediately on execution failure. No re-scan.
      consecutiveExecutionFailures counter tracks failures across sessions for diagnostics.

  4. Security
    - No table changes, no RLS changes
    - Doctrine row inserted as kind='power_up' (active doctrine unique index limitation)
*/

INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  kind,
  active,
  ratified_at,
  doctrine_text,
  power_up_name
) VALUES (
  'CCIP-2026-0519B-DIRECTION-AWARE-DEVIATION-HALT',
  'power_up',
  true,
  now(),
  'CCIP-2026-0519B: Direction-Aware Deviation Gate & Execution Failure Halt. ' ||
  '(1) PRE_EXECUTION_DEVIATION is direction-aware: only blocks UNFAVORABLE drift (price moving against trade direction). ' ||
  'For BUY, unfavorable = price rose (paying more). For SELL, unfavorable = price fell (selling cheaper). ' ||
  'Favorable drift (better fill) is NEVER blocked regardless of magnitude. ' ||
  '(2) Alpha receives prompt guidance for max_entry_deviation_pips: metals 5-15p, crypto 20-80p, indices 10-30p, forex 3-8p. ' ||
  'Calibration rule: 0.3-0.5x M5 ATR. No hard minimum floors — Alpha is the authority. ' ||
  '(3) Session halts permanently on first execution failure. No re-scan loop. ' ||
  'consecutiveExecutionFailures counter as safety net (max 3 before hard halt). ' ||
  'Rationale: infinite re-scan on systematic execution failure burns API costs with zero chance of success.',
  'direction_aware_deviation_halt'
);
