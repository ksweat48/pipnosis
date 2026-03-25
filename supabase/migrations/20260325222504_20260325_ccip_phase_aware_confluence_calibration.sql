/*
  # CCIP-2026-0325C — Phase-Aware Confluence Calibration System

  ## Purpose
  Implements a context-relative confidence scoring system where the number of
  confluence signals required — and their importance weighting — varies by
  market phase and trading style. This allows Alpha to correctly identify
  high-quality opportunities in ranging, distribution, retracement, and other
  market phases that previously appeared to fail a universal threshold.

  ## Core Principle
  The 50% confidence threshold is UNCHANGED. What changes is how Alpha
  interprets confluence COUNT relative to market phase. A 3/7 confluence
  in ACCUMULATION (with STRUCTURE + LIQUIDITY + TIMING confirmed) is a
  genuinely different quality signal than a 3/7 in EXPANSION. This table
  gives Alpha the calibration context to reason correctly.

  ## New Tables

  ### 1. alpha_phase_confluence_calibration
  SSOT for phase-relative confluence standards:
  - market_phase: ACCUMULATION | EXPANSION | DISTRIBUTION | RETRACEMENT | REVERSAL
  - trade_style: SCALP | SWING (MICRO_INTRADAY + INTRADAY share one row)
  - min_signals_required: minimum Q7 dimensions with named evidence
  - load_bearing_dimensions: which dimensions carry the most weight in this phase
  - signal_weight_multipliers: per-dimension weight multipliers applied to readiness score
  - expected_confidence_band_min / max: the confidence band Alpha should target given correct confluence
  - historical_win_rate: auto-updated from trade outcomes (starts null, filled by feedback loop)
  - sample_size: trades used for historical_win_rate
  - rationale: plain English explanation of why this phase behaves this way

  ### 2. alpha_phase_calibration_feedback
  Stores individual trade outcomes indexed by (market_phase, trade_style, confluence_count)
  so the calibration table can be updated by actual win rates over time.

  ## Security
  - RLS enabled on both tables
  - Authenticated users can read calibration (used by Alpha during scan)
  - Service role can insert feedback records
  - Admin can update calibration rows
*/

-- ─── 1. Phase confluence calibration table ───────────────────────────────────

CREATE TABLE IF NOT EXISTS alpha_phase_confluence_calibration (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_phase                text NOT NULL,
  trade_style                 text NOT NULL,
  min_signals_required        integer NOT NULL DEFAULT 3,
  load_bearing_dimensions     text[] NOT NULL DEFAULT '{}',
  signal_weight_multipliers   jsonb NOT NULL DEFAULT '{}',
  expected_confidence_band_min integer NOT NULL DEFAULT 50,
  expected_confidence_band_max integer NOT NULL DEFAULT 65,
  historical_win_rate         numeric(5,2),
  sample_size                 integer NOT NULL DEFAULT 0,
  rationale                   text NOT NULL DEFAULT '',
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT alpha_phase_calibration_phase_check
    CHECK (market_phase IN ('ACCUMULATION', 'EXPANSION', 'DISTRIBUTION', 'RETRACEMENT', 'REVERSAL')),

  CONSTRAINT alpha_phase_calibration_style_check
    CHECK (trade_style IN ('SCALP', 'SWING')),

  CONSTRAINT alpha_phase_calibration_unique
    UNIQUE (market_phase, trade_style),

  CONSTRAINT alpha_phase_calibration_min_signals_check
    CHECK (min_signals_required BETWEEN 1 AND 7),

  CONSTRAINT alpha_phase_calibration_confidence_band_check
    CHECK (expected_confidence_band_min < expected_confidence_band_max),

  CONSTRAINT alpha_phase_calibration_win_rate_check
    CHECK (historical_win_rate IS NULL OR (historical_win_rate >= 0 AND historical_win_rate <= 100))
);

ALTER TABLE alpha_phase_confluence_calibration ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read phase calibration"
  ON alpha_phase_confluence_calibration
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Service role can update phase calibration"
  ON alpha_phase_confluence_calibration
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can insert phase calibration"
  ON alpha_phase_confluence_calibration
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- ─── 2. Feedback table for auto-learning win rates ───────────────────────────

