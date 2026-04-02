/**
 * Constraint Feasibility Validator (SSOT)
 *
 * SINGLE SOURCE OF TRUTH for constraint internal consistency validation
 *
 * RESPONSIBILITY:
 * Validates that constraint pairs are mathematically feasible BEFORE they're returned to Alpha.
 * If minTP > maxTP, this service detects it and provides advisory state.
 *
 * CRITICAL PRINCIPLE:
 * This service describes what's POSSIBLE, not what's ACCEPTABLE.
 * It's the ENGINE that validates, not the AUTHORITY that decides.
 *
 * GOVERNANCE COMPLIANCE:
 * - Returns unmodified constraints + feasibility status
 * - Never auto-corrects or hides the conflict
 * - Provides clear advisory so Alpha sees reality
 * - Tracks infeasibility for governance audit trail
 *
 * ARCHITECTURE:
 * Input: minTP (from R:R requirements), maxTP (from market reality)
 * Output: Feasibility status + advisory state
 * Alpha then DECIDES: Accept reduced R:R, skip trade (NO_TRADE), etc. Style is IMMUTABLE.
 */

import type { ConstraintFeasibilityStatus } from '../types/omega9-constraints';

class ConstraintFeasibilityValidator {
  /**
   * Validate constraint internal consistency
   * Returns UNMODIFIED constraints + feasibility status
   *
   * KEY: This does NOT auto-correct. It just checks and reports.
   */
  validateConstraintPair(
    minTakeProfitPips: number,
    maxTakeProfitPips: number,
    minRiskReward: number,
    referenceSLPips: number,
    conflictSource: 'SESSION_TIME' | 'MARKET_ATR' | 'NONE',
    symbol: string,
    tradeStyle: string
  ): ConstraintFeasibilityStatus {
    const isFeasible = minTakeProfitPips <= maxTakeProfitPips;
    const maxAchievableRR = maxTakeProfitPips / referenceSLPips;

    if (isFeasible) {
      // Normal case: constraints are consistent
      return {
        isFeasible: true,
        minTakeProfitRequired: minTakeProfitPips,
        maxTakeProfitAvailable: maxTakeProfitPips,
        minRiskRewardRequired: minRiskReward,
        maxRiskRewardAchievable: maxAchievableRR,
        conflictSource: 'NONE',
        advisoryMessage: `Constraints are feasible. Market supports R:R up to ${maxAchievableRR.toFixed(2)}:1.`,
        alphaOptions: []
      };
    }

    // INFEASIBLE CASE: minTP > maxTP (mathematically impossible constraint pair)
    // This is the critical issue - Omega-9 is describing an impossible world
    const gap = minTakeProfitPips - maxTakeProfitPips;
    const requiredRRReduction = ((minRiskReward - maxAchievableRR) / minRiskReward) * 100;

    console.warn('[CONSTRAINT_FEASIBILITY] ⚠️ INFEASIBLE CONSTRAINT PAIR DETECTED', {
      type: 'CONSTRAINT_CONFLICT',
      severity: 'WARNING',
      symbol,
      tradeStyle,
      minTPRequired: minTakeProfitPips.toFixed(1),
      maxTPAvailable: maxTakeProfitPips.toFixed(1),
      gap: gap.toFixed(1),
      minRRRequired: minRiskReward.toFixed(2),
      maxRRAchievable: maxAchievableRR.toFixed(2),
      rrReductionNeeded: requiredRRReduction.toFixed(1),
      conflictSource
    });

    const advisoryMessage = `
FEASIBILITY ADVISORY: Constraint conflict detected

Market Reality:
• Maximum achievable TP: ${maxTakeProfitPips.toFixed(1)} pips
• Maximum achievable R:R: ${maxAchievableRR.toFixed(2)}:1

Original Requirements:
• Minimum required TP: ${minTakeProfitPips.toFixed(1)} pips
• Minimum required R:R: ${minRiskReward.toFixed(2)}:1

Gap: ${gap.toFixed(1)} pips (${requiredRRReduction.toFixed(1)}% R:R reduction needed)

Source: ${this.describeConflictSource(conflictSource)}

This is NOT a trading error. This is market reality vs. style requirements.
Alpha retains full authority to decide how to proceed.
    `;

    return {
      isFeasible: false,
      minTakeProfitRequired: minTakeProfitPips,
      maxTakeProfitAvailable: maxTakeProfitPips,
      minRiskRewardRequired: minRiskReward,
      maxRiskRewardAchievable: maxAchievableRR,
      conflictSource,
      advisoryMessage,
      alphaOptions: [
        `Accept reduced R:R of ${maxAchievableRR.toFixed(2)}:1 (market reality)`,
        `Seek a different entry or structural geometry within the same style`,
        `Widen stop loss to improve R:R at current market constraints`,
        `Accept higher position risk with lower R:R (if setup quality justifies)`
      ]
    };
  }

  /**
   * Provide human-readable description of conflict source
   */
  private describeConflictSource(source: 'SESSION_TIME' | 'MARKET_ATR' | 'NONE'): string {
    switch (source) {
      case 'SESSION_TIME':
        return 'Session time constraint is limiting available TP distance within current session';
      case 'MARKET_ATR':
        return 'Market volatility (ATR) is not supporting required R:R multiple';
      case 'NONE':
        return 'Unknown - internal consistency check';
    }
  }

  /**
   * GOVERNANCE: Style is IMMUTABLE. No style promotion/downgrade is permitted.
   * If constraints are infeasible for the current style, the only option is NO_TRADE.
   * This method is retained as dead code reference but is no longer called.
   */

  /**
   * Get conflict severity level for governance tracking
   * Used to decide whether to emit alerts or just log
   */
  getConflictSeverity(
    minTP: number,
    maxTP: number,
    gap: number,
    minRR: number,
    maxRR: number
  ): 'MINOR' | 'MODERATE' | 'SEVERE' {
    const rrReductionPercent = ((minRR - maxRR) / minRR) * 100;

    // SEVERE: Need to reduce R:R by >50%
    if (rrReductionPercent > 50) {
      return 'SEVERE';
    }

    // MODERATE: Need to reduce R:R by 25-50%
    if (rrReductionPercent > 25) {
      return 'MODERATE';
    }

    // MINOR: Need to reduce R:R by <25%
    return 'MINOR';
  }
}

export const constraintFeasibilityValidator = new ConstraintFeasibilityValidator();
