/*
  # CCIP Change Record — R:R Band Architecture Upgrade

  ## Summary
  Replaces the old per-style R:R floor-only model with a band model (floor + ceiling)
  that gives Alpha full authority to scale TP anywhere within the defined band.

  ## Previous R:R Rules
  - SCALP: minimum 1.5:1 (single TP)
  - MICRO_INTRADAY: TP1 >= 1.5:1, TP2 >= 2.0:1 (hard floors)
  - INTRADAY: TP1 >= 2.0:1, TP2 >= 3.0:1 (hard floors)

  ## New R:R Band Rules
  - SCALP: exactly 1.0:1 (floor = 1.0, ceiling = 1.0). Spread-adjusted net R:R must reach 1.0:1.
  - MICRO_INTRADAY: 1.0:1 minimum to 2.0:1 maximum. Alpha scales freely within band.
  - INTRADAY: 1.0:1 minimum to 3.0:1 maximum. Alpha scales freely within band.

  ## Files Changed
  1. src/config/trading-constants.ts
  2. src/services/omega9-constraint-provider.ts
  3. src/config/alpha-identity.ts
  4. src/brains/coordinator-alpha.ts
*/

INSERT INTO platform_settings (setting_key, setting_value, description, updated_at)
VALUES (
  'ccip_rr_band_upgrade_2026_03_06',
  jsonb_build_object(
    'change_id', 'CCIP-2026-03-06-RR-BAND',
    'type', 'BEHAVIORAL',
    'tier', 3,
    'scalp_min', 1.0,
    'scalp_max', 1.0,
    'micro_min', 1.0,
    'micro_max', 2.0,
    'intraday_min', 1.0,
    'intraday_max', 3.0,
    'previous_scalp_min', 1.5,
    'previous_micro_min', 2.0,
    'previous_intraday_min', 3.0,
    'deployed_at', now()::text
  ),
  'CCIP governance record: R:R band architecture upgrade. Replaces floor-only model with min/max band per style.',
  now()
)
ON CONFLICT (setting_key) DO UPDATE SET
  setting_value = EXCLUDED.setting_value,
  updated_at = now();
