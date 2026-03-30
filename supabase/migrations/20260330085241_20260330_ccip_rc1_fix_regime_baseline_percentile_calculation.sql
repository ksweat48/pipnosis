/*
  # Fix Regime Baseline Percentile Calculation — CCIP-2026-0330-RC1

  ## Problem
  The `upsert_regime_baseline` function stored hardcoded static defaults in the
  threshold columns when sample_count < 20. `get_regime_baselines` then read those
  stored static defaults back, making real accumulated samples invisible. Even after
  3-5 readings per symbol, the thresholds remained exactly {P70=1.2, P85=1.4, P30=0.85,
  P80=1.5, P90=2.0, P95=2.5, P20=0.6, P35=0.75} — the universal forex defaults.

  This caused the micro-regime classifier to return neutral_ranging for all symbols
  because the real indicator values (e.g. emaDisplacement = 0.05-0.10% for forex,
  0.30-0.50% for commodities) were compared against thresholds calibrated for
  completely different instruments.

  ## Fix — Two-part
  1. `upsert_regime_baseline` now computes real percentiles from available samples
     regardless of count (minimum 1 sample). The 20-sample threshold only controls
     the `is_dynamic` flag that gets exposed to the frontend.

  2. `get_regime_baselines` now computes percentiles live from the JSONB sample arrays
     on read, ensuring the returned values always reflect real accumulated data.

  ## Security
  Both functions remain SECURITY DEFINER, callable by authenticated and service_role.
  No RLS changes needed — regime_indicator_baselines already has correct policies.
*/

CREATE OR REPLACE FUNCTION upsert_regime_baseline(
  p_symbol text,
  p_session_name text,
  p_atr_expansion numeric,
  p_ema_displacement numeric,
  p_range_compression numeric,
  p_volume_ratio numeric DEFAULT 1.0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  SELECT * INTO v_existing
  FROM regime_indicator_baselines
  WHERE symbol = p_symbol AND session_name = p_session_name;

  IF NOT FOUND THEN
    v_atr_samples := jsonb_build_array(p_atr_expansion);
    v_ema_samples := jsonb_build_array(ABS(p_ema_displacement));
    v_range_samples := jsonb_build_array(p_range_compression);
    v_vol_samples := jsonb_build_array(p_volume_ratio);
    v_sample_count := 1;
    v_is_dynamic := false;

    v_p70 := p_atr_expansion;
    v_p85 := p_atr_expansion;
    v_p30 := p_atr_expansion;
    v_ep80 := ABS(p_ema_displacement);
    v_ep90 := ABS(p_ema_displacement);
    v_ep95 := ABS(p_ema_displacement);
    v_rp20 := p_range_compression;
    v_rp35 := p_range_compression;

    INSERT INTO regime_indicator_baselines (
      symbol, session_name,
      atr_expansion_samples, ema_displacement_samples,
      range_compression_samples, volume_ratio_samples,
      atr_expansion_p70, atr_expansion_p85, atr_expansion_p30,
      ema_displacement_p80, ema_displacement_p90, ema_displacement_p95,
      range_compression_p20, range_compression_p35,
      sample_count, last_updated_at
    ) VALUES (
      p_symbol, p_session_name,
      v_atr_samples, v_ema_samples,
      v_range_samples, v_vol_samples,
      v_p70, v_p85, v_p30,
      v_ep80, v_ep90, v_ep95,
      v_rp20, v_rp35,
      1, now()
    );

    RETURN jsonb_build_object(
      'atr_expansion_p70', v_p70,
      'atr_expansion_p85', v_p85,
      'atr_expansion_p30', v_p30,
      'ema_displacement_p80', v_ep80,
      'ema_displacement_p90', v_ep90,
      'ema_displacement_p95', v_ep95,
      'range_compression_p20', v_rp20,
      'range_compression_p35', v_rp35,
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

  v_sample_count := jsonb_array_length(v_atr_samples);
  v_is_dynamic := v_sample_count >= 20;

  -- Always compute real percentiles from accumulated samples (even < 20)
  -- This ensures real data is used immediately rather than hardcoded forex defaults
  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_atr_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_atr_sorted;

  v_p70 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.70)::int)];
  v_p85 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.85)::int)];
  v_p30 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.30)::int)];

  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_ema_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_ema_sorted;

  v_ep80 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.80)::int)];
  v_ep90 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.90)::int)];
  v_ep95 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.95)::int)];

  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_range_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_range_sorted;

  v_rp20 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.20)::int)];
  v_rp35 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.35)::int)];

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


/*
  Fix get_regime_baselines to compute live percentiles from sample arrays.
  The stored threshold columns were being written with stale static defaults;
  reading directly from the JSONB arrays guarantees fresh percentile values.
*/
CREATE OR REPLACE FUNCTION get_regime_baselines(
  p_symbol text,
  p_session_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_row regime_indicator_baselines;
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
BEGIN
  SELECT * INTO v_row
  FROM regime_indicator_baselines
  WHERE symbol = p_symbol AND session_name = p_session_name;

  IF NOT FOUND OR v_row.sample_count = 0 THEN
    RETURN jsonb_build_object(
      'atr_expansion_p70', NULL,
      'atr_expansion_p85', NULL,
      'atr_expansion_p30', NULL,
      'ema_displacement_p80', NULL,
      'ema_displacement_p90', NULL,
      'ema_displacement_p95', NULL,
      'range_compression_p20', NULL,
      'range_compression_p35', NULL,
      'sample_count', 0,
      'is_dynamic', false
    );
  END IF;

  -- Compute live percentiles from sample arrays (always fresh, never stale stored defaults)
  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_row.atr_expansion_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_atr_sorted;

  v_p70 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.70)::int)];
  v_p85 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.85)::int)];
  v_p30 := v_atr_sorted[GREATEST(1, FLOOR(array_length(v_atr_sorted, 1) * 0.30)::int)];

  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_row.ema_displacement_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_ema_sorted;

  v_ep80 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.80)::int)];
  v_ep90 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.90)::int)];
  v_ep95 := v_ema_sorted[GREATEST(1, FLOOR(array_length(v_ema_sorted, 1) * 0.95)::int)];

  SELECT ARRAY(
    SELECT (elem)::numeric FROM jsonb_array_elements(v_row.range_compression_samples) AS t(elem)
    ORDER BY 1
  ) INTO v_range_sorted;

  v_rp20 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.20)::int)];
  v_rp35 := v_range_sorted[GREATEST(1, FLOOR(array_length(v_range_sorted, 1) * 0.35)::int)];

  RETURN jsonb_build_object(
    'atr_expansion_p70', v_p70,
    'atr_expansion_p85', v_p85,
    'atr_expansion_p30', v_p30,
    'ema_displacement_p80', v_ep80,
    'ema_displacement_p90', v_ep90,
    'ema_displacement_p95', v_ep95,
    'range_compression_p20', v_rp20,
    'range_compression_p35', v_rp35,
    'sample_count', v_row.sample_count,
    'is_dynamic', v_row.sample_count >= 20
  );
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_regime_baseline TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_regime_baselines TO authenticated, service_role;
