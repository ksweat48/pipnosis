/**
 * Trade Execution Freshness Gate
 *
 * P0 CIRCUIT BREAKER: Prevents execution on stale intelligence or prices
 *
 * SSOT COMPLIANCE:
 * - Price freshness checks delegated to PriceFreshnessGate (governance layer)
 * - This service handles trade-specific validation (intelligence + drift)
 * - No duplicate price checking logic
 * - Severity thresholds sourced from TIME_MS (SSOT: time-constants.ts)
 *
 * Validation Layers:
 * 1. Omega Intelligence Freshness (max age by timeframe)
 * 2. Alpha Strategic Intelligence Freshness
 * 3. Price Drift Detection (signal vs current)
 * 4. Realtime Price Staleness Check (delegated to PriceFreshnessGate)
 *
 * ALL validations must pass for trade execution to proceed.
 *
 * CCIP-THRESHOLD-FIX-2026-03-03:
 * Alpha intelligence severity thresholds raised to align with the 15-minute thesis TTL.
 * Previous values (60s info / 120s warning / 300s critical) blocked execution for the
 * entire 5-15 minute window of a structurally valid cached thesis, making 67% of the
 * 15-minute TTL window permanently inaccessible.
 *
 * New thresholds scale proportionally with the 15-minute (900s) TTL:
 *   info:     0-33% of TTL  (0-300s)  — fully fresh, no advisory
 *   warning:  33-67% of TTL (300-600s) — Alpha factors into confidence, not blocked
 *   critical: >67% of TTL  (>600s)    — strong advisory NO_TRADE (but not hard block)
 *
 * NOTE: The CRITICAL severity generates a strong advisory but does NOT produce a hard
 * canExecute: false at the gate level for alpha age alone. The generateAdvisory() method
 * (used by Alpha's prompt context) communicates staleness as a penalty signal. The hard
 * block path (validateExecution -> blockingReasons) is driven by intelligenceFreshnessValidator
 * which uses TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING. This separation is intentional:
 * thesis structural validity (regime match) is the primary guard, not wall-clock age.
 */

import { logger, LogCategory } from '../lib/logger';
import { TIME_MS } from '../config/time-constants';
import { intelligenceFreshnessValidator, type IntelligenceData } from './intelligence-freshness-validator';
import { priceDriftDetector } from './price-drift-detector';
import { priceFreshnessGate } from '../governance/price-freshness-gate';
import { priceCoordinator } from './coordinators/price-coordinator';
import { pricePollingCoordinator } from './price-polling-coordinator';
import type { CachedOmegaIntelligence } from './shared-intelligence-coordinator';
import type { AlphaMarketThesis } from '../types/alpha-thesis';
import { FreshnessBlockCategory, type BlockMetadata } from '../types/freshness-block';
import { freshnessBlockLogger } from './freshness-block-logger';

export type FreshnessSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface FreshnessSeverityResult {
  severity: FreshnessSeverity;
  ageSeconds: number;
  maxAgeForInfo: number;
  maxAgeForWarning: number;
  maxAgeForCritical: number;
  description: string;
}

export interface FreshnessAdvisory {
  overallSeverity: FreshnessSeverity;
  canExecute: boolean;
  shouldReduceConfidence: boolean;
  confidenceReduction: number;
  advisoryMessage: string;
  detailedChecks: {
    omegaFreshness?: FreshnessSeverityResult;
    alphaFreshness?: FreshnessSeverityResult;
    priceDrift?: FreshnessSeverityResult;
    priceStaleness?: FreshnessSeverityResult;
  };
}

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
  advisory?: FreshnessAdvisory;
}

export interface ExecutionContext {
  symbol: string;
  timeframe: string;
  signalPrice?: number;
  currentPrice?: number;
  signalTimestamp?: number; // Unix timestamp when signal was generated
  currentTimestamp?: number; // Unix timestamp when current price was fetched
  omegaVotes?: Map<string, CachedOmegaIntelligence>;
  alphaInsight?: AlphaMarketThesis;
}

export type RefreshCallback = () => Promise<void>;

// SSOT: Derive alpha thresholds from canonical TTL (TIME_MS.CACHE.ALPHA_THESIS)
// Bands are 33% / 67% / 100% of the thesis TTL in seconds.
// This ensures the severity scale always maps proportionally to the actual cache lifetime.
const ALPHA_TTL_SECONDS = TIME_MS.CACHE.ALPHA_THESIS / 1000; // 900s (15 min)

