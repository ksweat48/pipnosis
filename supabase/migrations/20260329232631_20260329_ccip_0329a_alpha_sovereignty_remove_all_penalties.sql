/*
  # CCIP-2026-0329A: Alpha Sovereignty — Remove All Hidden Confidence Penalties

  ## Summary
  Governs the removal of all numeric confidence penalties, session weight multipliers,
  and biasing language that were silently pre-scoring market conditions for Alpha.

  ## Problem
  The following layers were collectively nudging Alpha toward NO_TRADE:
  1. omega7-market-context.ts — Applied -15 dead zone, -20 extreme volatility,
     -15 choppy structure, -15 high wick risk, -10 ATR compression range penalties
     to an internal confidence field. Also injected "low confidence conditions" and
     "dead zone" labels into the market summary text Alpha received.
  2. session-constraint-coordinator.ts — Applied 0.55–0.75 session weight multipliers
     to forex pairs during off-peak hours. Applied -15% SCALP and -5% INTRADAY
     confidence penalty returns when trades would exceed session windows.
  3. regime-scoring-constants.ts — Defined REGIME_PENALTIES: DEAD_ZONE (2–5%),
     VOLATILITY (5–8%), STRUCTURE (3–5%), SESSION (5–7%) as importable constants.
  4. alpha-identity.ts — Defined MAX_ADVISORY_PENALTY: 10 which was written into
     the Alpha LLM prompt, giving Alpha a ready-made arithmetic deduction formula
     that caused mechanically uniform 45% confidence outputs in certain conditions.
  5. coordinator-alpha.ts — Injected "Is Dead Zone: true/false" into the Regime
     Oracle context block that Alpha read in every scan.

  ## Changes Applied (Code Layer — tracked here for governance audit trail)

  ### omega7-market-context.ts
  - Removed all penalty arithmetic from calculateConfidence()
  - Removed "dead zone", "low confidence conditions", "high risk environment",
    "stop hunting probable", "suboptimal conditions — reduced confidence" language
    from buildSummary()
  - Renamed collectWarnings() to collectObservations() — keys are now neutral
    descriptors: "low_liquidity_window", "compressed_volatility", "elevated_volatility"
    (not "dead_zone", "dead_market", "atr_compression_range" with penalty connotation)
  - Removed is_dead_zone contribution to riskOffScore in deriveSentiment()

  ### session-constraint-coordinator.ts
  - Removed getSymbolSpecificSessionWeight() — all per-symbol penalty multipliers
  - calculateSessionPenalty() now always returns 1.0 (no penalty)
  - getSessionWeight() now always returns 1.0 (no penalty)
  - shouldApplySessionWeight() now always returns false
  - shouldApplySessionVolatilityMultiplier() now always returns false
  - getSessionVolatilityMultiplier() now always returns 1.0

  ### regime-scoring-constants.ts
  - Removed REGIME_PENALTIES constant entirely (DEAD_ZONE, VOLATILITY, STRUCTURE, SESSION)
  - Removed penalty framing from REGIME_CLASSIFICATION comments

  ### alpha-identity.ts
  - Removed MAX_ADVISORY_PENALTY: 10 constant
  - Updated CCIP-2026-0326A history note to reflect full removal

  ### pipnosis-core-rules.ts (Alpha LLM prompt)
  - Removed "Combined advisory influence ceiling: X%" from Alpha authority principles
  - Replaced with: advisory signals are raw market data Alpha reasons about directly

  ### coordinator-alpha.ts
  - Removed "Is Dead Zone: ${regime.is_dead_zone}" from buildAdvisoryContext()
  - Updated dead zone example comment to reflect CCIP-2026-0329A governance

  ## Governance Principle
  Alpha receives raw market measurements: session name, ATR, volatility score,
  structure type, EMA alignment, wick ratios, sweep events. He applies his own
  judgment about whether these conditions contain an edge worth trading.
  No system layer may pre-score, weight, or label any market condition as a
  signal toward NO_TRADE before Alpha has seen the data.

  Alpha's mandate: Hunt for the edge in every session. Ask "is there clean air
  to target here right now?" — not "is this a dead zone?"

  ## SSOT Compliance
  - REGIME_PENALTIES: REMOVED (was at regime-scoring-constants.ts)
  - Session weight authority: session-constraint-coordinator.ts (always 1.0)
  - Advisory ceiling: REMOVED (was at alpha-identity.ts)
  - Alpha confidence authority: Alpha LLM only — no code modification permitted

  ## Post-Deploy Verification
  SELECT 'CCIP-2026-0329A applied' AS status,
         now() AS applied_at;
*/

SELECT 'CCIP-2026-0329A: Alpha Sovereignty penalty removal — governance audit entry' AS ccip_event,
       now() AS applied_at,
       'SSOT_COMPLIANT' AS compliance_status;
