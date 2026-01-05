/**
 * Execution Eligibility Gate
 *
 * SINGLE SOURCE OF TRUTH for trade execution blocking decisions.
 *
 * This service owns WHETHER a trade executes. It enforces physics and economics,
 * NOT heuristics or quality preferences.
 *
 * RESPONSIBILITY SEPARATION:
 * - Alpha: Owns WHAT to trade (symbol, direction, levels, reasoning)
 * - Position Sizing: Owns HOW MUCH to risk (lot size, dollar risk)
 * - Execution Eligibility Gate: Owns WHETHER to execute (physics and economics)
 *
 * GUIDING PRINCIPLE:
 * If the trade is bad → BLOCK
 * If the trade is good but entry is bad → WAIT (CONVERT_TO_ENTRY_INTENT)
 * If the trade is good and entry is good → EXECUTE
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

    const slAtrMultiple = calculateSlAtrMultiple(
      input.symbol,
      input.entryPrice,
      input.stopLoss,
      input.currentATR
    );

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

    this.checkTimeToFill(input, modeLimits, reasons);
    this.checkMinimumProfit(input, minRequiredProfitUSD, spreadCostUSD, reasons);
    this.checkAbsurdTradeCount(input, modeLimits, reasons);
    this.checkSlAtrWidth(input, slAtrMultiple, reasons);

    if (reasons.length > 0) {
      console.error('%c[EXECUTION GATE] BLOCKED', 'color: #f44336; font-weight: bold; font-size: 14px');
      reasons.forEach(r => {
        console.error(`  ${r.code}: ${r.message}`);
        console.error(`    Metric: ${r.metric} | Threshold: ${r.threshold}`);
        console.error(`    Suggestion: ${r.suggestion}`);
      });

      return {
        status: 'BLOCK_EXECUTION',
        reasons,
        advisories,
        metrics
      };
    }

    this.collectAdvisories(input, metrics, advisories);

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
        entryIntentSuggestion
      };
    }

    console.log('%c[EXECUTION GATE] ALLOW_EXECUTION', 'color: #4caf50; font-weight: bold');
    console.log(`  Fill: ${metrics.expectedFillMinutes}min | Profit: $${metrics.expectedProfitUSD.toFixed(2)} | Trades: ${metrics.estimatedTradesRequired}`);

    return {
      status: 'ALLOW_EXECUTION',
      reasons: [],
      advisories,
      metrics
    };
  }

  private checkTimeToFill(
    input: ExecutionEligibilityInput,
    modeLimits: ReturnType<typeof getModeLimits>,
    reasons: EligibilityBlockReason[]
  ): void {
    const { timeToFillResult, tradingMode } = input;
    const hardBlockMinutes = modeLimits.timeToFill.hardBlockMinutes;

    if (timeToFillResult.recommendedAction === 'REJECT' ||
        timeToFillResult.expectedMinutes > hardBlockMinutes) {
      reasons.push({
        code: 'TIME_TO_FILL_EXCEEDED',
        message: `Expected fill time ${this.formatMinutes(timeToFillResult.expectedMinutes)} exceeds ${tradingMode} limit of ${this.formatMinutes(hardBlockMinutes)}`,
        metric: `${timeToFillResult.expectedMinutes.toFixed(0)} minutes`,
        threshold: `${hardBlockMinutes} minutes (${tradingMode})`,
        suggestion: tradingMode === 'INTRADAY'
          ? 'Consider tighter TP, wait for higher volatility session, or switch to SWING mode'
          : 'TP is unrealistic even for swing trading - reduce target distance'
      });
    }
  }

  private checkMinimumProfit(
    input: ExecutionEligibilityInput,
    minRequiredProfitUSD: number,
    spreadCostUSD: number,
    reasons: EligibilityBlockReason[]
  ): void {
    const { expectedProfitUSD, accountBalance } = input;
    const spreadSafetyMultiplier = getSpreadSafetyMultiplier();
    const minProfitVsSpread = spreadCostUSD * spreadSafetyMultiplier;

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
  }

  private checkAbsurdTradeCount(
    input: ExecutionEligibilityInput,
    modeLimits: ReturnType<typeof getModeLimits>,
    reasons: EligibilityBlockReason[]
  ): void {
    const { estimatedTradesRequired, tradingMode } = input;
    const maxTrades = modeLimits.maxTradesRequired;

    if (estimatedTradesRequired > maxTrades) {
      reasons.push({
        code: 'ABSURD_TRADE_COUNT',
        message: `Goal requires ${estimatedTradesRequired} trades, exceeding ${tradingMode} limit of ${maxTrades}`,
        metric: `${estimatedTradesRequired} trades estimated`,
        threshold: `${maxTrades} trades maximum (${tradingMode})`,
        suggestion: 'Reduce goal amount, increase position size within risk limits, or extend goal timeline'
      });
    }
  }

  private checkSlAtrWidth(
    input: ExecutionEligibilityInput,
    slAtrMultiple: number,
    reasons: EligibilityBlockReason[]
  ): void {
    const assetClass = getAssetClass(input.symbol);
    const slAtrCap = getSlAtrCap(assetClass, input.tradingMode);

    if (slAtrMultiple > slAtrCap && slAtrMultiple > 0) {
      reasons.push({
        code: 'SL_TOO_WIDE_FOR_STYLE',
        message: `Stop loss at ${slAtrMultiple.toFixed(1)}x ATR exceeds ${input.tradingMode} cap of ${slAtrCap.toFixed(1)}x for ${assetClass}`,
        metric: `${slAtrMultiple.toFixed(2)}x ATR`,
        threshold: `${slAtrCap.toFixed(1)}x ATR (${assetClass} ${input.tradingMode})`,
        suggestion: 'Tighten stop loss or switch to SWING mode for wider stops'
      });
    }
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

    if (input.timeToFillResult.viability === 'WARNING') {
      advisories.push({
        type: 'TIME_TO_FILL_WARNING',
        message: input.timeToFillResult.reasoning,
        severity: 'medium'
      });
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
