/*
  # Surface Noise Floor Raw Data to Alpha — CCIP-2026-0520B

  ## Summary
  Alpha was placing stops that cleared the M5 ATR noise check (1x ATR) but sat well inside
  the asset-specific noise floor (0.2% of price for XAUUSD = 9.1 pips vs 2.1 pip ATR).
  The noise floor was computed by the system but never surfaced to Alpha as raw data.
  
  Root cause: Alpha only received ATR (2.1 pips) as a noise reference. He placed a 3.5 pip
  stop which passed the 1x ATR check but was inside the true 9.1 pip noise floor. Price
  moved 5.3 pips against before going in Alpha's correct direction — stopped out on noise.

  ## Changes
  1. coordinator-alpha.ts: Added noise_floor_pips as a raw numeric reading alongside ATR
  2. alpha-identity.ts: Updated noise-band survival reasoning to reference max(ATR, noise_floor)
  3. alpha-output-schema.ts: Added sl_vs_noise_floor_ratio audit field

  ## Governance
  - Per Raw-Data Doctrine (CCIP-2026-0512A): noise_floor is raw data, not a verdict or gate
  - Per Alpha Autonomy Doctrine (CCIP-2026-0511ZZ): Alpha decides how to use the data
  - No new gates, floors, or constraints added — only raw data surfaced

  ## Expected Behavior
  Alpha will now see both ATR and noise_floor, and reason that his SL must clear the larger
  of the two. For XAUUSD at $4543: noise_floor = 9.1 pips, so Alpha should widen SL beyond
  9.1 pips to the next structural level and reduce lot size to maintain dollar risk.
*/

-- No schema changes required — this is a prompt/code-only change.
-- Recording the governance event for audit trail.
SELECT 1;