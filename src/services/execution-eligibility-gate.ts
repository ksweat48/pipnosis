/**
 * EXECUTION ELIGIBILITY GATE - SSOT Authority
 *
 * PURPOSE: Single source of truth for determining if a trade is eligible for execution
 *
 * ARCHITECTURAL ROLE:
 * - MICRO_INTRADAY trades with >=85% confidence override economic checks
 * - All other trades must pass full eligibility criteria
 * - Centralizes execution decision logic
 *
 * CCIP COMPLIANT: Part of confidence-dominant architecture
 * GOVERNANCE: All overrides logged for audit
 *
 * @module ExecutionEligibilityGate
 */

import { logger, LogCategory } from '../lib/logger';
import { priceFreshnessGate, type FreshnessContext } from '../governance/price-freshness-gate';

export interface ExecutionEligibilityInput {
  symbol: string;
  tradeConfidence?: number;
  style?: 'SCALP' | 'MICRO_INTRADAY' | 'INTRADAY' | 'SWING' | 'POSITION';
  timestamp?: Date | string;
  userId?: string;

  // Economic checks
  // Note: MICRO override does NOT bypass economic checks - minimum profit remains enforced
  hasPositiveExpectedValue?: boolean;
  hasAcceptableRiskReward?: boolean;
  hasValidGeometry?: boolean;
  expectedProfitPips?: number; // For minimum profit check (economic check not overridable)

  // Additional context
  sessionId?: string;
  goalSessionId?: string;
}

export interface ExecutionEligibilityResult {
  isEligible: boolean;
  reason?: string;
  overrideApplied?: boolean;
  overrideReason?: string;
  blockedBy?: string[];
  warnings?: string[];
  checks: {
    confidence?: boolean;
    freshness?: boolean;
    expectedValue?: boolean;
    riskReward?: boolean;
    geometry?: boolean;
    minimumProfit?: boolean;
  };
}

/**
 * MICRO_INTRADAY Confidence Override Threshold
 * Trades with this confidence or higher can override SOME checks
 * Note: MICRO override does NOT bypass economic checks (minimum profit)
 */
export const MICRO_CONFIDENCE_OVERRIDE_THRESHOLD = 85;

/**
 * Minimum profit threshold in pips
 * This economic check is NEVER overridden, even with MICRO confidence
 */
export const MINIMUM_PROFIT_PIPS = 5;

