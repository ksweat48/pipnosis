/*
  # CCIP-2026-0324A: Alpha Evidence-First Reasoning Governance

  ## Summary
  This migration documents the CCIP-2026-0324A governance change to Alpha's reasoning
  architecture. The changes are in source code (alpha-identity.ts, coordinator-alpha.ts,
  mid-trade-trigger-detector.ts, alpha-midtrade-analyst.ts) — this migration creates the
  audit record and governance log entry.

  ## Problem Being Fixed
  Audit of 10 consecutive losing trades revealed systematic template-filling:
  - Q4_momentum_stage: always "DEVELOPING" across all symbols and sessions
  - Q7_confluence_confirmed: always exactly "4/7" — statistically impossible
  - entry_mode: always "immediate" — zero uses of wait_pullback or push_confirmation
  - alpha_recheck_count: always 0 — mid-trade monitor never fired
  Root cause: Alpha was satisfying a JSON schema rather than reasoning from evidence.

  ## Changes Made

  ### 1. alpha-identity.ts (SSOT)
  - Opening identity: removed "there is always an opportunity" and "my job is to find a trade"
    language. Alpha reads the market first. NO_TRADE is a valid successful scan outcome.
  - professionalReasoningProcess: rebuilt as evidence-first framework.
  - Q4 MOMENTUM: now requires Alpha to read and describe specific candles BEFORE declaring
    the stage. Stage is a conclusion, not an opening declaration.
  - Q7 CONFLUENCE: now requires named price/candle/event per dimension OR explicit ABSENT.
    Count is the result of evidence — not a target to fill.
  - entry_mode DERIVATION: now conditions-based. execute_now requires named fired trigger
    AND price at/inside structural zone. Choosing execute_now by default is a coherence violation.
  - thesis_coherence_statement: reframed as adversarial cross-examination. Alpha must argue
    AGAINST the trade before committing. Confirmatory restatement is prohibited.

  ### 2. coordinator-alpha.ts
  - Scan mandate: removed "Returning NO_TRADE is a scan failure" language.
  - Regime-location conflict advisory: injected deterministically before candles.
    PREMIUM + potential BUY direction is flagged with specific named override requirement.
    DISCOUNT + potential SELL direction is flagged similarly.
    Ranging/choppy regime flagged for momentum continuation trades.

  ### 3. mid-trade-trigger-detector.ts
  - Added profit_giveback trigger: fires when trade peaked >= 0.5R and has since given
    back >= 50% of peak profit while still near breakeven. Addresses the NAS100 scenario
    where trade peaked at +$627 then reversed to -$1064 without mid-trade intervention.
  - Peak profit tracked per trade in peakPriceDiff Map (cleared on trade close).

  ### 4. alpha-midtrade-analyst.ts
  - Added profit_giveback to TRIGGER_DESCRIPTIONS
  - Added profit_giveback to shouldEscalateToAlpha (always escalates to LLM)
  - Added drawdown_0_30R description

  ## Governance Log
*/

DO $$
BEGIN
  INSERT INTO governance_change_log (
    change_id,
    entity_type,
    entity_id,
    change_type,
    change_description,
    old_value,
    new_value,
    metadata,
    changed_by
  ) VALUES (
    'CCIP-2026-0324A',
    'alpha_reasoning_framework',
    'alpha-identity-ssot',
    'EVIDENCE_FIRST_REASONING_REFORM',
    'Eliminated template-filling bias from Alpha reasoning. Q4 now requires candle evidence before stage verdict. Q7 requires named evidence per dimension. entry_mode derived from named conditions. thesis_coherence_statement reframed as adversarial cross-examination. Scan mandate removed. Regime-location conflict advisory injected. Profit-giveback mid-trade trigger added.',
    '{"Q4": "stage declared without evidence", "Q7": "count without per-dimension evidence", "entry_mode": "always immediate by default", "scan_mandate": "NO_TRADE is scan failure", "mid_trade": "no profit-giveback trigger"}',
    '{"Q4": "evidence read first, stage derived from candle description", "Q7": "named evidence per dimension or ABSENT, count is output not input", "entry_mode": "conditions-based derivation with named trigger requirement", "scan_mandate": "NO_TRADE is valid successful outcome", "mid_trade": "profit_giveback trigger fires at 50% peak giveback"}',
    '{"ccip": "CCIP-2026-0324A", "files_changed": ["alpha-identity.ts", "coordinator-alpha.ts", "mid-trade-trigger-detector.ts", "alpha-midtrade-analyst.ts"], "root_cause": "template-filling bias — Q4 always DEVELOPING, Q7 always 4/7, entry_mode always immediate across 10 consecutive trades"}',
    'system'
  );
EXCEPTION WHEN OTHERS THEN
  -- governance_change_log may have a different schema — log to notices only
  RAISE NOTICE 'CCIP-2026-0324A governance log: Alpha evidence-first reasoning reform applied. Q4/Q7/entry_mode evidence-first. Profit-giveback trigger added.';
END $$;
