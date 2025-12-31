/**
 * Trade Execution Freshness Gate
 *
 * P0 CIRCUIT BREAKER: Prevents execution on stale intelligence or prices
 *
 * Validation Layers:
 * 1. Omega Intelligence Freshness (max age by timeframe)
 * 2. Alpha Strategic Intelligence Freshness
 * 3. Price Drift Detection (signal vs current)
 * 4. Realtime Price Staleness Check
 *
 * ALL validations must pass for trade execution to proceed.
 */

import { logger, LogCategory } from '../lib/logger';
import { intelligenceFreshnessValidator, type IntelligenceData } from './intelligence-freshness-validator';
import { priceDriftDetector } from './price-drift-detector';
import { realtimePriceStalenessValidator } from './realtime-price-staleness-validator';
import type { CachedOmegaIntelligence, AlphaStrategicInsight } from './shared-intelligence-coordinator';
import { FreshnessBlockCategory, type BlockMetadata } from '../types/freshness-block';
import { freshnessBlockLogger } from './freshness-block-logger';

export interface FreshnessGateResult {
  canExecute: boolean;
  blockingReasons: string[];
  warnings: string[];
  validationResults: {
    omegaFreshness?: any;
    alphaFreshness?: any;
    priceDrift?: any;
    priceStaleness?: any;
  };
  wasAutoRefreshed?: boolean;
  blockCategories?: FreshnessBlockCategory[];
  blockMetadata?: BlockMetadata[];
}

export interface ExecutionContext {
  symbol: string;
  timeframe: string;
  signalPrice?: number;
  currentPrice?: number;
  omegaVotes?: Map<string, CachedOmegaIntelligence>;
  alphaInsight?: AlphaStrategicInsight;
}

export type RefreshCallback = () => Promise<void>;

