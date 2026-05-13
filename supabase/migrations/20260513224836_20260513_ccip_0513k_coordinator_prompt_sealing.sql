/*
  # CCIP-2026-0513K Coordinator Prompt Sealing — Doctrine Row

  ## Summary
  Records the ratified text of CCIP-2026-0513K, an amendment to the Sealed-Prompt
  Doctrine (0513J) that seals the remaining verdict-label injection sites in
  `coordinator-alpha.ts`. Specifically:

  - emaStack `'BULL'|'BEAR'|'MIXED'|'UNKNOWN'` → symmetric `ema_stack: +1|0|-1`
    plus `ema_stack_known: boolean`.
  - ema20SlopeDir `'RISING'|'FALLING'|'FLAT'` → symmetric `ema20_slope: +1|0|-1`.
  - htfTrendDir / m15DirTrend `'BULLISH'|'BEARISH'|'NEUTRAL'` → symmetric
    `close_vs_prev_close: +1|0|-1`.
  - EMA CONTEXT block `Price is ABOVE/BELOW EMA*` English → symmetric
    `price_vs_ema*: +1|-1` (0 when EMA unavailable).
  - EMA INTERPRETATION teaching sentence removed.

  Also adds build-time scanner patterns to prevent regression of these tokens
  in the broad `RAW_DATA_FORBIDDEN` rule set.

  ## Tables Affected
  - `alpha_engineering_doctrine`: insert one row, mark prior `0513J` row as
    superseded (active=false, supersedes link set on the new row).

  ## Security
  No new RLS changes. Inherits existing table policies.
*/

DO $$
DECLARE
  v_prior_id uuid;
BEGIN
  SELECT id INTO v_prior_id FROM alpha_engineering_doctrine
  WHERE ccip_reference = 'CCIP-2026-0513J-SEALED-PROMPT' AND active = true;

  IF v_prior_id IS NULL THEN
    RAISE EXCEPTION 'CCIP-2026-0513J-SEALED-PROMPT active row not found; cannot supersede.';
  END IF;

  UPDATE alpha_engineering_doctrine
  SET active = false
  WHERE id = v_prior_id;

  INSERT INTO alpha_engineering_doctrine (
    ccip_reference, ratified_at, doctrine_text, active, supersedes
  ) VALUES (
    'CCIP-2026-0513K-COORDINATOR-PROMPT-SEALING',
    now(),
    'CCIP-2026-0513K Coordinator Prompt Sealing — amendment to CCIP-2026-0513J.

Foundational Premise: The Sealed-Prompt Doctrine (0513J) was scoped to dedicated
prompt-formatter files (market-briefing-builder.ts). A 2026-05-13 audit of a
live XAUUSD SELL decision revealed that coordinator-alpha.ts still injected
verdict-label English directly into Alpha''s prompt via four sites: emaStack
(BULL/BEAR/MIXED), ema20SlopeDir (RISING/FALLING/FLAT), htfTrendDir and
m15DirTrend (BULLISH/BEARISH/NEUTRAL), and an EMA CONTEXT block whose
ABOVE/BELOW English plus an EMA INTERPRETATION teaching sentence
re-introduced exactly the bias channel 0513J was designed to eliminate.

Sealed Contract Extension: All four coordinator sites now emit symmetric
±1/0/-1 numeric codes. UNKNOWN states are signalled by a separate boolean
(ema_stack_known) rather than a fourth English label. EMA price-relative
readings emit price_vs_ema*: +1 (above), -1 (below), 0 (EMA unavailable).
The EMA INTERPRETATION teaching sentence is removed; Alpha already knows
how to read body ratios and EMAs.

Scanner Enforcement: scripts/audit-alpha-identity.cjs gains six 0513K
patterns in RAW_DATA_FORBIDDEN that block re-introduction of the removed
constructs. coordinator-alpha.ts remains under the broad RAW_DATA_TARGETS
list (not SEALED_PROMPT_TARGETS) because it is an orchestrator file with
internal-only .toUpperCase() and direction strings that do not feed the
prompt; promoting it to strict scope would generate ~26 false positives.
The new 0513K patterns target the specific prompt-feeding constructs that
were actually removed.

Engineering Law: Any PR that re-introduces emaStack BULL/BEAR/MIXED,
RISING/FALLING/FLAT slope labels, BULLISH/BEARISH/NEUTRAL trend labels,
ABOVE/BELOW EMA English, or the EMA INTERPRETATION teaching sentence
must be rejected on architectural grounds. Inherits all obligations from
0511ZZ, 0512A, 0512B, 0513A, 0513B, 0513J.',
    true,
    v_prior_id
  );
END $$;