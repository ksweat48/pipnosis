/**
 * Market Data Service - SINGLE SOURCE OF TRUTH
 *
 * Central authority for:
 * - Current prices (with freshness validation)
 * - Candle data (normalized from forex_candles)
 * - Market conditions (VWAP, ATR, volume)
 * - Pip distance calculations
 *
 * All price and candle fetching MUST go through this service.
 */

import { supabase } from '../lib/supabase';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { logger } from '../lib/logger';

export interface PriceData {
  price: number;
  bid: number;
  ask: number;
  timestamp: Date;
  freshness: 'fresh' | 'stale' | 'invalid';
}

export interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  open_time: string;
}

export interface MarketConditions {
  vwap: number;
  atr: number;
  avgVolume: number;
  candles: CandleData[];
}

export interface CandleStats {
  totalCandles: number;
  oldestCandle: Date | null;
  newestCandle: Date | null;
  averageInterval: number | null;
  gapCount?: number;
}

export interface Gap {
  expectedTime: Date;
  actualNextTime: Date;
  gapDurationMs: number;
}

const FRESH_THRESHOLD_MS = 10000; // 10 seconds
const STALE_THRESHOLD_MS = 30000; // 30 seconds

export class MarketDataService {
  private static instance: MarketDataService;

  private constructor() {}

  static getInstance(): MarketDataService {
    if (!MarketDataService.instance) {
      MarketDataService.instance = new MarketDataService();
    }
    return MarketDataService.instance;
  }

