/*
  # CCIP-2026-03-18: Alpha Full SL/TP Authority — Coordinator Price Mutation Removal

  ## Summary
  Governance record for a critical accountability fix applied to coordinator-alpha.ts.

  ## What Changed (coordinator-alpha.ts)

  ### 1. SL Anchor Lift Removed (PRE-ALPHA)
  The coordinator previously silently lifted the buy/sell SL anchor pips/price to the
  wall minimum BEFORE sending data to Alpha. This meant Alpha saw a pre-corrected anchor
  and chose a SL relative to a value the coordinator had already modified.
  REMOVED. Anchors are now presented exactly as computed by the stop calculator.

  ### 2. Sweep-Aware Anchor Log Reclassified (PRE-ALPHA)
  Console logs announcing "SWEEP-AWARE SL: X → Y pips" were worded as a correction
  applied to Alpha's view. Reclassified to advisory: "SL Anchor Advisory — presented
  as advisory to Alpha."

  ### 3. TP Nudge Repair Removed (POST-ALPHA)
  After Alpha returned its decision, the coordinator lifted decision.takeProfit to the
  wall minimum when Alpha placed a TP below that threshold — silently mutating Alpha's
  chosen price. Fields decision.tp_nudged and decision.tp_nudge_reason also set.
  REMOVED. Alpha's takeProfit is never modified after Alpha decides.

  ### 4. Wall Violations Converted from Hard Block to Advisory (POST-ALPHA)
  SL below wall min, SL above wall max, TP below wall min, TP above wall max previously
  accumulated into wallViolations[] which forced decision.action = 'NO_TRADE' with
  confidence = 0. Now converted to wallAdvisories[] — logged diagnostically with
  blocked: false. The decision passes through untouched.

  ### 5. Prompt Language Updated
  - "HARD WALLS ... AUTO-REJECTED" → "EXPECTED ENVELOPE ... logged for analysis but not rejected"
  - Sweep zone: "BINDING RULE: You MUST NOT" → advisory text preserving Alpha's authority
  - "Stops placed inside the swept zone will be auto-rejected by Omega-9" → removed

  ## What Stays (Omega-9 — Mathematical Impossibility Only)
  - SL on wrong side of entry (BUY SL >= entry, SELL SL <= entry)
  - TP on wrong side of entry (BUY TP <= entry, SELL TP >= entry)
  - Zero distance (SL or TP at entry)
  - Stop inside spread (cannot survive broker fill)
  - Catastrophic R:R (Omega-9 threshold)

  ## Accountability Principle
  Every SL and TP in the trades table is now exactly what Alpha chose.
  Post-trade analysis can attribute placement decisions to Alpha without ambiguity.
  When a trade fails, the failure belongs to Alpha's structural judgment, not to
  a coordinator modification that obscured what Alpha actually decided.

  ## Violation Type Change
  ALPHA_WALL_VIOLATION (blocked: true) → ALPHA_WALL_ADVISORY (blocked: false)
  Existing logged violations remain in ssot_violations for historical reference.

  ## No Schema Changes
  This migration is a governance-only record. No DDL or DML.
*/

DO $$
BEGIN
  RAISE NOTICE 'CCIP-2026-03-18: Alpha Full SL/TP Authority governance record applied.';
  RAISE NOTICE 'coordinator-alpha.ts: SL anchor lift removed, TP nudge repair removed, wall checks advisory-only.';
  RAISE NOTICE 'Omega-9 (mathematical impossibility) remains the sole veto authority.';
END $$;
