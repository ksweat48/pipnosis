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
 *
 * SSOT COMPLIANCE:
 * - Session constraints delegated to sessionConstraintCoordinator
 * - Asset classification delegated to assetClassifier
 * - NO hardcoded symbol checks - all queries go through coordinators
 */

import { calculatePipDistance, getCurrencyPipInfo } from '../utils/currencyHelpers';
import { riskAwareStopCalculator } from './risk-aware-stop-calculator';
import { sessionConstraintCoordinator } from './session-constraint-coordinator';
import { assetClassifier } from './asset-classifier';
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
   *
   * CRITICAL: Session-time constraints apply differently based on trade style:
   * - SCALP: Session-time caps TP (trades must complete within current session)
   * - INTRADAY: Session-time is advisory only (trades may extend beyond session)
   * - SWING: Session-time ignored (multi-session trades)
   *
   * CRITICAL FIX: Now includes pre-flight feasibility checks to detect impossible constraints
   */
  generateConstraints(input: Omega9ConstraintInput): Omega9Constraints {
    const {
      symbol,
      entry,
      direction,
      atr,
      riskMode,
      tradeStyle,
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

    // Calculate noise floor - the statistical minimum to survive spread + volatility
    const noiseFloor = riskAwareStopCalculator.calculateNoiseFloor(symbol, entry, atr);

    // Calculate feasible travel distance (used for all styles, applied differently)
    // SSOT: volatility calculation delegates to session constraint coordinator
    const volatilityPerHour = this.estimateVolatilityPerHour(symbol, atr, volatilityRegime, currentSession);
    const feasibleTravelPips = (sessionTimeRemainingMinutes / 60) * volatilityPerHour * 0.8; // 80% safety factor

    // Base TP maximum from ATR
    const atrBasedMaxTP = resolvedPlan?.tpMaxAtrMultiple
      ? atr * resolvedPlan.tpMaxAtrMultiple
      : atr * 12; // 12x ATR as default

    // SSOT: Get session constraint policy from coordinator
    const sessionConstraintPolicy = sessionConstraintCoordinator.getSessionConstraintPolicy(symbol, tradeStyle);

    // Apply session-time constraints based on policy
    let maxTakeProfitPips: number;
    let sessionConstraintMode: 'BLOCKING' | 'ADVISORY' | 'NONE';
    let tpReasoningSuffix = '';

    switch (sessionConstraintPolicy) {
      case 'ENFORCED':
        // SCALP or forex-hours: Session-time BLOCKS - trade must complete within current session
        maxTakeProfitPips = Math.min(atrBasedMaxTP, feasibleTravelPips);
        sessionConstraintMode = 'BLOCKING';

        if (feasibleTravelPips < atrBasedMaxTP) {
          tpReasoningSuffix = ` | ⚠️ ${tradeStyle} trades limited by session time: ${feasibleTravelPips.toFixed(1)} pips feasible in ${sessionTimeRemainingMinutes}min remaining`;
        }
        break;

      case 'ADVISORY':
        // INTRADAY: Session-time ADVISORY - trade may extend beyond current session
        maxTakeProfitPips = atrBasedMaxTP; // No session cap
        sessionConstraintMode = 'ADVISORY';

        if (atrBasedMaxTP > feasibleTravelPips) {
          tpReasoningSuffix = ` | ℹ️ ${tradeStyle} trade may extend beyond current session (${feasibleTravelPips.toFixed(1)} pips feasible in ${sessionTimeRemainingMinutes}min, target ${atrBasedMaxTP.toFixed(1)} pips)`;
        }
        break;

      case 'NONE':
        // SWING or 24/7 market: Session-time NONE - no session constraints
        maxTakeProfitPips = atrBasedMaxTP; // No session cap
        sessionConstraintMode = 'NONE';

        if (assetClassifier.is24HourMarket(symbol)) {
          tpReasoningSuffix = ` | 24/7 market - no session constraints`;
        } else {
          tpReasoningSuffix = ` | ${tradeStyle} trade - session timing not applicable`;
        }
        break;
    }

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

    // Build constraint violations (empty initially, used for validation later)
    const violations: ConstraintViolation[] = [];

    // Set minimum TP (no infeasibility check - that's handled by feasibility resolver)
    const minTakeProfitPips = Math.min(idealMinTakeProfitPips, maxTakeProfitPips);
    const constraintFeasibilityWarning = resolvedPlan
      ? '✅ Constraints validated by feasibility resolver'
      : '';

    // Build take-profit reasoning with style-aware session context
    const baseTpReasoning = `Minimum: ${minTakeProfitPips.toFixed(1)} pips (R:R ≥ ${minRiskReward.toFixed(1)}:1). Target: ${targetTakeProfitPips.toFixed(1)} pips (R:R ≥ 1.5:1). Maximum: ${maxTakeProfitPips.toFixed(1)} pips (12x ATR)`;
    const fullTpReasoning = constraintFeasibilityWarning || (baseTpReasoning + tpReasoningSuffix);

    const constraints: Omega9Constraints = {
      // Stop-Loss Constraints
      minStopLossPips: Math.max(stopLossCalc.profileMinPips, noiseFloor.noiseFloorPips), // Enforce noise floor
      maxStopLossPips: stopLossCalc.profileMaxPips,
      recommendedStopLossPips: stopLossCalc.stopLossPips,
      stopLossReasoning: stopLossCalc.reasoning,

      // Noise Floor (statistical minimum for survival)
      noiseFloorPips: noiseFloor.noiseFloorPips,
      noiseFloorReasoning: noiseFloor.reasoning,

      // Take-Profit Constraints
      minTakeProfitPips,
      maxTakeProfitPips,
      recommendedTakeProfitPips: Math.min(targetTakeProfitPips, maxTakeProfitPips),
      takeProfitReasoning: fullTpReasoning,

      // Risk:Reward Constraints
      minRiskReward,
      targetRiskReward: 1.5,
      optimalRiskReward: 2.0,

      // Session Constraints
      sessionTimeRemaining: sessionTimeRemainingMinutes,
      volatilityPerHour,
      feasibleTravelPips,
      sessionConstraintMode,

      violations
    };

    // CRITICAL PRE-FLIGHT FEASIBILITY CHECK
    // Detect mathematically impossible constraint scenarios
    const isInfeasible = constraints.minTakeProfitPips > constraints.maxTakeProfitPips;
    const maxAchievableRR = constraints.maxTakeProfitPips / referenceSLPips;

    if (isInfeasible) {
      console.error('[Omega-9 Constraints] ❌ INFEASIBLE CONSTRAINTS DETECTED');
      console.error(`[Omega-9 Constraints] Min TP: ${constraints.minTakeProfitPips.toFixed(1)} pips > Max TP: ${constraints.maxTakeProfitPips.toFixed(1)} pips`);
      console.error(`[Omega-9 Constraints] Required R:R: ${minRiskReward.toFixed(2)}:1 | Max Achievable: ${maxAchievableRR.toFixed(2)}:1`);
      console.error(`[Omega-9 Constraints] Root cause: Session constraint (${feasibleTravelPips.toFixed(1)} pips) too restrictive for ${tradeStyle} style`);

      // Add infeasibility violation
      constraints.violations.push({
        type: 'INFEASIBLE_SETUP',
        severity: 'ERROR',
        message: `Constraints impossible: Min TP ${constraints.minTakeProfitPips.toFixed(1)} > Max TP ${constraints.maxTakeProfitPips.toFixed(1)} pips`,
        suggestedFix: `STRONG RECOMMENDATION: NO_TRADE. Alternatively: 1) Tighten SL to ${constraints.maxTakeProfitPips.toFixed(1)} pips, or 2) Accept reduced R:R ${maxAchievableRR.toFixed(2)}:1`
      });
    }

    console.log('[Omega-9 Constraints] ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[Omega-9 Constraints] Symbol: ${symbol} | Direction: ${direction} | Style: ${tradeStyle} | Risk: ${riskMode.toUpperCase()}`);
    console.log(`[Omega-9 Constraints] Noise Floor: ${constraints.noiseFloorPips.toFixed(1)} pips (${constraints.noiseFloorReasoning})`);
    console.log(`[Omega-9 Constraints] Stop-Loss Range: ${constraints.minStopLossPips.toFixed(1)} - ${constraints.maxStopLossPips.toFixed(1)} pips (recommended: ${constraints.recommendedStopLossPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] Take-Profit Range: ${constraints.minTakeProfitPips.toFixed(1)} - ${constraints.maxTakeProfitPips.toFixed(1)} pips (recommended: ${constraints.recommendedTakeProfitPips.toFixed(1)})`);
    console.log(`[Omega-9 Constraints] R:R Requirements: Min ${constraints.minRiskReward}:1 | Target ${constraints.targetRiskReward}:1 | Optimal ${constraints.optimalRiskReward}:1`);
    console.log(`[Omega-9 Constraints] Session: ${currentSession} (${sessionTimeRemainingMinutes}min remaining) | Feasible travel: ${feasibleTravelPips.toFixed(1)} pips | Mode: ${sessionConstraintMode}`);

    if (isInfeasible) {
      console.error(`[Omega-9 Constraints] ⚠️ INFEASIBLE: Constraints conflict - Max achievable R:R is ${maxAchievableRR.toFixed(2)}:1 (need ${minRiskReward.toFixed(2)}:1)`);
    }

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
• Noise Floor: ${constraints.noiseFloorPips.toFixed(1)} pips (${constraints.noiseFloorReasoning})
• Minimum: ${constraints.minStopLossPips.toFixed(1)} pips (max of profile floor and noise floor)
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
   *
   * CRITICAL FIX: ATR is in PRICE UNITS, need to convert to PIPS for calculations
   *
   * SSOT COMPLIANCE:
   * - Session volatility multipliers delegated to sessionConstraintCoordinator
   * - 24/7 markets automatically get constant volatility profile
   */
  private estimateVolatilityPerHour(
    symbol: string,
    atr: number,
    volatilityRegime: 'low' | 'medium' | 'high',
    currentSession: string
  ): number {
    // Convert ATR from price units to pips first
    const pipInfo = getCurrencyPipInfo(symbol);
    const atrInPips = atr / pipInfo.pipValue;

    console.log(`[Omega-9 Volatility] ${symbol}: ATR ${atr.toFixed(6)} (${atrInPips.toFixed(2)} pips)`);

    // Base: ATR * 1.5 (assuming ATR is 24hr, we want hourly rate)
    let baseVolatility = atrInPips * 1.5;

    // Adjust for volatility regime
    let regimeMultiplier = 1.0;
    if (volatilityRegime === 'high') {
      regimeMultiplier = 1.3;
      baseVolatility *= 1.3;
    } else if (volatilityRegime === 'low') {
      regimeMultiplier = 0.7;
      baseVolatility *= 0.7;
    }

    // SSOT: Get session volatility multiplier from coordinator
    // This automatically handles 24/7 markets vs forex-hours markets
    const sessionMultiplier = sessionConstraintCoordinator.getSessionVolatilityMultiplier(
      symbol,
      currentSession as 'asian' | 'london' | 'ny' | 'overlap' | 'sydney' | 'dead'
    );

    baseVolatility *= sessionMultiplier;

    // Apply minimum floor of 5 pips/hour to prevent zero feasible travel
    const minimumVolatility = 5.0;
    if (baseVolatility < minimumVolatility) {
      console.warn(`[Omega-9 Volatility] ${symbol}: Calculated volatility ${baseVolatility.toFixed(2)} pips/hour below minimum ${minimumVolatility} - using floor`);
      baseVolatility = minimumVolatility;
    }

    console.log(`[Omega-9 Volatility] ${symbol}: Base ${(atrInPips * 1.5).toFixed(1)} → Regime ${regimeMultiplier}x → Session ${sessionMultiplier}x → Final ${baseVolatility.toFixed(1)} pips/hour`);

    return baseVolatility;
  }
}

export const omega9ConstraintProvider = new Omega9ConstraintProvider();
