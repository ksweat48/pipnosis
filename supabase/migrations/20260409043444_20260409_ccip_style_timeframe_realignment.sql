/*
  # CCIP-2026-0409A — Style Timeframe Realignment + MICRO_INTRADAY Own Calibration

  ## Purpose
  Realigns the readiness indicator calculation to the correct controlling timeframe
  per trading style:
    - SCALP:          M1  (was M15)
    - MICRO_INTRADAY: M5  (was H1)
    - INTRADAY:       M15 (was H4)

  ## Changes

  ### 1. pre_screen_results — controlling_timeframe constraint
  Expands the CHECK constraint to accept M1 and M5 in addition to the
  existing M15, H1, H4. Stale rows written under old timeframes are deleted
  so the UNIQUE(symbol, style, controlling_timeframe) constraint does not
  conflict with the new rows.

  ### 2. alpha_phase_confluence_calibration — trade_style constraint + MICRO_INTRADAY rows
  MICRO_INTRADAY now has its own calibration key separate from SWING (INTRADAY).
  - Expands trade_style CHECK to accept 'MICRO_INTRADAY' and 'INTRADAY' as explicit keys.
  - Inserts 5 new rows (one per phase) for MICRO_INTRADAY with M5-appropriate calibration.
  - Inserts 5 new INTRADAY rows cloned from SWING for explicit keying.
  - Updates get_phase_calibration_matrix() RPC to return all style keys.

  ### 3. alpha_phase_calibration_feedback — trade_style constraint
  Expands the feedback table's trade_style constraint to match.

  ## Security
  No new tables — RLS already enabled on all affected tables.
  Existing policies are sufficient.

  ## Important Notes
  - Deleting stale pre_screen_results rows is safe: they are transient readiness
    indicators recomputed every 5 minutes by the Netlify function.
  - expected_confidence_band_min/max must be NULL per the no_confidence_band_anchors
    constraint added in CCIP-2026-0401A.
  - SWING rows in calibration are preserved for backward compatibility.
*/

-- ─── 1. Expand controlling_timeframe constraint on pre_screen_results ─────────

ALTER TABLE pre_screen_results
  DROP CONSTRAINT IF EXISTS pre_screen_results_controlling_timeframe_check;

ALTER TABLE pre_screen_results
  ADD CONSTRAINT pre_screen_results_controlling_timeframe_check
    CHECK (controlling_timeframe IN ('M1', 'M5', 'M15', 'H1', 'H4'));

-- Delete stale rows written under the old timeframe assignments.
DELETE FROM pre_screen_results
  WHERE (style = 'SCALP'          AND controlling_timeframe != 'M1')
     OR (style = 'MICRO_INTRADAY' AND controlling_timeframe != 'M5')
     OR (style = 'INTRADAY'       AND controlling_timeframe != 'M15');

-- ─── 2. Expand trade_style constraints on calibration tables ─────────────────

ALTER TABLE alpha_phase_confluence_calibration
  DROP CONSTRAINT IF EXISTS alpha_phase_calibration_style_check;

ALTER TABLE alpha_phase_confluence_calibration
  ADD CONSTRAINT alpha_phase_calibration_style_check
    CHECK (trade_style IN ('SCALP', 'SWING', 'MICRO_INTRADAY', 'INTRADAY'));

ALTER TABLE alpha_phase_calibration_feedback
  DROP CONSTRAINT IF EXISTS phase_feedback_style_check;

ALTER TABLE alpha_phase_calibration_feedback
  ADD CONSTRAINT phase_feedback_style_check
    CHECK (trade_style IN ('SCALP', 'SWING', 'MICRO_INTRADAY', 'INTRADAY'));

-- ─── 3. Add INTRADAY rows (mirror of SWING, explicit key) ────────────────────

INSERT INTO alpha_phase_confluence_calibration
  (market_phase, trade_style, min_signals_required, load_bearing_dimensions,
   signal_weight_multipliers, expected_confidence_band_min, expected_confidence_band_max, rationale)
SELECT
  market_phase,
  'INTRADAY' AS trade_style,
  min_signals_required,
  load_bearing_dimensions,
  signal_weight_multipliers,
  NULL AS expected_confidence_band_min,
  NULL AS expected_confidence_band_max,
  rationale || ' [INTRADAY/M15 key — cloned from SWING, tune independently]'
FROM alpha_phase_confluence_calibration
WHERE trade_style = 'SWING'
ON CONFLICT (market_phase, trade_style) DO NOTHING;

-- ─── 4. Insert MICRO_INTRADAY calibration rows (M5-specific) ─────────────────
/*
  MICRO_INTRADAY (M5) calibration rationale:
  M5 sits between scalp speed and intraday context. Signals fire faster and with
  more noise than M15. Thresholds match SCALP (3-4) rather than INTRADAY (4-5)
  because M5 setups must be acted on quickly. Confidence bands are NULL per
  CCIP-2026-0401A governance (no numerical anchoring).
*/

INSERT INTO alpha_phase_confluence_calibration
  (market_phase, trade_style, min_signals_required, load_bearing_dimensions,
   signal_weight_multipliers, expected_confidence_band_min, expected_confidence_band_max, rationale)