CREATE TABLE IF NOT EXISTS alpha_phase_calibration_feedback (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trade_id              uuid NOT NULL,
  user_id               uuid NOT NULL,
  market_phase          text NOT NULL,
  trade_style           text NOT NULL,
  confluence_count      integer NOT NULL,
  trade_confidence      integer NOT NULL,
  trade_outcome         text NOT NULL,
  pnl_r                 numeric(10,4),
  load_bearing_hit      boolean NOT NULL DEFAULT false,
  signals_confirmed     text[] NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT phase_feedback_outcome_check
    CHECK (trade_outcome IN ('WIN', 'LOSS', 'BREAKEVEN')),

  CONSTRAINT phase_feedback_phase_check
    CHECK (market_phase IN ('ACCUMULATION', 'EXPANSION', 'DISTRIBUTION', 'RETRACEMENT', 'REVERSAL')),

  CONSTRAINT phase_feedback_style_check
    CHECK (trade_style IN ('SCALP', 'SWING')),

  CONSTRAINT phase_feedback_confluence_check
    CHECK (confluence_count BETWEEN 0 AND 7)
);

ALTER TABLE alpha_phase_calibration_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own phase feedback"
  ON alpha_phase_calibration_feedback
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Service role can insert phase feedback"
  ON alpha_phase_calibration_feedback
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can select phase feedback"
  ON alpha_phase_calibration_feedback
  FOR SELECT
  TO service_role
  USING (true);

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_phase_calibration_phase_style
  ON alpha_phase_confluence_calibration (market_phase, trade_style);

CREATE INDEX IF NOT EXISTS idx_phase_feedback_phase_style
  ON alpha_phase_calibration_feedback (market_phase, trade_style);

CREATE INDEX IF NOT EXISTS idx_phase_feedback_trade_id
  ON alpha_phase_calibration_feedback (trade_id);

CREATE INDEX IF NOT EXISTS idx_phase_feedback_created_at
  ON alpha_phase_calibration_feedback (created_at DESC);

-- ─── 4. Updated_at trigger ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_phase_calibration_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_phase_calibration_updated_at ON alpha_phase_confluence_calibration;
CREATE TRIGGER trigger_phase_calibration_updated_at
  BEFORE UPDATE ON alpha_phase_confluence_calibration
  FOR EACH ROW EXECUTE FUNCTION update_phase_calibration_updated_at();

-- ─── 5. RPC: get_phase_calibration_matrix ────────────────────────────────────
-- Returns the full calibration matrix for Alpha to include in its briefing

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

-- ─── 6. RPC: update_phase_calibration_win_rate ───────────────────────────────
-- Called by feedback loop to recalculate historical_win_rate from feedback records

CREATE OR REPLACE FUNCTION update_phase_calibration_win_rates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT
      market_phase,
      trade_style,
      COUNT(*) FILTER (WHERE trade_outcome = 'WIN') AS wins,
      COUNT(*) AS total
    FROM alpha_phase_calibration_feedback
    GROUP BY market_phase, trade_style
  LOOP
    IF r.total >= 5 THEN
      UPDATE alpha_phase_confluence_calibration
      SET
        historical_win_rate = ROUND((r.wins::numeric / r.total::numeric) * 100, 2),
        sample_size = r.total
      WHERE market_phase = r.market_phase
        AND trade_style = r.trade_style;
    END IF;
  END LOOP;
END;
$$;

