/*
  # Fix Alpha Scalp Accuracy and Omega Voting Pipeline

  ## Summary
  Documents critical frontend code fixes that resolve five interconnected bugs
  affecting Alpha's trade classification, accuracy, and data pipeline.

  ## Changes (Frontend Code - No Schema Changes)

  1. **Omega Voting Pipeline Fix** (goal-session-live-engine.ts)
    - BUG: `marketState.omegaVotes` (cached intelligence Map, usually undefined) 
      was passed to the DB logger instead of `decision.omega_votes` (actual council votes)
    - FIX: Now extracts votes from `decision.omega_votes` and computes real consensus 
      (buy/sell/no_trade counts) instead of hardcoded zeros
    - IMPACT: Omega vote data now persists correctly in alpha_decisions table

  2. **entryTimeframe Initialization Order** (alpha-omega-orchestrator.ts)
    - BUG: `entryTimeframe` variable used on line 180 before declaration on line 222
    - Caused runtime error: "Cannot access 'entryTimeframe' before initialization"
    - This blocked Alpha from evaluating SPX500, NAS100, and other instruments
    - FIX: Moved riskMode/mtfConfig/entryTimeframe declaration before first usage

  3. **Goal Session Style Propagation** (coordinator-alpha.ts, goal-session-live-engine.ts)
    - BUG: GoalContext interface had no tradeStyle field
    - User's goal session "scalper" preference was never passed to Alpha
    - Default fallback was arbitrary ('SCALP' in coordinator, 'INTRADAY' in live engine)
    - FIX: Added tradeStyle to GoalContext, populated from config.tradeStyle,
      injected as TRADE STYLE DIRECTIVE in Alpha's prompt, used as default style fallback

  4. **Style Envelope SL Enforcement** (coordinator-alpha.ts)
    - BUG: Only TP was capped against style envelope bounds; SL had zero enforcement
    - A 33-pip SL on a SCALP (max 20 pips) passed through unchecked
    - `validateTPSLAgainstEnvelope()` existed but was dead code (never called)
    - FIX: Added parallel SL capping logic, wired in validateTPSLAgainstEnvelope(),
      violations are logged to ssot_violations table

  5. **TP1/TP2 Ordering Invariant** (coordinator-alpha.ts)
    - BUG: TP1 fallback used slDistance (could exceed tpDistance after capping)
    - Resulted in TP1 >= TP2 or TP1 === TP2 (no partial profit staging)
    - FIX: Fallback now uses min(slDistance, tpDistance*0.6)
    - Added invariant: if TP1 distance >= TP2 distance, correct TP1 to 60% of TP2

  ## CCIP Compliance
  - System Map: Traced full pipeline from Omega specialists -> coordinator -> DB
  - Logic Contract: Style envelopes are SSOT guardrails, not hardcoded overrides
  - Compatibility: All changes are backward-compatible, no schema modifications
  - Governance: Violations logged to ssot_violations table for audit trail

  ## No Database Schema Changes Required
  This migration serves as an audit record only.
*/

SELECT 1 AS alpha_scalp_accuracy_fix_documented;