VALUES

('ACCUMULATION', 'MICRO_INTRADAY', 3,
 ARRAY['STRUCTURE', 'LIQUIDITY', 'TIMING'],
 '{"BOS": 1.7, "LIQUIDITY_SWEEP": 1.8, "CHOCH": 1.4, "FVG": 1.4, "PIN_BAR": 1.5, "ENGULFING": 1.3, "EMA_STACK": 0.65, "MOMENTUM_DIV": 1.2, "ATR_EXPANSION": 0.8, "ORDER_BLOCK": 1.5}'::jsonb,
 NULL, NULL,
 'M5 range-bound. STRUCTURE + LIQUIDITY + TIMING at range extreme = 3/7 sufficient. EMA_STACK is flat in ranging M5 markets — de-weighted. M5 allows faster entry than M15 but requires the same structural evidence at range boundaries.'),

('EXPANSION', 'MICRO_INTRADAY', 4,
 ARRAY['TREND', 'MOMENTUM', 'BOS', 'EMA_STACK'],
 '{"BOS": 1.8, "LIQUIDITY_SWEEP": 1.2, "CHOCH": 0.75, "FVG": 1.3, "PIN_BAR": 1.15, "ENGULFING": 1.4, "EMA_STACK": 1.8, "MOMENTUM_DIV": 0.9, "ATR_EXPANSION": 1.5, "ORDER_BLOCK": 1.2}'::jsonb,
 NULL, NULL,
 'M5 expansion: directional momentum active. BOS + EMA_STACK + MOMENTUM load-bearing. 4/7 with trend alignment required to avoid chasing. ATR_EXPANSION confirms energy at M5 speed.'),

('DISTRIBUTION', 'MICRO_INTRADAY', 4,
 ARRAY['STRUCTURE', 'PATTERN', 'LIQUIDITY', 'CHOCH'],
 '{"BOS": 1.3, "LIQUIDITY_SWEEP": 1.7, "CHOCH": 2.0, "FVG": 1.2, "PIN_BAR": 1.7, "ENGULFING": 1.5, "EMA_STACK": 0.75, "MOMENTUM_DIV": 1.6, "ATR_EXPANSION": 0.95, "ORDER_BLOCK": 1.3}'::jsonb,
 NULL, NULL,
 'M5 distribution: late-move phase, reversal risk high. CHOCH 2x weight as primary reversal confirmation. PIN_BAR + LIQUIDITY_SWEEP complete reversal case. 4/7 required — M5 distribution reversals can whipsaw without sufficient evidence.'),

('RETRACEMENT', 'MICRO_INTRADAY', 3,
 ARRAY['STRUCTURE', 'TIMING', 'LIQUIDITY'],
 '{"BOS": 1.3, "LIQUIDITY_SWEEP": 1.6, "CHOCH": 1.0, "FVG": 1.5, "PIN_BAR": 1.4, "ENGULFING": 1.3, "EMA_STACK": 1.45, "MOMENTUM_DIV": 0.9, "ATR_EXPANSION": 0.85, "ORDER_BLOCK": 1.5}'::jsonb,
 NULL, NULL,
 'M5 retracement: pullback to zone in primary trend direction. Cleanest M5 setup. STRUCTURE + TIMING + LIQUIDITY = 3/7 sufficient. M5 allows tight stops at the zone.'),

('REVERSAL', 'MICRO_INTRADAY', 4,
 ARRAY['STRUCTURE', 'PATTERN', 'LIQUIDITY', 'MOMENTUM'],
 '{"BOS": 1.5, "LIQUIDITY_SWEEP": 1.6, "CHOCH": 1.8, "FVG": 1.3, "PIN_BAR": 1.7, "ENGULFING": 1.5, "EMA_STACK": 0.85, "MOMENTUM_DIV": 1.6, "ATR_EXPANSION": 1.1, "ORDER_BLOCK": 1.4}'::jsonb,
 NULL, NULL,
 'M5 reversal: prior BOS fired against trend. 4/7 minimum — reversal governance maintained. STRUCTURE + PATTERN + LIQUIDITY + MOMENTUM load-bearing. M5 reversals confirm faster but also fail faster.')

ON CONFLICT (market_phase, trade_style) DO NOTHING;

-- ─── 5. Update get_phase_calibration_matrix RPC ───────────────────────────────

CREATE OR REPLACE FUNCTION get_phase_calibration_matrix()
RETURNS TABLE (
  market_phase                text,
  trade_style                 text,
  min_signals_required        integer,
  load_bearing_dimensions     text[],
  signal_weight_multipliers   jsonb,
  expected_confidence_band_min integer,
  expected_confidence_band_max integer,
  historical_win_rate         numeric,
  sample_size                 integer,
  rationale                   text
)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT
    market_phase,
    trade_style,
    min_signals_required,
    load_bearing_dimensions,
    signal_weight_multipliers,
    expected_confidence_band_min,
    expected_confidence_band_max,
    historical_win_rate,
    sample_size,
    rationale
  FROM alpha_phase_confluence_calibration
  ORDER BY market_phase, trade_style;
$$;