-- ─── 7. Seed: Initial calibration matrix ─────────────────────────────────────
/*
  CALIBRATION RATIONALE:

  ACCUMULATION (range-bound):
  - SCALP: 3/7 required. Load-bearing: STRUCTURE, LIQUIDITY, TIMING.
    Range boundaries are the edge. BOS inside range is noise. EMA STACK is often flat.
    A tight range scalp to the opposite boundary needs boundary confirmation, not trend.
    Band: 55-70% (range edges are high-probability when correctly identified).

  - SWING: 4/7 required. STRUCTURE + LIQUIDITY + TIMING + PATTERN.
    Swing trades from range extremes need more confirmation because holding through
    range noise requires structural conviction.

  EXPANSION (directional momentum):
  - SCALP: 4/7 required. Load-bearing: TREND, MOMENTUM, BOS, EMA_STACK.
    Expansion scalps need trend confirmation — fading expansion is dangerous.
    Pullback entries to structure during expansion need trend alignment.
    Band: 60-75%.

  - SWING: 4/7 required. Same load-bearing. Swing during expansion is higher probability
    but needs all trend dimensions confirmed to hold through retracements.

  DISTRIBUTION (late move, reversal risk):
  - SCALP: 4/7 required. Load-bearing: STRUCTURE, PATTERN, LIQUIDITY, CHOCH.
    Distribution scalps are reversal entries. High risk — requires reversal evidence.
    CHOCH + Pattern + Structure sweep = valid reversal scalp.
    Band: 55-65%.

  - SWING: 5/7 required. Distribution swing reversals are highest risk setups.
    Requires overwhelming evidence including OMEGA_CONSENSUS.
    Band: 60-70%.

  RETRACEMENT (pullback against primary):
  - SCALP: 3/7 required. Load-bearing: STRUCTURE, TIMING, LIQUIDITY.
    Retracement scalps are the safest — waiting for pullback to zone then entering
    continuation. Clean structure anchor + timing at the right zone = valid.
    Band: 60-72%.

  - SWING: 3/7 required. Same logic — pullback to structural zone + trend alignment.
    TREND + STRUCTURE + MOMENTUM = standard retracement swing.
    Band: 62-75%.

  REVERSAL (prior BOS fired against trend):
  - SCALP: 4/7 required. Load-bearing: STRUCTURE, PATTERN, LIQUIDITY, MOMENTUM.
    Existing governance: 4/7 minimum for reversals. Maintained here.
    Band: 55-65%.

  - SWING: 4/7 required (3/7 if Q4=FRESH per existing Q12/Q4 protocol).
    Load-bearing: TREND (new direction), STRUCTURE, LIQUIDITY, CHOCH, OMEGA_CONSENSUS.
    Band: 58-68%.
*/

INSERT INTO alpha_phase_confluence_calibration
  (market_phase, trade_style, min_signals_required, load_bearing_dimensions,
   signal_weight_multipliers, expected_confidence_band_min, expected_confidence_band_max, rationale)
VALUES

-- ACCUMULATION × SCALP
('ACCUMULATION', 'SCALP', 3,
 ARRAY['STRUCTURE', 'LIQUIDITY', 'TIMING'],
 '{"BOS": 1.6, "LIQUIDITY_SWEEP": 1.8, "CHOCH": 1.4, "FVG": 1.3, "PIN_BAR": 1.5, "ENGULFING": 1.3, "EMA_STACK": 0.7, "MOMENTUM_DIV": 1.2, "ATR_EXPANSION": 0.8, "ORDER_BLOCK": 1.5}'::jsonb,
 55, 70,
 'Range-bound market. Boundaries are the edge. STRUCTURE (named zone), LIQUIDITY (sweep of range extreme), and TIMING (session kill zone at boundary) are the load-bearing signals. EMA_STACK is often flat in ranging markets and carries less weight. A 3/7 count with STRUCTURE + LIQUIDITY + TIMING confirmed at a range boundary is a 60-70% probability scalp to the opposite range extreme. BOS inside the range is noise — only a BOS OUTSIDE the established range boundaries counts.'),

-- ACCUMULATION × SWING
('ACCUMULATION', 'SWING', 4,
 ARRAY['STRUCTURE', 'LIQUIDITY', 'TIMING', 'PATTERN'],
 '{"BOS": 1.5, "LIQUIDITY_SWEEP": 1.8, "CHOCH": 1.4, "FVG": 1.4, "PIN_BAR": 1.6, "ENGULFING": 1.4, "EMA_STACK": 0.6, "MOMENTUM_DIV": 1.3, "ATR_EXPANSION": 0.7, "ORDER_BLOCK": 1.6}'::jsonb,
 55, 68,
 'Range swing trades require one additional confirmation over scalp because holding through range noise requires structural conviction. PATTERN (pin bar or engulfing at boundary) adds the confirmation needed to hold a swing position through the range. 4/7 with load-bearing dimensions confirmed = 58-68%.'),

