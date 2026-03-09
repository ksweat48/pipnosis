/*
  # CCIP-2026-03-09: Alpha Three Core Fixes — Governance Audit

  ## Change Intent
  Three structural bugs prevented Alpha from finding trades in valid market conditions.
  This migration records the governance decision and audit trail for each fix.

  ## Fix 1: atr20 Population (ATR Never Populated)
  - Root Cause: alpha-omega-orchestrator.ts built MarketContext with only `atr` populated.
    `atr20` (the SCALP primary ATR, mapped via styleAtrMap SCALP → atr20) was always
    undefined, causing Alpha's ATR legend to display "N/A" for SCALP scans.
  - Impact: Stop sizing and FRESH/DEVELOPING/EXHAUSTED phase calculations used a fallback
    ATR (marketState.atr) that was not timeframe-aligned to M5, producing inaccurate
    move stage readings and unreliable scalp window assessments.
  - Fix: marketContext.atr20 = snapshot.atr — the snapshot is always built for the
    style-derived entryTimeframe (M5 for SCALP), so snapshot.atr IS the M5 ATR.
  - SSOT: styleAtrMap in coordinator-alpha.ts remains the authority for field mapping.

  ## Fix 2: SCALP INDEX Mathematical Impossibility
  - Root Cause: MAXIMUM_SCALP = 1.0 (TP must equal SL exactly) combined with
    SCALP INDEX slPercent.min = 0.15% (noise floor). At NAS100 ~19,000 points,
    SL minimum = 0.15% × 19,000 / pip_value ≈ 28+ pips. With tpPips.max = 25,
    TP < SL was structurally impossible — Omega-9 hard-blocked every INDEX SCALP scan.
  - Fix A: MAXIMUM_SCALP raised from 1.0 to 1.5 in trading-constants.ts.
    Rationale: A 1.5:1 R:R scalp is tighter than MICRO_INTRADAY (2:1) and still
    captures a single M5 swing leg. SCALP identity is preserved.
  - Fix B: SCALP INDEX tpPercent.max raised from 0.60% to 0.80% in style-execution-envelopes.ts.
    Rationale: With MAXIMUM_SCALP=1.5, at SL=0.35% the TP ceiling needed is 0.525%.
    0.80% provides adequate headroom without relaxing INDEX scalp identity.
  - SSOT: omega9-constraint-provider.ts uses getMaxRRForStyle() which reads from trading-constants.ts.
  - Noise floor governance unchanged: SL min remains 0.15% for INDEX (CCIP-2026-02-18 compliant).

  ## Fix 3: Alpha Prompt Advisory Reframe
  - Root Cause: SCALP prompt used imperative "NO_TRADE is the correct output" language
    in three locations (exhausted ATR phase, no named structure, ATR legend). At
    temperature 0.3, the LLM pattern-matched these as hard rules, producing 10-30%
    confidence and NO_TRADE on any non-textbook market condition.
  - Alpha's architecture principle (coordinator-alpha.ts L26): "Rule-based modules =
    ADVISORS ONLY. CANNOT block trades." The SCALP prompt violated this principle.
  - Fix: All three hard-block phrases converted to advisory guidance:
    * Exhausted ATR: "ADVISORY: reduce confidence 15-25pts. Reason about reversal/retest/sweep. Only NO_TRADE if no directional case exists."
    * No named structure: "GUIDANCE: identify closest match or describe structure. Return NO_TRADE only if genuinely no structural reason."
    * Reasoning contract: Added explicit trade-finder objective. NO_TRADE requires a positive reason, not absence of perfection.
  - Governance: BOS, impulsive leg, named structures remain advisory guidance — Alpha
    weighs them in confidence scoring. They are not blocking gates.
  - Safety unchanged: Omega-9 still hard-blocks catastrophic R:R. Confidence gate at 60%
    still enforces minimum quality. The freshness gate remains P0.

  ## Compliance
  - SSOT: Each fix has a single authoritative source file.
  - CCIP: All changes documented with rationale and backward-compatible.
  - Governance: No new blockers introduced. Advisory framework strengthened.
  - No destructive DB operations in this migration (audit record only).
*/

CREATE TABLE IF NOT EXISTS ccip_governance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_id text NOT NULL,
  change_date timestamptz DEFAULT now(),
  category text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  files_modified text[] NOT NULL,
  ssot_owner text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE ccip_governance_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ccip_governance_audit' AND constraint_name = 'ccip_governance_audit_change_id_key'
  ) THEN
    ALTER TABLE ccip_governance_audit ADD CONSTRAINT ccip_governance_audit_change_id_key UNIQUE (change_id);
  END IF;
END $$;

CREATE POLICY "Admins can read governance audit"
  ON ccip_governance_audit FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.is_admin = true
    )
  );

INSERT INTO ccip_governance_audit (change_id, category, title, description, files_modified, ssot_owner)
VALUES
  (
    'CCIP-2026-03-09-FIX1-ATR20',
    'DATA_PIPELINE',
    'atr20 population fix — M5 ATR wired into MarketContext',
    'marketContext.atr20 was never populated. Now assigned from snapshot.atr which is the style-timeframe-aligned ATR (M5 for SCALP). Resolves N/A in Alpha ATR legend and unreliable ATR-phase calculations.',
    ARRAY['src/services/alpha-omega-orchestrator.ts'],
    'alpha-omega-orchestrator.ts :: MarketContext build block'
  ),
  (
    'CCIP-2026-03-09-FIX2-SCALP-INDEX-RR',
    'ENVELOPE_GOVERNANCE',
    'SCALP INDEX mathematical impossibility resolved',
    'MAXIMUM_SCALP raised from 1.0 to 1.5. INDEX tpPercent.max raised from 0.60% to 0.80%. Fixes hard Omega-9 block on all INDEX SCALP scans caused by SL floor exceeding TP ceiling.',
    ARRAY['src/config/trading-constants.ts', 'src/config/style-execution-envelopes.ts'],
    'trading-constants.ts :: RISK_REWARD_RATIOS.MAXIMUM_SCALP'
  ),
  (
    'CCIP-2026-03-09-FIX3-ALPHA-PROMPT',
    'LLM_GOVERNANCE',
    'Alpha SCALP prompt reframed from blocker-first to trade-finder advisory',
    'Three hard "NO_TRADE is the correct output" imperative blocks converted to confidence-reduction advisories. Added explicit trade-finder objective to reasoning contract. BOS/structure remain advisory guidance not blockers. Safety unchanged: Omega-9 and confidence gate both active.',
    ARRAY['src/brains/coordinator-alpha.ts'],
    'coordinator-alpha.ts :: SCALP prompt blocks and reasoning contract'
  )
ON CONFLICT (change_id) DO NOTHING;
