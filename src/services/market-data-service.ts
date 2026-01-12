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
   */
  async getCandles(symbol: string, timeframe: string, limit: number = 10): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .order('open_time', { ascending: false })
        .limit(limit);

      if (error || !data) {
        logger.warn(`[MarketData] No candle data for ${symbol} ${timeframe}`);
        return [];
      }

      return data as CandleData[];
    } catch (error) {
      logger.error('[MarketData] Error fetching candles:', error);
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
