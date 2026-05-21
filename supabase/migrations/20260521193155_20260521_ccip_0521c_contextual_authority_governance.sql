/*
  # CCIP-2026-0521C: Contextual Authority — Remove M5 Absolute Hierarchy

  ## Summary
  Alpha's decision framework transitions from absolute M5 timeframe hierarchy
  to contextual authority where Alpha freely synthesizes ALL timeframes.

  ## Changes
  1. Deactivates prior active doctrine (CCIP-2026-0517A)
  2. Inserts new CCIP-2026-0521C contextual authority doctrine as active

  ## Governance
  - Supersedes CCIP-2026-0513F (M5-Primary Hierarchy)
  - Inherits all obligations from CCIP-2026-0511ZZ, 0512A, 0512B, 0513A, 0513B, 0513J, 0513K
*/

-- Deactivate the current active doctrine
UPDATE alpha_engineering_doctrine
SET active = false
WHERE id = 'd9a96385-e764-45b0-b1ce-d412fc4f8a5d'
  AND active = true;

-- Insert the new contextual authority doctrine
INSERT INTO alpha_engineering_doctrine (
  id,
  ccip_reference,
  ratified_at,
  doctrine_text,
  active,
  kind
) VALUES (
  gen_random_uuid(),
  'CCIP-2026-0521C',
  now(),
  'CONTEXTUAL AUTHORITY DOCTRINE (supersedes 0513F, inherits 0511ZZ/0512A/0512B/0513A/0513B/0513J/0513K/0517A): Alpha''s decision framework uses contextual authority. No single timeframe (M5, M15, H1, D1) is declared dominant or controlling. All timeframes are equal data sources. Alpha synthesizes ALL available data and decides what the market is doing. When timeframes conflict, Alpha weighs evidence and decides which signal is more structurally significant. M5 is execution granularity for SL/TP precision only — NOT directional authority. The retired 0513F doctrine declared M5 as primary directional authority with M15/H1 as subordinate background context. This caused Alpha to fixate on M5 signals and ignore conflicting higher-timeframe evidence. The fix is architectural: remove the hierarchy, present all TFs with equal visual weight, let Alpha reason freely. All prior doctrine obligations (raw data only, no verdicts, no teaching, no gates, Alpha autonomy, trap-aware geometry, profitability invalidation) remain in full force.',
  true,
  'doctrine'
);