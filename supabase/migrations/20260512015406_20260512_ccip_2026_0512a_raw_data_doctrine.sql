/*
  # CCIP-2026-0512A — Raw-Data Doctrine

  1. Doctrine Change
    - Supersedes CCIP-2026-0511ZZ (Alpha Autonomy Doctrine)
    - Mandates Alpha receives ONLY raw sensor data — no interpretation,
      labels, verdicts, teachings, or historical performance
    - Alpha already knows market mechanics; system delivers unprocessed
      readings and records his decisions

  2. Enforcement
    - Deactivates CCIP-2026-0511ZZ row first to respect partial unique
      index idx_alpha_engineering_doctrine_active_one
    - Inserts CCIP-2026-0512A as sole active doctrine, linking via
      supersedes uuid FK to the prior row
    - Build-time audit guard extended separately

  3. Security
    - No RLS changes. Governance-only table.
*/

DO $$
DECLARE
  v_prior_id uuid;
BEGIN
  SELECT id INTO v_prior_id
  FROM public.alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0511ZZ'
    AND active = true
  LIMIT 1;

  IF v_prior_id IS NOT NULL THEN
    UPDATE public.alpha_engineering_doctrine
    SET active = false
    WHERE id = v_prior_id;
  END IF;

  INSERT INTO public.alpha_engineering_doctrine (
    ccip_reference,
    doctrine_text,
    active,
    ratified_at,
    supersedes
  ) VALUES (
    'CCIP-2026-0512A',
$doctrine$
RAW-DATA DOCTRINE (CCIP-2026-0512A) — NON-NEGOTIABLE

Ratified 2026-05-12. Supersedes CCIP-2026-0511ZZ (Alpha Autonomy Doctrine).
This record is the SSOT for Pipnosis engineering law. Any PR, agent, or
contributor that violates it must be rejected on architectural grounds.

FOUNDATIONAL PREMISE
Alpha is an institutional-grade reasoning system. He already understands
every market move, signal, phase, pattern, session behavior, and structural
mechanic. He does NOT require definitions, labels, verdicts, or teachings
from infrastructure code. He requires RAW DATA and the discipline to
reason from it.

The system's sole responsibilities toward Alpha are:
  (1) deliver raw sensor readings (numbers, prices, booleans, counts)
  (2) record his decisions for audit and learning
Never to interpret, pre-classify, or verdict the market on his behalf.

PROHIBITED PROMPT CONTENT
No context builder, formatter, or prompt-assembly function may inject:
  1. Interpretation labels for market moves (e.g., "momentum peaking",
     "exhausting", "building", "compressing")
  2. Phase names or hunt descriptions ("post_sweep_resolving",
     "look for continuation", "reversal setups are active")
  3. Pattern verdicts or alignment narratives ("SUPPORTS:", "CONFLICTS:",
     "Overall Reasoning:", "Direction Bias:", "Direction Aligned:")
  4. Intent labels per timeframe ("HTF Intent: bullish")
  5. Signal classifications ("REJECTION WICK detected — possible exhaustion",
     "bullish absorption on M15", "strong wick", "structural observation")
  6. Historical trade performance summaries (recent win/loss, best/worst
     performing pairs, R:R ratio success rates, trade history)
  7. Teaching narratives about what phase supports which hunt type
  8. Directional suggestions ("Long targets", "Short targets" — use
     "above price" / "below price" instead)
  9. Confidence recommendations, tier prescriptions, or entry-mode choices
  10. Any sentence that tells Alpha what the market is doing rather than
      showing him the numbers

PERMITTED PROMPT CONTENT
Context builders may emit only:
  - Raw numeric readings (ratios, percentiles, counts, prices)
  - Boolean flags (swept=true, bos_confirmed=false)
  - Pattern type names without interpretation (pattern_type=double_top)
  - Price levels without directional framing
  - Schema contract references when the output contract changes

PROHIBITED INFRASTRUCTURE CHANGES
No infrastructure code may:
  1. Inject historical performance data into Alpha's prompt
  2. Pre-classify market regimes in the prompt text
  3. Translate sensor outputs into English narratives
  4. Add verdict layers on top of raw data
  5. Intercept Alpha's output or redirect his decisions
  6. Add execution gates, confidence floors, phase-locks, or session-locks
     to fix a reasoning problem

PERMITTED INFRASTRUCTURE CHANGES
Infrastructure may only:
  - Enforce data integrity (schema presence, type safety, ledger
    consistency, no-null contracts at the transport layer)
  - Record Alpha's decisions for audit and learning
  - Surface raw sensor data to Alpha
  - Correct true semantic contradictions that the schema cannot express

IF ALPHA MAKES A BAD DECISION
The fix is ALWAYS to improve the quality of his reasoning via the prompt,
or to deliver additional RAW data he was missing. Never a gate, block,
floor, phase-lock, session-lock, pattern-specific rule, symbol-specific
rule, or interpretation layer.

ENFORCEMENT
  - Every prompt or context-builder change must cite this doctrine
  - Build-time audit script scripts/audit-alpha-identity.cjs scans for
    forbidden tokens across alpha-identity.ts, coordinator-alpha.ts,
    and all prompt formatter files
  - This Supabase row is the SSOT — any deviation must first supersede
    this record with an explicit CCIP amendment

INHERITED OBLIGATIONS FROM CCIP-2026-0511ZZ (still in force)
  - No step-numbered procedural brackets
  - No IF pattern=X THEN output=Y rules
  - No pre-execution or confirmation checklists
  - Decision-first / audit-second ordering preserved
$doctrine$,
    true,
    now(),
    v_prior_id
  );
END $$;