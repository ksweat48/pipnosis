/*
  # Drift-Resilient Geometry Doctrine — CCIP-2026-0519A

  1. Purpose
    - Establishes the doctrine that Alpha must account for expected fill drift
      when computing SL geometry at decision time
    - Prevents the executor's NOISE_BAND_COLLAPSED check from killing valid trades
      that had predictable slippage
    - Shifts noise-band survival from a post-fill gate to a pre-fill reasoning obligation

  2. Changes
    - Inserts power_up row into alpha_engineering_doctrine table

  3. Doctrine Summary
    - Alpha receives his average drift history per symbol at decision time
    - Alpha must compute: effective_sl_after_drift = sl_distance_pips - avg_drift_pips
    - Alpha must verify: sl_post_drift_vs_atr_ratio = effective_sl_after_drift / m5_atr_pips >= 1.0
    - If ratio < 1.0, Alpha widens SL to next structural level and reduces lot size
    - The executor's post-fill NOISE_BAND_COLLAPSED check remains as safety net only

  4. Security
    - No new tables or RLS changes
*/

INSERT INTO alpha_engineering_doctrine (
  ccip_reference,
  ratified_at,
  active,
  supersedes,
  doctrine_text,
  kind,
  power_up_name
) VALUES (
  'CCIP-2026-0519A',
  now(),
  true,
  NULL,
  'DRIFT-RESILIENT GEOMETRY DOCTRINE: Alpha must account for expected fill drift when computing SL geometry at decision time. The reasoning obligation: effective_sl_after_drift = sl_distance_pips - avg_drift_pips. sl_post_drift_vs_atr_ratio = effective_sl_after_drift / m5_atr_pips. This ratio MUST be >= 1.0 at decision time. If it is not, Alpha widens SL to the next structural level that clears the noise band after drift, then reduces lot size to keep dollar risk constant. The executor post-fill NOISE_BAND_COLLAPSED check remains as a safety net but should rarely fire when Alpha reasons correctly about drift-adjusted noise-band survival. This doctrine is a reasoning improvement, not a constraint — Alpha already has drift history and ATR data, he simply lacked the explicit obligation to pre-compute post-drift survival.',
  'power_up',
  'DRIFT-RESILIENT-GEOMETRY'
);
