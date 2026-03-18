/*
  # CCIP-2026-03-18: Retire Style Gate Authority

  ## Summary
  The `style_gate_blocks` table is preserved for historical audit data but
  is officially retired as an active decision-making authority.

  ## Change Rationale
  The Style Qualification Gate previously ran post-Alpha, checking ATR%,
  duration, and pip range suitability against hardcoded style contracts.
  This violated SSOT because:
  1. Alpha already receives full ATR and market context in its briefing.
  2. Alpha is the sole authority on volatility suitability for a trade style.
  3. The gate created misleading audit trails — NO_TRADE summaries were
     attributed to this gate rather than Alpha's own stated reasoning.

  ## What Changed
  - `validateStyleQualification()` removed from alpha-trade-executor.ts
  - `style-qualification-gate.ts` reduced to reference types and pure utilities only
  - `trade-feasibility-resolver.ts` ATR advisory note reworded to reflect
     Alpha's authority explicitly (no execution path uses it to block)
  - No new rows will be written to `style_gate_blocks`
  - Existing rows are preserved as historical governance record

  ## Tables Modified
  - `style_gate_blocks`: comment updated to reflect retired status

  ## Security
  - No RLS changes required
  - No new policies added or removed

  ## Important Notes
  1. The `getAtrGate()` function in trade-constraints.ts is RETAINED because
     trade-feasibility-resolver.ts uses it for advisory context notes to Alpha.
  2. The style_gate_blocks table is NOT dropped — it holds historical data.
  3. This migration is SSOT-compliant: authority flows through Alpha only.
*/

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'style_gate_blocks'
  ) THEN
    COMMENT ON TABLE style_gate_blocks IS
      'RETIRED CCIP-2026-03-18: Historical governance record only. '
      'No new rows are written. The style qualification gate has been removed '
      'from the trade execution pipeline. Alpha is the sole authority on '
      'volatility suitability for a given trade style.';
  END IF;
END $$;
