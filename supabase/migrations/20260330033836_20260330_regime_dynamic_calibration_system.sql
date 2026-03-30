/*
  # Regime Dynamic Calibration System
  
  ## Summary
  Replaces static hardcoded regime thresholds with a fully dynamic, self-calibrating
  system that tracks per-symbol, per-session baselines and records actual regime
  accuracy against trade outcomes.

  ## New Tables

  ### regime_indicator_baselines
  Rolling 100-sample baseline per symbol per session for each raw indicator.
  Used to compute PERCENTILE thresholds rather than hardcoded absolute values.
  Each row = the current rolling window for one symbol+session combination.

  ### regime_outcome_log
  Every trade entry records what micro-regime was active. After closure, the 
  actual outcome is written back. This is the calibration evidence dataset.

  ## Modified Tables
  - goal_session_trades: adds micro_regime_at_entry column

  ## Security
  - RLS enabled on all new tables
  - Authenticated users can read/write their own records
  - Service role bypass for server-side functions
*/

-- ─────────────────────────────────────────────────────────────
-- TABLE 1: regime_indicator_baselines
-- Rolling window of raw indicator values per symbol per session
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regime_indicator_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol text NOT NULL,
  session_name text NOT NULL CHECK (session_name IN ('asian', 'london', 'ny', 'overlap', 'dead')),
  -- Rolling sample window (last 100 readings stored as arrays)
  atr_expansion_samples jsonb NOT NULL DEFAULT '[]',
  ema_displacement_samples jsonb NOT NULL DEFAULT '[]',
  range_compression_samples jsonb NOT NULL DEFAULT '[]',
  volume_ratio_samples jsonb NOT NULL DEFAULT '[]',
  -- Computed percentile thresholds (refreshed on each upsert)
  atr_expansion_p70 numeric(10,4) NOT NULL DEFAULT 1.2,
  atr_expansion_p85 numeric(10,4) NOT NULL DEFAULT 1.4,
  atr_expansion_p30 numeric(10,4) NOT NULL DEFAULT 0.85,
  ema_displacement_p80 numeric(10,4) NOT NULL DEFAULT 1.5,
  ema_displacement_p90 numeric(10,4) NOT NULL DEFAULT 2.0,
  ema_displacement_p95 numeric(10,4) NOT NULL DEFAULT 2.5,
  range_compression_p20 numeric(10,4) NOT NULL DEFAULT 0.6,
  range_compression_p35 numeric(10,4) NOT NULL DEFAULT 0.75,
  sample_count integer NOT NULL DEFAULT 0,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(symbol, session_name)
);

ALTER TABLE regime_indicator_baselines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to regime baselines"
  ON regime_indicator_baselines
  FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role insert regime baselines"
  ON regime_indicator_baselines
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role update regime baselines"
  ON regime_indicator_baselines
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

-- Allow authenticated reads (no PII, these are global market baselines)
CREATE POLICY "Authenticated users can read regime baselines"
  ON regime_indicator_baselines
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_regime_baselines_symbol_session 
  ON regime_indicator_baselines(symbol, session_name);

-- ─────────────────────────────────────────────────────────────
-- TABLE 2: regime_outcome_log
-- Links regime label at entry to actual trade outcome
-- The calibration evidence dataset
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS regime_outcome_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id uuid NOT NULL,
  symbol text NOT NULL,
  session_name text NOT NULL,
  -- What regime was classified at the time of entry
  regime_at_entry text NOT NULL,
  regime_confidence_at_entry integer NOT NULL DEFAULT 0,
  -- Was the classification from dynamic baselines or static fallback?
  used_dynamic_baseline boolean NOT NULL DEFAULT false,
  -- Raw sensor readings at entry time
  atr_expansion_at_entry numeric(10,4),
  ema_displacement_at_entry numeric(10,4),
  rsi_at_entry numeric(6,2),
  range_compression_at_entry numeric(10,4),
  volume_profile_at_entry text,
  -- Outcome filled in by post-trade-analyzer after closure
  trade_outcome text CHECK (trade_outcome IN ('win', 'loss', 'breakeven')),
  close_reason text,
  pnl numeric(12,4),
  pnl_r numeric(8,4),
  -- Was the regime label useful for predicting this outcome?
  -- Computed: regime is directional (not neutral) AND direction matched outcome
  regime_direction_correct boolean,
  -- Timestamps
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_time timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE regime_outcome_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own regime outcomes"
  ON regime_outcome_log
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own regime outcomes"
  ON regime_outcome_log
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own regime outcomes"
  ON regime_outcome_log
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role full access to regime outcomes"
  ON regime_outcome_log
  FOR SELECT TO service_role USING (true);

