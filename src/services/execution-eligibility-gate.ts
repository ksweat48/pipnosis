/**
 * Execution Eligibility Gate
 *
 * SINGLE SOURCE OF TRUTH for trade execution blocking decisions.
 *
 * This service owns WHETHER a trade executes. It enforces TRUE economics,
 * NOT volatility/duration heuristics.
 *
 * RESPONSIBILITY SEPARATION:
 * - Alpha: Owns WHAT to trade (symbol, direction, levels, reasoning)
 * - Position Sizing: Owns HOW MUCH to risk (lot size, dollar risk)
 * - Execution Eligibility Gate: Owns WHETHER to execute (economics only)
 *
 * ARCHITECTURAL PRINCIPLE (v2.0):
 * - TIME & VOLATILITY ARE SCORING SIGNALS, NOT REJECTION CONSTRAINTS
 * - NEVER hard-block trades due to time-to-fill or SL width
 * - These factors affect confidence scoring and style upgrades only
 * - Philosophy: Reduced profit > NO_TRADE
 *
 * LEGITIMATE BLOCKS (Economics):
 * - Profit below minimum (spread would consume profit)
 * - Trade count absurd (goal mathematically impossible)
 *
 * ADVISORY ONLY (NOT BLOCKING):
 * - Time-to-fill expectations
 * - SL width (volatility warnings)
 * - Duration warnings
 * - Session transitions
 */

import {
  type TradingMode,
  getModeLimits,
  getMinExpectedProfit,
  getSlAtrCap,
  getSpreadSafetyMultiplier,
  getEntryQualityThreshold,
  EXECUTION_ELIGIBILITY_CONFIG
} from '../config/execution-eligibility';
import type { TimeToFillResult } from './time-to-fill-calculator';
import { getSymbolConfig } from '../config/symbol-registry';
import { getAssetClass } from '../config/asset-class-risk-profiles';

export type EligibilityStatus =
  | 'ALLOW_EXECUTION'
  | 'BLOCK_EXECUTION'
  | 'CONVERT_TO_ENTRY_INTENT';

export interface EligibilityBlockReason {
  code: string;
  message: string;
  metric: string;
  threshold: string;
  suggestion: string;
}

export interface EligibilityAdvisory {
  type: string;
  message: string;
  severity: 'low' | 'medium' | 'high';
}

export interface ExecutionEligibilityResult {
  status: EligibilityStatus;
  reasons: EligibilityBlockReason[];
  advisories: EligibilityAdvisory[];
  metrics: {
    expectedFillMinutes: number;
    expectedProfitUSD: number;
    minRequiredProfitUSD: number;
    estimatedTradesRequired: number;
    slAtrMultiple: number;
    spreadCostUSD: number;
    goalContributionPercent: number;
  };
  entryIntentSuggestion?: {
    reason: string;
    suggestedWaitMinutes: number;
    expectedRRImprovement: number;
  };
  styleTracking?: {
    alphaStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'; // ✅ IMMUTABLE: Alpha's chosen style
    durationBand: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'EXTENDED'; // ✅ Expected duration (advisory only)
    durationDeviation: 'WITHIN_BAND' | 'SLIGHTLY_OVER' | 'SIGNIFICANTLY_OVER' | 'VERY_EXTENDED'; // ✅ How far over expected
    expectedDurationHours: number;
    confidencePenalty: number; // ✅ NEW: Explicit penalty amount
    durationPenaltyApplied: boolean;
    durationRewardApplied: boolean;
  };
}

export interface ExecutionEligibilityInput {
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  lotSize: number;
  expectedProfitUSD: number;
  estimatedTradesRequired: number;
  remainingGoal: number;
  accountBalance: number;
  currentATR: number;
  spreadPips: number;
  timeToFillResult: TimeToFillResult;
  tradingMode: TradingMode;
  entryQualityScore?: number;
  potentialRRImprovement?: number;
  tradeConfidence?: number; // ✅ NEW: For MICRO >=85% confidence override
  style?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY'; // ✅ NEW: For style-specific overrides
}