const SEVERITY_THRESHOLDS = {
  omega: {
    infoMaxAge: 30,
    warningMaxAge: 90,
    criticalMaxAge: 180
  },
  alpha: {
    infoMaxAge: Math.round(ALPHA_TTL_SECONDS * 0.33),   // ~300s (5 min) — fully fresh
    warningMaxAge: Math.round(ALPHA_TTL_SECONDS * 0.67), // ~600s (10 min) — moderate advisory
    criticalMaxAge: ALPHA_TTL_SECONDS                    // 900s (15 min) — strong advisory
  },
  price: {
    infoMaxAge: 15,
    warningMaxAge: 45,
    criticalMaxAge: 90
  },
  drift: {
    infoMaxPips: 3,
    warningMaxPips: 8,
    criticalMaxPips: 15
  }
};

export class TradeExecutionFreshnessGate {
  private calculateAgeSeverity(
    ageSeconds: number,
    thresholds: { infoMaxAge: number; warningMaxAge: number; criticalMaxAge: number },
    label: string
  ): FreshnessSeverityResult {
    if (ageSeconds <= thresholds.infoMaxAge) {
      return {
        severity: 'INFO',
        ageSeconds,
        maxAgeForInfo: thresholds.infoMaxAge,
        maxAgeForWarning: thresholds.warningMaxAge,
        maxAgeForCritical: thresholds.criticalMaxAge,
        description: `${label}: Fresh (${ageSeconds}s)`
      };
    } else if (ageSeconds <= thresholds.warningMaxAge) {
      return {
        severity: 'WARNING',
        ageSeconds,
        maxAgeForInfo: thresholds.infoMaxAge,
        maxAgeForWarning: thresholds.warningMaxAge,
        maxAgeForCritical: thresholds.criticalMaxAge,
        description: `${label}: Moderately stale (${ageSeconds}s) - consider refreshing`
      };
    } else {
      return {
        severity: 'CRITICAL',
        ageSeconds,
        maxAgeForInfo: thresholds.infoMaxAge,
        maxAgeForWarning: thresholds.warningMaxAge,
        maxAgeForCritical: thresholds.criticalMaxAge,
        description: `${label}: Critically stale (${ageSeconds}s) - strongly recommend NO_TRADE`
      };
    }
  }

  private combineSevertities(severities: FreshnessSeverity[]): FreshnessSeverity {
    if (severities.includes('CRITICAL')) return 'CRITICAL';
    if (severities.includes('WARNING')) return 'WARNING';
    return 'INFO';
  }

  private calculateConfidenceReduction(severity: FreshnessSeverity): number {
    switch (severity) {
      case 'INFO': return 0;
      case 'WARNING': return 10;
      case 'CRITICAL': return 25;
    }
  }

  generateAdvisory(context: ExecutionContext, validationResults: any): FreshnessAdvisory {
    const detailedChecks: FreshnessAdvisory['detailedChecks'] = {};
    const severities: FreshnessSeverity[] = [];

    if (validationResults.omegaFreshness) {
      const age = validationResults.omegaFreshness.ageSeconds || 0;
      const result = this.calculateAgeSeverity(age, SEVERITY_THRESHOLDS.omega, 'Omega Intelligence');
      detailedChecks.omegaFreshness = result;
      severities.push(result.severity);
    }

    if (validationResults.alphaFreshness) {
      const age = validationResults.alphaFreshness.ageSeconds || 0;
      const result = this.calculateAgeSeverity(age, SEVERITY_THRESHOLDS.alpha, 'Alpha Intelligence');
      detailedChecks.alphaFreshness = result;
      severities.push(result.severity);
    }

    if (validationResults.priceStaleness) {
      const age = validationResults.priceStaleness.ageSeconds || 0;
      const result = this.calculateAgeSeverity(age, SEVERITY_THRESHOLDS.price, 'Realtime Price');
      detailedChecks.priceStaleness = result;
      severities.push(result.severity);
    }

    if (validationResults.priceDrift) {
      const driftPips = validationResults.priceDrift.driftPips || 0;
      let severity: FreshnessSeverity = 'INFO';
      let description = `Price Drift: ${driftPips.toFixed(1)} pips - acceptable`;

      if (driftPips > SEVERITY_THRESHOLDS.drift.criticalMaxPips) {
        severity = 'CRITICAL';
        description = `Price Drift: ${driftPips.toFixed(1)} pips - excessive drift, strongly recommend NO_TRADE`;
      } else if (driftPips > SEVERITY_THRESHOLDS.drift.warningMaxPips) {
        severity = 'WARNING';
        description = `Price Drift: ${driftPips.toFixed(1)} pips - moderate drift, consider re-evaluation`;
      }

      detailedChecks.priceDrift = {
        severity,
        ageSeconds: 0,
        maxAgeForInfo: SEVERITY_THRESHOLDS.drift.infoMaxPips,
        maxAgeForWarning: SEVERITY_THRESHOLDS.drift.warningMaxPips,
        maxAgeForCritical: SEVERITY_THRESHOLDS.drift.criticalMaxPips,
        description
      };
      severities.push(severity);
    }

    const overallSeverity = this.combineSevertities(severities);
    const confidenceReduction = this.calculateConfidenceReduction(overallSeverity);

    let advisoryMessage = '';
    switch (overallSeverity) {
      case 'INFO':
        advisoryMessage = 'All data fresh - proceed normally';
        break;
      case 'WARNING':
        advisoryMessage = 'Some data moderately stale - Alpha should factor this into confidence';
        break;
      case 'CRITICAL':
        advisoryMessage = 'Critical staleness detected - Alpha should weight staleness risk in confidence calibration';
        break;
    }

    return {
      overallSeverity,
      canExecute: overallSeverity !== 'CRITICAL',
      shouldReduceConfidence: overallSeverity === 'WARNING',
      confidenceReduction,
      advisoryMessage,
      detailedChecks
    };
  }

