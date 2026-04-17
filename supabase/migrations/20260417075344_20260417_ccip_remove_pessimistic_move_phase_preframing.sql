/*
  # CCIP Governance Audit — Remove Pessimistic Move Phase Pre-Framing from Alpha Prompt

  ## Change Control Reference
  CCIP-2026-04-17b: Alpha Hunting Instinct Restoration

  ## Problem Statement
  Alpha was receiving directive, pessimistic language in the SCALP move phase advisory
  block (coordinator-alpha.ts scalpMovePhaseContext) that pre-selected thesis direction
  before Alpha assessed any market structure:

  - DEVELOPING stage: "Pullback scalp entry preferred. Continuation requires explicit
    justification that the single TP remains achievable."
  - EXHAUSTED stage: "Look for a reversal scalp or M1 structural retest setup rather
    than a continuation entry."

  ## Fix Applied (coordinator-alpha.ts lines 2353-2385)

  1. DEVELOPING phaseLabelM5: Removed directional steering. Replaced with neutral:
     "ATR travel data provided. Alpha assesses remaining structural space and R:R
     independently."

  2. EXHAUSTED phaseLabelM5: Renamed label from EXHAUSTED to EXTENDED. Removed
     continuation bias. Replaced with neutral: "ATR travel data provided. Alpha
     assesses structure and thesis direction independently."

  3. DEVELOPING stage body: Removed R:R pre-calculation directive that created a
     pessimistic numerical anchor before structure assessment.

  4. EXTENDED stage body: Removed "rather than a continuation entry" directive.
     Replaced with: "Identify the strongest structural thesis available — continuation,
     reversal, or retest — from the current price action."

  ## SSOT Compliance
  Single authority for prompt language is coordinator-alpha.ts. Raw ATR travel metric
  and scalp_momentum_phase telemetry field unchanged. No other files modified.

  ## Governance Classification
  Text-only change. No logic paths altered. No schema changes. No data risk.
  Recorded here as governance audit trail per CCIP protocol.
*/

DO $$
BEGIN
  RAISE NOTICE 'CCIP-2026-04-17b: Pessimistic move phase pre-framing removed from coordinator-alpha.ts. Governance audit recorded.';
END $$;
