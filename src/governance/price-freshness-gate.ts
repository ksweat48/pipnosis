/**
 * PRICE FRESHNESS GATE - SSOT Authority
 *
 * PURPOSE: Single source of truth for price data freshness validation
 *
 * ARCHITECTURAL ROLE:
 * - SOLE authority for determining if price data is fresh enough
 * - All services MUST call this gate, never implement their own checks
 * - Consistent thresholds across entire system
 *
 * REPLACES:
 * - Duplicate freshness checks in goal-session-live-engine
 * - Duplicate checks in entry-execution-coordinator
 * - Duplicate checks in trade-execution-engine
 * - intelligence-freshness-validator (will be refactored to use this)
 *
 * @module PriceFreshnessGate
 */

import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';
import { TIME_CONSTANTS, getAgeInSeconds } from '../config/time-constants';

export interface PriceFreshnessResult {
  isFresh: boolean;
  ageSeconds: number;
  maxAgeSeconds: number;
  reason?: string;
  lastUpdate?: Date;
  symbol: string;
}

/**
 * Price data interface - SSOT compliant
 * Uses canonical database columns (mid, not price alias)
 */
export interface PriceData {
  symbol: string;
  mid: number;  // SSOT: Use 'mid' column (not 'price')
  timestamp: Date | string;
  source?: string;
}

/**
 * Freshness Thresholds - SSOT Configuration
 * Uses TIME_CONSTANTS as the single source of truth
 */
export const FRESHNESS_THRESHOLDS = {
  // Default maximum age for price data
  DEFAULT_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,

  // Critical threshold - beyond this, always block
  CRITICAL_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_BLOCK_TRADING,

  // Trading execution requires fresher data
  EXECUTION_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING,

  // Analysis/scanning can use slightly older data
  ANALYSIS_MAX_AGE_SECONDS: 90,

  // Forex markets - during active hours
  FOREX_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,

  // Indices - during market hours
  INDEX_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,

  // Absolute maximum - reject anything older
  ABSOLUTE_MAX_AGE_SECONDS: TIME_CONSTANTS.SECONDS.PRICE_STALENESS_ABSOLUTE_MAX
} as const;

export type FreshnessContext = 'execution' | 'analysis' | 'monitoring' | 'display';