-- EXPANSION × SCALP
('EXPANSION', 'SCALP', 4,
 ARRAY['TREND', 'MOMENTUM', 'BOS', 'EMA_STACK'],
 '{"BOS": 1.8, "LIQUIDITY_SWEEP": 1.2, "CHOCH": 0.8, "FVG": 1.3, "PIN_BAR": 1.2, "ENGULFING": 1.4, "EMA_STACK": 1.8, "MOMENTUM_DIV": 0.9, "ATR_EXPANSION": 1.5, "ORDER_BLOCK": 1.2}'::jsonb,
 60, 75,
 'Directional momentum is active. BOS, EMA_STACK (trend confirmation), and MOMENTUM (candle evidence of expansion) are load-bearing. Fading expansion is dangerous — continuation scalps need trend alignment. ATR_EXPANSION confirms the move has energy. 4/7 with TREND + MOMENTUM + BOS + EMA_STACK = 65-75%.'),

-- EXPANSION × SWING
('EXPANSION', 'SWING', 4,
 ARRAY['TREND', 'MOMENTUM', 'STRUCTURE', 'EMA_STACK'],
 '{"BOS": 1.7, "LIQUIDITY_SWEEP": 1.2, "CHOCH": 0.7, "FVG": 1.4, "PIN_BAR": 1.1, "ENGULFING": 1.4, "EMA_STACK": 1.8, "MOMENTUM_DIV": 0.9, "ATR_EXPANSION": 1.4, "ORDER_BLOCK": 1.3}'::jsonb,
 62, 76,
 'Expansion swings are pullback-to-structure entries in the direction of trend. TREND + STRUCTURE (pullback target zone) + EMA_STACK + MOMENTUM = 4/7 needed. Highest probability style/phase combination when aligned. Band is wider because expansion can extend significantly.'),

-- DISTRIBUTION × SCALP
('DISTRIBUTION', 'SCALP', 4,
 ARRAY['STRUCTURE', 'PATTERN', 'LIQUIDITY', 'CHOCH'],
 '{"BOS": 1.3, "LIQUIDITY_SWEEP": 1.7, "CHOCH": 2.0, "FVG": 1.2, "PIN_BAR": 1.7, "ENGULFING": 1.5, "EMA_STACK": 0.8, "MOMENTUM_DIV": 1.6, "ATR_EXPANSION": 1.0, "ORDER_BLOCK": 1.3}'::jsonb,
 55, 65,
 'Late-move phase. Continuation is high-risk. Distribution scalps are reversal entries requiring reversal evidence: CHOCH (change of character — highest weight at 2x), PATTERN (pin bar or engulf at the exhaustion point), LIQUIDITY (sweep of the extension high/low), STRUCTURE (named reversal anchor). 4/7 with these confirmed = 58-65%. Without CHOCH or PATTERN, the reversal case is insufficient.'),

-- DISTRIBUTION × SWING
('DISTRIBUTION', 'SWING', 5,
 ARRAY['STRUCTURE', 'CHOCH', 'LIQUIDITY', 'MOMENTUM', 'OMEGA_CONSENSUS'],
 '{"BOS": 1.2, "LIQUIDITY_SWEEP": 1.7, "CHOCH": 2.0, "FVG": 1.3, "PIN_BAR": 1.6, "ENGULFING": 1.5, "EMA_STACK": 0.7, "MOMENTUM_DIV": 1.8, "ATR_EXPANSION": 0.9, "ORDER_BLOCK": 1.4}'::jsonb,
 60, 70,
 'Distribution swing reversals are the highest-risk setups in this system. Existing governance: 4/7 minimum (REVERSAL protocol). Distribution swing extends this to 5/7 because the position must survive the initial noise before the reversal confirms. OMEGA_CONSENSUS required — if the Omega brains disagree on the reversal, it is not yet confirmed. CHOCH weight is 2x. Without 5/7 confirmed, the distribution swing is NOT_VALID.'),

