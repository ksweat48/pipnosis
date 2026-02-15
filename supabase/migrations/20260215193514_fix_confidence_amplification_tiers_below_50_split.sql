/*
  # Fix Confidence Amplification Tiers - Split below_50 into Granular Ranges

  ## Problem
  The omega_weight_profiles table stores confidence_amplification_tiers JSONB with keys:
  - below_50, 50_to_69, 70_to_79, 80_to_89, 90_to_100

  But the omega-weight-resolver code expects:
  - below_20, 20_to_49, 50_to_69, 70_to_79, 80_to_89, 90_to_100

  This mismatch causes getConfidenceMultiplier() to return undefined for confidence < 50,
  which propagates NaN through the entire weight calculation pipeline, blocking ALL trades.

  ## Fix
  Update all omega_weight_profiles rows to include BOTH old and new tier keys:
  - Keep below_50 for backwards compatibility
  - Add below_20 (0.4x) and 20_to_49 (0.7x) as granular replacements
  - Both old and new code paths will work correctly

  ## Tables Modified
  - omega_weight_profiles: Updated confidence_amplification_tiers JSONB column

  ## Security
  - No RLS changes
  - No new tables
*/

UPDATE omega_weight_profiles
SET confidence_amplification_tiers = jsonb_build_object(
  'below_20', 0.4,
  'below_50', 0.7,
  '20_to_49', 0.7,
  '50_to_69', 1.0,
  '70_to_79', 1.2,
  '80_to_89', 1.5,
  '90_to_100', 2.0
),
updated_at = now()
WHERE active = true;