class PriceFreshnessGate {
  /**
   * Check if price data is fresh enough for a given context
   * SSOT: THE ONLY method that determines price freshness
   *
   * @param symbol Trading symbol
   * @param context What the price will be used for
   * @returns Freshness result with details
   */
  async checkFreshness(
    symbol: string,
    context: FreshnessContext = 'execution'
  ): Promise<PriceFreshnessResult> {
    try {
      // Get latest price from database (SSOT: use canonical columns)
      const { data: priceData, error } = await supabase
        .from('realtime_prices')
        .select('symbol, mid, created_at')
        .eq('symbol', symbol.toUpperCase())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error('[Price Freshness Gate] Database error', { symbol, error });
        return {
          isFresh: false,
          ageSeconds: Infinity,
          maxAgeSeconds: this.getMaxAgeForContext(context, symbol),
          reason: 'Database error fetching price',
          symbol
        };
      }

      if (!priceData) {
        logger.warn('[Price Freshness Gate] No price data available', { symbol });
        return {
          isFresh: false,
          ageSeconds: Infinity,
          maxAgeSeconds: this.getMaxAgeForContext(context, symbol),
          reason: 'No price data available',
          symbol
        };
      }

      // Calculate age (SSOT: use canonical created_at column + time-constants helper)
      const lastUpdate = new Date(priceData.created_at);
      const ageSeconds = getAgeInSeconds(lastUpdate);
      const maxAgeSeconds = this.getMaxAgeForContext(context, symbol);

      // Determine if fresh
      const isFresh = ageSeconds <= maxAgeSeconds;

      if (!isFresh) {
        logger.warn('[Price Freshness Gate] Stale price detected', {
          symbol,
          ageSeconds: ageSeconds.toFixed(1),
          maxAgeSeconds,
          context,
          lastUpdate: lastUpdate.toISOString()
        });
      }

      return {
        isFresh,
        ageSeconds,
        maxAgeSeconds,
        lastUpdate,
        symbol,
        reason: isFresh ? undefined : `Price data is ${ageSeconds.toFixed(0)}s old (max: ${maxAgeSeconds}s)`
      };
    } catch (err) {
      logger.error('[Price Freshness Gate] Unexpected error', { symbol, error: err });
      return {
        isFresh: false,
        ageSeconds: Infinity,
        maxAgeSeconds: this.getMaxAgeForContext(context, symbol),
        reason: 'Unexpected error checking freshness',
        symbol
      };
    }
  }

  /**
   * Check freshness for multiple symbols at once
   * Efficient batch checking
   */
  async checkMultipleFreshness(
    symbols: string[],
    context: FreshnessContext = 'analysis'
  ): Promise<Map<string, PriceFreshnessResult>> {
    const results = new Map<string, PriceFreshnessResult>();

    // Fetch all prices in one query (SSOT: use canonical columns)
    const { data: pricesData, error } = await supabase
      .from('realtime_prices')
      .select('symbol, mid, created_at')
      .in('symbol', symbols.map(s => s.toUpperCase()))
      .order('created_at', { ascending: false });

    if (error) {
      logger.error('[Price Freshness Gate] Batch fetch error', { symbols, error });
      // Return all as stale
      symbols.forEach(symbol => {
        results.set(symbol, {
          isFresh: false,
          ageSeconds: Infinity,
          maxAgeSeconds: this.getMaxAgeForContext(context, symbol),
          reason: 'Database error',
          symbol
        });
      });
      return results;
    }

    // Process each symbol
    const priceMap = new Map(pricesData?.map(p => [p.symbol, p]) || []);

    symbols.forEach(symbol => {
      const normalizedSymbol = symbol.toUpperCase();
      const priceData = priceMap.get(normalizedSymbol);

      if (!priceData) {
        results.set(symbol, {
          isFresh: false,
          ageSeconds: Infinity,
          maxAgeSeconds: this.getMaxAgeForContext(context, symbol),
          reason: 'No price data available',
          symbol
        });
        return;
      }

      // SSOT: use canonical created_at column + time-constants helper
      const lastUpdate = new Date(priceData.created_at);
      const ageSeconds = getAgeInSeconds(lastUpdate);
      const maxAgeSeconds = this.getMaxAgeForContext(context, symbol);
      const isFresh = ageSeconds <= maxAgeSeconds;

      results.set(symbol, {
        isFresh,
        ageSeconds,
        maxAgeSeconds,
        lastUpdate,
        symbol,
        reason: isFresh ? undefined : `Price ${ageSeconds.toFixed(0)}s old`
      });
    });

    return results;
  }

  /**
   * Check if a timestamp is fresh enough (no database query)
   * Useful when caller already has timestamp
   *
   * @param timestamp The price timestamp to check
   * @param context What the price will be used for
   * @param symbol Optional symbol for symbol-specific thresholds
   */
  isTimestampFresh(
    timestamp: Date | string,
    context: FreshnessContext = 'execution',
    symbol: string = 'UNKNOWN'
  ): boolean {
    const timestampDate = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const ageSeconds = getAgeInSeconds(timestampDate);
    const maxAgeSeconds = this.getMaxAgeForContext(context, symbol);
    return ageSeconds <= maxAgeSeconds;
  }

  /**
   * Get age and max age for a timestamp (no database query)
   * Returns details without boolean result
   */
  getTimestampAge(
    timestamp: Date | string,
    context: FreshnessContext = 'execution',
    symbol: string = 'UNKNOWN'
  ): { ageSeconds: number; maxAgeSeconds: number; isFresh: boolean } {
    const timestampDate = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
    const ageSeconds = getAgeInSeconds(timestampDate);
    const maxAgeSeconds = this.getMaxAgeForContext(context, symbol);
    return {
      ageSeconds,
      maxAgeSeconds,
      isFresh: ageSeconds <= maxAgeSeconds
    };
  }

  /**
   * Validate price data object for freshness
   * Used when price is provided directly (not from DB)
   */
  validatePriceData(priceData: PriceData, context: FreshnessContext = 'execution'): PriceFreshnessResult {
    const timestamp = typeof priceData.timestamp === 'string'
      ? new Date(priceData.timestamp)
      : priceData.timestamp;

    const ageSeconds = getAgeInSeconds(timestamp);
    const maxAgeSeconds = this.getMaxAgeForContext(context, priceData.symbol);
    const isFresh = ageSeconds <= maxAgeSeconds;

    return {
      isFresh,
      ageSeconds,
      maxAgeSeconds,
      lastUpdate: timestamp,
      symbol: priceData.symbol,
      reason: isFresh ? undefined : `Price ${ageSeconds.toFixed(0)}s old (max: ${maxAgeSeconds}s)`
    };
  }

  /**
   * Get maximum allowed age for a context and symbol
   * SSOT: Threshold determination logic
   */
  private getMaxAgeForContext(context: FreshnessContext, symbol: string): number {
    const normalizedSymbol = symbol.toUpperCase();

    // Context-specific overrides
    switch (context) {
      case 'execution':
        return FRESHNESS_THRESHOLDS.EXECUTION_MAX_AGE_SECONDS;

      case 'analysis':
        return FRESHNESS_THRESHOLDS.ANALYSIS_MAX_AGE_SECONDS;

      case 'monitoring':
      case 'display':
        // Symbol-specific thresholds for monitoring/display
        if (this.isIndex(normalizedSymbol)) {
          return FRESHNESS_THRESHOLDS.INDEX_MAX_AGE_SECONDS;
        }
        return FRESHNESS_THRESHOLDS.FOREX_MAX_AGE_SECONDS;

      default:
        return FRESHNESS_THRESHOLDS.DEFAULT_MAX_AGE_SECONDS;
    }
  }

  /**
   * Helper: Check if symbol is index
   */
  private isIndex(symbol: string): boolean {
    return symbol.includes('US30') ||
           symbol.includes('NAS') ||
           symbol.includes('SPX') ||
           symbol.includes('DJI');
  }

  /**
   * Block execution if price is stale
   * Throws error with clear message if not fresh
   */
  async requireFreshPrice(
    symbol: string,
    context: FreshnessContext = 'execution'
  ): Promise<void> {
    const result = await this.checkFreshness(symbol, context);

    if (!result.isFresh) {
      const error = new Error(
        `[Price Freshness Gate] Stale price data: ${result.reason}`
      );
      (error as any).freshnessResult = result;
      throw error;
    }
  }

  /**
   * Get current freshness status for logging/debugging
   */
  async getStatus(symbol: string): Promise<string> {
    const result = await this.checkFreshness(symbol, 'display');

    if (result.isFresh) {
      return `✅ Fresh (${result.ageSeconds.toFixed(1)}s old)`;
    } else {
      return `❌ Stale (${result.ageSeconds.toFixed(1)}s old, max: ${result.maxAgeSeconds}s)`;
    }
  }
}

// Export singleton instance
export const priceFreshnessGate = new PriceFreshnessGate();

// Export class for testing
export { PriceFreshnessGate };
