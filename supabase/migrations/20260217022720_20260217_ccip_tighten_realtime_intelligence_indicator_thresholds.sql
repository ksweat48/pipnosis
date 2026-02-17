/*
  # CCIP Governance: Tighten Real-Time Intelligence Indicator Thresholds

  ## Problem
  All 8 indicator checks in the Real-Time Intelligence Calculator had overly loose thresholds,
  causing near-universal 100% confidence / 8-of-8 alignment across all pairs in any directional move.
  This made the intelligence panel unreliable for traders who depend on it for real signals.

  ## Fix (Code-Only - netlify/functions/_shared/realtime-intelligence-calculator.ts)
  1. VWAP: Strict side-of-VWAP (price must be on correct side, zero tolerance)
  2. EMA20: Strict side-of-EMA20 (removed wrong-side allowance)
  3. EMA50: Added EMA20/EMA50 cross confirmation for trend alignment
  4. RSI: Narrowed to 15-point windows (buy: 50-65, sell: 35-50)
  5. Volume: 20-candle baseline average, 3/5 directional with above-average volume, fails if <10 volume candles
  6. Pattern: Requires body >50% of candle range AND close beyond previous candle extreme
  7. Structure: Consecutive transition counting (3/4 higher highs + 2/4 higher lows for buy)
  8. Momentum: Tripled threshold to 0.3% + added short-term (3-candle) momentum confirmation

  ## Governance Tracking
  1. Modified Constraints
    - `valid_entity_type`: Added `realtime_intelligence_calculator`
    - `valid_operation`: Added `configuration_change`
  2. New Records
    - Governance audit entry documenting the threshold change

  ## SSOT Compliance
  - realtime-intelligence-calculator.ts remains sole authority for these thresholds
  - No duplicate threshold logic exists elsewhere
  - This panel is display-only and does NOT affect Alpha trading decisions
*/

-- Extend valid_entity_type to include realtime_intelligence_calculator
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_entity_type;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_entity_type CHECK (
    entity_type = ANY (ARRAY[
      'goal_sessions'::text,
      'goal_session_trades'::text,
      'entry_intents'::text,
      'user_profiles'::text,
      'pending_user_modals'::text,
      'trade_processing_lock'::text,
      'database_migration'::text,
      'system_configuration'::text,
      'club_token_balances'::text,
      'ai_trader_score'::text,
      'timeout_governance_config'::text,
      'alpha_coordinator'::text,
      'realtime_intelligence_calculator'::text
    ])
  );

-- Extend valid_operation to include configuration_change
ALTER TABLE governance_change_log
  DROP CONSTRAINT IF EXISTS valid_operation;

ALTER TABLE governance_change_log
  ADD CONSTRAINT valid_operation CHECK (
    operation = ANY (ARRAY[
      'status_transition'::text,
      'balance_update'::text,
      'intent_cleanup'::text,
      'intent_execution'::text,
      'modal_creation'::text,
      'modal_dismissal'::text,
      'timeout_auto_close'::text,
      'force_cleanup'::text,
      'trade_closure'::text,
      'field_update'::text,
      'timestamp_set'::text,
      'lock_acquired'::text,
      'lock_attempt_failed'::text,
      'lock_released'::text,
      'expired_locks_cleanup'::text,
      'ccip_migration_applied'::text,
      'configuration_update'::text,
      'system_recovery'::text,
      'configuration_change'::text
    ])
  );

-- Record the governance change
INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  created_at
) VALUES (
  'realtime_intelligence_calculator',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'vwap', '0.5% wrong-side tolerance',
    'ema20', '1% wrong-side tolerance',
    'ema50', 'no cross confirmation',
    'rsi_buy', '40-70 (30pt window)',
    'rsi_sell', '30-60 (30pt window)',
    'volume', '2/5 candles, 0.8x self-ref avg',
    'pattern', 'last candle direction only',
    'structure', 'alternating index OR logic',
    'momentum', '0.1% threshold, no short-term check'
  ),
  jsonb_build_object(
    'vwap', 'strict side-of-VWAP, zero tolerance',
    'ema20', 'strict side-of-EMA20, zero tolerance',
    'ema50', 'price + EMA20/EMA50 cross confirmation',
    'rsi_buy', '50-65 (15pt window)',
    'rsi_sell', '35-50 (15pt window)',
    'volume', '3/5 candles, 1.0x 20-candle avg, missing data guard',
    'pattern', '>50% body ratio + close beyond prev extreme',
    'structure', '3/4 consecutive HH + 2/4 HL (or inverse)',
    'momentum', '0.3% threshold + 3-candle short-term confirmation'
  ),
  'CCIP Governance: Indicator thresholds were too loose causing inflated 100% confidence on all pairs. Tightened to institutional-grade discrimination for reliable trading signals.',
  NOW()
);