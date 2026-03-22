/*
  # CCIP-2026-0322B: Remove Stale Entry Deviation Pre-Check (Governance Audit Record)

  ## Summary
  Documents the removal of the stale CCIP-2026-0320A pre-executor entry deviation guard
  from goal-session-live-engine.ts and the correction of the executor's last-resort
  fallback from style-keyed to asset-class-aware thresholds.

  ## Changes
  1. goal-session-live-engine.ts — Removed CCIP-2026-0320A block.
     That block used hardcoded style limits (SCALP=5, MICRO_INTRADAY=8, INTRADAY=15)
     and fired BEFORE AlphaTradeExecutor was called, causing SCALP+crypto trades to be
     blocked at 5 pips even though Alpha had set max_entry_deviation_pips=200.

  2. alpha-trade-executor.ts — Updated last-resort fallback in executeImmediate() from
     style-keyed (SCALP=5) to asset-class-aware:
       - Crypto (BTC, ETH, LTC, XRP, BCH): 200 pips
       - Metals (XAU, XAG, GOLD): 80 pips
       - Indices (US30, NAS100, SPX500, UK100, DE30, JP225): 50 pips
       - Forex: 20 pips

  ## SSOT Authority
  AlphaTradeExecutor.executeImmediate() is the single authority for entry deviation
  enforcement (CCIP-2026-0321A). No pre-executor deviation check may exist upstream.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason
) VALUES (
  'alpha_execution_policy',
  gen_random_uuid(),
  'ccip_policy_removal',
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-0320A',
    'file', 'src/services/goal-session-live-engine.ts',
    'description', 'Pre-executor deviation check with style-keyed limits SCALP=5 MICRO_INTRADAY=8 INTRADAY=15',
    'status', 'removed'
  ),
  jsonb_build_object(
    'ccip_id', 'CCIP-2026-0322B',
    'supersedes', 'CCIP-2026-0320A',
    'authority', 'CCIP-2026-0321A in AlphaTradeExecutor.executeImmediate()',
    'file', 'src/services/alpha-trade-executor.ts',
    'fallback_updated', 'asset-class-aware: crypto=200 metals=80 indices=50 forex=20',
    'status', 'active'
  ),
  'CCIP-2026-0320A pre-executor deviation check blocked SCALP+crypto trades at 5 pips bypassing Alphas 200-pip crypto tolerance. Stale check removed. Executor fallback updated to asset-class-aware to match coordinator-alpha.ts SSOT.'
);
