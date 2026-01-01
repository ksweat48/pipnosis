/**
 * Omega-9 Constraint Provider
 *
 * Provides trading constraints UP-FRONT before Alpha makes decisions.
 *
 * Philosophy:
 * - Constraints define the BOUNDARIES of acceptable trades
 * - Alpha optimizes WITHIN those boundaries
 * - Omega-9 validates CATASTROPHIC errors only, not strategy
 *
 * This separates:
 * 1. Constraint Generation (this service) - runs BEFORE Alpha decides
 * 2. Catastrophic Validation (Omega-9) - runs AFTER Alpha decides
 */

import { calculatePipDistance } from '../utils/currencyHelpers';
import { riskAwareStopCalculator } from './risk-aware-stop-calculator';
import type {
  Omega9Constraints,
  Omega9ConstraintInput,
  ConstraintViolation
} from '../types/omega9-constraints';

class Omega9ConstraintProvider {
  /**
   * Generate comprehensive constraints for Alpha to work within
   *
   * This runs BEFORE Alpha makes a decision, providing clear boundaries
   * Accepts optional resolved plan from feasibility resolver (SSOT)
   */
  generateConstraints(input: Omega9ConstraintInput): Omega9Constraints {
    const {
      symbol,
      entry,
      direction,
      atr,
      riskMode,
      currentSession,
      sessionTimeRemainingMinutes,
      volatilityRegime,
      proposedStopLoss,
      resolvedPlan
    } = input;

    // Calculate professional stop-loss ranges
    const stopLossCalc = riskAwareStopCalculator.calculateStopLoss({
      symbol,
      entryPrice: entry,
      direction: direction === 'BUY' ? 'buy' : 'sell',
      riskMode,
      atr,
      marketVolatility: volatilityRegime
    });

    // Use resolved plan constraints if provided (from feasibility resolver)
    // Otherwise fall back to default logic
    const maxTakeProfitPips = resolvedPlan?.tpMaxAtrMultiple
      ? atr * resolvedPlan.tpMaxAtrMultiple
      : atr * 12; // 12x ATR as default

    // Determine the SL we'll use for R:R calculations
    // If Alpha already proposed an SL, use that; otherwise use recommended
    const referenceSLPips = proposedStopLoss
      ? calculatePipDistance(symbol, entry, proposedStopLoss)
      : stopLossCalc.stopLossPips;

    // Use resolved minimum R:R if provided, otherwise default to 1.0
    const minRiskReward = resolvedPlan?.minRR ?? 1.0;

    // Calculate MINIMUM TP for the resolved minimum R:R
    const idealMinTakeProfitPips = referenceSLPips * minRiskReward;
    const targetTakeProfitPips = referenceSLPips * 1.5; // Professional target
    const optimalTakeProfitPips = Math.min(referenceSLPips * 2.0, maxTakeProfitPips); // Elite target, capped by maximum

    // Calculate feasible travel distance
    const volatilityPerHour = this.estimateVolatilityPerHour(atr, volatilityRegime, currentSession);
    const feasibleTravelPips = (sessionTimeRemainingMinutes / 60) * volatilityPerHour * 0.8; // 80% safety factor

    // Build constraint violations (empty initially, used for validation later)
    const violations: ConstraintViolation[] = [];

    // Set minimum TP (no infeasibility check - that's handled by feasibility resolver)
    const minTakeProfitPips = Math.min(idealMinTakeProfitPips, maxTakeProfitPips);
    const constraintFeasibilityWarning = resolvedPlan
      ? '✅ Constraints validated by feasibility resolver'
      : '';

    const constraints: Omega9Constraints = {
      // Stop-Loss Constraints
      minStopLossPips: stopLossCalc.profileMinPips,
      maxStopLossPips: stopLossCalc.profileMaxPips,
      recommendedStopLossPips: stopLossCalc.stopLossPips,
      stopLossReasoning: stopLossCalc.reasoning,

      // Take-Profit Constraints
      minTakeProfitPips,
      maxTakeProfitPips,
      recommendedTakeProfitPips: Math.min(targetTakeProfitPips, maxTakeProfitPips),
      takeProfitReasoning: constraintFeasibilityWarning || `Minimum: ${minTakeProfitPips.toFixed(1)} pips (R:R ≥ ${minRiskReward.toFixed(1)}:1). Target: ${targetTakeProfitPips.toFixed(1)} pips (R:R ≥ 1.5:1). Maximum: ${maxTakeProfitPips.toFixed(1)} pips (12x ATR)`,

      // Risk:Reward Constraints
      minRiskReward,
      targetRiskReward: 1.5,
      optimalRiskReward: 2.0,

      // Session Constraints
      sessionTimeRemaining: sessionTimeRemainingMinutes,
      volatilityPerHour,
      feasibleTravelPips,

      violations
    };

    console.log('[Omega-9 Constraints] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[Omega-9 Constraints] Symbol: ${symbol} | Direction: ${direction} | Risk Mode: ${riskMode.toUpperCase()}`);
    console.log(`[Omega-9 Constraints] Stop-Loss Range: ${constraints.minStopLossPips.toFixed(1)} - ${constraints.maxStopLossPips.toFixed(1)} pips (recommended: ${constraints.recommendedStopLossPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] Take-Profit Range: ${constraints.minTakeProfitPips.toFixed(1)} - ${constraints.maxTakeProfitPips.toFixed(1)} pips (recommended: ${constraints.recommendedTakeProfitPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] R:R Requirements: Min ${constraints.minRiskReward}:1 | Target ${constraints.targetRiskReward}:1 | Optimal ${constraints.optimalRiskReward}:1`);
    console.log(`[Omega-9 Constraints] Session: ${currentSession} (${sessionTimeRemainingMinutes}min remaining) | Feasible travel: ${feasibleTravelPips.toFixed(1)} pips`);
    console.log('[Omega-9 Constraints] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return constraints;
  }

  /**
   * Validate Alpha's decision against constraints
   * Returns violations (but does NOT block - that's Alpha's choice)
   */
  validateAgainstConstraints(
    decision: {
      entry: number;
      stopLoss: number;
      takeProfit: number;
      direction: 'BUY' | 'SELL';
    },
    constraints: Omega9Constraints,
    symbol: string
  ): ConstraintViolation[] {
    const violations: ConstraintViolation[] = [];

    const slPips = calculatePipDistance(symbol, decision.entry, decision.stopLoss);
    const tpPips = calculatePipDistance(symbol, decision.entry, decision.takeProfit);
    const rr = slPips > 0 ? tpPips / slPips : 0;

    // Check R:R minimum (WARNING, not ERROR - Alpha can override)
    if (rr < constraints.minRiskReward) {
      violations.push({
        type: 'MIN_RR',
        severity: 'WARNING',
        message: `R:R ${rr.toFixed(2)}:1 below minimum ${constraints.minRiskReward}:1`,
        suggestedFix: `Increase TP to ${constraints.minTakeProfitPips.toFixed(1)} pips for R:R ≥ 1.0`
      });
    }

    // Check TP maximum (ERROR - sanity check constraint)
    if (tpPips > constraints.maxTakeProfitPips) {
      violations.push({
        type: 'MAX_TP',
        severity: 'ERROR',
        message: `TP ${tpPips.toFixed(1)} pips exceeds maximum ${constraints.maxTakeProfitPips.toFixed(1)} pips`,
        suggestedFix: `Reduce TP to ${constraints.maxTakeProfitPips.toFixed(1)} pips maximum`
      });
    }

    // Check SL range (WARNING - professional guidance)
    if (slPips < constraints.minStopLossPips) {
      violations.push({
        type: 'MIN_SL',
        severity: 'WARNING',
        message: `SL ${slPips.toFixed(1)} pips below recommended minimum ${constraints.minStopLossPips.toFixed(1)} pips`,
        suggestedFix: `Consider widening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`
      });
    }

    if (slPips > constraints.maxStopLossPips) {
      violations.push({
        type: 'MAX_SL',
        severity: 'WARNING',
        message: `SL ${slPips.toFixed(1)} pips above recommended maximum ${constraints.maxStopLossPips.toFixed(1)} pips`,
        suggestedFix: `Consider tightening SL to ${constraints.recommendedStopLossPips.toFixed(1)} pips`
      });
    }

    return violations;
  }

  /**
   * Auto-correct decision to meet minimum constraints
   * Used when Alpha's decision violates basic requirements
   */
  autoCorrectDecision(
    decision: {
      entry: number;
      stopLoss: number;
      takeProfit: number;
      direction: 'BUY' | 'SELL';
    },
    constraints: Omega9Constraints,
    symbol: string
  ): {
    corrected: boolean;
    newStopLoss?: number;
    newTakeProfit?: number;
    corrections: string[];
    infeasible?: boolean;
  } {
    const corrections: string[] = [];
    let newStopLoss = decision.stopLoss;
    let newTakeProfit = decision.takeProfit;
    let corrected = false;

    const slPips = calculatePipDistance(symbol, decision.entry, decision.stopLoss);
    const tpPips = calculatePipDistance(symbol, decision.entry, decision.takeProfit);
    const rr = slPips > 0 ? tpPips / slPips : 0;

    // Note: Infeasibility checks are now handled by the feasibility resolver (SSOT)
    // If we reach this point, constraints should be feasible

    // Auto-correct TP maximum violation first (sanity check constraint)
    if (tpPips > constraints.maxTakeProfitPips) {
      const isBuy = decision.direction === 'BUY';

      if (isBuy) {
        newTakeProfit = decision.entry + (constraints.maxTakeProfitPips / 10000);
      } else {
        newTakeProfit = decision.entry - (constraints.maxTakeProfitPips / 10000);
      }

      corrections.push(`Auto-corrected TP from ${tpPips.toFixed(1)} pips to ${constraints.maxTakeProfitPips.toFixed(1)} pips (maximum constraint)`);
      corrected = true;
    }

    // Now check R:R with the potentially corrected TP
    const finalTPPips = calculatePipDistance(symbol, decision.entry, newTakeProfit);
    const finalRR = slPips > 0 ? finalTPPips / slPips : 0;

    // Auto-correct R:R < minRiskReward (respects the constraint's actual minimum)
    // Only if it won't violate the maximum we just applied
    if (finalRR < constraints.minRiskReward) {
      const minTPPips = slPips * constraints.minRiskReward;

      // Double-check maximum (should not happen after previous check, but safety)
      if (minTPPips <= constraints.maxTakeProfitPips) {
        const isBuy = decision.direction === 'BUY';

        if (isBuy) {
          newTakeProfit = decision.entry + (minTPPips / 10000);
        } else {
          newTakeProfit = decision.entry - (minTPPips / 10000);
        }

        corrections.push(`Auto-corrected TP from ${finalTPPips.toFixed(1)} pips to ${minTPPips.toFixed(1)} pips (R:R ${finalRR.toFixed(2)} → ${constraints.minRiskReward.toFixed(2)})`);
        corrected = true;
      } else {
        // This should have been caught earlier but just in case
        corrections.push(`Cannot correct R:R: would violate maximum constraint`);
        return {
          corrected: false,
          infeasible: true,
          corrections
        };
      }
    }

    return {
      corrected,
      newStopLoss: corrected ? newStopLoss : undefined,
      newTakeProfit: corrected ? newTakeProfit : undefined,
      corrections,
      infeasible: false
    };
  }

  /**
   * Format constraints for inclusion in Alpha's prompt
   */
  formatConstraintsForPrompt(constraints: Omega9Constraints): string {
    const infeasibleSetup = constraints.minRiskReward < 1.0;
    const infeasibleWarning = infeasibleSetup ? `
⚠️ INFEASIBLE SETUP WARNING:
The TP ceiling (${constraints.maxTakeProfitPips.toFixed(1)} pips) prevents achieving 1:1 R:R.
Maximum achievable R:R is ${constraints.minRiskReward.toFixed(2)}:1.
STRONG RECOMMENDATION: Return NO_TRADE or tighten SL to ≤ ${constraints.maxTakeProfitPips.toFixed(1)} pips.
` : '';

    return `
🎯 OMEGA-9 TRADING CONSTRAINTS (Your Operating Boundaries)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${infeasibleWarning}
These are your DECISION BOUNDARIES, not vetoes.
You have FULL AUTHORITY to choose within these ranges.

STOP-LOSS BOUNDARIES:
• Minimum: ${constraints.minStopLossPips.toFixed(1)} pips (risk profile floor)
• Maximum: ${constraints.maxStopLossPips.toFixed(1)} pips (risk profile ceiling)
• Recommended: ${constraints.recommendedStopLossPips.toFixed(1)} pips
• Rationale: ${constraints.stopLossReasoning}

TAKE-PROFIT BOUNDARIES:
• Minimum: ${constraints.minTakeProfitPips.toFixed(1)} pips (R:R ≥ ${constraints.minRiskReward.toFixed(2)}:1)
• Recommended: ${constraints.recommendedTakeProfitPips.toFixed(1)} pips (R:R ≥ ${constraints.targetRiskReward}:1)
• Maximum: ${constraints.maxTakeProfitPips.toFixed(1)} pips (ATR-based maximum)
• Rationale: ${constraints.takeProfitReasoning}

RISK:REWARD REQUIREMENTS:
• MINIMUM: ${constraints.minRiskReward.toFixed(2)}:1 ${infeasibleSetup ? '(⚠️ BELOW PROFESSIONAL STANDARD)' : '(professional floor - auto-corrected if violated)'}
• TARGET: ${constraints.targetRiskReward}:1 (standard professional expectation)
• OPTIMAL: ${constraints.optimalRiskReward}:1 (elite trader standard)

SESSION PHYSICS:
• Time remaining: ${constraints.sessionTimeRemaining} minutes
• Expected volatility: ${constraints.volatilityPerHour.toFixed(1)} pips/hour
• Realistic travel: ${constraints.feasibleTravelPips.toFixed(1)} pips maximum

YOUR AUTHORITY:
✅ You may choose ANY SL within min-max range
✅ You may choose ANY TP within min-max range
✅ You may override recommendations with reasoning
✅ You may tighten or widen based on structure
${infeasibleSetup ? '⚠️ STRONG RECOMMENDATION: NO_TRADE due to infeasible constraints' : ''}

WHAT HAPPENS IF YOU VIOLATE:
• R:R < ${constraints.minRiskReward.toFixed(2)}:1 → Auto-corrected to minimum (confidence penalty)
• TP > maximum → Auto-corrected to maximum (moderate confidence penalty)
• SL outside range → Warning only (no correction, your choice)

This is CONSTRAINT-FIRST trading: boundaries are transparent, you optimize within them.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Estimate volatility per hour based on ATR and market conditions
   */
  private estimateVolatilityPerHour(
    atr: number,
    volatilityRegime: 'low' | 'medium' | 'high',
    currentSession: string
  ): number {
    // Base: ATR * 1.5 (assuming ATR is 24hr, we want hourly rate)
    let baseVolatility = atr * 1.5;

    // Adjust for volatility regime
    if (volatilityRegime === 'high') {
      baseVolatility *= 1.3;
    } else if (volatilityRegime === 'low') {
      baseVolatility *= 0.7;
    }

    // Adjust for session (higher during London/NY, lower during Asian)
    if (currentSession === 'london' || currentSession === 'ny' || currentSession === 'overlap') {
      baseVolatility *= 1.2;
    } else if (currentSession === 'asian' || currentSession === 'sydney') {
      baseVolatility *= 0.8;
    }

    return baseVolatility;
  }
}

export const omega9ConstraintProvider = new Omega9ConstraintProvider();
