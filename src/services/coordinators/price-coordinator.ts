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
 */

import { supabase } from '../../lib/supabase';
import { TIME_CONSTANTS, TIME_MS, isOlderThan, getAgeInSeconds } from '../../config/time-constants';
import { marketDataService } from '../market-data-service';

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
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('symbol, bid, ask, broker_time, created_at')
        .eq('symbol', symbol)
        .order('broker_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return {
          success: false,
          price: null,
          error: error?.message || 'No realtime price found',
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
      return {
        success: false,
        price: null,
        error: error instanceof Error ? error.message : 'Unknown error',
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
}

export const priceCoordinator = new PriceCoordinator();
