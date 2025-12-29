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
import { tpCeilingCalculator } from './tp-ceiling-calculator';
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
      proposedStopLoss
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

    // Calculate TP ceiling (maximum feasible TP)
    const tpCeiling = tpCeilingCalculator.calculateMaximumFeasibleTP({
      symbol,
      entry,
      direction,
      atr,
      currentSession,
      sessionTimeRemainingMinutes,
      volatilityRegime
    });

    // Determine the SL we'll use for R:R calculations
    // If Alpha already proposed an SL, use that; otherwise use recommended
    const referenceSLPips = proposedStopLoss
      ? calculatePipDistance(symbol, entry, proposedStopLoss)
      : stopLossCalc.stopLossPips;

    // Calculate MINIMUM TP for R:R ≥ 1.0
    // This is the critical constraint that prevents the "0.99 R:R block" problem
    const minTakeProfitPips = referenceSLPips * 1.0; // Exactly 1:1 minimum
    const targetTakeProfitPips = referenceSLPips * 1.5; // Professional target
    const optimalTakeProfitPips = Math.min(referenceSLPips * 2.0, tpCeiling.maxDistancePips); // Elite target, capped by ceiling

    // Calculate feasible travel distance
    const volatilityPerHour = this.estimateVolatilityPerHour(atr, volatilityRegime, currentSession);
    const feasibleTravelPips = (sessionTimeRemainingMinutes / 60) * volatilityPerHour * 0.8; // 80% safety factor

    // Build constraint violations (empty initially, used for validation later)
    const violations: ConstraintViolation[] = [];

    const constraints: Omega9Constraints = {
      // Stop-Loss Constraints
      minStopLossPips: stopLossCalc.profileMinPips,
      maxStopLossPips: stopLossCalc.profileMaxPips,
      recommendedStopLossPips: stopLossCalc.stopLossPips,
      stopLossReasoning: stopLossCalc.reasoning,

      // Take-Profit Constraints
      minTakeProfitPips,
      maxTakeProfitPips: tpCeiling.maxDistancePips,
      recommendedTakeProfitPips: Math.min(targetTakeProfitPips, tpCeiling.maxDistancePips),
      takeProfitReasoning: `Minimum: ${minTakeProfitPips.toFixed(1)} pips (R:R ≥ 1.0). Target: ${targetTakeProfitPips.toFixed(1)} pips (R:R ≥ 1.5). Ceiling: ${tpCeiling.maxDistancePips.toFixed(1)} pips (${tpCeiling.limitingFactor})`,

      // Risk:Reward Constraints
      minRiskReward: 1.0,
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

    // Check TP ceiling (ERROR - physics constraint)
    if (tpPips > constraints.maxTakeProfitPips) {
      violations.push({
        type: 'MAX_TP',
        severity: 'ERROR',
        message: `TP ${tpPips.toFixed(1)} pips exceeds ceiling ${constraints.maxTakeProfitPips.toFixed(1)} pips`,
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

    // Check session time feasibility (WARNING)
    if (tpPips > constraints.feasibleTravelPips) {
      violations.push({
        type: 'SESSION_TIME',
        severity: 'WARNING',
        message: `TP ${tpPips.toFixed(1)} pips may not be reachable in ${constraints.sessionTimeRemaining}min (feasible: ${constraints.feasibleTravelPips.toFixed(1)} pips)`,
        suggestedFix: `Consider reducing TP to ${constraints.feasibleTravelPips.toFixed(1)} pips for session time`
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
  } {
    const corrections: string[] = [];
    let newStopLoss = decision.stopLoss;
    let newTakeProfit = decision.takeProfit;
    let corrected = false;

    const slPips = calculatePipDistance(symbol, decision.entry, decision.stopLoss);
    const tpPips = calculatePipDistance(symbol, decision.entry, decision.takeProfit);
    const rr = slPips > 0 ? tpPips / slPips : 0;

    // Auto-correct R:R < 1.0 (minimum professional standard)
    if (rr < 1.0) {
      const minTPPips = slPips * 1.0; // Exactly 1:1
      const isBuy = decision.direction === 'BUY';

      if (isBuy) {
        newTakeProfit = decision.entry + (minTPPips / 10000); // Convert pips to price
      } else {
        newTakeProfit = decision.entry - (minTPPips / 10000);
      }

      corrections.push(`Auto-corrected TP from ${tpPips.toFixed(1)} pips to ${minTPPips.toFixed(1)} pips (R:R ${rr.toFixed(2)} → 1.00)`);
      corrected = true;
    }

    // Auto-correct TP ceiling violation (physics constraint)
    const correctedTPPips = calculatePipDistance(symbol, decision.entry, newTakeProfit);
    if (correctedTPPips > constraints.maxTakeProfitPips) {
      const isBuy = decision.direction === 'BUY';

      if (isBuy) {
        newTakeProfit = decision.entry + (constraints.maxTakeProfitPips / 10000);
      } else {
        newTakeProfit = decision.entry - (constraints.maxTakeProfitPips / 10000);
      }

      corrections.push(`Auto-corrected TP from ${correctedTPPips.toFixed(1)} pips to ${constraints.maxTakeProfitPips.toFixed(1)} pips (ceiling constraint)`);
      corrected = true;
    }

    return {
      corrected,
      newStopLoss: corrected ? newStopLoss : undefined,
      newTakeProfit: corrected ? newTakeProfit : undefined,
      corrections
    };
  }

  /**
   * Format constraints for inclusion in Alpha's prompt
   */
  formatConstraintsForPrompt(constraints: Omega9Constraints): string {
    return `
🎯 OMEGA-9 TRADING CONSTRAINTS (Your Operating Boundaries)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

These are your DECISION BOUNDARIES, not vetoes.
You have FULL AUTHORITY to choose within these ranges.

STOP-LOSS BOUNDARIES:
• Minimum: ${constraints.minStopLossPips.toFixed(1)} pips (risk profile floor)
• Maximum: ${constraints.maxStopLossPips.toFixed(1)} pips (risk profile ceiling)
• Recommended: ${constraints.recommendedStopLossPips.toFixed(1)} pips
• Rationale: ${constraints.stopLossReasoning}

TAKE-PROFIT BOUNDARIES:
• Minimum: ${constraints.minTakeProfitPips.toFixed(1)} pips (R:R ≥ ${constraints.minRiskReward}:1)
• Recommended: ${constraints.recommendedTakeProfitPips.toFixed(1)} pips (R:R ≥ ${constraints.targetRiskReward}:1)
• Maximum: ${constraints.maxTakeProfitPips.toFixed(1)} pips (session ceiling)
• Rationale: ${constraints.takeProfitReasoning}

RISK:REWARD REQUIREMENTS:
• MINIMUM: ${constraints.minRiskReward}:1 (professional floor - auto-corrected if violated)
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

WHAT HAPPENS IF YOU VIOLATE:
• R:R < ${constraints.minRiskReward}:1 → Auto-corrected to minimum (small confidence penalty)
• TP > ceiling → Auto-corrected to ceiling (moderate confidence penalty)
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
