/*
  # CCIP-2026-0513M-SEALED-COORDINATOR Doctrine Persistence

  ## Summary
  Records the CCIP-2026-0513M Sealed-Coordinator Doctrine in the
  alpha_engineering_doctrine table as the active SSOT row, superseding
  the prior active row. This doctrine seals the remaining HIGH and
  MEDIUM bias-channel injection sites in coordinator-alpha.ts and
  market-briefing-builder.ts identified in the 2026-05-14 audit.

  ## Changes
  1. Deactivate the prior active doctrine row
  2. Insert the new 0513M doctrine row with active=true and supersedes
     pointing at the deactivated row's id

  ## Security
  No table or RLS changes. Single-row write under existing policies.

  ## Notes
  Uses a DO $$ block to satisfy the
  idx_alpha_engineering_doctrine_active_one unique constraint, which
  permits exactly one row with active=true at a time.
*/

DO $$
DECLARE
  v_supersedes_id uuid;
BEGIN
  SELECT id INTO v_supersedes_id
  FROM alpha_engineering_doctrine
  WHERE active = true
  LIMIT 1;

  IF v_supersedes_id IS NOT NULL THEN
    UPDATE alpha_engineering_doctrine
    SET active = false
    WHERE id = v_supersedes_id;
  END IF;

  INSERT INTO alpha_engineering_doctrine (
    ccip_reference,
    doctrine_text,
    active,
    supersedes,
    ratified_at
  ) VALUES (
    'CCIP-2026-0513M-SEALED-COORDINATOR',
    $doctrine$
CCIP-2026-0513M-SEALED-COORDINATOR — Sealed-Coordinator Doctrine
Ratified 2026-05-14.
Inherits all obligations from 0511ZZ, 0512A, 0512B, 0513A, 0513B, 0513J, 0513K, 0513L.

FOUNDATIONAL PREMISE
A 2026-05-14 audit identified twelve remaining bias-channel injection sites
across coordinator-alpha.ts and market-briefing-builder.ts after the 0513L
move-phase sealing. Six were HIGH severity (Premium/Discount/Equilibrium
zone English; regimeCategory.toUpperCase() REGIME CONTEXT push; "Derive Q8C"
teaching; ATR-legend FRESH/DEVELOPING/EXHAUSTED English; SCAN MANDATE +
CONVICTION STANDARD tier-to-action map + Q_DIR/Q_RANGE/Q_EDGE block; ENTRY
MODE STEP 1/2/3 procedural sequence with COUNTER-MOMENTUM FADE CHECK). Six
were MEDIUM severity (marketPhase English in briefing; wickBias English
labels; sweep_type English with .toUpperCase(); "Note: sensor readings"
teaching footer; "conviction candle" interpretation teaching; "ADVISORY:
Move is extended" teaching). All twelve channels permitted Alpha to defer
to verdict labels rather than reason from raw numerics.

THE SEALED CONTRACT EXTENSION
Every removed site now emits raw numerics or symmetric +1/0/-1 codes.

- Swing-range location: swing_high, swing_low, position_pct (0-100).
  No PREMIUM/DISCOUNT/EQUILIBRIUM English. No regime-conflict advisory.
- Move-stage thresholds: phase_0_max_pips, phase_1_max_pips, active_atr_pips.
  No FRESH/DEVELOPING/EXHAUSTED English. No "ADVISORY: Move is extended."
- Wick bias: wb code in {+1 upper, -1 lower, 0 balanced}. No English
  in the candle string.
- Sweep type: sweep_type_code in {+1 high, -1 low, 0 none}. No "HIGH" /
  "LOW" verdict in the briefing or coordinator. No "Note: sensor readings"
  teaching footer.
- Confluence signals[]: bounded to /^[a-z0-9_]+$/ alphabet. English
  classification phrases filtered out at the formatter boundary.
- marketPhase: removed from briefing prompt entirely.
- ENTRY MODE block: GOVERNANCE RULE + ENTRY MODE OPTIONS + JSON schema
  reminder retained. STEP 1/2/3, MANDATORY DECISION SEQUENCE, and
  COUNTER-MOMENTUM FADE CHECK procedural sequences removed. Monitor-off
  branch reduced to brief governance + monitor_active=false note.
- Decision framing: SCAN MANDATE paragraph, CONVICTION STANDARD tier-to-
  action permitted-set prescriptions, advisory-sources teaching, and
  OPPORTUNITY ASSESSMENT Q_DIR/Q_RANGE/Q_EDGE block all removed. Replaced
  with a SCHEMA NOTE listing the four valid confidence_tier values and
  the existing LEGITIMATE_BLOCK_CONDITIONS list as the only automatic
  NO_TRADE conditions.
- conviction-candle / indecision / institutional-rejection-signal
  interpretation teaching removed from candle FORMAT description.
  body_p, upW_p, loW_p declared as raw pip measurements only.

SCANNER ENFORCEMENT
scripts/audit-alpha-identity.cjs gains 22 new patterns in
RAW_DATA_FORBIDDEN that block re-introduction of the removed constructs.

ENGINEERING LAW
Any PR that re-introduces the removed bias-channel constructs must be
rejected on architectural grounds. The infrastructure is sealed.
Alpha reads raw data and decides.
$doctrine$,
    true,
    v_supersedes_id,
    now()
  );
END $$;