function getAssetClass(symbol: string): 'forex' | 'crypto' | 'index' | 'metal' | 'energy' {
  const config = getSymbolConfig(symbol);
  if (!config) return 'forex';
  return config.category as 'forex' | 'crypto' | 'index' | 'metal' | 'energy';
}

function calculateSlAtrMultiple(
  symbol: string,
  entryPrice: number,
  stopLoss: number,
  currentATR: number
): number {
  if (currentATR <= 0) return 0;
  const slDistance = Math.abs(entryPrice - stopLoss);
  return slDistance / currentATR;
}

function calculateSpreadCostUSD(
  symbol: string,
  spreadPips: number,
  lotSize: number
): number {
  const config = getSymbolConfig(symbol);
  const dollarPerPipPerLot = config?.dollarPerPipPerLot || 10;
  return spreadPips * lotSize * dollarPerPipPerLot;
}

class ExecutionEligibilityGate {
  evaluate(input: ExecutionEligibilityInput): ExecutionEligibilityResult {
    const reasons: EligibilityBlockReason[] = [];
    const advisories: EligibilityAdvisory[] = [];
    const modeLimits = getModeLimits(input.tradingMode);

    // ═══════════════════════════════════════════════════════════════════
    // MICRO >=85% CONFIDENCE OVERRIDE (CONFIDENCE-DOMINANT ARCHITECTURE)
    // ═══════════════════════════════════════════════════════════════════
    // When Alpha has >=85% confidence on MICRO_INTRADAY style, bypass
    // non-economic filters to respect confidence-first selection
    const isMicroHighConfidence =
      input.style === 'MICRO_INTRADAY' &&
      (input.tradeConfidence || 0) >= 85;

    if (isMicroHighConfidence) {
      console.log('%c[EXECUTION GATE] 🎯 MICRO >=85% CONFIDENCE OVERRIDE ACTIVE', 'color: #2196f3; font-weight: bold; font-size: 14px');
      console.log(`  Confidence: ${input.tradeConfidence}% | Style: ${input.style}`);
      console.log(`  Bypassing non-economic filters to respect Alpha's high-confidence decision`);

      advisories.push({
        type: 'HIGH_CONFIDENCE_OVERRIDE',
        message: `MICRO style with ${input.tradeConfidence}% confidence - relaxed filtering applied`,
        severity: 'low'
      });
    }

    const slAtrMultiple = calculateSlAtrMultiple(
      input.symbol,
      input.entryPrice,
      input.stopLoss,
      input.currentATR
    );

    // DEBUG: Log ATR calculations
    console.log(`[ELIGIBILITY GATE ATR DEBUG] ${input.symbol}:`, {
      currentATR: input.currentATR,
      entryPrice: input.entryPrice,
      stopLoss: input.stopLoss,
      slDistance: Math.abs(input.entryPrice - input.stopLoss),
      slAtrMultiple
    });

    const spreadCostUSD = calculateSpreadCostUSD(
      input.symbol,
      input.spreadPips,
      input.lotSize
    );

    const minRequiredProfitUSD = getMinExpectedProfit(input.accountBalance);
    const goalContributionPercent = input.remainingGoal > 0
      ? (input.expectedProfitUSD / input.remainingGoal) * 100
      : 100;

    const metrics = {
      expectedFillMinutes: input.timeToFillResult.expectedMinutes,
      expectedProfitUSD: input.expectedProfitUSD,
      minRequiredProfitUSD,
      estimatedTradesRequired: input.estimatedTradesRequired,
      slAtrMultiple,
      spreadCostUSD,
      goalContributionPercent
    };

    this.checkTimeToFill(input, modeLimits, reasons, isMicroHighConfidence);
    this.checkMinimumProfit(input, minRequiredProfitUSD, spreadCostUSD, reasons, isMicroHighConfidence);
    this.checkAbsurdTradeCount(input, modeLimits, reasons, isMicroHighConfidence);
    this.checkSlAtrWidth(input, slAtrMultiple, reasons, isMicroHighConfidence);

    if (reasons.length > 0) {
      console.error('%c[EXECUTION GATE] BLOCKED', 'color: #f44336; font-weight: bold; font-size: 14px');
      reasons.forEach(r => {
        console.error(`  ${r.code}: ${r.message}`);
        console.error(`    Metric: ${r.metric} | Threshold: ${r.threshold}`);
        console.error(`    Suggestion: ${r.suggestion}`);
      });

      // Build style tracking even for blocked trades (for diagnostics)
      const styleTracking = this.buildStyleTracking(input);

      return {
        status: 'BLOCK_EXECUTION',
        reasons,
        advisories,
        metrics,
        styleTracking
      };
    }

    this.collectAdvisories(input, metrics, advisories);

    // Build style tracking data for all execution results
    const styleTracking = this.buildStyleTracking(input);

    const entryIntentSuggestion = this.checkEntryQuality(input);
    if (entryIntentSuggestion) {
      console.log('%c[EXECUTION GATE] CONVERT_TO_ENTRY_INTENT', 'color: #ff9800; font-weight: bold; font-size: 14px');
      console.log(`  Reason: ${entryIntentSuggestion.reason}`);
      console.log(`  Expected R:R improvement: ${entryIntentSuggestion.expectedRRImprovement}%`);

      return {
        status: 'CONVERT_TO_ENTRY_INTENT',
        reasons: [],
        advisories,
        metrics,
        entryIntentSuggestion,
        styleTracking
      };
    }

    console.log('%c[EXECUTION GATE] ALLOW_EXECUTION', 'color: #4caf50; font-weight: bold');
    console.log(`  Fill: ${metrics.expectedFillMinutes}min | Profit: $${metrics.expectedProfitUSD.toFixed(2)} | Trades: ${metrics.estimatedTradesRequired}`);

    return {
      status: 'ALLOW_EXECUTION',
      reasons: [],
      advisories,
      metrics,
      styleTracking
    };
  }