  /**
   * PRE-CHECK: Quick validation before expensive LLM calls
   * Checks price staleness only to fail fast before wasting money
   *
   * SSOT: Delegates to PriceFreshnessGate (governance layer)
   *
   * CONTEXT RATIONALE: Uses 'analysis' context (90s threshold), not 'execution'
   * (30s), because this runs BEFORE the LLM call during the analysis phase.
   * The stricter 30s execution threshold is enforced downstream in
   * validateExecution() after the LLM returns. This avoids false blocks
   * during multi-symbol concurrent scans where Batch 1 LLM calls (~40-60s)
   * cause DB records to appear stale for Batch 2/3 symbols.
   *
   * FALLBACK CHAIN:
   * 1. DB freshness check (analysis context: 90s threshold)
   * 2. PriceCoordinator in-memory cache (isCriticallyStale guard)
   * 3. PricePollingCoordinator wall-clock fetch age (independent of DB timestamps)
   *    — uses getSecondsSinceLastFetch() which measures when the coordinator
   *      last successfully polled the Netlify function, NOT the DB record age.
   *      This is genuinely independent: coordinator polls every 2s from client,
   *      so a recent fetch proves live price availability regardless of DB writes.
   * 4. Market snapshot hint (candle-derived price from shared intelligence cache)
   *    — if a snapshot was freshly built (within 30s) and contains a valid price,
   *      the candle pipeline has confirmed market activity. This prevents false blocks
   *      at session startup before the first price poll has written to realtime_prices.
   */
  async preCheckFreshness(
    symbol: string,
    snapshotHint?: { price: number; createdAt: number }
  ): Promise<{ shouldProceed: boolean; reason?: string }> {
    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] 🔍 Pre-check for ${symbol} before Omega calls`
    );

    // SSOT: Use centralized PriceFreshnessGate with 'analysis' context (90s threshold)
    // Pre-LLM check is analysis-phase; execution-phase (30s) enforced in validateExecution
    const freshnessResult = await priceFreshnessGate.checkFreshness(symbol, 'analysis');

    if (freshnessResult.isFresh) {
      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ✅ Pre-check PASSED - price age: ${freshnessResult.ageSeconds}s`
      );
      return { shouldProceed: true };
    }

    // Tier-2 fallback: check PriceCoordinator in-memory cache
    // This avoids false blocks from transient DB write delays
    const cachedResult = await priceCoordinator.getPrice(symbol, { useCacheFirst: true, allowStale: false });

    if (cachedResult.success && cachedResult.price && !cachedResult.price.isCriticallyStale) {
      logger.info(
        LogCategory.AI_TRADING,
        `[Freshness Gate] ✅ Pre-check PASSED via cache fallback - cache age: ${cachedResult.price.ageSeconds.toFixed(1)}s (DB was ${freshnessResult.ageSeconds}s old)`
      );
      return { shouldProceed: true };
    }

    // Tier-3 fallback: check when pricePollingCoordinator last successfully fetched.
    // Uses wall-clock time of the last successful HTTP poll (getSecondsSinceLastFetch),
    // NOT the DB-sourced price timestamp. This is genuinely independent of DB staleness:
    // if the coordinator polled within the last 10 seconds, live prices ARE available
    // client-side even if the DB write pipeline is temporarily lagging.
    const fetchAge = pricePollingCoordinator.getSecondsSinceLastFetch();
    const MAX_FETCH_AGE_SECONDS = 10; // 5× the 2s poll interval = reasonable tolerance

    if (fetchAge <= MAX_FETCH_AGE_SECONDS) {
      const polledPrice = pricePollingCoordinator.getSymbolPrice(symbol.toUpperCase());
      if (polledPrice) {
        logger.info(
          LogCategory.AI_TRADING,
          `[Freshness Gate] ✅ Pre-check PASSED via polling coordinator - fetch age: ${fetchAge.toFixed(1)}s, DB was ${freshnessResult.ageSeconds}s old`
        );
        return { shouldProceed: true };
      }
    }

    // Tier-4 fallback: market snapshot price (candle-derived, from shared intelligence cache).
    // If a fresh snapshot was built for this symbol within the last 30 seconds, the candle
    // pipeline has confirmed market activity and a current price is already in memory.
    // This prevents false blocks at session startup before the first realtime_prices DB write.
    if (snapshotHint && snapshotHint.price > 0) {
      const snapshotAgeSeconds = (Date.now() - snapshotHint.createdAt) / 1000;
      const MAX_SNAPSHOT_AGE_SECONDS = 30;

      if (snapshotAgeSeconds <= MAX_SNAPSHOT_AGE_SECONDS) {
        logger.info(
          LogCategory.AI_TRADING,
          `[Freshness Gate] ✅ Pre-check PASSED via snapshot hint - snapshot age: ${snapshotAgeSeconds.toFixed(1)}s, price: ${snapshotHint.price} (DB was ${freshnessResult.ageSeconds}s old)`
        );
        return { shouldProceed: true };
      }
    }

    // All four layers confirm stale/absent — genuine block
    const reason = freshnessResult.reason || 'Price data unavailable or critically stale';
    logger.error(
      LogCategory.AI_TRADING,
      `[Freshness Gate] 🚫 PRE-CHECK FAILED: ${reason} (age: ${freshnessResult.ageSeconds}s)`
    );
    return {
      shouldProceed: false,
      reason: `Price data stale: ${reason}`
    };
  }

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

    // Layer 4: Validate Price Freshness (SSOT: PriceFreshnessGate with cache fallback)
    const freshnessResult = await priceFreshnessGate.checkFreshness(context.symbol, 'execution');

    let effectiveFreshness = freshnessResult;

    if (!freshnessResult.isFresh && freshnessResult.ageSeconds !== Infinity) {
      // DB record stale - check PriceCoordinator in-memory cache as fallback
      const cachedResult = await priceCoordinator.getPrice(context.symbol, { useCacheFirst: true, allowStale: false });
      if (cachedResult.success && cachedResult.price && !cachedResult.price.isCriticallyStale) {
        effectiveFreshness = {
          isFresh: true,
          ageSeconds: cachedResult.price.ageSeconds,
          maxAgeSeconds: freshnessResult.maxAgeSeconds,
          symbol: context.symbol
        };
      }
    }

    validationResults.priceStaleness = {
      isValid: effectiveFreshness.isFresh,
      ageSeconds: effectiveFreshness.ageSeconds,
      maxAgeSeconds: effectiveFreshness.maxAgeSeconds,
      shouldBlockTrading: !effectiveFreshness.isFresh
    };

    if (!effectiveFreshness.isFresh) {
      const reason = freshnessResult.reason || 'Price data unavailable';
      blockingReasons.push(`Price Freshness: ${reason}`);

      const blockCat = freshnessResult.ageSeconds === Infinity
        ? FreshnessBlockCategory.BLOCK_NO_PRICE_DATA
        : FreshnessBlockCategory.BLOCK_STALE_PRICE_FEED;

      blockCategories.push(blockCat);
      blockMetadata.push({
        symbol: context.symbol,
        ageSeconds: freshnessResult.ageSeconds,
        maxAgeSeconds: freshnessResult.maxAgeSeconds
      });
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

    const advisory = this.generateAdvisory(context, validationResults);

    logger.info(
      LogCategory.AI_TRADING,
      `[Freshness Gate] Advisory: ${advisory.overallSeverity} - ${advisory.advisoryMessage}`
    );

    return {
      canExecute,
      blockingReasons,
      warnings,
      validationResults,
      blockCategories,
      blockMetadata,
      advisory
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
   *
   * SSOT: Uses centralized PriceFreshnessGate for batch checking
   */
  async validatePriceDataAvailability(symbols: string[]): Promise<Map<string, boolean>> {
    // SSOT: Use centralized gate for batch freshness checking
    const freshnessResults = await priceFreshnessGate.checkMultipleFreshness(symbols, 'execution');

    const availability = new Map<string, boolean>();
    for (const [symbol, result] of freshnessResults) {
      availability.set(symbol, result.isFresh);
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
