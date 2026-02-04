/**
 * PRICE COORDINATOR - Single Source of Truth
 *
 * ALL price fetching MUST go through this coordinator.
 * DO NOT query realtime_prices directly elsewhere in the codebase.
 *
 * This provides:
 * - Consistent price access patterns
 * - Built-in staleness detection
 * - Automatic fallback to candle data
 * - Caching to reduce database load
 * - Validation of price data quality
 *
 * ✅ SSOT COMPLIANT: Uses MarketDataService for candle fallback queries
 *
 * PRICE WRITE AUTHORITY:
 * - Browser polling writes immediately to database (tick-buffer-service)
 * - Server-side cron provides backup price collection
 * - Both sources write to realtime_prices table (single authority)
 * - This ensures Alpha has fresh prices for execution decisions (<30s threshold)
 */

import { supabase } from '../../lib/supabase';
import { TIME_CONSTANTS, TIME_MS, isOlderThan, getAgeInSeconds } from '../../config/time-constants';
import { marketDataService } from '../market-data-service';

interface TimeoutConfig {
  timeout_ms: number;
  retry_count: number;
  backoff_multiplier: number;
  circuit_breaker_threshold: number;
}

interface CircuitBreakerState {
  isOpen: boolean;
  failureCount: number;
  successCount: number;
  lastFailureTime: number;
}

export interface PriceData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: Date;
  ageSeconds: number;
  source: 'realtime' | 'candle' | 'cache';
  isStale: boolean;
  isCriticallyStale: boolean;
}

export interface PriceFetchOptions {
  maxAgeSeconds?: number;
  allowStale?: boolean;
  useCacheFirst?: boolean;
}

export interface PriceFetchResult {
  success: boolean;
  price: PriceData | null;
  error?: string;
  warning?: string;
}

interface CachedPrice {
  data: PriceData;
  cachedAt: number;
}

class PriceCoordinator {
  private priceCache = new Map<string, CachedPrice>();
  private readonly CACHE_TTL_MS = TIME_MS.CACHE.SHORT;
  private readonly DEFAULT_MAX_AGE_SECONDS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL;
  private timeoutConfig: TimeoutConfig | null = null;
  private circuitBreaker: CircuitBreakerState = {
    isOpen: false,
    failureCount: 0,
    successCount: 0,
    lastFailureTime: 0,
  };
  private configLoadedAt: number = 0;
  private readonly CONFIG_CACHE_DURATION = 60_000; // Cache config for 1 minute

  constructor() {
    this.initializeConfig();
  }