export class TradeExecutionFreshnessGate {
  /**
   * P0 CIRCUIT BREAKER: Validate all freshness requirements before execution
   */
  async validateExecution(context: ExecutionContext): Promise<FreshnessGateResult> {
    const blockingReasons: string[] = [];
    const warnings: string[] = [];
    const validationResults: any = {};
    const blockCategories: FreshnessBlockCategory[] = [];
    const blockMetadata: BlockMetadata[] = [];

    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] 🛡️ Validating execution for ${context.symbol}@${context.timeframe}`
    );

    // Layer 1: Validate Omega Intelligence Freshness
    if (context.omegaVotes && context.omegaVotes.size > 0) {
      const omegaData: IntelligenceData[] = Array.from(context.omegaVotes.values()).map(vote => ({
        brainName: vote.brainName,
        cacheAgeSeconds: vote.cacheAgeSeconds,
        timeframe: context.timeframe
      }));

      const omegaValidation = intelligenceFreshnessValidator.validateOmegaIntelligence(
        omegaData,
        context.timeframe
      );

      validationResults.omegaFreshness = omegaValidation;

      if (!omegaValidation.isValid) {
        blockingReasons.push(`Omega Intelligence: ${omegaValidation.reason}`);
        if (omegaValidation.blockCategory) {
          blockCategories.push(omegaValidation.blockCategory);
        }
        if (omegaValidation.blockMetadata) {
          blockMetadata.push(omegaValidation.blockMetadata);
        }
      }
    }

    // Layer 2: Validate Alpha Strategic Intelligence Freshness
    if (context.alphaInsight) {
      const alphaValidation = intelligenceFreshnessValidator.validateAlphaIntelligence(
        context.alphaInsight.cacheAgeSeconds,
        context.timeframe
      );

      validationResults.alphaFreshness = alphaValidation;

      if (!alphaValidation.isValid) {
        blockingReasons.push(`Alpha Intelligence: ${alphaValidation.reason}`);
        if (alphaValidation.blockCategory) {
          blockCategories.push(alphaValidation.blockCategory);
        }
        if (alphaValidation.blockMetadata) {
          blockMetadata.push(alphaValidation.blockMetadata);
        }
      }
    }

    // Layer 3: Validate Price Drift (if signal price available)
    if (context.signalPrice && context.currentPrice) {
      const driftValidation = priceDriftDetector.validateDrift(
        context.symbol,
        context.signalPrice,
        context.currentPrice
      );

      validationResults.priceDrift = driftValidation;

      if (driftValidation.shouldBlock) {
        blockingReasons.push(`Price Drift: ${driftValidation.reason}`);
        if (driftValidation.blockCategory) {
          blockCategories.push(driftValidation.blockCategory);
        }
        if (driftValidation.blockMetadata) {
          blockMetadata.push(driftValidation.blockMetadata);
        }
      }
    }

    // Layer 4: Validate Realtime Price Freshness
    const priceValidation = await realtimePriceStalenessValidator.validatePriceFreshness(
      context.symbol
    );

    validationResults.priceStaleness = priceValidation;

    if (priceValidation.shouldBlockTrading) {
      blockingReasons.push(`Realtime Price: ${priceValidation.reason}`);
      if (priceValidation.blockCategory) {
        blockCategories.push(priceValidation.blockCategory);
      }
      if (priceValidation.blockMetadata) {
        blockMetadata.push(priceValidation.blockMetadata);
      }
    }

    // Final Decision
    const canExecute = blockingReasons.length === 0;

    if (!canExecute) {
      logger.error(
        LogCategory.AI_TRADING,
        `[Freshness Gate] 🚫 EXECUTION BLOCKED for ${context.symbol}:`
      );
      blockingReasons.forEach((reason, i) => {
        logger.error(LogCategory.AI_TRADING, `  ${i + 1}. ${reason}`);
      });
    } else {
      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ✅ ALL CHECKS PASSED - ${context.symbol} cleared for execution`
      );
    }

    return {
      canExecute,
      blockingReasons,
      warnings,
      validationResults,
      blockCategories,
      blockMetadata
    };
  }

  /**
   * SOFT-REFRESH FLOW: Validate with automatic refresh on first failure
   *
   * Pattern:
   * 1. Initial validation
   * 2. If failed -> refresh data -> retry once
   * 3. If still failed -> BLOCK (persistent staleness)
   *
   * This avoids blocking on cache expiry while maintaining safety.
   */
  async validateWithAutoRefresh(
    context: ExecutionContext,
    refreshCallback: RefreshCallback,
    userId?: string
  ): Promise<FreshnessGateResult> {
    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] 🛡️ Starting soft-refresh validation for ${context.symbol}@${context.timeframe}`
    );

    // Initial validation
    const firstCheck = await this.validateExecution(context);

    if (firstCheck.canExecute) {
      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ✅ Initial check PASSED - no refresh needed`
      );
      return { ...firstCheck, wasAutoRefreshed: false };
    }

    // First check failed - attempt auto-refresh
    logger.warn(
      LogCategory.AI_TRADING,
      `[Freshness Gate] ⚠️ Initial check FAILED - attempting auto-refresh`,
      { blockingReasons: firstCheck.blockingReasons }
    );

    // Log initial blocks
    if (userId && firstCheck.blockCategories && firstCheck.blockMetadata) {
      for (let i = 0; i < firstCheck.blockCategories.length; i++) {
        const metadata = firstCheck.blockMetadata[i] || {};
        await freshnessBlockLogger.logBlock({
          symbol: context.symbol,
          timeframe: context.timeframe,
          blockCategory: firstCheck.blockCategories[i],
          blockMetadata: {
            ...metadata,
            refreshAttempted: true,
            wasAutoRefreshed: false
          },
          cacheTier: 'omega'
        });
      }
    }

    try {
      // Refresh stale data
      await refreshCallback();

      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] 🔄 Refresh complete - re-validating`
      );

      // Re-validate with fresh data
      const secondCheck = await this.validateExecution(context);

      if (!secondCheck.canExecute) {
        // Still failed after refresh - this is persistent staleness
        const persistentMetadata: BlockMetadata = {
          symbol: context.symbol,
          timeframe: context.timeframe,
          refreshAttempted: true,
          wasAutoRefreshed: false
        };

        logger.error(
          LogCategory.AI_TRADING,
          `[Freshness Gate] 🚫 ${FreshnessBlockCategory.BLOCK_PERSISTENT_STALENESS}: Failed after refresh`,
          persistentMetadata
        );

        // Log persistent staleness
        if (userId) {
          await freshnessBlockLogger.logBlock({
            symbol: context.symbol,
            timeframe: context.timeframe,
            blockCategory: FreshnessBlockCategory.BLOCK_PERSISTENT_STALENESS,
            blockMetadata: persistentMetadata,
            cacheTier: 'omega'
          });
        }

        return {
          ...secondCheck,
          wasAutoRefreshed: false,
          blockCategories: [
            ...(secondCheck.blockCategories || []),
            FreshnessBlockCategory.BLOCK_PERSISTENT_STALENESS
          ],
          blockMetadata: [
            ...(secondCheck.blockMetadata || []),
            persistentMetadata
          ]
        };
      }

      // Success after refresh - log successful refresh
      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ✅ PASSED after refresh - execution cleared`
      );

      // Log successful auto-refresh for all initial blocks
      if (userId && firstCheck.blockCategories && firstCheck.blockMetadata) {
        for (let i = 0; i < firstCheck.blockCategories.length; i++) {
          const metadata = firstCheck.blockMetadata[i] || {};
          await freshnessBlockLogger.logBlock({
            symbol: context.symbol,
            timeframe: context.timeframe,
            blockCategory: firstCheck.blockCategories[i],
            blockMetadata: {
              ...metadata,
              refreshAttempted: true,
              wasAutoRefreshed: true
            },
            cacheTier: 'omega'
          });
        }
      }

      return { ...secondCheck, wasAutoRefreshed: true };
    } catch (error) {
      logger.error(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ❌ Refresh callback failed:`,
        error
      );

      // Return original failure if refresh fails
      return { ...firstCheck, wasAutoRefreshed: false };
    }
  }

  /**
   * Quick validation for Omega votes only (used during analysis phase)
   */
  async validateOmegaVotesOnly(
    omegaVotes: Map<string, CachedOmegaIntelligence>,
    timeframe: string,
    symbol: string
  ): Promise<{ isValid: boolean; reason?: string }> {
    const omegaData: IntelligenceData[] = Array.from(omegaVotes.values()).map(vote => ({
      brainName: vote.brainName,
      cacheAgeSeconds: vote.cacheAgeSeconds,
      timeframe
    }));

    const validation = intelligenceFreshnessValidator.validateOmegaIntelligence(
      omegaData,
      timeframe
    );

    if (!validation.isValid) {
      logger.warn(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ⚠️ Stale Omega votes detected for ${symbol} - forcing refresh`
      );
    }

    return {
      isValid: validation.isValid,
      reason: validation.reason
    };
  }

  /**
   * Validate price staleness before any trading activity
   */
  async validatePriceDataAvailability(symbols: string[]): Promise<Map<string, boolean>> {
    const results = await realtimePriceStalenessValidator.validateMultipleSymbols(symbols);
    const availability = new Map<string, boolean>();

    for (const [symbol, result] of results.entries()) {
      availability.set(symbol, !result.shouldBlockTrading);
    }

    return availability;
  }

  /**
   * Get detailed freshness report for debugging
   */
  async getFreshnessReport(context: ExecutionContext): Promise<string> {
    const result = await this.validateExecution(context);

    let report = `\n═══════════════════════════════════════════════════\n`;
    report += `FRESHNESS VALIDATION REPORT\n`;
    report += `Symbol: ${context.symbol} | Timeframe: ${context.timeframe}\n`;
    report += `═══════════════════════════════════════════════════\n\n`;

    report += `✅ Can Execute: ${result.canExecute ? 'YES' : 'NO'}\n\n`;

    if (result.blockingReasons.length > 0) {
      report += `🚫 BLOCKING REASONS:\n`;
      result.blockingReasons.forEach((reason, i) => {
        report += `  ${i + 1}. ${reason}\n`;
      });
      report += `\n`;
    }

    if (result.warnings.length > 0) {
      report += `⚠️  WARNINGS:\n`;
      result.warnings.forEach((warning, i) => {
        report += `  ${i + 1}. ${warning}\n`;
      });
      report += `\n`;
    }

    report += `VALIDATION DETAILS:\n`;
    if (result.validationResults.omegaFreshness) {
      const omega = result.validationResults.omegaFreshness;
      report += `  Omega: ${omega.isValid ? '✅' : '🚫'} (age: ${omega.ageSeconds}s, max: ${omega.maxAgeSeconds}s)\n`;
    }
    if (result.validationResults.alphaFreshness) {
      const alpha = result.validationResults.alphaFreshness;
      report += `  Alpha: ${alpha.isValid ? '✅' : '🚫'} (age: ${alpha.ageSeconds}s, max: ${alpha.maxAgeSeconds}s)\n`;
    }
    if (result.validationResults.priceDrift) {
      const drift = result.validationResults.priceDrift;
      report += `  Price Drift: ${drift.isValid ? '✅' : '🚫'}`;
      if (drift.driftPips) {
        report += ` (${drift.driftPips.toFixed(1)} pips, max: ${drift.maxDriftPips} pips)\n`;
      } else if (drift.driftPercent) {
        report += ` (${drift.driftPercent.toFixed(2)}%, max: ${drift.maxDriftPercent}%)\n`;
      } else {
        report += `\n`;
      }
    }
    if (result.validationResults.priceStaleness) {
      const price = result.validationResults.priceStaleness;
      report += `  Realtime Price: ${price.isValid ? '✅' : '🚫'} (age: ${price.ageSeconds}s, max: ${price.maxAgeSeconds}s)\n`;
    }

    report += `═══════════════════════════════════════════════════\n`;

    return report;
  }
}

export const tradeExecutionFreshnessGate = new TradeExecutionFreshnessGate();