  private checkTimeToFill(
    input: ExecutionEligibilityInput,
    modeLimits: ReturnType<typeof getModeLimits>,
    reasons: EligibilityBlockReason[],
    isMicroHighConfidence: boolean
  ): void {
    // ARCHITECTURAL CHANGE (v2.0):
    // Time-to-fill NEVER blocks execution
    // It only provides advisory information for:
    // - Style upgrade recommendations
    // - Confidence scoring adjustments
    // - Learning/tracking purposes
    //
    // The time-to-fill calculator now returns:
    // - recommendedAction: 'EXECUTE' | 'EXECUTE_WITH_UPGRADE' | 'EXECUTE_WITH_PENALTY'
    // - styleUpgrade: recommendation for style change
    // - shouldApplyReward/shouldApplyPenalty: for learning system
    //
    // NO BLOCKING based on time - this is intentionally empty for blocking logic
    // MICRO >=85% override is not needed here as there's no blocking
  }

  private checkMinimumProfit(
    input: ExecutionEligibilityInput,
    minRequiredProfitUSD: number,
    spreadCostUSD: number,
    reasons: EligibilityBlockReason[],
    isMicroHighConfidence: boolean
  ): void {
    const { expectedProfitUSD, accountBalance } = input;
    const spreadSafetyMultiplier = getSpreadSafetyMultiplier();
    const minProfitVsSpread = spreadCostUSD * spreadSafetyMultiplier;

    // ✅ ECONOMIC CHECK: Always enforce (not overridable)
    // These checks protect against unprofitable trades regardless of confidence
    if (expectedProfitUSD < minRequiredProfitUSD) {
      reasons.push({
        code: 'PROFIT_BELOW_MINIMUM',
        message: `Expected profit $${expectedProfitUSD.toFixed(2)} below minimum $${minRequiredProfitUSD.toFixed(2)}`,
        metric: `$${expectedProfitUSD.toFixed(2)}`,
        threshold: `$${minRequiredProfitUSD.toFixed(2)} (max of $${EXECUTION_ELIGIBILITY_CONFIG.minProfit.absoluteMinUSD} or ${(EXECUTION_ELIGIBILITY_CONFIG.minProfit.balancePercentMin * 100).toFixed(2)}% of $${accountBalance.toFixed(0)})`,
        suggestion: 'Increase position size within risk limits, choose closer TP, or select more volatile instrument'
      });
    }

    if (expectedProfitUSD < minProfitVsSpread) {
      reasons.push({
        code: 'PROFIT_DOMINATED_BY_SPREAD',
        message: `Expected profit $${expectedProfitUSD.toFixed(2)} is less than ${spreadSafetyMultiplier}x spread cost $${spreadCostUSD.toFixed(2)}`,
        metric: `$${expectedProfitUSD.toFixed(2)} profit vs $${spreadCostUSD.toFixed(2)} spread`,
        threshold: `Profit must exceed ${spreadSafetyMultiplier}x spread ($${minProfitVsSpread.toFixed(2)})`,
        suggestion: 'Trade is spread-dominated - wait for lower spread conditions or choose different instrument'
      });
    }
    // Note: MICRO >=85% override does NOT bypass economic checks
  }