  private async initializeConfig(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('timeout_governance_config')
        .select('timeout_ms, retry_count, backoff_multiplier, circuit_breaker_threshold')
        .eq('service', 'price-coordinator')
        .maybeSingle();

      if (!error && data) {
        this.timeoutConfig = data as TimeoutConfig;
        this.configLoadedAt = Date.now();
      } else {
        // Fallback to hardcoded config from time-constants
        this.timeoutConfig = TIME_MS.SERVICE_TIMEOUTS?.PRICE_COORDINATOR || {
          timeout_ms: 10_000,
          retry_count: 3,
          backoff_multiplier: 1.5,
          circuit_breaker_threshold: 0.05,
        };
      }
    } catch (error) {
      // Silent fallback if config loading fails
      this.timeoutConfig = TIME_MS.SERVICE_TIMEOUTS?.PRICE_COORDINATOR || {
        timeout_ms: 10_000,
        retry_count: 3,
        backoff_multiplier: 1.5,
        circuit_breaker_threshold: 0.05,
      };
    }
  }

  private async getTimeoutConfig(): Promise<TimeoutConfig> {
    if (!this.timeoutConfig) {
      await this.initializeConfig();
    }

    // Refresh config if cache expired
    if (Date.now() - this.configLoadedAt > this.CONFIG_CACHE_DURATION) {
      await this.initializeConfig();
    }

    return this.timeoutConfig!;
  }

  private async executeWithTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    retryCount: number,
    backoffMultiplier: number
  ): Promise<T> {
    let lastError: Error | null = null;
    let backoffMs = 1_000; // Start with 1 second

    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const result = await Promise.race([
            operation(),
            new Promise<never>((_, reject) => {
              if (controller.signal.aborted) {
                reject(new Error('Timeout'));
              }
              controller.signal.addEventListener('abort', () => {
                reject(new Error(`Query timeout after ${timeoutMs}ms`));
              });
            }),
          ]);
          clearTimeout(timeoutHandle);

          // Success - reset circuit breaker
          this.circuitBreaker.successCount++;
          if (this.circuitBreaker.successCount > 5) {
            this.circuitBreaker.isOpen = false;
            this.circuitBreaker.failureCount = 0;
          }

          return result;
        } finally {
          clearTimeout(timeoutHandle);
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Log timeout event to governance system
        await this.logTimeoutEvent(timeoutMs, attempt, 'query_timeout');

        // Update circuit breaker state
        this.circuitBreaker.failureCount++;
        this.circuitBreaker.lastFailureTime = Date.now();

        // Exponential backoff for retries
        if (attempt < retryCount) {
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          backoffMs = Math.floor(backoffMs * backoffMultiplier);
        }
      }
    }

    throw lastError || new Error('Query failed after all retries');
  }

  private async logTimeoutEvent(timeoutMs: number, retryAttempt: number, reason: string): Promise<void> {
    try {
      await supabase.rpc('log_timeout_event', {
        p_service: 'price-coordinator',
        p_timeout_ms: timeoutMs,
        p_retry_count: retryAttempt,
        p_reason: reason,
      });
    } catch {
      // Silent fail - don't block price fetching on logging errors
    }
  }

  async getPrice(symbol: string, options: PriceFetchOptions = {}): Promise<PriceFetchResult> {
    const {
      maxAgeSeconds = this.DEFAULT_MAX_AGE_SECONDS,
      allowStale = true,
      useCacheFirst = true,
    } = options;

    if (useCacheFirst) {
      const cached = this.getCachedPrice(symbol);
      if (cached && !cached.isStale) {
        return { success: true, price: cached };
      }
    }

    const realtimeResult = await this.fetchRealtimePrice(symbol);

    if (realtimeResult.success && realtimeResult.price) {
      const price = realtimeResult.price;

      price.isStale = price.ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING;
      price.isCriticallyStale = price.ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL;

      if (!price.isCriticallyStale || allowStale) {
        this.setCachedPrice(symbol, price);
        return { success: true, price };
      }
    }

    const candleResult = await this.fetchCandlePrice(symbol);

    if (candleResult.success && candleResult.price) {
      const price = candleResult.price;
      price.source = 'candle';
      price.isStale = true;
      price.isCriticallyStale = price.ageSeconds > maxAgeSeconds;

      if (allowStale || !price.isCriticallyStale) {
        return {
          success: true,
          price,
          warning: 'Using candle data as fallback',
        };
      }
    }

    const cached = this.getCachedPrice(symbol);
    if (cached && allowStale) {
      return {
        success: true,
        price: { ...cached, isStale: true, isCriticallyStale: true },
        warning: 'Using stale cached data',
      };
    }

    return {
      success: false,
      price: null,
      error: `No price data available for ${symbol}`,
    };
  }

  async getPrices(symbols: string[], options: PriceFetchOptions = {}): Promise<Map<string, PriceFetchResult>> {
    const results = new Map<string, PriceFetchResult>();

    const { data: prices, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, broker_time, created_at')
      .in('symbol', symbols)
      .order('broker_time', { ascending: false });

    if (error) {
      for (const symbol of symbols) {
        results.set(symbol, await this.getPrice(symbol, options));
      }
      return results;
    }

    const latestPrices = new Map<string, typeof prices[0]>();
    for (const price of prices || []) {
      if (!latestPrices.has(price.symbol)) {
        latestPrices.set(price.symbol, price);
      }
    }

    for (const symbol of symbols) {
      const priceRow = latestPrices.get(symbol);

      if (priceRow) {
        const timestamp = new Date(priceRow.broker_time || priceRow.created_at);
        const ageSeconds = getAgeInSeconds(timestamp);

        // ABSOLUTE MAX CHECK: Reject prices older than 10 minutes
        if (ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_ABSOLUTE_MAX) {
          results.set(symbol, await this.getPrice(symbol, options));
          continue;
        }

        const mid = (priceRow.bid + priceRow.ask) / 2;
        const spread = priceRow.ask - priceRow.bid;

        const priceData: PriceData = {
          symbol,
          bid: priceRow.bid,
          ask: priceRow.ask,
          mid,
          spread,
          timestamp,
          ageSeconds,
          source: 'realtime',
          isStale: ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING,
          isCriticallyStale: ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,
        };

        this.setCachedPrice(symbol, priceData);
        results.set(symbol, { success: true, price: priceData });
      } else {
        results.set(symbol, await this.getPrice(symbol, options));
      }
    }

    return results;
  }

  private async fetchRealtimePrice(symbol: string): Promise<PriceFetchResult> {
    try {
      const config = await this.getTimeoutConfig();

      // Check circuit breaker - if open, skip to fallback immediately
      if (this.circuitBreaker.isOpen) {
        // Try to recover after 30 seconds of no failures
        if (Date.now() - this.circuitBreaker.lastFailureTime > 30_000) {
          this.circuitBreaker.isOpen = false;
          this.circuitBreaker.failureCount = 0;
        } else {
          return {
            success: false,
            price: null,
            error: 'Circuit breaker open - falling back to candle data',
          };
        }
      }

      const data = await this.executeWithTimeout(
        async () => {
          const { data: result, error } = await supabase
            .from('realtime_prices')
            .select('symbol, bid, ask, broker_time, created_at')
            .eq('symbol', symbol)
            .order('broker_time', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) throw new Error(error.message);
          return result;
        },
        config.timeout_ms,
        config.retry_count,
        config.backoff_multiplier
      );

      if (!data) {
        return {
          success: false,
          price: null,
          error: 'No realtime price found',
        };
      }

      const timestamp = new Date(data.broker_time || data.created_at);
      const ageSeconds = getAgeInSeconds(timestamp);

      // ABSOLUTE MAX CHECK: Reject prices older than 10 minutes
      // This prevents serving extremely stale data (e.g., 52-hour old prices)
      if (ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_ABSOLUTE_MAX) {
        return {
          success: false,
          price: null,
          error: `Price data too old: ${ageSeconds}s (max: ${TIME_CONSTANTS.SECONDS.PRICE_STALENESS_ABSOLUTE_MAX}s)`,
        };
      }

      const mid = (data.bid + data.ask) / 2;
      const spread = data.ask - data.bid;

      return {
        success: true,
        price: {
          symbol,
          bid: data.bid,
          ask: data.ask,
          mid,
          spread,
          timestamp,
          ageSeconds,
          source: 'realtime',
          isStale: false,
          isCriticallyStale: false,
        },
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';

      // Activate circuit breaker on repeated timeouts
      if (errorMsg.includes('timeout') || errorMsg.includes('Timeout')) {
        if (this.circuitBreaker.failureCount > 3) {
          this.circuitBreaker.isOpen = true;
        }
      }

      return {
        success: false,
        price: null,
        error: errorMsg,
      };
    }
  }

  /**
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  private async fetchCandlePrice(symbol: string): Promise<PriceFetchResult> {
    try {
      const candle = await marketDataService.getLastCandle(symbol, 'M5');

      if (!candle) {
        return {
          success: false,
          price: null,
          error: 'No candle data found',
        };
      }

      const timestamp = new Date(candle.open_time);
      const ageSeconds = getAgeInSeconds(timestamp);

      const estimatedSpread = (candle.high - candle.low) * 0.1;
      const mid = candle.close;
      const bid = mid - estimatedSpread / 2;
      const ask = mid + estimatedSpread / 2;

      return {
        success: true,
        price: {
          symbol,
          bid,
          ask,
          mid,
          spread: estimatedSpread,
          timestamp,
          ageSeconds,
          source: 'candle',
          isStale: true,
          isCriticallyStale: ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,
        },
      };
    } catch (error) {
      return {
        success: false,
        price: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private getCachedPrice(symbol: string): PriceData | null {
    const cached = this.priceCache.get(symbol);
    if (!cached) return null;

    if (Date.now() - cached.cachedAt > this.CACHE_TTL_MS) {
      this.priceCache.delete(symbol);
      return null;
    }

    const ageSeconds = getAgeInSeconds(cached.data.timestamp);

    // ABSOLUTE MAX CHECK: Reject cached prices older than 10 minutes
    if (ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_ABSOLUTE_MAX) {
      this.priceCache.delete(symbol);
      return null;
    }

    return {
      ...cached.data,
      ageSeconds,
      source: 'cache',
      isStale: ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING,
      isCriticallyStale: ageSeconds > TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL,
    };
  }

  private setCachedPrice(symbol: string, price: PriceData): void {
    this.priceCache.set(symbol, {
      data: price,
      cachedAt: Date.now(),
    });
  }

  clearCache(): void {
    this.priceCache.clear();
  }

  clearCacheForSymbol(symbol: string): void {
    this.priceCache.delete(symbol);
  }

  async validatePriceFreshness(symbol: string): Promise<{
    isValid: boolean;
    ageSeconds: number;
    shouldBlockTrading: boolean;
    warning?: string;
  }> {
    const result = await this.getPrice(symbol, { useCacheFirst: false });

    if (!result.success || !result.price) {
      return {
        isValid: false,
        ageSeconds: Infinity,
        shouldBlockTrading: true,
        warning: 'No price data available',
      };
    }

    const { ageSeconds, isStale, isCriticallyStale } = result.price;

    return {
      isValid: !isCriticallyStale,
      ageSeconds,
      shouldBlockTrading: isCriticallyStale,
      warning: isStale ? `Price data is ${ageSeconds}s old` : undefined,
    };
  }

  /**
   * SSOT: Extract execution price from PriceData object
   *
   * This centralizes the logic for selecting the correct price to use for trade execution.
   * - BUY orders use ASK (what you pay to enter long)
   * - SELL orders use BID (what you receive to enter short)
   *
   * GOVERNANCE: Validates the extracted price and throws if invalid
   * CCIP: Call site logs any failures for audit trail
   */
  extractExecutionPrice(priceData: PriceData, direction: 'buy' | 'sell'): number {
    // Use directional price (ask for buys, bid for sells)
    const executionPrice = direction === 'buy' ? priceData.ask : priceData.bid;

    // GOVERNANCE: Validate extracted price is a valid number
    if (!Number.isFinite(executionPrice)) {
      throw new Error(
        `[PriceCoordinator] Invalid execution price for ${direction} on ${priceData.symbol}: ${executionPrice} (source: ${priceData.source})`
      );
    }

    return executionPrice;
  }
}

export const priceCoordinator = new PriceCoordinator();
