/*
  # CCIP Governance Documentation: Entry Narrative in Mid-Trade Intelligence Monitor
  20260220 — entry_narrative field in MidTradePlan JSONB

  ## What Changed
  Added `entry_narrative` (optional string) to the MidTradePlan JSONB structure
  stored in goal_session_trades.mid_trade_plan.

  ## Design Decisions (SSOT / CCIP Compliance)
  1. SSOT: buildMidTradePlan() in mid-trade-plan-engine.ts is the sole authority
     for this field. No other service generates or modifies entry_narrative.
  2. CCIP: Zero LLM calls post-entry. Narrative is synthesized deterministically
     from structured Alpha decision fields at the moment of trade entry.
  3. Backward-compatible: field is optional. Trades created before this deployment
     will have entry_narrative = undefined and the UI falls back to setup_summary.
  4. No new columns, tables, or RLS policies needed.
     entry_narrative lives inside the existing JSONB column.

  ## Affected Frontend Files
  - src/services/mid-trade-plan-engine.ts (MidTradePlan interface + buildMidTradePlan)
  - src/components/MidTradeMonitor.tsx (AlphaEntryIntelligence component)

  ## Governance Notes
  - Trade data is never mutated by this change
  - The narrative is set once at entry and never updated
  - Pattern badge and collapsible narrative replace the old AlphaPlanSection
    (which showed raw key_levels and token tags)
*/

DO $$
BEGIN
  RAISE NOTICE 'CCIP 20260220: entry_narrative field governance documentation recorded.';
  RAISE NOTICE 'SSOT: mid-trade-plan-engine.ts buildMidTradePlan() is sole authority.';
  RAISE NOTICE 'Zero LLM calls. Deterministic synthesis. Backward-compatible JSONB field.';
END $$;