CREATE POLICY "Service role insert regime outcomes"
  ON regime_outcome_log
  FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "Service role update regime outcomes"
  ON regime_outcome_log
  FOR UPDATE TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_regime_outcome_log_trade_id 
  ON regime_outcome_log(trade_id);

CREATE INDEX IF NOT EXISTS idx_regime_outcome_log_user_symbol 
  ON regime_outcome_log(user_id, symbol);

CREATE INDEX IF NOT EXISTS idx_regime_outcome_log_regime 
  ON regime_outcome_log(regime_at_entry, symbol, session_name);

-- ─────────────────────────────────────────────────────────────
-- Add micro_regime_at_entry to goal_session_trades
-- ─────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'micro_regime_at_entry'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN micro_regime_at_entry text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'regime_confidence_at_entry'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN regime_confidence_at_entry integer;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'goal_session_trades' AND column_name = 'regime_used_dynamic_baseline'
  ) THEN
    ALTER TABLE goal_session_trades ADD COLUMN regime_used_dynamic_baseline boolean DEFAULT false;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- RPC: upsert_regime_baseline
-- Called by the classifier to update rolling baselines
-- Returns the updated percentile thresholds
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION upsert_regime_baseline(
  p_symbol text,
  p_session_name text,
  p_atr_expansion numeric,
  p_ema_displacement numeric,
  p_range_compression numeric,
  p_volume_ratio numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing regime_indicator_baselines;
  v_atr_samples jsonb;
  v_ema_samples jsonb;
  v_range_samples jsonb;
  v_vol_samples jsonb;
  v_max_samples constant integer := 100;
  v_result jsonb;
BEGIN
  -- Fetch existing record
  SELECT * INTO v_existing
  FROM regime_indicator_baselines
  WHERE symbol = p_symbol AND session_name = p_session_name;

  IF NOT FOUND THEN
    -- Bootstrap new record with first sample
    v_atr_samples := jsonb_build_array(p_atr_expansion);
    v_ema_samples := jsonb_build_array(ABS(p_ema_displacement));
    v_range_samples := jsonb_build_array(p_range_compression);
    v_vol_samples := jsonb_build_array(p_volume_ratio);
    
    INSERT INTO regime_indicator_baselines (
      symbol, session_name,
      atr_expansion_samples, ema_displacement_samples,
      range_compression_samples, volume_ratio_samples,
      sample_count, last_updated_at
    ) VALUES (
      p_symbol, p_session_name,
      v_atr_samples, v_ema_samples,
      v_range_samples, v_vol_samples,
      1, now()
    );
    
    -- Return static defaults for first sample (no percentile data yet)
    RETURN jsonb_build_object(
      'atr_expansion_p70', 1.2,
      'atr_expansion_p85', 1.4,
      'atr_expansion_p30', 0.85,
      'ema_displacement_p80', 1.5,
      'ema_displacement_p90', 2.0,
      'ema_displacement_p95', 2.5,
      'range_compression_p20', 0.6,
      'range_compression_p35', 0.75,
      'sample_count', 1,
      'is_dynamic', false
    );
  END IF;

  -- Append new samples, keep rolling window of max_samples
  v_atr_samples := (
    SELECT jsonb_agg(val)
    FROM (
      SELECT val FROM jsonb_array_elements(v_existing.atr_expansion_samples) AS t(val)
      UNION ALL SELECT to_jsonb(p_atr_expansion)
      ORDER BY ordinality DESC
      LIMIT v_max_samples
    ) sub(val, ordinality)
  );
  
  -- Simpler approach for jsonb arrays
  v_atr_samples := v_existing.atr_expansion_samples || jsonb_build_array(p_atr_expansion);
  IF jsonb_array_length(v_atr_samples) > v_max_samples THEN
    v_atr_samples := (
      SELECT jsonb_agg(elem) FROM (
        SELECT elem FROM jsonb_array_elements(v_atr_samples) WITH ORDINALITY AS t(elem, ord)
        ORDER BY ord DESC LIMIT v_max_samples
      ) sub
    );
  END IF;

  v_ema_samples := v_existing.ema_displacement_samples || jsonb_build_array(ABS(p_ema_displacement));
  IF jsonb_array_length(v_ema_samples) > v_max_samples THEN
    v_ema_samples := (
      SELECT jsonb_agg(elem) FROM (
        SELECT elem FROM jsonb_array_elements(v_ema_samples) WITH ORDINALITY AS t(elem, ord)
        ORDER BY ord DESC LIMIT v_max_samples
      ) sub
    );
  END IF;

  v_range_samples := v_existing.range_compression_samples || jsonb_build_array(p_range_compression);
  IF jsonb_array_length(v_range_samples) > v_max_samples THEN
    v_range_samples := (
      SELECT jsonb_agg(elem) FROM (
        SELECT elem FROM jsonb_array_elements(v_range_samples) WITH ORDINALITY AS t(elem, ord)
        ORDER BY ord DESC LIMIT v_max_samples
      ) sub
    );
  END IF;

  v_vol_samples := v_existing.volume_ratio_samples || jsonb_build_array(p_volume_ratio);
  IF jsonb_array_length(v_vol_samples) > v_max_samples THEN
    v_vol_samples := (
      SELECT jsonb_agg(elem) FROM (
        SELECT elem FROM jsonb_array_elements(v_vol_samples) WITH ORDINALITY AS t(elem, ord)
        ORDER BY ord DESC LIMIT v_max_samples
      ) sub
    );
  END IF;

  -- Compute percentiles from sorted arrays using simple percentile method
  -- For small samples (<20), return static defaults to avoid noisy calibration
  DECLARE
    v_sample_count integer := jsonb_array_length(v_atr_samples);
    v_atr_sorted numeric[];
    v_ema_sorted numeric[];
    v_range_sorted numeric[];
    v_p70 numeric; v_p85 numeric; v_p30 numeric;
    v_ep80 numeric; v_ep90 numeric; v_ep95 numeric;
    v_rp20 numeric; v_rp35 numeric;
    v_is_dynamic boolean := v_sample_count >= 20;
  BEGIN
    IF v_is_dynamic THEN
      -- Extract and sort ATR samples
      SELECT ARRAY(
        SELECT (elem)::numeric FROM jsonb_array_elements(v_atr_samples) AS t(elem)
        ORDER BY 1
      ) INTO v_atr_sorted;

      v_p70 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted,1) * 0.70)::int)];
      v_p85 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted,1) * 0.85)::int)];
      v_p30 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted,1) * 0.30)::int)];

      -- Extract and sort EMA displacement samples
      SELECT ARRAY(
        SELECT (elem)::numeric FROM jsonb_array_elements(v_ema_samples) AS t(elem)
        ORDER BY 1
      ) INTO v_ema_sorted;

      v_ep80 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted,1) * 0.80)::int)];
      v_ep90 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted,1) * 0.90)::int)];
      v_ep95 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted,1) * 0.95)::int)];

      -- Extract and sort range compression samples (lower = more compressed)
      SELECT ARRAY(
        SELECT (elem)::numeric FROM jsonb_array_elements(v_range_samples) AS t(elem)
        ORDER BY 1
      ) INTO v_range_sorted;

      v_rp20 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted,1) * 0.20)::int)];
      v_rp35 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted,1) * 0.35)::int)];
    ELSE
      -- Not enough samples yet — use conservative static defaults
      v_p70 := 1.2; v_p85 := 1.4; v_p30 := 0.85;
      v_ep80 := 1.5; v_ep90 := 2.0; v_ep95 := 2.5;
      v_rp20 := 0.6; v_rp35 := 0.75;
    END IF;

    -- Persist updated baselines
    UPDATE regime_indicator_baselines SET
      atr_expansion_samples = v_atr_samples,
      ema_displacement_samples = v_ema_samples,
      range_compression_samples = v_range_samples,
      volume_ratio_samples = v_vol_samples,
      atr_expansion_p70 = v_p70,
      atr_expansion_p85 = v_p85,
      atr_expansion_p30 = v_p30,
      ema_displacement_p80 = v_ep80,
      ema_displacement_p90 = v_ep90,
      ema_displacement_p95 = v_ep95,
      range_compression_p20 = v_rp20,
      range_compression_p35 = v_rp35,
      sample_count = v_sample_count,
      last_updated_at = now()
    WHERE symbol = p_symbol AND session_name = p_session_name;

    v_result := jsonb_build_object(
      'atr_expansion_p70', v_p70,
      'atr_expansion_p85', v_p85,
      'atr_expansion_p30', v_p30,
      'ema_displacement_p80', v_ep80,
      'ema_displacement_p90', v_ep90,
      'ema_displacement_p95', v_ep95,
      'range_compression_p20', v_rp20,
      'range_compression_p35', v_rp35,
      'sample_count', v_sample_count,
      'is_dynamic', v_is_dynamic
    );

    RETURN v_result;
  END;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: get_regime_baselines