-- RETRACEMENT × SCALP
('RETRACEMENT', 'SCALP', 3,
 ARRAY['STRUCTURE', 'TIMING', 'LIQUIDITY'],
 '{"BOS": 1.3, "LIQUIDITY_SWEEP": 1.6, "CHOCH": 1.0, "FVG": 1.5, "PIN_BAR": 1.4, "ENGULFING": 1.3, "EMA_STACK": 1.4, "MOMENTUM_DIV": 0.9, "ATR_EXPANSION": 0.9, "ORDER_BLOCK": 1.5}'::jsonb,
 60, 72,
 'Pullback against primary direction. This is the cleanest trade type: waiting for price to return to a known structural zone then entering the continuation. STRUCTURE (the pullback target zone), TIMING (kill zone or session alignment), LIQUIDITY (sweep of pullback low/high = stop hunt complete) = 3/7 is sufficient. These 3 confirmed in a retracement = high-probability continuation scalp. Band 62-72%.'),

-- RETRACEMENT × SWING
('RETRACEMENT', 'SWING', 3,
 ARRAY['TREND', 'STRUCTURE', 'MOMENTUM'],
 '{"BOS": 1.4, "LIQUIDITY_SWEEP": 1.5, "CHOCH": 0.9, "FVG": 1.5, "PIN_BAR": 1.3, "ENGULFING": 1.4, "EMA_STACK": 1.5, "MOMENTUM_DIV": 1.1, "ATR_EXPANSION": 1.0, "ORDER_BLOCK": 1.4}'::jsonb,
 62, 75,
 'Retracement swing: pullback to structural zone in primary trend direction. TREND (primary trend intact), STRUCTURE (zone where pullback should complete), MOMENTUM (exhausted pullback candles = reversal imminent). 3/7 with these three = 65-75%. The trend is already established — we are simply waiting for the pullback to complete. This is the highest expected-value setup type in the system.'),

-- REVERSAL × SCALP
('REVERSAL', 'SCALP', 4,
 ARRAY['STRUCTURE', 'PATTERN', 'LIQUIDITY', 'MOMENTUM'],
 '{"BOS": 1.5, "LIQUIDITY_SWEEP": 1.6, "CHOCH": 1.8, "FVG": 1.3, "PIN_BAR": 1.7, "ENGULFING": 1.5, "EMA_STACK": 0.9, "MOMENTUM_DIV": 1.6, "ATR_EXPANSION": 1.1, "ORDER_BLOCK": 1.4}'::jsonb,
 55, 65,
 'Prior trend BOS has fired. Counter-trend entry. CCIP-2026-0316A governance: minimum 4/7 for reversals. Load-bearing: STRUCTURE (new reversal anchor), PATTERN (candlestick confirmation of reversal), LIQUIDITY (sweep of prior extreme = stop hunt confirmed), MOMENTUM (candle evidence of new direction). 4/7 with load-bearing = 58-65%. Exception: if Q4=FRESH (both TFs agree), 3/7 is sufficient per existing Q12/Q4 protocol.'),

-- REVERSAL × SWING
('REVERSAL', 'SWING', 4,
 ARRAY['TREND', 'STRUCTURE', 'LIQUIDITY', 'CHOCH'],
 '{"BOS": 1.6, "LIQUIDITY_SWEEP": 1.6, "CHOCH": 1.9, "FVG": 1.4, "PIN_BAR": 1.5, "ENGULFING": 1.5, "EMA_STACK": 1.1, "MOMENTUM_DIV": 1.5, "ATR_EXPANSION": 1.0, "ORDER_BLOCK": 1.4}'::jsonb,
 58, 68,
 'Reversal swing: new trend establishing after prior BOS. TREND (new direction now showing HHs/LLs), STRUCTURE (first pullback anchor in new trend), LIQUIDITY (sweep of prior extreme confirmed), CHOCH (change of character visible on control TF). 4/7 minimum. If Q4=FRESH, 3/7 acceptable. OMEGA_CONSENSUS adds significant weight when available. Band 58-68%.')

ON CONFLICT (market_phase, trade_style) DO NOTHING;
