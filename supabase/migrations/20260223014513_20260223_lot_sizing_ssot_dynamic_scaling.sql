/*
  # CCIP Governance Record: Dynamic Lot Sizing SSOT Refactor

  ## Title
  Remove Static maxLotSize Cap for Indices — Enable Account-Balance-Scaled Lot Sizing

  ## Problem Being Fixed
  All index symbols (NAS100, US30, SPX500, UK100, GER40) had a hardcoded maxLotSize
  of 1.0 enforced in four separate locations. This capped a $95,749 account at 1.0
  lot for NAS100 regardless of risk %. Correct output for 5% risk / 37-pip stop
  on a $95k account is ~4.79 lots, not 0.48.

  ## Changes Applied
  1. symbol-registry.ts — maxLotSize raised to 500.0 (broker ceiling) for all index symbols
  2. New SSOT function getScaledMaxLotSize(symbol, accountBalance, riskPct) added
  3. currencyHelpers.ts calculatePositionSize() — removed hardcoded index?1.0 switch
  4. currencyHelpers.ts calculateGoalAwareLotSize() — removed hardcoded 5% cap
  5. unified-risk-authority.ts — broker cap now uses getScaledMaxLotSize()

  ## SSOT Compliance
  Single authority: getScaledMaxLotSize() in symbol-registry.ts
  All enforcement points delegate to this one function.
*/

INSERT INTO governance_change_log (
  entity_type,
  entity_id,
  operation,
  old_value,
  new_value,
  reason,
  requester_id,
  metadata
)
VALUES (
  'system_configuration',
  gen_random_uuid(),
  'configuration_change',
  jsonb_build_object(
    'maxLotSize_NAS100', 1.0,
    'maxLotSize_US30', 1.0,
    'maxLotSize_SPX500', 1.0,
    'maxLotSize_UK100', 1.0,
    'maxLotSize_GER40', 1.0,
    'calculatePositionSize_index_cap', 1.0,
    'calculateGoalAwareLotSize_risk_cap', '5%_hardcoded',
    'ABSOLUTE_MAX_LOT_SIZE', 10.0
  ),
  jsonb_build_object(
    'maxLotSize_indices', '500.0 (broker ceiling only)',
    'lot_sizing_authority', 'getScaledMaxLotSize(symbol, accountBalance, riskPct)',
    'calculateGoalAwareLotSize_risk_cap', 'user riskPercentageAllowed (dynamic)',
    'policy', 'lot sizes scale proportionally with account balance and user risk selection'
  ),
  'Static hardcoded maxLotSize=1.0 for indices prevented lot sizes from scaling with account balance. A $95,749 account was capped at 1.0 lot for NAS100 regardless of risk %. The correct output for 5% risk with 37-pip stop should be ~4.79 lots, not 0.48.',
  NULL,
  jsonb_build_object(
    'ccip_ref', '20260223_lot_sizing_ssot_dynamic_scaling',
    'files_changed', ARRAY[
      'src/config/symbol-registry.ts',
      'src/utils/currencyHelpers.ts',
      'src/services/unified-risk-authority.ts'
    ],
    'functions_changed', ARRAY[
      'getScaledMaxLotSize (new SSOT)',
      'calculatePositionSize',
      'calculateLotSizeFromDollarRisk',
      'calculateGoalAwareLotSize',
      'UnifiedRiskAuthority.assessTrade'
    ]
  )
);
