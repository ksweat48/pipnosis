/**
 * Risk Policy Configuration (SSOT)
 *
 * Simplified to single STANDARD risk policy: 1-10% per trade, 20% max total exposure.
 * Risk is now user-controlled via dollar amounts rather than abstract modes.
 *
 * Legacy RiskMode type kept for backward compatibility but deprecated.
 */

export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH' | 'STANDARD';

export interface RiskPolicyEnvelope {
  mode: RiskMode | 'STANDARD';
  minPercent: number;
  maxPercent: number;
  defaultPercent: number;
  description: string;
}

export const STANDARD_RISK_POLICY: RiskPolicyEnvelope = {
  mode: 'STANDARD',
  minPercent: 1,
  maxPercent: 10,
  defaultPercent: 2,
  description: 'Standard risk - 1-10% per trade, user controls via dollar amounts',
};

export const RISK_MODE_POLICIES: Record<RiskMode, RiskPolicyEnvelope> = {
  STANDARD: STANDARD_RISK_POLICY,
  LOW: STANDARD_RISK_POLICY,
  MEDIUM: STANDARD_RISK_POLICY,
  HIGH: STANDARD_RISK_POLICY,
};

export const PLATFORM_ABSOLUTE_RISK_CAP = 10;
export const MAX_TOTAL_EXPOSURE_PERCENT = 20;

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