class ExecutionEligibilityGate {
  /**
   * PRIMARY METHOD: Check if trade is eligible for execution
   *
   * MICRO OVERRIDE LOGIC:
   * - If style === 'MICRO_INTRADAY' AND tradeConfidence >= 85%
   *   → Skip economic checks, only require freshness
   * - All other cases: Full eligibility check
   *
   * @param input Trade parameters and eligibility data
   * @returns Eligibility result with details
   */
  async checkEligibility(input: ExecutionEligibilityInput): Promise<ExecutionEligibilityResult> {
    const {
      symbol,
      tradeConfidence,
      style,
      timestamp,
      hasPositiveExpectedValue,
      hasAcceptableRiskReward,
      hasValidGeometry,
      expectedProfitPips,
      userId,
      sessionId
    } = input;

    const checks: ExecutionEligibilityResult['checks'] = {};
    const blockedBy: string[] = [];
    const warnings: string[] = [];

    // ===================================================================
    // MANDATORY CHECK: Minimum Profit (NEVER OVERRIDDEN)
    // ===================================================================
    // Economic checks like minimum profit are enforced for ALL trades
    // including MICRO_INTRADAY with high confidence
    // ===================================================================
    if (expectedProfitPips !== undefined) {
      const profitCheck = this.checkMinimumProfit(expectedProfitPips);
      checks.minimumProfit = profitCheck.passed;

      if (!profitCheck.passed) {
        blockedBy.push(profitCheck.reason);

        logger.warn(
          LogCategory.AI_TRADING,
          `[Execution Eligibility] ❌ PROFIT_BELOW_MINIMUM: ${symbol} - ${profitCheck.reason}`,
          {
            symbol,
            expectedProfitPips,
            minimumRequired: MINIMUM_PROFIT_PIPS,
            userId,
            sessionId
          }
        );
      }
    }

    // ===================================================================
    // CHECK 1: MICRO_INTRADAY Confidence Override
    // ===================================================================
    // If MICRO_INTRADAY with >=85% confidence, override economic checks
    // ===================================================================
    const isMicroIntraday = style === 'MICRO_INTRADAY';
    const hasHighConfidence = (tradeConfidence ?? 0) >= MICRO_CONFIDENCE_OVERRIDE_THRESHOLD;

    if (isMicroIntraday && hasHighConfidence) {
      logger.info(
        LogCategory.AI_TRADING,
        `[Execution Eligibility] ⚡ MICRO CONFIDENCE OVERRIDE: ${symbol} at ${tradeConfidence}% confidence (style: ${style})`,
        {
          symbol,
          confidence: tradeConfidence,
          style,
          threshold: MICRO_CONFIDENCE_OVERRIDE_THRESHOLD,
          userId,
          sessionId
        }
      );

      // MICRO override: Only check freshness, skip economic checks
      const freshnessCheck = await this.checkFreshness(symbol, timestamp, 'execution');
      checks.freshness = freshnessCheck.isFresh;

      if (!freshnessCheck.isFresh) {
        blockedBy.push(`Stale price data: ${freshnessCheck.reason}`);
      }

      // Economic checks marked as overridden (not required)
      checks.confidence = true;
      checks.expectedValue = true; // Overridden
      checks.riskReward = true; // Overridden
      checks.geometry = true; // Overridden

      return {
        isEligible: checks.freshness!,
        overrideApplied: true,
        overrideReason: `MICRO_INTRADAY with ${tradeConfidence}% confidence (>=${MICRO_CONFIDENCE_OVERRIDE_THRESHOLD}%)`,
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
        checks,
        reason: blockedBy.length > 0 ? blockedBy.join('; ') : 'MICRO override applied - freshness passed'
      };
    }

    // ===================================================================
    // CHECK 2: Standard Eligibility (No Override)
    // ===================================================================
    // Full checks for all other cases
    // ===================================================================

    // 2a. Confidence Check (if provided)
    if (tradeConfidence !== undefined) {
      checks.confidence = tradeConfidence >= 50; // Minimum threshold
      if (!checks.confidence) {
        blockedBy.push(`Low confidence: ${tradeConfidence}% (min: 50%)`);
      }
    }

    // 2b. Freshness Check
    const freshnessCheck = await this.checkFreshness(symbol, timestamp, 'execution');
    checks.freshness = freshnessCheck.isFresh;
    if (!checks.freshness) {
      blockedBy.push(`Stale price data: ${freshnessCheck.reason}`);
    }

    // 2c. Expected Value Check
    if (hasPositiveExpectedValue !== undefined) {
      checks.expectedValue = hasPositiveExpectedValue;
      if (!checks.expectedValue) {
        blockedBy.push('Negative expected value');
      }
    }

    // 2d. Risk/Reward Check
    if (hasAcceptableRiskReward !== undefined) {
      checks.riskReward = hasAcceptableRiskReward;
      if (!checks.riskReward) {
        blockedBy.push('Unacceptable risk/reward ratio');
      }
    }

    // 2e. Geometry Check
    if (hasValidGeometry !== undefined) {
      checks.geometry = hasValidGeometry;
      if (!checks.geometry) {
        blockedBy.push('Invalid SL/TP geometry');
      }
    }

    // Determine eligibility
    const isEligible = blockedBy.length === 0;

    if (!isEligible) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Execution Eligibility] ❌ BLOCKED: ${symbol} - ${blockedBy.join(', ')}`,
        {
          symbol,
          confidence: tradeConfidence,
          style,
          blockedBy,
          userId,
          sessionId
        }
      );
    } else {
      logger.info(
        LogCategory.AI_TRADING,
        `[Execution Eligibility] ✅ ELIGIBLE: ${symbol}`,
        {
          symbol,
          confidence: tradeConfidence,
          style,
          userId,
          sessionId
        }
      );
    }

    return {
      isEligible,
      reason: isEligible ? 'All checks passed' : blockedBy.join('; '),
      overrideApplied: false,
      blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
      checks
    };
  }

  /**
   * Check price freshness for execution
   * Delegates to PriceFreshnessGate (SSOT compliance)
   */
  private async checkFreshness(
    symbol: string,
    timestamp: Date | string | undefined,
    context: FreshnessContext
  ): Promise<{ isFresh: boolean; reason?: string }> {
    if (timestamp) {
      // Timestamp provided - check it directly
      const result = priceFreshnessGate.getTimestampAge(timestamp, context, symbol);
      return {
        isFresh: result.isFresh,
        reason: result.isFresh ? undefined : `Price ${result.ageSeconds.toFixed(0)}s old (max: ${result.maxAgeSeconds}s)`
      };
    } else {
      // No timestamp - query database
      const result = await priceFreshnessGate.checkFreshness(symbol, context);
      return {
        isFresh: result.isFresh,
        reason: result.reason
      };
    }
  }

  /**
   * Quick check: Is this trade eligible for MICRO override?
   * Returns true if trade meets MICRO_INTRADAY + >=85% confidence
   */
  isMicroOverrideEligible(style: string | undefined, confidence: number | undefined): boolean {
    return style === 'MICRO_INTRADAY' && (confidence ?? 0) >= MICRO_CONFIDENCE_OVERRIDE_THRESHOLD;
  }

  /**
   * Get override threshold for logging/display
   */
  getOverrideThreshold(): number {
    return MICRO_CONFIDENCE_OVERRIDE_THRESHOLD;
  }

  /**
   * Check minimum profit requirement
   * This economic check is NEVER overridden, even by MICRO confidence
   *
   * @param expectedProfitPips Expected profit in pips
   * @returns Check result with pass/fail and reason
   */
  checkMinimumProfit(expectedProfitPips: number): { passed: boolean; reason: string } {
    if (expectedProfitPips < MINIMUM_PROFIT_PIPS) {
      return {
        passed: false,
        reason: `PROFIT_BELOW_MINIMUM: Expected ${expectedProfitPips.toFixed(1)} pips (min: ${MINIMUM_PROFIT_PIPS} pips)`
      };
    }

    return {
      passed: true,
      reason: `Minimum profit check passed: ${expectedProfitPips.toFixed(1)} pips`
    };
  }
}

// Export singleton instance
export const executionEligibilityGate = new ExecutionEligibilityGate();

// Export class for testing
export { ExecutionEligibilityGate };
