/*
  # CCIP-2026-0513L Move-Phase Sealing Doctrine

  Supersedes CCIP-2026-0513K. Deactivates the prior active row and inserts
  the new doctrine row as active. Records the supersedes linkage so the
  audit trail is preserved.

  1. Data
    - Sets active = false on CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING
    - Inserts CCIP-2026-0513L-MOVE-PHASE-SEALING with supersedes pointing
      at the 0513K row id, active = true
*/

DO $$
DECLARE
  v_supersedes_id uuid;
BEGIN
  SELECT id INTO v_supersedes_id
  FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING';

  UPDATE alpha_engineering_doctrine
  SET active = false
  WHERE ccip_reference = 'CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING';

  INSERT INTO alpha_engineering_doctrine (ccip_reference, ratified_at, doctrine_text, active, supersedes)
  VALUES (
    'CCIP-2026-0513L-MOVE-PHASE-SEALING',
    '2026-05-13T00:00:00Z',
    $DOC$MOVE-PHASE SEALING DOCTRINE — Ratified 2026-05-13.

Inherits all obligations from CCIP-2026-0511ZZ (Alpha Autonomy), CCIP-2026-0512A (Raw-Data),
CCIP-2026-0512B (MTF Layer Contract), CCIP-2026-0513A (Profitability & Invalidation),
CCIP-2026-0513B (Trap-Aware Geometry), CCIP-2026-0513J (Sealed-Prompt), and
CCIP-2026-0513K (Coordinator Prompt Sealing).

Foundational Premise.
A 2026-05-13 audit of a losing XAUUSD SELL trade revealed two compounding failures.
First, a residual bias channel: the M5 MOVE PHASE block in coordinator-alpha.ts
emitted English verdicts (FRESH / DEVELOPING / EXHAUSTED), direction-named
fakeout labels (BEARISH_FAKEOUT / BULLISH_FAKEOUT), and teaching sentences
("The move is extended", "Document the structural picture honestly",
"Full structural space available") directly into Alpha's prompt. The block
had survived CCIP-2026-0513J because coordinator-alpha.ts sits in
RAW_DATA_TARGETS (broad scope) rather than SEALED_PROMPT_TARGETS (strict scope).
Second, an identity reasoning gap: alpha-identity.ts contained no obligation
to register sweep polarity (high-sweep vs low-sweep) before claiming an
exhaustion-reversal direction. Alpha labelled an extended leg "exhausted"
without identifying which side of price had just been swept, then chose the
direction opposite to the textbook reclaim — selling into a high-sweep
reclaim setup that called for a BUY.

The Sealed M5 Move-Phase Contract.
The M5 block in coordinator-alpha.ts now emits raw symmetric codes only:
move_phase_code 0|1|2, leg_direction +1|0|-1, most_recent_extreme_break_code
+1|0|-1, sweep_of_high_detected/sweep_of_low_detected booleans,
sweep_candles_ago integer, sweep_reversal_confirmed boolean, and the raw
ATR/anchor numerics. The answer-sheet field changes from m5_move_phase to
m5_move_phase_code with the same 0|1|2 contract. All English verdicts,
directional fakeout labels, and teaching sentences are removed.

The Sweep-Polarity Reasoning Obligation.
alpha-identity.ts gains a MOVE-PHASE / SWEEP-POLARITY DOCTRINE block that
makes the directional implication of sweep polarity explicit. high-sweep
implies a BUY-favored reclaim by default; low-sweep implies SELL-favored
reclaim or BUY-favored trap-resolution depending on rejection structure.
Alpha must explicitly reconcile his action with sweep polarity before any
exhaustion-reversal call.

New Directional Integrity Cross-Checks.
SWEEP-DIRECTION INVERSION: when most_recent_extreme_break_code is non-zero
and the action is opposite the textbook reclaim polarity, the audit must
contain a named, evidence-cited reason. EXTREME-BREAK SENSOR CONTRADICTION:
if sweep_of_high_detected/sweep_of_low_detected disagree with
most_recent_extreme_break_code, execute_now is blocked until reconciled.

Enforcement.
scripts/audit-alpha-identity.cjs gains eight RAW_DATA_FORBIDDEN patterns
that block re-introduction of the removed constructs. coordinator-alpha.ts
remains in RAW_DATA_TARGETS; the new patterns target the specific
prompt-feeding constructs that were removed.

Engineering Law.
Any PR that re-introduces English move-phase verdicts, direction-named
fakeout labels, or move-phase teaching sentences in any prompt-feeding
file must be rejected on architectural grounds. The M5 move-phase block
is sealed. Alpha reads the raw code and decides.$DOC$,
    true,
    v_supersedes_id
  );
END $$;
