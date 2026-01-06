/**
 * Risk Mode Policy Configuration (SSOT)
 *
 * Defines the policy envelopes for each risk mode.
 * Alpha has authority to choose any risk % within the user's selected policy envelope.
 *
 * This is NOT a "hardcoded decision" - it's the contract between:
 * - User's risk tolerance selection
 * - Platform safety requirements
 * - Alpha's decision-making freedom
 */

export type RiskMode = 'LOW' | 'MEDIUM' | 'HIGH';

export interface RiskPolicyEnvelope {
  mode: RiskMode;
  minPercent: number;
  maxPercent: number;
  defaultPercent: number;
  description: string;
}

export const RISK_MODE_POLICIES: Record<RiskMode, RiskPolicyEnvelope> = {
  LOW: {
    mode: 'LOW',
    minPercent: 1,
    maxPercent: 3,
    defaultPercent: 2,
    description: 'Conservative risk - suitable for capital preservation'
  },
  MEDIUM: {
    mode: 'MEDIUM',
    minPercent: 2,
    maxPercent: 5,
    defaultPercent: 3,
    description: 'Balanced risk - suitable for steady growth'
  },
  HIGH: {
    mode: 'HIGH',
    minPercent: 3,
    maxPercent: 10,
    defaultPercent: 5,
    description: 'Aggressive risk - suitable for experienced traders seeking growth'
  }
};

export const PLATFORM_ABSOLUTE_RISK_CAP = 15;

export function getRiskPolicyForMode(mode: RiskMode): RiskPolicyEnvelope {
  return RISK_MODE_POLICIES[mode];
}

export function validateRiskPercentForMode(
  riskPercent: number,
  mode: RiskMode
): { valid: boolean; reason?: string } {
  const policy = getRiskPolicyForMode(mode);

  if (riskPercent < policy.minPercent) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% is below minimum ${policy.minPercent}% for ${mode} mode`
    };
  }

  if (riskPercent > policy.maxPercent) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% exceeds maximum ${policy.maxPercent}% for ${mode} mode`
    };
  }

  if (riskPercent > PLATFORM_ABSOLUTE_RISK_CAP) {
    return {
      valid: false,
      reason: `Risk ${riskPercent}% exceeds platform safety cap of ${PLATFORM_ABSOLUTE_RISK_CAP}%`
    };
  }

  return { valid: true };
}

export function getRiskPercentFromMode(mode: RiskMode, preferredPercent?: number): number {
  const policy = getRiskPolicyForMode(mode);

  if (preferredPercent !== undefined) {
    const validation = validateRiskPercentForMode(preferredPercent, mode);
    if (validation.valid) {
      return preferredPercent;
    }
  }

  return policy.defaultPercent;
}
