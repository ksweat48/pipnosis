/*
  # Fix upsert_regime_baseline nested DECLARE block bug

  ## Problem
  The existing `upsert_regime_baseline` function has a nested DECLARE block
  inside the function body after the main BEGIN has already started. This is
  invalid PL/pgSQL syntax that compiles but throws a runtime error on every
  call, causing a 400 Bad Request from PostgREST.

  ## Fix
  All variable declarations are moved to the top-level DECLARE block. The inner
  DECLARE...BEGIN...END wrapper is removed and the logic is flattened into a
  single block. No table changes, no signature changes.

  ## Changes
  - Modified: `upsert_regime_baseline` function body only
  - No table schema changes
  - No RLS changes
  - TypeScript callers unchanged
*/

CREATE OR REPLACE FUNCTION public.upsert_regime_baseline(
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
SET search_path TO 'public'
AS $$
DECLARE
  v_existing regime_indicator_baselines;
  v_atr_samples jsonb;
  v_ema_samples jsonb;
  v_range_samples jsonb;
  v_vol_samples jsonb;
  v_max_samples constant integer := 100;
  v_result jsonb;
  v_sample_count integer;
  v_atr_sorted numeric[];
  v_ema_sorted numeric[];
  v_range_sorted numeric[];
  v_p70 numeric;
  v_p85 numeric;
  v_p30 numeric;
  v_ep80 numeric;
  v_ep90 numeric;
  v_ep95 numeric;
  v_rp20 numeric;
  v_rp35 numeric;
  v_is_dynamic boolean;
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
  v_atr_samples := v_existing.atr_expansion_samples || jsonb_build_array(p_atr_expansion);
  IF jsonb_array_length(v_atr_samples) > v_max_samples THEN
    SELECT jsonb_agg(elem) INTO v_atr_samples
    FROM (
      SELECT elem FROM jsonb_array_elements(v_atr_samples) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT v_max_samples
    ) sub;
  END IF;

  v_ema_samples := v_existing.ema_displacement_samples || jsonb_build_array(ABS(p_ema_displacement));
  IF jsonb_array_length(v_ema_samples) > v_max_samples THEN
    SELECT jsonb_agg(elem) INTO v_ema_samples
    FROM (
      SELECT elem FROM jsonb_array_elements(v_ema_samples) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT v_max_samples
    ) sub;
  END IF;

  v_range_samples := v_existing.range_compression_samples || jsonb_build_array(p_range_compression);
  IF jsonb_array_length(v_range_samples) > v_max_samples THEN
    SELECT jsonb_agg(elem) INTO v_range_samples
    FROM (
      SELECT elem FROM jsonb_array_elements(v_range_samples) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT v_max_samples
    ) sub;
  END IF;

  v_vol_samples := v_existing.volume_ratio_samples || jsonb_build_array(p_volume_ratio);
  IF jsonb_array_length(v_vol_samples) > v_max_samples THEN
    SELECT jsonb_agg(elem) INTO v_vol_samples
    FROM (
      SELECT elem FROM jsonb_array_elements(v_vol_samples) WITH ORDINALITY AS t(elem, ord)
      ORDER BY ord DESC LIMIT v_max_samples
    ) sub;
  END IF;

  -- Determine sample count and whether dynamic calibration is ready
  v_sample_count := jsonb_array_length(v_atr_samples);
  v_is_dynamic := v_sample_count >= 20;

  IF v_is_dynamic THEN
    -- Extract and sort ATR samples
    SELECT ARRAY(
      SELECT (elem)::numeric FROM jsonb_array_elements(v_atr_samples) AS t(elem)
      ORDER BY 1
    ) INTO v_atr_sorted;

    v_p70 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.70)::int)];
    v_p85 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.85)::int)];
    v_p30 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.30)::int)];

    -- Extract and sort EMA displacement samples
    SELECT ARRAY(
      SELECT (elem)::numeric FROM jsonb_array_elements(v_ema_samples) AS t(elem)
      ORDER BY 1
    ) INTO v_ema_sorted;

    v_ep80 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.80)::int)];
    v_ep90 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.90)::int)];
    v_ep95 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.95)::int)];

    -- Extract and sort range compression samples
    SELECT ARRAY(
      SELECT (elem)::numeric FROM jsonb_array_elements(v_range_samples) AS t(elem)
      ORDER BY 1
    ) INTO v_range_sorted;

    v_rp20 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.20)::int)];
    v_rp35 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.35)::int)];
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
$$;