-- Read-only fetch of thresholds for a symbol+session
-- Used by the classifier before any candles are available
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_regime_baselines(
  p_symbol text,
  p_session_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row regime_indicator_baselines;
BEGIN
  SELECT * INTO v_row
  FROM regime_indicator_baselines
  WHERE symbol = p_symbol AND session_name = p_session_name;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'atr_expansion_p70', 1.2,
      'atr_expansion_p85', 1.4,
      'atr_expansion_p30', 0.85,
      'ema_displacement_p80', 1.5,
      'ema_displacement_p90', 2.0,
      'ema_displacement_p95', 2.5,
      'range_compression_p20', 0.6,
      'range_compression_p35', 0.75,
      'sample_count', 0,
      'is_dynamic', false
    );
  END IF;

  RETURN jsonb_build_object(
    'atr_expansion_p70', v_row.atr_expansion_p70,
    'atr_expansion_p85', v_row.atr_expansion_p85,
    'atr_expansion_p30', v_row.atr_expansion_p30,
    'ema_displacement_p80', v_row.ema_displacement_p80,
    'ema_displacement_p90', v_row.ema_displacement_p90,
    'ema_displacement_p95', v_row.ema_displacement_p95,
    'range_compression_p20', v_row.range_compression_p20,
    'range_compression_p35', v_row.range_compression_p35,
    'sample_count', v_row.sample_count,
    'is_dynamic', v_row.sample_count >= 20
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- RPC: record_regime_outcome
-- Called by post-trade-analyzer when a trade closes
-- Updates regime_outcome_log with actual trade result
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION record_regime_outcome(
  p_trade_id uuid,
  p_outcome text,
  p_close_reason text,
  p_pnl numeric,
  p_pnl_r numeric,
  p_exit_time timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log regime_outcome_log;
  v_direction_correct boolean;
BEGIN
  SELECT * INTO v_log
  FROM regime_outcome_log
  WHERE trade_id = p_trade_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Determine if the regime direction matched the trade outcome
  -- A regime with a directional label (bullish/bearish) is "correct" if the trade won
  v_direction_correct := CASE
    WHEN v_log.volume_profile_at_entry = 'neutral' THEN NULL  -- neutral regimes have no direction prediction
    WHEN p_outcome = 'win' THEN true
    WHEN p_outcome = 'loss' THEN false
    ELSE NULL
  END;

  UPDATE regime_outcome_log SET
    trade_outcome = p_outcome,
    close_reason = p_close_reason,
    pnl = p_pnl,
    pnl_r = p_pnl_r,
    exit_time = p_exit_time,
    regime_direction_correct = v_direction_correct,
    updated_at = now()
  WHERE id = v_log.id;
END;
$$;