  /**
   * Get current price with freshness validation
   */
  async getCurrentPrice(symbol: string): Promise<PriceData | null> {
    try {
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('bid, ask, created_at')
        .eq('symbol', symbol)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        logger.warn(`[MarketData] No price data for ${symbol}`);
        return null;
      }

      const timestamp = new Date(data.created_at);
      const age = Date.now() - timestamp.getTime();

      let freshness: 'fresh' | 'stale' | 'invalid';
      if (age < FRESH_THRESHOLD_MS) {
        freshness = 'fresh';
      } else if (age < STALE_THRESHOLD_MS) {
        freshness = 'stale';
        logger.debug(`[MarketData] Stale price for ${symbol}: ${(age / 1000).toFixed(0)}s old`);
      } else {
        freshness = 'invalid';
        logger.warn(`[MarketData] Invalid price age for ${symbol}: ${(age / 1000).toFixed(0)}s old`);
        return null;
      }

      return {
        price: (data.bid + data.ask) / 2,
        bid: data.bid,
        ask: data.ask,
        timestamp,
        freshness
      };
    } catch (error) {
      logger.error('[MarketData] Error fetching price:', error);
      return null;
    }
  }

  /**
   * Get recent candles from forex_candles (SSOT for candles)
   * CCIP COMPLIANCE: Comprehensive diagnostic logging
   * SSOT COMPLIANCE: Single authority for candle data retrieval
   */
  async getCandles(symbol: string, timeframe: string, limit: number = 10): Promise<CandleData[]> {
    try {
      const normalizedTimeframe = normalizeTimeframeToDb(timeframe);

      logger.debug(`[MarketData] Fetching candles from forex_candles`, {
        symbol,
        requestedTimeframe: timeframe,
        normalizedTimeframe,
        limit,
        table: 'forex_candles'
      });

      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizedTimeframe)
        .order('open_time', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('[MarketData] Database error fetching candles', {
          symbol,
          timeframe: normalizedTimeframe,
          error: error.message,
          errorCode: error.code,
          errorDetails: error.details
        });
        return [];
      }

      if (!data || data.length === 0) {
        logger.warn(`[MarketData] No candle data found`, {
          symbol,
          timeframe: normalizedTimeframe,
          requestedLimit: limit,
          note: 'Database returned empty result. Check if symbol/timeframe combination exists in forex_candles table.'
        });
        return [];
      }

      logger.debug(`[MarketData] Candles fetched successfully`, {
        symbol,
        timeframe: normalizedTimeframe,
        candlesReturned: data.length,
        requestedLimit: limit,
        oldestCandle: data[data.length - 1]?.open_time,
        newestCandle: data[0]?.open_time
      });

      return data as CandleData[];
    } catch (error) {
      logger.error('[MarketData] Unexpected error fetching candles:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        symbol,
        timeframe
      });
      return [];
    }
  }

  /**
   * Get market conditions (VWAP, ATR, volume)
   */
  async getMarketConditions(symbol: string, timeframe: string = '15m'): Promise<MarketConditions | null> {
    try {
      const candles = await this.getCandles(symbol, timeframe, 20);

      if (candles.length === 0) {
        return null;
      }

      const vwap = this.calculateVWAP(candles);
      const atr = this.calculateATR(candles);
      const avgVolume = candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;

      return {
        vwap,
        atr,
        avgVolume,
        candles
      };
    } catch (error) {
      logger.error('[MarketData] Error fetching market conditions:', error);
      return null;
    }
  }

  /**
   * Calculate pip distance between two prices
   * ✅ SSOT FIX: Delegate to currencyHelpers instead of local implementation
   */
  async calculatePipDistance(symbol: string, price1: number, price2: number): Promise<number> {
    const { calculatePipDistance } = await import('../utils/currencyHelpers');
    return calculatePipDistance(symbol, price1, price2);
  }

  // ❌ REMOVED: getPipMultiplier() - replaced with SSOT getCurrencyPipInfo()
  // All pip calculations must go through currencyHelpers.ts

  /**
   * Get the most recent candle for a symbol/timeframe
   * @param symbol - Trading symbol (e.g., "EURUSD")
   * @param timeframe - Timeframe (e.g., "5m", "15m", "1h")
   * @returns Latest candle or null if not found
   */
  async getLastCandle(symbol: string, timeframe: string): Promise<CandleData | null> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data as CandleData;
    } catch (error) {
      logger.error('[MarketData] Error fetching last candle:', error);
      return null;
    }
  }

  /**
   * Count candles with optional filters
   * @param symbol - Optional symbol filter
   * @param timeframe - Optional timeframe filter
   * @param startTime - Optional start time filter
   * @param endTime - Optional end time filter
   * @returns Number of candles matching filters
   */
  async getCandleCount(
    symbol?: string,
    timeframe?: string,
    startTime?: Date,
    endTime?: Date
  ): Promise<number> {
    try {
      let query = supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true });

      if (symbol) {
        query = query.eq('symbol', symbol);
      }
      if (timeframe) {
        query = query.eq('timeframe', normalizeTimeframeToDb(timeframe));
      }
      if (startTime) {
        query = query.gte('open_time', startTime.toISOString());
      }
      if (endTime) {
        query = query.lte('open_time', endTime.toISOString());
      }

      const { count, error } = await query;

      if (error) {
        throw error;
      }

      return count || 0;
    } catch (error) {
      logger.error('[MarketData] Error counting candles:', error);
      return 0;
    }
  }

  /**
   * Get candles within a time range
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param startTime - Start of range
   * @param endTime - End of range
   * @param orderAsc - Order ascending (default: false)
   * @returns Array of candles in range
   */
  async getCandlesInRange(
    symbol: string,
    timeframe: string,
    startTime: Date,
    endTime: Date,
    orderAsc: boolean = false
  ): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .gte('open_time', startTime.toISOString())
        .lte('open_time', endTime.toISOString())
        .order('open_time', { ascending: orderAsc });

      if (error || !data) {
        logger.warn(`[MarketData] No candles in range for ${symbol} ${timeframe}`);
        return [];
      }

      return data as CandleData[];
    } catch (error) {
      logger.error('[MarketData] Error fetching candles in range:', error);
      return [];
    }
  }

  /**
   * Efficiently fetch candles for multiple symbols
   * @param symbols - Array of symbols
   * @param timeframe - Timeframe
   * @param limit - Number of candles per symbol
   * @returns Map of symbol to candles
   */
  async getBulkCandles(
    symbols: string[],
    timeframe: string,
    limit: number = 10
  ): Promise<Map<string, CandleData[]>> {
    const result = new Map<string, CandleData[]>();

    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .in('symbol', symbols)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .order('open_time', { ascending: false })
        .limit(limit * symbols.length);

      if (error || !data) {
        logger.warn(`[MarketData] No bulk candle data for timeframe ${timeframe}`);
        return result;
      }

      // Group candles by symbol
      const grouped = data.reduce((acc, candle) => {
        const symbol = (candle as any).symbol;
        if (!acc.has(symbol)) {
          acc.set(symbol, []);
        }
        acc.get(symbol)!.push(candle as CandleData);
        return acc;
      }, new Map<string, CandleData[]>());

      // Limit each symbol to the requested limit
      for (const [symbol, candles] of grouped) {
        result.set(symbol, candles.slice(0, limit));
      }

      return result;
    } catch (error) {
      logger.error('[MarketData] Error fetching bulk candles:', error);
      return result;
    }
  }

  /**
   * Get aggregate statistics for candles
   * @param symbol - Optional symbol filter
   * @param timeframe - Optional timeframe filter
   * @returns Statistics about candles
   */
  async getCandleStatistics(
    symbol?: string,
    timeframe?: string
  ): Promise<CandleStats> {
    try {
      let query = supabase
        .from('forex_candles')
        .select('open_time')
        .order('open_time', { ascending: true });

      if (symbol) {
        query = query.eq('symbol', symbol);
      }
      if (timeframe) {
        query = query.eq('timeframe', normalizeTimeframeToDb(timeframe));
      }

      const { data, error } = await query;

      if (error || !data || data.length === 0) {
        return {
          totalCandles: 0,
          oldestCandle: null,
          newestCandle: null,
          averageInterval: null
        };
      }

      const oldestCandle = new Date(data[0].open_time);
      const newestCandle = new Date(data[data.length - 1].open_time);

      // Calculate average interval from sample
      let averageInterval: number | null = null;
      if (data.length > 1) {
        const sampleSize = Math.min(data.length - 1, 100);
        let totalInterval = 0;
        for (let i = 0; i < sampleSize; i++) {
          const current = new Date(data[i].open_time);
          const next = new Date(data[i + 1].open_time);
          totalInterval += next.getTime() - current.getTime();
        }
        averageInterval = totalInterval / sampleSize;
      }

      return {
        totalCandles: data.length,
        oldestCandle,
        newestCandle,
        averageInterval
      };
    } catch (error) {
      logger.error('[MarketData] Error fetching candle statistics:', error);
      return {
        totalCandles: 0,
        oldestCandle: null,
        newestCandle: null,
        averageInterval: null
      };
    }
  }

  /**
   * Detect gaps in candle sequence
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param startTime - Start of range
   * @param endTime - End of range
   * @param expectedIntervalMinutes - Expected interval between candles
   * @returns Array of detected gaps
   */
  async detectGaps(
    symbol: string,
    timeframe: string,
    startTime: Date,
    endTime: Date,
    expectedIntervalMinutes: number
  ): Promise<Gap[]> {
    try {
      const candles = await this.getCandlesInRange(symbol, timeframe, startTime, endTime, true);

      if (candles.length === 0) {
        return [];
      }

      const gaps: Gap[] = [];
      const expectedIntervalMs = expectedIntervalMinutes * 60 * 1000;
      const gapThresholdMs = expectedIntervalMs * 1.5; // Allow 50% tolerance

      for (let i = 0; i < candles.length - 1; i++) {
        const currentTime = new Date(candles[i].open_time);
        const nextTime = new Date(candles[i + 1].open_time);
        const actualInterval = nextTime.getTime() - currentTime.getTime();

        if (actualInterval > gapThresholdMs) {
          const expectedTime = new Date(currentTime.getTime() + expectedIntervalMs);
          gaps.push({
            expectedTime,
            actualNextTime: nextTime,
            gapDurationMs: actualInterval - expectedIntervalMs
          });
        }
      }

      return gaps;
    } catch (error) {
      logger.error('[MarketData] Error detecting gaps:', error);
      return [];
    }
  }

  /**
   * Get quality-filtered candles within a time range
   * Uses forex_candles_best view for automatic data source prioritization
   * and flat candle filtering.
   *
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param startTime - Start of range
   * @param endTime - End of range
   * @param orderAsc - Order ascending (default: false)
   * @param limit - Optional limit on results
   * @returns Array of quality-filtered candles in range
   */
  async getQualityCandlesInRange(
    symbol: string,
    timeframe: string,
    startTime: Date,
    endTime: Date,
    orderAsc: boolean = false,
    limit?: number
  ): Promise<CandleData[]> {
    try {
      let query = supabase
        .from('forex_candles_best')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .gte('open_time', startTime.toISOString())
        .lte('open_time', endTime.toISOString())
        .order('open_time', { ascending: orderAsc });

      if (limit) {
        query = query.limit(limit);
      }

      const { data, error } = await query;

      if (error || !data) {
        logger.warn(`[MarketData] No quality candles in range for ${symbol} ${timeframe}`);
        return [];
      }

      return data as CandleData[];
    } catch (error) {
      logger.error('[MarketData] Error fetching quality candles in range:', error);
      return [];
    }
  }

  /**
   * Get the most recent candle across all symbols
   * Used for system health checks (e.g., emergency poller mode determination)
   * @returns Latest candle from any symbol, or null if no data exists
   */
  async getLatestCandleAnySymbol(): Promise<{ open_time: string; symbol: string } | null> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('open_time, symbol')
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return data as { open_time: string; symbol: string };
    } catch (error) {
      logger.error('[MarketData] Error fetching latest candle across all symbols:', error);
      return null;
    }
  }

  /**
   * Calculate VWAP from candles
   */
  private calculateVWAP(candles: CandleData[]): number {
    let sumPV = 0;
    let sumV = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      sumPV += typical * candle.volume;
      sumV += candle.volume;
    }

    return sumV > 0 ? sumPV / sumV : 0;
  }

  /**
   * Calculate ATR from candles
   */
  private calculateATR(candles: CandleData[]): number {
    if (candles.length < 2) return 0;

    const trs: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );
      trs.push(tr);
    }

    return trs.reduce((a, b) => a + b, 0) / trs.length;
  }
}

export const marketDataService = MarketDataService.getInstance();