  private checkAbsurdTradeCount(
    input: ExecutionEligibilityInput,
    modeLimits: ReturnType<typeof getModeLimits>,
    reasons: EligibilityBlockReason[],
    isMicroHighConfidence: boolean
  ): void {
    const { estimatedTradesRequired, tradingMode } = input;
    const maxTrades = modeLimits.maxTradesRequired;

    // ✅ ECONOMIC CHECK: Always enforce (not overridable)
    // This prevents mathematically impossible goals regardless of confidence
    if (estimatedTradesRequired > maxTrades) {
      reasons.push({
        code: 'ABSURD_TRADE_COUNT',
        message: `Goal requires ${estimatedTradesRequired} trades, exceeding ${tradingMode} limit of ${maxTrades}`,
        metric: `${estimatedTradesRequired} trades estimated`,
        threshold: `${maxTrades} trades maximum (${tradingMode})`,
        suggestion: 'Reduce goal amount, increase position size within risk limits, or extend goal timeline'
      });
    }
    // Note: MICRO >=85% override does NOT bypass economic checks
  }

  private checkSlAtrWidth(
    input: ExecutionEligibilityInput,
    slAtrMultiple: number,
    reasons: EligibilityBlockReason[],
    isMicroHighConfidence: boolean
  ): void {
    // ARCHITECTURAL CHANGE (v2.0):
    // SL width NEVER blocks execution
    // It only provides advisory information for:
    // - Style upgrade recommendations
    // - Confidence scoring adjustments
    // - Learning/tracking purposes
    //
    // NO BLOCKING based on SL width - this is intentionally empty for blocking logic
    // SL width advisories are now handled in collectAdvisories()
    // MICRO >=85% override is not needed here as there's no blocking
  }

  private collectAdvisories(
    input: ExecutionEligibilityInput,
    metrics: ExecutionEligibilityResult['metrics'],
    advisories: EligibilityAdvisory[]
  ): void {
    const { goalContributionWarningPercent, smallProfitWarningUSD } =
      EXECUTION_ELIGIBILITY_CONFIG.advisoryThresholds;

    if (metrics.goalContributionPercent < goalContributionWarningPercent) {
      advisories.push({
        type: 'LOW_GOAL_CONTRIBUTION',
        message: `Trade contributes only ${metrics.goalContributionPercent.toFixed(1)}% toward goal`,
        severity: 'medium'
      });
    }

    if (metrics.expectedProfitUSD < smallProfitWarningUSD) {
      advisories.push({
        type: 'SMALL_PROFIT',
        message: `Expected profit $${metrics.expectedProfitUSD.toFixed(2)} is relatively small`,
        severity: 'low'
      });
    }

    // Time-to-fill is now ADVISORY ONLY, never blocking
    const ttf = input.timeToFillResult;
    if (ttf.viability === 'WARNING' || ttf.viability === 'EXTENDED' || ttf.viability === 'VERY_EXTENDED') {
      advisories.push({
        type: 'TIME_TO_FILL_ADVISORY',
        message: ttf.reasoning,
        severity: ttf.viability === 'VERY_EXTENDED' ? 'high' : 'medium'
      });
    }

    // ❌ REMOVED: Style upgrade advisory - style is IMMUTABLE after Alpha decides
    // Duration deviation is tracked but never changes the style

    // Add penalty advisory if applicable
    if ('shouldApplyPenalty' in ttf && ttf.shouldApplyPenalty) {
      advisories.push({
        type: 'DURATION_PENALTY_APPLIED',
        message: `Extended duration penalty applied. Trade still executing with reduced confidence.`,
        severity: 'medium'
      });
    }

    // SL width is now ADVISORY ONLY, never blocking
    if (metrics.slAtrMultiple > 0) {
      const assetClass = getAssetClass(input.symbol);
      const slAtrCap = getSlAtrCap(assetClass, input.tradingMode);

      if (metrics.slAtrMultiple > slAtrCap) {
        advisories.push({
          type: 'SL_WIDTH_ADVISORY',
          message: `Stop loss at ${metrics.slAtrMultiple.toFixed(1)}x ATR exceeds typical ${assetClass} intraday cap of ${slAtrCap.toFixed(1)}x. Trade executing with wider stop loss.`,
          severity: metrics.slAtrMultiple > slAtrCap * 1.5 ? 'high' : 'medium'
        });
      }
    }
  }

