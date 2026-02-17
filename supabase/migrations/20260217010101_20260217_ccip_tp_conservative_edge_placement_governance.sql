/*
  # CCIP: TP Conservative Edge Placement Governance Policy

  1. Summary
    - Added a new Alpha prompt rule: when placing TP at a support/resistance zone,
      Alpha must target the CONSERVATIVE EDGE (near side) of the zone, not the far boundary.
    - For SELL trades: TP at the TOP of support (upper boundary of candle cluster)
    - For BUY trades: TP at the BOTTOM of resistance (lower boundary of candle cluster)
    - This maximizes fill probability.

  2. Files Modified
    - `src/config/alpha-identity.ts`: Added TP ZONE EDGE RULE section, amended SCALP style contract
    - `src/brains/coordinator-alpha.ts`: Reinforced conservative edge in TAKE-PROFIT RULES

  3. Trigger Event
    - ETHUSD SELL 2026-02-17: TP at 1973.14 (bottom of support) missed fill at 1980.98 (top of support)

  4. Governance
    - Type: Config change (Alpha prompt enhancement, non-breaking, no wall changes)
*/

INSERT INTO ccip_change_requests (
  change_title,
  change_type,
  priority,
  description,
  business_justification,
  technical_impact,
  risk_assessment,
  ccip_status,
  governance_status,
  deployment_method,
  modified_files,
  breaking_changes
) VALUES (
  'TP Conservative Edge Placement Rule',
  'config',
  'high',
  'Alpha must place TP at the near side of S/R zones, not the far boundary. SELL -> top of support, BUY -> bottom of resistance.',
  'ETHUSD SELL 2026-02-17: Perfect directional read but TP at bottom of support (1973.14) missed fill. Price bounced at top of support (1980.98). Would have been a clean winner.',
  'Prompt-level change only. No wall/constraint/code logic changes. Added TP ZONE EDGE RULE to alpha-identity.ts and reinforced in coordinator-alpha.ts.',
  'None -- advisory prompt change. Does not alter arena walls, confidence gates, or execution logic.',
  'approved',
  'approved',
  'code_deploy',
  ARRAY['src/config/alpha-identity.ts', 'src/brains/coordinator-alpha.ts'],
  false
) ON CONFLICT DO NOTHING;
