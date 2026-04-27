/**
 * Risk Pre-Flight Gate - DETERMINISTIC Risk Validation System
 *
 * CCIP-2026-0328B: ALPHA SOVEREIGNTY ENFORCEMENT
 *
 * This gate validates trade GEOMETRY and DATA INTEGRITY only.
 * It does NOT block Alpha's trading decisions based on R:R ratios,
 * SL placement, or exposure levels — those are Alpha's professional judgments.
 *
 * HARD BLOCKS (geometry / data integrity only):
 * - SL on wrong side of entry (mathematical impossibility)
 * - TP on wrong side of entry (mathematical impossibility)
 *
 * ADVISORY ONLY (logged, not blocking):
 * - R:R below style minimum — Alpha's structural choice
 * - SL too tight / too wide vs ATR — Alpha's structural choice
 * - Risk % policy violation — advisory warning
 * - Total exposure exceeded — advisory warning
 *
 * SSOT: alpha-identity.ts LEGITIMATE_BLOCK_CONDITIONS governs all hard stops.
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { ATRValue } from '../types/atr';
import { safeExtractATRValue } from '../types/atr';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { RISK_GATE_THRESHOLDS } from '../config/omega-thresholds';
import { validateRiskPercentForMode, PLATFORM_ABSOLUTE_RISK_CAP, type RiskMode } from '../config/risk-mode-policy';
import { TRADING_CONSTANTS, getMinRRForStyle } from '../config/trading-constants';
import { tradeValidationService } from './trade-validation-service';

export interface RiskGateInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  atr: number | ATRValue;
  accountBalance: number;
  riskPercent: number;
  riskMode?: RiskMode;
  existingExposure?: number;
  style?: string;
}

export interface RiskGateResult {
  canProceed: boolean;
  riskScore: number;
  violations: RiskViolation[];
  warnings: RiskWarning[];
  adjustments?: RiskAdjustments;
  evidence: string;
}

export interface RiskViolation {
  type: 'CRITICAL' | 'BLOCKING';
  code: string;
  message: string;
  value?: number;
  threshold?: number;
}

export interface RiskWarning {
  type: 'ADVISORY' | 'CAUTION';
  code: string;
  message: string;
  value?: number;
  threshold?: number;
}

export interface RiskAdjustments {
  suggestedSL?: number;
  suggestedTP?: number;
  suggestedRiskPct?: number;
  reason: string;
}

class RiskPreflightGate {
  validate(input: RiskGateInput): RiskGateResult {
    const violations: RiskViolation[] = [];
    const warnings: RiskWarning[] = [];
    let riskScore = 100;

    const atrValue = safeExtractATRValue(input.atr, 'RiskPreflightGate.validate');
    const isBuy = input.direction === 'BUY';

    const slDistance = Math.abs(input.entry - input.stopLoss);
    const tpDistance = Math.abs(input.takeProfit - input.entry);
    const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

    const slDistancePips = calculatePipDistance(input.symbol, input.entry, input.stopLoss);
    const tpDistancePips = calculatePipDistance(input.symbol, input.entry, input.takeProfit);
    const slInATR = slDistance / atrValue;

    // ✅ PHASE 2 SECTION 2: Use TradeValidationService (SSOT for SL/TP direction)
    // Replaces duplicate validation logic (lines 86-128)
    const validation = tradeValidationService.validateTrade({
      symbol: input.symbol,
      direction: input.direction.toLowerCase() as 'buy' | 'sell',
      entryPrice: input.entry,
      stopLoss: input.stopLoss,
      takeProfit: input.takeProfit,
      lotSize: 1.0 // Default for validation purposes
    });

    if (!validation.isValid) {
      // Map SSOT errors to RiskGate violation format
      validation.errors.forEach(error => {
        violations.push({
          type: 'CRITICAL',
          code: error.includes('Stop loss') ? 'SL_DIRECTION_INVALID' : 'TP_DIRECTION_INVALID',
          message: error,
          value: error.includes('Stop loss') ? input.stopLoss : input.takeProfit,
          threshold: input.entry
        });
      });
      riskScore = 0;
    }

    // CCIP-2026-0328B: R:R, SL placement, risk %, and exposure are Alpha's structural
    // decisions. They are observed and logged as advisory warnings — never BLOCKING.
    // Only geometry inversions (wrong side of entry) are hard violations.
    const styleMinRR = getMinRRForStyle(input.style);
    if (rrRatio < styleMinRR) {
      warnings.push({
        type: 'ADVISORY',
        code: 'RR_BELOW_STYLE_MINIMUM',
        message: `R:R ratio ${rrRatio.toFixed(2)} below style minimum ${styleMinRR} for ${input.style || 'default'} — advisory only per CCIP-2026-0328B`,
        value: rrRatio,
        threshold: styleMinRR
      });
      riskScore -= 10;
    } else if (rrRatio < TRADING_CONSTANTS.RISK_REWARD_RATIOS.TARGET) {
      warnings.push({
        type: 'CAUTION',
        code: 'RR_SUBOPTIMAL',
        message: `R:R ratio ${rrRatio.toFixed(2)} below target ${TRADING_CONSTANTS.RISK_REWARD_RATIOS.TARGET}`,
        value: rrRatio,
        threshold: TRADING_CONSTANTS.RISK_REWARD_RATIOS.TARGET
      });
      riskScore -= 5;
    } else if (rrRatio >= TRADING_CONSTANTS.RISK_REWARD_RATIOS.EXCELLENT) {
      riskScore += 10;
    }

    if (slInATR < RISK_GATE_THRESHOLDS.MIN_SL_ATR) {
      warnings.push({
        type: 'ADVISORY',
        code: 'SL_TOO_TIGHT',
        message: `SL distance ${slInATR.toFixed(2)} ATR below minimum ${RISK_GATE_THRESHOLDS.MIN_SL_ATR} — advisory only`,
        value: slInATR,
        threshold: RISK_GATE_THRESHOLDS.MIN_SL_ATR
      });
      riskScore -= 5;
    }

    if (slInATR > RISK_GATE_THRESHOLDS.MAX_SL_ATR) {
      warnings.push({
        type: 'ADVISORY',
        code: 'SL_TOO_WIDE',
        message: `SL distance ${slInATR.toFixed(2)} ATR exceeds maximum ${RISK_GATE_THRESHOLDS.MAX_SL_ATR} — advisory only`,
        value: slInATR,
        threshold: RISK_GATE_THRESHOLDS.MAX_SL_ATR
      });
      riskScore -= 5;
    }

    if (input.riskMode) {
      const riskValidation = validateRiskPercentForMode(input.riskPercent, input.riskMode);
      if (!riskValidation.valid) {
        warnings.push({
          type: 'ADVISORY',
          code: 'RISK_PCT_POLICY_ADVISORY',
          message: `${riskValidation.reason} — advisory only per CCIP-2026-0328B`,
          value: input.riskPercent
        });
        riskScore -= 10;
      }
    } else if (input.riskPercent > PLATFORM_ABSOLUTE_RISK_CAP) {
      warnings.push({
        type: 'ADVISORY',
        code: 'RISK_PCT_HIGH',
        message: `Risk ${input.riskPercent}% above platform cap ${PLATFORM_ABSOLUTE_RISK_CAP}% — advisory only`,
        value: input.riskPercent,
        threshold: PLATFORM_ABSOLUTE_RISK_CAP
      });
      riskScore -= 10;
    }

    const totalExposure = (input.existingExposure || 0) + input.riskPercent;
    if (totalExposure > RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE) {
      warnings.push({
        type: 'ADVISORY',
        code: 'EXPOSURE_HIGH',
        message: `Total exposure ${totalExposure}% above maximum ${RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE}% — advisory only`,
        value: totalExposure,
        threshold: RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE
      });
      riskScore -= 10;
    }

    // CCIP-2026-0328B: Only CRITICAL geometry violations block execution.
    // BLOCKING type no longer exists — all non-critical checks are advisory.
    const hasCritical = violations.some(v => v.type === 'CRITICAL');
    const canProceed = !hasCritical;

    riskScore = Math.max(0, Math.min(100, riskScore));

    let adjustments: RiskAdjustments | undefined;
    if (!canProceed && !hasCritical) {
      adjustments = this.suggestAdjustments(input, violations, atrValue);
    }

    const evidence = this.buildEvidence(input, rrRatio, slInATR, riskScore, violations, warnings);

    console.log(`[Risk Pre-Flight] ${canProceed ? 'PASS' : 'FAIL'} | Score: ${riskScore}/100 | R:R: ${rrRatio.toFixed(2)} | SL: ${slInATR.toFixed(2)} ATR`);
    if (violations.length > 0) {
      console.log(`[Risk Pre-Flight] Violations: ${violations.map(v => v.code).join(', ')}`);
    }
    if (warnings.length > 0) {
      console.log(`[Risk Pre-Flight] Warnings: ${warnings.map(w => w.code).join(', ')}`);
    }

    return {
      canProceed,
      riskScore,
      violations,
      warnings,
      adjustments,
      evidence
    };
  }

  private suggestAdjustments(
    input: RiskGateInput,
    violations: RiskViolation[],
    atr: number
  ): RiskAdjustments | undefined {
    const isBuy = input.direction === 'BUY';
    const adjustments: RiskAdjustments = { reason: '' };
    const reasons: string[] = [];

    const rrViolation = violations.find(v => v.code === 'RR_TOO_LOW');
    if (rrViolation) {
      const slDistance = Math.abs(input.entry - input.stopLoss);
      const minRR = getMinRRForStyle(input.style);
      const minTpDistance = slDistance * minRR;

      if (isBuy) {
        adjustments.suggestedTP = input.entry + minTpDistance;
      } else {
        adjustments.suggestedTP = input.entry - minTpDistance;
      }
      reasons.push(`TP adjusted for ${minRR}:1 R:R (${input.style || 'default'})`);
    }

    const riskViolation = violations.find(v => v.code === 'RISK_PCT_POLICY_VIOLATION' || v.code === 'RISK_PCT_TOO_HIGH');
    if (riskViolation && input.riskMode) {
      const policy = validateRiskPercentForMode(input.riskPercent, input.riskMode);
      if (!policy.valid) {
        adjustments.suggestedRiskPct = PLATFORM_ABSOLUTE_RISK_CAP;
        reasons.push(`Risk capped at platform limit ${PLATFORM_ABSOLUTE_RISK_CAP}%`);
      }
    } else if (riskViolation) {
      adjustments.suggestedRiskPct = PLATFORM_ABSOLUTE_RISK_CAP;
      reasons.push(`Risk capped at ${PLATFORM_ABSOLUTE_RISK_CAP}%`);
    }

    if (reasons.length === 0) {
      return undefined;
    }

    adjustments.reason = reasons.join('; ');
    return adjustments;
  }

  private buildEvidence(
    input: RiskGateInput,
    rrRatio: number,
    slInATR: number,
    riskScore: number,
    violations: RiskViolation[],
    warnings: RiskWarning[]
  ): string {
    const parts = [
      `RR=${rrRatio.toFixed(2)}`,
      `SL_ATR=${slInATR.toFixed(2)}`,
      `RISK=${input.riskPercent}%`,
      `SCORE=${riskScore}`
    ];

    if (violations.length > 0) {
      parts.push(`VIOL=${violations.map(v => v.code).join(',')}`);
    }

    if (warnings.length > 0) {
      parts.push(`WARN=${warnings.map(w => w.code).join(',')}`);
    }

    return parts.join('|');
  }

  validateQuick(
    direction: 'BUY' | 'SELL',
    entry: number,
    stopLoss: number,
    takeProfit: number,
    style?: string
  ): { valid: boolean; reason?: string } {
    const isBuy = direction === 'BUY';

    if (isBuy && stopLoss >= entry) {
      return { valid: false, reason: 'BUY SL must be below entry' };
    }
    if (!isBuy && stopLoss <= entry) {
      return { valid: false, reason: 'SELL SL must be above entry' };
    }
    if (isBuy && takeProfit <= entry) {
      return { valid: false, reason: 'BUY TP must be above entry' };
    }
    if (!isBuy && takeProfit >= entry) {
      return { valid: false, reason: 'SELL TP must be below entry' };
    }

    // CCIP-2026-0427L: R:R floor REMOVED. Alpha owns R:R judgement.
    // Geometry direction checks above remain (physics, not strategy).
    return { valid: true };
  }

  async validateTotalExposure(
    userId: string,
    accountBalance: number,
    newTradeRiskDollars: number,
    isMultiTradeMode: boolean
  ): Promise<{
    canTrade: boolean;
    blockReason?: string;
    exposureInfo: {
      currentExposurePercent: number;
      remainingCapacityPercent: number;
      remainingCapacityDollars: number;
    };
  }> {
    if (!isMultiTradeMode) {
      // SSOT: Use platform maximum exposure from trading-constants.ts (20%)
      const maxExposurePercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE * 100;
      return {
        canTrade: true,
        exposureInfo: {
          currentExposurePercent: 0,
          remainingCapacityPercent: maxExposurePercent,
          remainingCapacityDollars: accountBalance * TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE,
        },
      };
    }

    const { professionalRiskManager } = await import('./professional-risk-manager');

    const exposureCheck = await professionalRiskManager.checkTotalExposure(
      userId,
      accountBalance,
      newTradeRiskDollars
    );

    return {
      canTrade: exposureCheck.canTrade,
      blockReason: exposureCheck.blockReason,
      exposureInfo: {
        currentExposurePercent: exposureCheck.currentExposurePercent,
        remainingCapacityPercent: exposureCheck.remainingCapacityPercent,
        remainingCapacityDollars: exposureCheck.remainingCapacityDollars,
      },
    };
  }
}

export const riskPreflightGate = new RiskPreflightGate();
