/**
 * Risk Pre-Flight Gate - DETERMINISTIC Risk Validation System
 *
 * This is NOT an Omega voter - it's a PRE-FLIGHT GATE that validates
 * trade proposals BEFORE they execute.
 *
 * RESPONSIBILITY:
 * - Validate R:R ratio meets minimum requirements
 * - Check SL placement against ATR
 * - Validate position sizing
 * - Ensure exposure limits
 * - Return GO/NO_GO with reasons
 *
 * FULLY DETERMINISTIC - NO LLM CALLS
 */

import type { ATRValue } from '../types/atr';
import { safeExtractATRValue } from '../types/atr';
import { calculatePipDistance } from '../utils/currencyHelpers';
import { RISK_GATE_THRESHOLDS } from '../config/omega-thresholds';

export interface RiskGateInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  atr: number | ATRValue;
  accountBalance: number;
  riskPercent: number;
  existingExposure?: number;
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

    if (isBuy && input.stopLoss >= input.entry) {
      violations.push({
        type: 'CRITICAL',
        code: 'SL_WRONG_SIDE_BUY',
        message: `BUY SL (${input.stopLoss}) must be below entry (${input.entry})`,
        value: input.stopLoss,
        threshold: input.entry
      });
      riskScore = 0;
    }

    if (!isBuy && input.stopLoss <= input.entry) {
      violations.push({
        type: 'CRITICAL',
        code: 'SL_WRONG_SIDE_SELL',
        message: `SELL SL (${input.stopLoss}) must be above entry (${input.entry})`,
        value: input.stopLoss,
        threshold: input.entry
      });
      riskScore = 0;
    }

    if (isBuy && input.takeProfit <= input.entry) {
      violations.push({
        type: 'CRITICAL',
        code: 'TP_WRONG_SIDE_BUY',
        message: `BUY TP (${input.takeProfit}) must be above entry (${input.entry})`,
        value: input.takeProfit,
        threshold: input.entry
      });
      riskScore = 0;
    }

    if (!isBuy && input.takeProfit >= input.entry) {
      violations.push({
        type: 'CRITICAL',
        code: 'TP_WRONG_SIDE_SELL',
        message: `SELL TP (${input.takeProfit}) must be below entry (${input.entry})`,
        value: input.takeProfit,
        threshold: input.entry
      });
      riskScore = 0;
    }

    if (rrRatio < RISK_GATE_THRESHOLDS.MIN_RR_RATIO) {
      violations.push({
        type: 'BLOCKING',
        code: 'RR_TOO_LOW',
        message: `R:R ratio ${rrRatio.toFixed(2)} below minimum ${RISK_GATE_THRESHOLDS.MIN_RR_RATIO}`,
        value: rrRatio,
        threshold: RISK_GATE_THRESHOLDS.MIN_RR_RATIO
      });
      riskScore -= 40;
    } else if (rrRatio < RISK_GATE_THRESHOLDS.IDEAL_RR_RATIO) {
      warnings.push({
        type: 'CAUTION',
        code: 'RR_SUBOPTIMAL',
        message: `R:R ratio ${rrRatio.toFixed(2)} below ideal ${RISK_GATE_THRESHOLDS.IDEAL_RR_RATIO}`,
        value: rrRatio,
        threshold: RISK_GATE_THRESHOLDS.IDEAL_RR_RATIO
      });
      riskScore -= 10;
    } else if (rrRatio >= 2.0) {
      riskScore += 10;
    }

    if (slInATR < RISK_GATE_THRESHOLDS.MIN_SL_ATR) {
      warnings.push({
        type: 'CAUTION',
        code: 'SL_TOO_TIGHT',
        message: `SL distance ${slInATR.toFixed(2)} ATR below minimum ${RISK_GATE_THRESHOLDS.MIN_SL_ATR}`,
        value: slInATR,
        threshold: RISK_GATE_THRESHOLDS.MIN_SL_ATR
      });
      riskScore -= 15;
    }

    if (slInATR > RISK_GATE_THRESHOLDS.MAX_SL_ATR) {
      warnings.push({
        type: 'CAUTION',
        code: 'SL_TOO_WIDE',
        message: `SL distance ${slInATR.toFixed(2)} ATR exceeds maximum ${RISK_GATE_THRESHOLDS.MAX_SL_ATR}`,
        value: slInATR,
        threshold: RISK_GATE_THRESHOLDS.MAX_SL_ATR
      });
      riskScore -= 15;
    }

    if (input.riskPercent > RISK_GATE_THRESHOLDS.MAX_RISK_PERCENT) {
      violations.push({
        type: 'BLOCKING',
        code: 'RISK_PCT_TOO_HIGH',
        message: `Risk ${input.riskPercent}% exceeds maximum ${RISK_GATE_THRESHOLDS.MAX_RISK_PERCENT}%`,
        value: input.riskPercent,
        threshold: RISK_GATE_THRESHOLDS.MAX_RISK_PERCENT
      });
      riskScore -= 30;
    }

    const totalExposure = (input.existingExposure || 0) + input.riskPercent;
    if (totalExposure > RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE) {
      violations.push({
        type: 'BLOCKING',
        code: 'EXPOSURE_EXCEEDED',
        message: `Total exposure ${totalExposure}% exceeds maximum ${RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE}%`,
        value: totalExposure,
        threshold: RISK_GATE_THRESHOLDS.MAX_TOTAL_EXPOSURE
      });
      riskScore -= 25;
    }

    const hasCritical = violations.some(v => v.type === 'CRITICAL');
    const hasBlocking = violations.some(v => v.type === 'BLOCKING');
    const canProceed = !hasCritical && !hasBlocking;

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
      const minTpDistance = slDistance * RISK_GATE_THRESHOLDS.MIN_RR_RATIO;

      if (isBuy) {
        adjustments.suggestedTP = input.entry + minTpDistance;
      } else {
        adjustments.suggestedTP = input.entry - minTpDistance;
      }
      reasons.push(`TP adjusted for ${RISK_GATE_THRESHOLDS.MIN_RR_RATIO}:1 R:R`);
    }

    const riskViolation = violations.find(v => v.code === 'RISK_PCT_TOO_HIGH');
    if (riskViolation) {
      adjustments.suggestedRiskPct = RISK_GATE_THRESHOLDS.MAX_RISK_PERCENT;
      reasons.push(`Risk capped at ${RISK_GATE_THRESHOLDS.MAX_RISK_PERCENT}%`);
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
    takeProfit: number
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

    const slDistance = Math.abs(entry - stopLoss);
    const tpDistance = Math.abs(takeProfit - entry);
    const rrRatio = slDistance > 0 ? tpDistance / slDistance : 0;

    if (rrRatio < RISK_GATE_THRESHOLDS.MIN_RR_RATIO) {
      return { valid: false, reason: `R:R ${rrRatio.toFixed(2)} below minimum ${RISK_GATE_THRESHOLDS.MIN_RR_RATIO}` };
    }

    return { valid: true };
  }
}

export const riskPreflightGate = new RiskPreflightGate();
