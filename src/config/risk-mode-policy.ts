/**
 * Risk Policy Configuration (SSOT)
 *
 * Simplified to single STANDARD risk policy: 1-10% per trade, 20% max total exposure.
 * Risk is now user-controlled via dollar amounts rather than abstract modes.
 *
 * Legacy RiskMode type kept for backward compatibility but deprecated.
 */

import { TRADING_CONSTANTS } from './trading-constants';

export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH' | 'STANDARD';

export interface RiskPolicyEnvelope {
  mode: RiskMode | 'STANDARD';
  minPercent: number;
  maxPercent: number;
  defaultPercent: number;
  description: string;
}

// SSOT: Import risk limits from trading-constants.ts
export const STANDARD_RISK_POLICY: RiskPolicyEnvelope = {
  mode: 'STANDARD',
  minPercent: TRADING_CONSTANTS.RISK_PERCENTAGES.MIN_PER_TRADE * 100,
  maxPercent: TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100,
  defaultPercent: TRADING_CONSTANTS.RISK_PERCENTAGES.DEFAULT_PER_TRADE * 100,
  description: 'Standard risk - 1-10% per trade, user controls via dollar amounts',
};

export const RISK_MODE_POLICIES: Record<RiskMode, RiskPolicyEnvelope> = {
  STANDARD: STANDARD_RISK_POLICY,
  LOW: STANDARD_RISK_POLICY,
  MEDIUM: STANDARD_RISK_POLICY,
  HIGH: STANDARD_RISK_POLICY,
};

// SSOT: Import from trading-constants.ts
export const PLATFORM_ABSOLUTE_RISK_CAP = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100;
export const MAX_TOTAL_EXPOSURE_PERCENT = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_TOTAL_EXPOSURE * 100;

export function getRiskPolicyForMode(mode?: RiskMode): RiskPolicyEnvelope {
  return STANDARD_RISK_POLICY;
}

export function validateRiskPercentForMode(
  riskPercent: number,
  mode?: RiskMode
): { valid: boolean; reason?: string } {
  const policy = STANDARD_RISK_POLICY;

  if (riskPercent < policy.minPercent) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% is below minimum ${policy.minPercent}%`,
    };
  }

  if (riskPercent > policy.maxPercent) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% exceeds maximum ${policy.maxPercent}%`,
    };
  }

  if (riskPercent > PLATFORM_ABSOLUTE_RISK_CAP) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% exceeds platform safety cap of ${PLATFORM_ABSOLUTE_RISK_CAP}%`,
    };
  }

  return { valid: true };
}

export function getRiskPercentFromMode(
  mode?: RiskMode,
  preferredPercent?: number
): number {
  const policy = STANDARD_RISK_POLICY;

  if (preferredPercent !== undefined) {
    const validation = validateRiskPercentForMode(preferredPercent, mode);
    if (validation.valid) {
      return preferredPercent;
    }
  }

  return policy.defaultPercent;
}

export function getStandardRiskPolicy(): RiskPolicyEnvelope {
  return STANDARD_RISK_POLICY;
}
