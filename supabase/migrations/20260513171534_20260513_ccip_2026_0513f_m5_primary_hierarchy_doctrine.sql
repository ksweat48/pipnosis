/*
  # CCIP-2026-0513F: M5-Primary Hierarchy Doctrine

  Ratifies the M5-Primary Hierarchy Doctrine as an amendment to the Trap-Aware
  Geometry Doctrine (CCIP-2026-0513B). Inherits all obligations from
  0511ZZ, 0512A, 0512B, 0513A, 0513B, and 0513C.

  ## Foundational Premise
  Pipnosis is a MICRO_INTRADAY platform pursuing quick wins on M5. The trade
  lives or dies on M5. SL and TP are placed on M5 reality. M15 is a one-line
  directional filter. M1 is optional sniper timing. H1 is background context
  only — never an authority that overrides the active M5 leg. D1 is reference.

  ## What This Migration Does
  1. Marks the previously-active CCIP-2026-0513B row as superseded (active=false)
  2. Inserts the new CCIP-2026-0513F doctrine row as the active SSOT
  3. Establishes supersedes linkage to CCIP-2026-0513B

  ## Security
  No table changes. Pure data insertion in alpha_engineering_doctrine.
*/

DO $$
DECLARE
  v_prev_id uuid;
BEGIN
  SELECT id INTO v_prev_id
  FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0513B-TRAP-AWARE-GEOMETRY'
  LIMIT 1;

  UPDATE alpha_engineering_doctrine
  SET active = false
  WHERE active = true
    AND ccip_reference <> 'CCIP-2026-0513F-M5-PRIMARY-HIERARCHY';

  INSERT INTO alpha_engineering_doctrine (ccip_reference, doctrine_text, active, supersedes)
  VALUES (
    'CCIP-2026-0513F-M5-PRIMARY-HIERARCHY',
    $DOC$
M5-PRIMARY HIERARCHY DOCTRINE — CCIP-2026-0513F

Ratified 2026-05-13. Identity-level amendment to the Trap-Aware Geometry
Doctrine (CCIP-2026-0513B). Inherits all obligations from CCIP-2026-0511ZZ,
CCIP-2026-0512A, CCIP-2026-0512B, CCIP-2026-0513A, CCIP-2026-0513B, and
CCIP-2026-0513C.

FOUNDATIONAL PREMISE
Pipnosis is a MICRO_INTRADAY platform that hunts quick wins on the M5 timeframe.
The trade lives, breathes, and dies on M5. Stop-loss and take-profit are placed
against M5 structure and the current M5 leg's reality. Higher timeframes do not
execute trades — M5 does.

TIMEFRAME AUTHORITY ORDER
1. M5 — PRIMARY BATTLEFIELD. The only timeframe that decides whether the
   trade is currently working. SL/TP/entry geometry is anchored here.
2. M15 — DIRECTIONAL FILTER. One-line check: is M15 broadly aligned, mixed,
   or opposed? It does not override M5; it informs whether tailwind exists.
3. M1 — OPTIONAL SNIPER TIMING. Used only for fine-tuning entry trigger
   when M5 is at a decision point. Never the primary authority.
4. H1 — BACKGROUND CONTEXT ONLY. A rough higher-frame snapshot. H1 alignment
   does not authorize a trade against an active opposing M5 leg.
5. D1 — REFERENCE ONLY. Macro location.

PROHIBITED REASONING
1. Treating H1 as the primary or controlling timeframe
2. Anchoring SL or TP to H1 or M15 levels when an M5 level is closer and
   structurally relevant
3. Allowing an H1 trend bias to override an active opposing M5 leg
4. Q1-style "trend alignment" reasoning that ranks H1 above M5
5. Phrases that elevate H1: "CONTROL TF", "H1 control", "H1 authority",
   "H1-driven entry", "wait for H1 confirmation"
6. Hard execution gates blocking trades on H1 alignment grounds — Alpha's
   reasoning is the authority; the schema records, never redirects

REQUIRED AUDIT FIELDS
On every scan, Alpha records the M5-primary reconciliation:
- directional_authority — must equal 'm5'
- m5_direction_call — Alpha's read of the active M5 leg (BUY_BIAS,
  SELL_BIAS, or NEUTRAL)
- m5_micro_leg_state — current M5 leg state (impulse_up, impulse_down,
  pullback_up, pullback_down, range, exhaustion)
- m15_filter_check — 'aligned' | 'mixed' | 'opposed' | 'irrelevant'
- m1_sniper_used — boolean, whether M1 informed entry timing
- h1_background_only — boolean, must be true; confirms H1 was treated as
  context, not authority

PERMITTED PROMPT CONTENT
- Raw M5 columnar OHLC tables (oldest→newest), placed FIRST in the MTF block
- Raw M5 sensor readings (leg length, consecutive same-color candles,
  exhaustion pocket distance, recent BOS/sweep flags)
- M15 raw readings reduced to one-line filter summary
- M1 raw readings only when sniper timing is being considered
- H1 raw readings as a brief background snapshot, never as a directional
  authority

PROHIBITED PROMPT CONTENT
1. H1 listed first in MTF block
2. H1 framed as "control", "primary", or "authority"
3. M15 framed as "directional authority" rather than filter
4. Any "wait for higher-timeframe alignment" instruction
5. Any "trend alignment" framing that ranks H1 trend above active M5 leg

INFRASTRUCTURE PROHIBITIONS
- No execution gates on H1 alignment
- No data-integrity wall that rejects scans for missing H1 candles when M5
  data is sufficient (downgrade H1 absence to advisory)
- No coordinator code that rewrites Alpha's direction based on H1 bias

ENFORCEMENT
- Build-time audit script blocks H1-elevation tokens in alpha-identity.ts,
  coordinator-alpha.ts, and multi-timeframe-pattern-intelligence.ts
- Schema requires the six M5-primary audit fields with directional_authority
  pinned to 'm5' via enum constraint
- This Supabase row is the SSOT; deviations require an explicit superseding
  CCIP amendment
$DOC$,
    true,
    v_prev_id
  );
END $$;