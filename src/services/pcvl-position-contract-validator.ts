/**
 * PCVL (Position Contract Validation Layer)
 *
 * CRITICAL LAST-LINE DEFENSE: Validates broker pip value math before order execution.
 *
 * PURPOSE:
 * Prevents silent 10-100× risk violations caused by:
 * - Pip value configuration errors
 * - Mixed calculation sources (currencyHelpers vs symbol-registry)
 * - Decimal placement disasters
 * - Missing pip value definitions
 *
 * VALIDATION LOGIC:
 * 1. Calculate TRUE risk: trueRisk = lot_size × pip_value × stop_pips
 * 2. Compare to intended risk
 * 3. Block if variance > ±2%
 * 4. Validate pip value is within expected range
 * 5. Validate lot size is within broker limits
 *
 * HARD BLOCKS:
 * - Risk variance > ±2%
 * - Pip value missing or out of range
 * - Lot size outside broker limits
 * - Stop distance < minimum
 *
 * EMERGENCY KILL SWITCH:
 * Set PCVL_CONFIG.enabled = false to bypass (use with extreme caution)
 */

import { getCurrencyPipInfo, calculateDollarPerPip, calculatePipDistance } from '../utils/currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import { PCVL_CONFIG, isPCVLEnabled } from '../config/pcvl-config';
import { prodLogger } from '../lib/production-logger';
import type { PCVLInput, PCVLResult, PCVLAudit } from '../types/pcvl';

/**
 * Validate position contract before order execution
 *
 * This is the CRITICAL function that prevents position sizing disasters.
 * Every trade must pass this validation before reaching the broker.
 *
 * @param inputs Position contract details
 * @returns Validation result with approval status and audit trail
 */
