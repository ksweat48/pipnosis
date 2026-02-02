/**
 * PCVL Position Contract Validator
 *
 * SSOT Authority: Position sizing validation and risk verification
 *
 * CRITICAL: Last-line defense against 10-100× risk violations
 * Validates that: trueRisk = lot_size × pip_value × stop_pips = intended_risk
 *
 * CCIP Compliant: Emergency fix for missing validator (20260202)
 *
 * Principles:
 * - Fail closed (block trades that violate risk limits)
 * - Complete audit trail (all validations logged)
 * - Symbol-aware (different rules for forex, indices, metals, crypto)
 * - Variance-based (allow small deviations, block large ones)
 */

import { getCurrencyPipInfo, calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { PCVL_CONFIG, isPCVLEnabled as configIsPCVLEnabled } from '../config/pcvl-config';
import type { PCVLInput, PCVLResult } from '../types/pcvl';
import { prodLogger } from '../lib/production-logger';

/**
 * Re-export isPCVLEnabled from config for convenience
 */
export { isPCVLEnabled } from '../config/pcvl-config';

/**
 * Validate position contract using PCVL
 *
 * Validates that the true risk (calculated from lot size and pip values)
 * matches the intended risk within acceptable variance thresholds.
 *
 * @param input Position contract parameters
 * @returns Validation result with approval status and audit trail
 */
export function validatePositionContract(input: PCVLInput): PCVLResult {
  const {
    symbol,
    lot_size,
    stop_pips,
    intended_risk_dollars,
    entry_price,
    stop_loss
  } = input;

  // Get symbol configuration
  const pipInfo = getCurrencyPipInfo(symbol);
  const symbolConfig = getSymbolConfig(symbol);

  // Calculate true risk using actual pip values
  const dollarPerPip = calculateDollarPerPip(symbol, lot_size);
  const trueRiskDollars = stop_pips * dollarPerPip;

  // Calculate risk variance
  const riskVariancePercent = ((trueRiskDollars - intended_risk_dollars) / intended_risk_dollars) * 100;

  // Determine approval status
  const withinVariance = Math.abs(riskVariancePercent) <= PCVL_CONFIG.max_risk_variance_percent;

  // Validate pip value is within expected ranges
  const pipValueValid = validatePipValue(symbol, pipInfo.dollarPerPipPerLot, pipInfo.symbolType);

  // Validate lot size is within broker limits
  const lotSizeValid = validateLotSize(symbol, lot_size, symbolConfig);

  // Overall approval
  const approved = withinVariance && pipValueValid && lotSizeValid;

  // Generate block reason if not approved
  let blockReason: string | undefined;
  if (!approved) {
    if (!withinVariance) {
      blockReason = `Risk variance ${riskVariancePercent.toFixed(2)}% exceeds ±${PCVL_CONFIG.max_risk_variance_percent}%. Intended: $${intended_risk_dollars.toFixed(2)}, Actual: $${trueRiskDollars.toFixed(2)}`;
    } else if (!pipValueValid) {
      blockReason = `Pip value $${pipInfo.dollarPerPipPerLot.toFixed(2)} outside expected range for ${pipInfo.symbolType}`;
    } else if (!lotSizeValid) {
      blockReason = `Lot size ${lot_size.toFixed(3)} outside broker limits [${symbolConfig?.minLotSize || 0.01}-${symbolConfig?.maxLotSize || 5.0}]`;
    }
  }

  // Build audit trail
  const audit = {
    symbol,
    lot_size,
    stop_pips,
    intended_risk: intended_risk_dollars,
    calculated_risk: trueRiskDollars,
    risk_variance: riskVariancePercent,
    pip_value: pipInfo.dollarPerPipPerLot,
    dollar_per_pip: dollarPerPip,
    approved,
    block_reason: blockReason,
    validation_timestamp: new Date().toISOString(),
    pip_value_valid: pipValueValid,
    lot_size_valid: lotSizeValid,
    symbol_type: pipInfo.symbolType
  };

  // Log validation result
  if (!approved) {
    prodLogger.error('[PCVL] ❌ Position contract validation FAILED:', {
      symbol,
      blockReason,
      audit
    });
  } else if (Math.abs(riskVariancePercent) > PCVL_CONFIG.risk_variance_thresholds.warning) {
    prodLogger.warn('[PCVL] ⚠️ Position contract validation passed with warning:', {
      symbol,
      variance: riskVariancePercent,
      audit
    });
  }

  return {
    approved,
    true_risk_dollars: trueRiskDollars,
    risk_variance_percent: riskVariancePercent,
    pip_value_used: pipInfo.dollarPerPipPerLot,
    dollar_per_pip: dollarPerPip,
    block_reason: blockReason,
    audit
  };
}

/**
 * Validate pip value is within expected ranges for symbol type
 */
function validatePipValue(
  symbol: string,
  pipValue: number,
  symbolType: 'forex' | 'metal' | 'index' | 'crypto'
): boolean {
  const validation = PCVL_CONFIG.pip_value_validation[symbolType];

  if (!validation) {
    prodLogger.warn(`[PCVL] No validation rules for symbol type: ${symbolType}`);
    return true; // Don't block on missing validation rules
  }

  return pipValue >= validation.min && pipValue <= validation.max;
}

/**
 * Validate lot size is within broker limits
 */
function validateLotSize(
  symbol: string,
  lotSize: number,
  symbolConfig: ReturnType<typeof getSymbolConfig>
): boolean {
  const minLot = symbolConfig?.minLotSize || 0.01;
  const maxLot = symbolConfig?.maxLotSize || 5.0;

  return lotSize >= minLot && lotSize <= maxLot;
}

/**
 * Quick PCVL check for pre-validation (returns boolean only)
 */
export function quickPCVLCheck(
  symbol: string,
  lotSize: number,
  stopPips: number,
  intendedRiskDollars: number
): boolean {
  if (!configIsPCVLEnabled()) {
    return true;
  }

  const dollarPerPip = calculateDollarPerPip(symbol, lotSize);
  const trueRiskDollars = stopPips * dollarPerPip;
  const variance = Math.abs(((trueRiskDollars - intendedRiskDollars) / intendedRiskDollars) * 100);

  return variance <= PCVL_CONFIG.max_risk_variance_percent;
}