  private checkEntryQuality(
    input: ExecutionEligibilityInput
  ): ExecutionEligibilityResult['entryIntentSuggestion'] | undefined {
    const { potentialRRImprovement, entryQualityScore } = input;
    const threshold = getEntryQualityThreshold();

    if (potentialRRImprovement !== undefined &&
        potentialRRImprovement >= threshold &&
        entryQualityScore !== undefined &&
        entryQualityScore < 70) {
      return {
        reason: `Waiting for pullback could improve R:R by ${potentialRRImprovement.toFixed(0)}%`,
        suggestedWaitMinutes: 15,
        expectedRRImprovement: potentialRRImprovement
      };
    }

    return undefined;
  }

  private buildStyleTracking(
    input: ExecutionEligibilityInput
  ): ExecutionEligibilityResult['styleTracking'] | undefined {
    const ttf = input.timeToFillResult;

    // ✅ ALPHA AUTHORITY MODEL: Alpha's style is IMMUTABLE
    // We track the style Alpha chose (based on execution mechanics)
    // Duration band is advisory only - it does NOT change the style
    let alphaStyle: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' = 'INTRADAY';

    // Infer Alpha's intended style from the duration band
    // (This is what Alpha chose based on M5 execution logic, pip targets, etc.)
    if (ttf.durationBand === 'SCALP') {
      alphaStyle = 'SCALP';
    } else if (ttf.durationBand === 'MICRO_INTRADAY') {
      alphaStyle = 'MICRO_INTRADAY';
    }

    // ❌ REMOVED: Style mutation logic - resolvedStyle/styleUpgradeApplied
    // Style remains UNCHANGED regardless of expected duration
    // Duration deviations only affect confidence scoring

    return {
      alphaStyle, // ✅ IMMUTABLE: What Alpha chose
      durationBand: ttf.durationBand, // ✅ Expected duration (advisory only)
      durationDeviation: ttf.durationDeviation, // ✅ How far over expected
      expectedDurationHours: ttf.expectedHours,
      confidencePenalty: ttf.confidencePenalty, // ✅ Explicit penalty amount
      durationPenaltyApplied: ttf.shouldApplyPenalty,
      durationRewardApplied: ttf.shouldApplyReward
    };
  }

  private formatMinutes(minutes: number): string {
    if (minutes < 60) {
      return `${minutes.toFixed(0)}min`;
    }
    const hours = minutes / 60;
    if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    }
    const days = hours / 24;
    return `${days.toFixed(1)} days`;
  }

  formatBlockMessageForUser(result: ExecutionEligibilityResult): string {
    if (result.status !== 'BLOCK_EXECUTION' || result.reasons.length === 0) {
      return '';
    }

    const primaryReason = result.reasons[0];
    const suggestions = result.reasons.map(r => r.suggestion).join('\n- ');

    return `Trade blocked: ${primaryReason.message}\n\n` +
      `Computed values:\n` +
      `- Expected fill: ${this.formatMinutes(result.metrics.expectedFillMinutes)}\n` +
      `- Expected profit: $${result.metrics.expectedProfitUSD.toFixed(2)}\n` +
      `- Trades needed: ${result.metrics.estimatedTradesRequired}\n\n` +
      `Suggestions:\n- ${suggestions}`;
  }
}

export const executionEligibilityGate = new ExecutionEligibilityGate();