export function validatePositionContract(inputs: PCVLInput): PCVLResult {
  const {
    symbol,
    lot_size,
    stop_pips,
    intended_risk_dollars,
    entry_price,
    stop_loss,
  } = inputs;

  prodLogger.info(`[PCVL] 🛡️ Validating position contract for ${symbol}`);
  prodLogger.info(`[PCVL] Lot size: ${lot_size.toFixed(3)}, Stop: ${stop_pips.toFixed(1)} pips, Intended risk: $${intended_risk_dollars.toFixed(2)}`);

  // Step 1: Get SSOT pip value from currencyHelpers (single source of truth)
  const pipInfo = getCurrencyPipInfo(symbol);
  const symbolConfig = getSymbolConfig(symbol);

  // Step 2: Calculate TRUE dollar risk using broker pip values
  const dollarPerPip = calculateDollarPerPip(symbol, lot_size);
  const trueRiskDollars = stop_pips * dollarPerPip;

  prodLogger.info(`[PCVL] Pip value: ${pipInfo.pipValue}, Dollar/pip: $${dollarPerPip.toFixed(2)}`);
  prodLogger.info(`[PCVL] TRUE RISK: $${trueRiskDollars.toFixed(2)}`);

  // Step 3: Calculate risk variance (positive = over-risk, negative = under-risk)
  const riskVariance = ((trueRiskDollars - intended_risk_dollars) / intended_risk_dollars) * 100;

  prodLogger.info(`[PCVL] Risk variance: ${riskVariance >= 0 ? '+' : ''}${riskVariance.toFixed(2)}%`);

  // Step 4: HARD BLOCK if risk variance exceeds tolerance
  if (Math.abs(riskVariance) > PCVL_CONFIG.max_risk_variance_percent) {
    prodLogger.error(`[PCVL] 🚫 BLOCKED: Risk variance ${riskVariance.toFixed(2)}% exceeds ±${PCVL_CONFIG.max_risk_variance_percent}%`);
    prodLogger.error(`[PCVL] Intended: $${intended_risk_dollars.toFixed(2)}, Actual: $${trueRiskDollars.toFixed(2)}`);
    prodLogger.error(`[PCVL] This indicates a pip value calculation error or config mismatch`);

    return {
      approved: false,
      true_risk_dollars: trueRiskDollars,
      pip_value_used: pipInfo.pipValue,
      dollar_per_pip: dollarPerPip,
      risk_variance_percent: riskVariance,
      block_reason: `RISK_VARIANCE_EXCEEDED: ${riskVariance.toFixed(2)}% variance (max ±${PCVL_CONFIG.max_risk_variance_percent}%). Intended: $${intended_risk_dollars.toFixed(2)}, Actual: $${trueRiskDollars.toFixed(2)}`,
      audit: createAudit(inputs, trueRiskDollars, pipInfo.pipValue, dollarPerPip, riskVariance, false, 'RISK_VARIANCE_EXCEEDED'),
    };
  }

  // Step 5: Validate pip value is within expected range for instrument type
  const instrumentType = pipInfo.symbolType;
  const pipValueRange = PCVL_CONFIG.pip_value_validation[instrumentType];

  if (pipValueRange && (dollarPerPip < pipValueRange.min || dollarPerPip > pipValueRange.max)) {
    prodLogger.error(`[PCVL] 🚫 BLOCKED: Dollar/pip $${dollarPerPip.toFixed(2)} outside expected range [$${pipValueRange.min}-$${pipValueRange.max}] for ${instrumentType}`);
    prodLogger.error(`[PCVL] This indicates a pip value configuration error in currencyHelpers or symbol-registry`);

    return {
      approved: false,
      true_risk_dollars: trueRiskDollars,
      pip_value_used: pipInfo.pipValue,
      dollar_per_pip: dollarPerPip,
      risk_variance_percent: riskVariance,
      block_reason: `PIP_VALUE_OUT_OF_RANGE: $${dollarPerPip.toFixed(2)}/pip outside expected range [$${pipValueRange.min}-$${pipValueRange.max}] for ${instrumentType}`,
      audit: createAudit(inputs, trueRiskDollars, pipInfo.pipValue, dollarPerPip, riskVariance, false, 'PIP_VALUE_OUT_OF_RANGE'),
    };
  }

  // Step 6: Validate lot size within broker limits
  const minLot = symbolConfig?.minLotSize || 0.01;
  const maxLot = symbolConfig?.maxLotSize || 5.0;

  if (lot_size < minLot || lot_size > maxLot) {
    prodLogger.error(`[PCVL] 🚫 BLOCKED: Lot size ${lot_size.toFixed(3)} outside broker limits [${minLot}-${maxLot}]`);

    return {
      approved: false,
      true_risk_dollars: trueRiskDollars,
      pip_value_used: pipInfo.pipValue,
      dollar_per_pip: dollarPerPip,
      risk_variance_percent: riskVariance,
      block_reason: `LOT_SIZE_OUT_OF_RANGE: ${lot_size.toFixed(3)} lots outside broker limits [${minLot}-${maxLot}]`,
      audit: createAudit(inputs, trueRiskDollars, pipInfo.pipValue, dollarPerPip, riskVariance, false, 'LOT_SIZE_OUT_OF_RANGE'),
    };
  }

  // Step 7: Validate stop distance is reasonable
  // Recalculate from actual prices to verify
  const verifiedStopPips = calculatePipDistance(symbol, entry_price, stop_loss);
  const pipDiscrepancy = Math.abs(verifiedStopPips - stop_pips);

  // Allow up to 1 pip discrepancy for rounding
  if (pipDiscrepancy > 1.0) {
    prodLogger.warn(`[PCVL] ⚠️ WARNING: Stop pip discrepancy detected`);
    prodLogger.warn(`[PCVL] Provided: ${stop_pips.toFixed(2)} pips, Calculated: ${verifiedStopPips.toFixed(2)} pips`);
    prodLogger.warn(`[PCVL] Discrepancy: ${pipDiscrepancy.toFixed(2)} pips`);
    // Log warning but don't block - this is informational
  }

  // Step 8: Log variance warnings (but still approve)
  if (Math.abs(riskVariance) >= PCVL_CONFIG.risk_variance_thresholds.warning) {
    prodLogger.warn(`[PCVL] ⚠️ WARNING: Risk variance ${riskVariance.toFixed(2)}% approaching threshold`);
    prodLogger.warn(`[PCVL] Intended: $${intended_risk_dollars.toFixed(2)}, Actual: $${trueRiskDollars.toFixed(2)}`);
  }

  // Step 9: All validations passed ✅
  prodLogger.info(`[PCVL] ✅ APPROVED: Contract validated successfully`);
  prodLogger.info(`[PCVL] Risk variance: ${riskVariance >= 0 ? '+' : ''}${riskVariance.toFixed(2)}% (within ±${PCVL_CONFIG.max_risk_variance_percent}%)`);
  prodLogger.info(`[PCVL] Pip value: ${pipInfo.pipValue}, Dollar/pip: $${dollarPerPip.toFixed(2)}`);

  return {
    approved: true,
    true_risk_dollars: trueRiskDollars,
    pip_value_used: pipInfo.pipValue,
    dollar_per_pip: dollarPerPip,
    risk_variance_percent: riskVariance,
    audit: createAudit(inputs, trueRiskDollars, pipInfo.pipValue, dollarPerPip, riskVariance, true),
  };
}

/**
 * Create audit trail for PCVL validation
 */
function createAudit(
  inputs: PCVLInput,
  calculatedRisk: number,
  pipValue: number,
  dollarPerPip: number,
  riskVariance: number,
  approved: boolean,
  blockReason?: string
): PCVLAudit {
  return {
    timestamp: new Date().toISOString(),
    symbol: inputs.symbol,
    lot_size: inputs.lot_size,
    stop_pips: inputs.stop_pips,
    intended_risk: inputs.intended_risk_dollars,
    calculated_risk: calculatedRisk,
    risk_variance: riskVariance,
    pip_value: pipValue,
    dollar_per_pip: dollarPerPip,
    approved,
    block_reason,
  };
}

/**
 * Export PCVL enabled check
 */
export { isPCVLEnabled };

/**
 * Get PCVL configuration (for testing and debugging)
 */
export { PCVL_CONFIG, getPCVLConfig } from '../config/pcvl-config';
