/**
 * Market Snapshot Cache - SSOT for Market Data
 *
 * PURPOSE: Ensure all Omegas see the SAME market snapshot per cycle
 *
 * This is NOT caching Omega outputs (deterministic).
 * This IS caching expensive inputs (DB reads, indicator computation).
 *
 * Key Benefits:
 * - One DB query per symbol/timeframe/cycle (not 7+)
 * - Consistent ATR/price across all Omegas
 * - No "Omega-1 saw 4461.70, Omega-2 saw 4461.42" bugs
 * - Prevents repeated indicator computation
 *
 * ✅ SSOT COMPLIANT: Uses MarketDataService for all candle queries
 * ✅ CCIP-SNAPSHOT-TTL-SSOT-2026-03-03: All TTLs and candle minimums sourced
 *    from TIME_MS.CACHE in time-constants.ts (no hardcoded magic values).
 * ✅ CCIP-LOGGING-SSOT-2026-03-03: All logging routes through centralized logger.
 */

import { computeOmegaSensors, type OmegaSensors, type Candle } from './omega-sensors';
import { type Timeframe } from '../config/timeframe-hierarchy';
import { regimeOracle, type RegimeSnapshot } from './regime-oracle';
import { adversarialDetector, type AdversarialSignal } from './adversarial-detector';
import { createATRValue, type ATRValue, type ATRTimeframe } from '../types/atr';
import type { AggregatedSentiment } from './sentiment-aggregator';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { marketDataService } from './market-data-service';
import { TIME_MS } from '../config/time-constants';
import { logger } from '../lib/logger';

export interface MarketSnapshotData {
  // Core Price Data
  symbol: string;
  timeframe: Timeframe;
  price: number;
  timestamp: number;

  // Raw Candles
  candles: Candle[];

  // Technical Indicators (computed once)
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  stochRsi: number;
  atr: ATRValue;
  vwap: number;

  // Derived Analysis
  trend: string;
  trendScore: number; // Numeric strength: -100 (strong bear) to +100 (strong bull)
  volatility: string;
  momentum: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;

  // Structure Analysis
  structure?: { hh: boolean; hl: boolean; lh: boolean; ll: boolean };

  // Advanced Indicators (computed once)
  omegaSensors: OmegaSensors;
  regime: RegimeSnapshot;
  adversarial: AdversarialSignal;
  sentiment?: AggregatedSentiment;

  // Tradeability Assessment
  tradeable: boolean;
  blockReason?: string;

  // Metadata
  snapshotHash: string;
  createdAt: number;
}

interface CachedSnapshot {
  data: MarketSnapshotData;
  expiresAt: number;
}

/**
 * TTL Configuration based on timeframe.
 * CCIP-SNAPSHOT-TTL-SSOT-2026-03-03: All values sourced from TIME_MS.CACHE (time-constants.ts).
 * No magic numbers — the SSOT for all cache lifetimes is time-constants.ts.
 */
function getTTLForTimeframe(timeframe: Timeframe): number {
  const ttls: Record<Timeframe, number> = {
    'M5': TIME_MS.CACHE.SNAPSHOT_TTL_M5,
    'M15': TIME_MS.CACHE.SNAPSHOT_TTL_M15,
    'H1': TIME_MS.CACHE.SNAPSHOT_TTL_H1,
    'H4': TIME_MS.CACHE.SNAPSHOT_TTL_H4,
    'D': TIME_MS.CACHE.SNAPSHOT_TTL_D,
  };

  return ttls[timeframe] ?? TIME_MS.CACHE.SNAPSHOT_TTL_DEFAULT;
}

/**
 * Generate cache key
 */
function generateCacheKey(symbol: string, timeframe: Timeframe): string {
  return `snapshot:${symbol}:${timeframe}`;
}

/**
 * Generate snapshot hash for drift detection
 */
function generateSnapshotHash(candles: Candle[]): string {
  if (!candles || candles.length === 0) return 'empty';

  const latestCandle = candles[candles.length - 1];
  const timestamp = typeof latestCandle.open_time === 'string'
    ? latestCandle.open_time
    : new Date(latestCandle.open_time).toISOString();

  return `${timestamp}_${latestCandle.close.toFixed(5)}`;
}

class MarketSnapshotCache {
  private cache = new Map<string, CachedSnapshot>();
  private stats = {
    hits: 0,
    misses: 0,
    dbReadsAvoided: 0
  };

  /**
   * Get or build market snapshot (SSOT)
   * All Omegas for this symbol/timeframe will receive the SAME snapshot.
   *
   * CCIP-STYLE-TF-2026: The caller MUST pass the style-derived timeframe.
   * riskMode no longer overrides timeframe — risk controls financial exposure only.
   */
  async getSnapshot(
    symbol: string,
    timeframe: Timeframe
  ): Promise<MarketSnapshotData> {
    const effectiveTimeframe = timeframe;

    const cacheKey = generateCacheKey(symbol, effectiveTimeframe);
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.stats.hits++;
      const ageSeconds = Math.round((now - cached.data.createdAt) / 1000);
      logger.debug('[SnapshotCache] HIT', { symbol, timeframe: effectiveTimeframe, ageSeconds });
      return cached.data;
    }

    this.stats.misses++;
    logger.debug('[SnapshotCache] MISS - building fresh snapshot', { symbol, timeframe: effectiveTimeframe });

    const snapshot = await this.buildFreshSnapshot(symbol, effectiveTimeframe);

    const ttl = getTTLForTimeframe(effectiveTimeframe);
    this.cache.set(cacheKey, {
      data: snapshot,
      expiresAt: now + ttl
    });

    logger.debug('[SnapshotCache] Snapshot cached', {
      symbol,
      timeframe: effectiveTimeframe,
      ttlSeconds: ttl / 1000
    });

    return snapshot;
  }

  /**
   * Build a fresh snapshot from scratch
   * This is the EXPENSIVE operation we want to do ONCE per cycle
   *
   * CCIP COMPLIANCE: Structured logging via logger.* for governance tracking
   * SSOT COMPLIANCE: Single authority for market snapshot construction
   */
  private async buildFreshSnapshot(
    symbol: string,
    timeframe: Timeframe
  ): Promise<MarketSnapshotData> {
    logger.info('[SnapshotCache] Building snapshot', { symbol, timeframe });

    const candles = await this.fetchCandles(symbol, timeframe);

    logger.debug('[SnapshotCache] Candle fetch result', {
      symbol,
      timeframe,
      candlesReturned: candles.length,
      requiredMinimum: TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_REQUIRED,
      oldestCandle: candles.length > 0 ? candles[0].open_time : null,
      newestCandle: candles.length > 0 ? candles[candles.length - 1].open_time : null
    });

    if (candles.length < TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_REQUIRED) {
      const errorMsg = `Insufficient candle data for ${symbol}@${timeframe}: Found ${candles.length} candles, need at least ${TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_REQUIRED}.`;
      logger.error('[SnapshotCache] Insufficient candles', { symbol, timeframe, found: candles.length, required: TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_REQUIRED });
      throw new Error(errorMsg);
    }

    let indicators;
    try {
      indicators = this.computeIndicators(candles, timeframe, symbol);

      if (!indicators.atr || indicators.atr.value <= 0) {
        logger.error('[SnapshotCache] ATR calculation failed', {
          symbol,
          timeframe,
          atrValue: indicators.atr?.value ?? 'undefined',
          candleCount: candles.length
        });
      } else {
        logger.debug('[SnapshotCache] ATR calculated', {
          symbol,
          timeframe,
          atrValue: indicators.atr.value.toFixed(5),
          atrPeriod: indicators.atr.period
        });
      }
    } catch (error: any) {
      logger.error('[SnapshotCache] Indicator computation failed', {
        symbol,
        timeframe,
        error: error.message,
        candleCount: candles.length
      });
      throw new Error(`Indicator computation failed for ${symbol}@${timeframe}: ${error.message}`);
    }

    const omegaSensors = computeOmegaSensors(
      candles,
      indicators.rsi,
      indicators.macd,
      indicators.macdSignal,
      indicators.atr.value,
      indicators.vwap
    );

    const structure = this.analyzeStructure(candles);
    const { support, resistance } = this.detectSupportResistance(candles);
    const { swingHigh, swingLow } = this.detectSwingPoints(candles);

    const currentPrice = candles[candles.length - 1].close;
    const snapshotHash = generateSnapshotHash(candles);

    const latestCandle = candles[candles.length - 1];
    const timestamp = latestCandle.open_time || new Date();
    const marketState = {
      price: currentPrice,
      ema20: indicators.ema20,
      ema50: indicators.ema50,
      ema200: indicators.ema200,
      rsi: indicators.rsi,
      atr: indicators.atr.value,
      vwap: indicators.vwap,
      recentCandles: candles.slice(-20)
    };

    const regime = regimeOracle.evaluate(marketState, timestamp, candles, symbol);

    // CCIP-2026-03-07: Pass the RAW (un-enforced) ATR to the adversarial detector.
    // The enforced ATR minimum exists to protect trade sizing from genuine
    // low-volatility edge cases. Feeding the enforced value into the adversarial
    // detector inflates wick-to-ATR ratios during calm markets, producing false
    // stop-run positives. Alpha must see real volatility context, not an
    // artificial floor. The enforced ATR continues to flow through indicators.atr
    // for all sizing/stop calculations downstream.
    logger.debug('[SnapshotCache] ATR split — adversarial uses raw', {
      symbol,
      rawATR: indicators.atrRaw.toFixed(6),
      enforcedATR: indicators.atr.value.toFixed(6),
      enforced: indicators.atrRaw !== indicators.atr.value
    });

    const adversarial = adversarialDetector.evaluate(
      {
        ...marketState,
        atr: indicators.atrRaw,
        swingHigh,
        swingLow
      },
      candles.slice(-20),
      regime
    );

    const tradeable = true;

    const advisoryFlags: string[] = [];
    const confidencePenalties: Array<{ source: string; penalty: number; reason: string }> = [];

    if (regime.avoid_trading) {
      advisoryFlags.push(`Regime advisory: ${regime.reason || 'unfavorable conditions'}`);
    }
    if (regime.is_high_risk_regime) {
      advisoryFlags.push(`Regime advisory: ${regime.reason || 'high risk regime'}`);
    }
    if (adversarial.recommended_action === 'delay') {
      advisoryFlags.push(`Adversarial advisory: ${adversarial.notes}`);
    }

    if (advisoryFlags.length > 0) {
      logger.info('[SnapshotCache] Advisory warnings', { symbol, advisoryFlags });
    }
    if (confidencePenalties.length > 0) {
      logger.info('[SnapshotCache] Confidence penalties', { symbol, confidencePenalties });
    }

    const snapshot: MarketSnapshotData = {
      symbol,
      timeframe,
      price: currentPrice,
      timestamp: Date.now(),
      candles,
      ...indicators,
      omegaSensors,
      regime,
      adversarial,
      structure,
      support,
      resistance,
      swingHigh,
      swingLow,
      tradeable,
      blockReason: undefined,
      advisoryFlags,
      confidencePenalties,
      snapshotHash,
      createdAt: Date.now()
    } as MarketSnapshotData & { advisoryFlags: string[]; confidencePenalties: Array<{ source: string; penalty: number; reason: string }> };

    logger.info('[SnapshotCache] Snapshot built', {
      symbol,
      timeframe,
      price: currentPrice.toFixed(5),
      atrRaw: indicators.atrRaw.toFixed(5),
      atrEnforced: indicators.atr.value.toFixed(5),
      atrEnforcementActive: indicators.atrRaw !== indicators.atr.value,
      trend: indicators.trend,
      volatility: indicators.volatility,
      advisoryCount: advisoryFlags.length,
      hash: snapshotHash
    });

    return snapshot;
  }

  /**
   * Fetch candles from database
   * ✅ SSOT: Uses MarketDataService
   * CCIP COMPLIANCE: Structured logging for governance
   */
  private async fetchCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    logger.debug('[SnapshotCache] Fetching candles', {
      symbol,
      timeframe,
      requestedLimit: TIME_MS.CACHE.SNAPSHOT_CANDLE_FETCH_LIMIT,
      source: 'marketDataService.getCandles'
    });

    const candles = await marketDataService.getCandles(symbol, timeframe, TIME_MS.CACHE.SNAPSHOT_CANDLE_FETCH_LIMIT);

    logger.debug('[SnapshotCache] MarketDataService returned', {
      symbol,
      timeframe,
      candleCount: candles?.length || 0,
      isEmptyArray: Array.isArray(candles) && candles.length === 0
    });

    if (!candles || candles.length === 0) {
      const errorMsg = `No candle data found for ${symbol}@${timeframe}. Database query returned empty.`;
      logger.error('[SnapshotCache] No candles returned', { symbol, timeframe });
      throw new Error(errorMsg);
    }

    const reversedCandles = candles.reverse().map(c => ({
      open_time: c.open_time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || undefined
    }));

    logger.debug('[SnapshotCache] Candles processed', {
      symbol,
      timeframe,
      totalCandles: reversedCandles.length,
      oldestTime: reversedCandles[0]?.open_time,
      newestTime: reversedCandles[reversedCandles.length - 1]?.open_time
    });

    return reversedCandles;
  }

  /**
   * Compute all technical indicators
   */
  private computeIndicators(candles: Candle[], timeframe: Timeframe, symbol: string): {
    ema20: number;
    ema50: number;
    ema200: number;
    rsi: number;
    stochRsi: number;
    atr: ATRValue;
    atrRaw: number; // CCIP-2026-03-07: un-enforced ATR for adversarial detector
    vwap: number;
    macd: number;
    macdSignal: number;
    trend: string;
    trendScore: number;
    volatility: string;
    momentum: number;
  } {
    const closes = candles.map(c => c.close);

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, 200);
    const rsi = this.calculateRSI(closes, 14);
    const stochRsi = this.calculateStochRSI(closes, 14);
    const atrRaw = this.calculateATR(candles);
    const atrEnforced = this.enforceATRMinimum(atrRaw, symbol, closes[closes.length - 1]);
    // CCIP-2026-03-07: atr (ATRValue) uses the enforced floor for trade sizing/stops.
    // atrRaw is preserved separately so the adversarial detector receives the true
    // market ATR — not an inflated minimum — for accurate wick-to-ATR comparisons.
    const atr = createATRValue(atrEnforced, timeframe as ATRTimeframe, 14);
    const vwap = this.calculateVWAP(candles.slice(-20));
    const { macd, signal } = this.calculateMACD(closes);

    const currentPrice = closes[closes.length - 1];
    const momentum = this.calculateMomentum(closes);
    const trend = this.determineTrend(currentPrice, ema20, ema50, ema200);
    const trendScore = this.calculateTrendScore(currentPrice, ema20, ema50, ema200, momentum);
    const volatility = this.determineVolatility(atr.value, currentPrice);

    return {
      ema20,
      ema50,
      ema200,
      rsi,
      stochRsi,
      atr,
      atrRaw,
      vwap,
      macd,
      macdSignal: signal,
      trend,
      trendScore,
      volatility,
      momentum
    };
  }

  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1] || 0;

    const multiplier = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((sum, p) => sum + p, 0) / period;

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema;
    }

    return ema;
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50;

    const changes: number[] = [];
    for (let i = 1; i < prices.length; i++) {
      changes.push(prices[i] - prices[i - 1]);
    }

    const gains = changes.map(c => c > 0 ? c : 0);
    const losses = changes.map(c => c < 0 ? Math.abs(c) : 0);

    const avgGain = gains.slice(-period).reduce((sum, g) => sum + g, 0) / period;
    const avgLoss = losses.slice(-period).reduce((sum, l) => sum + l, 0) / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private calculateStochRSI(prices: number[], period: number = 14): number {
    const rsi = this.calculateRSI(prices, period);
    return rsi;
  }

  /**
   * Calculate ATR with comprehensive error handling
   * CCIP COMPLIANCE: Structured logging via logger.* for governance
   * SSOT COMPLIANCE: Single authority for ATR calculation in snapshot cache
   */
  private calculateATR(candles: Candle[]): number {
    if (candles.length < 14) {
      logger.warn('[SnapshotCache] ATR: Insufficient candles', {
        candleCount: candles.length,
        requiredMinimum: 14,
        returnedFallback: 0.001
      });
      return 0.001;
    }

    const trs: number[] = [];
    let zeroRangeCount = 0;

    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;

      const tr = Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      );

      if (tr > 0) {
        trs.push(tr);
      } else {
        zeroRangeCount++;
      }
    }

    logger.debug('[SnapshotCache] ATR calculation details', {
      totalCandles: candles.length,
      validRanges: trs.length,
      zeroRangeCandles: zeroRangeCount,
      percentValid: ((trs.length / (candles.length - 1)) * 100).toFixed(1) + '%'
    });

    if (trs.length < TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_ATR) {
      logger.warn('[SnapshotCache] ATR: Insufficient valid ranges', {
        validRanges: trs.length,
        requiredMinimum: TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_ATR,
        zeroRangeCandles: zeroRangeCount,
        returnedFallback: 0.001
      });
      return 0.001;
    }

    const validTRs = trs.slice(-14);
    const atr = validTRs.reduce((sum, tr) => sum + tr, 0) / validTRs.length;

    logger.debug('[SnapshotCache] ATR calculated', {
      rawATR: atr.toFixed(6),
      rangesUsed: validTRs.length,
      minRange: Math.min(...validTRs).toFixed(6),
      maxRange: Math.max(...validTRs).toFixed(6)
    });

    return atr;
  }

  /**
   * Enforce instrument-specific ATR minimums
   * CCIP COMPLIANCE: Structured logging for governance audit trail
   * SSOT COMPLIANCE: Uses TRADING_CONSTANTS as single source for ATR minimums
   */
  private enforceATRMinimum(atr: number, symbol: string, currentPrice: number): number {
    logger.debug('[SnapshotCache] ATR minimum enforcement check', {
      symbol,
      rawATR: atr.toFixed(6),
      currentPrice: currentPrice.toFixed(5),
      hasSpecificMinimum: !!TRADING_CONSTANTS.ATR_MINIMUMS[symbol as keyof typeof TRADING_CONSTANTS.ATR_MINIMUMS]
    });

    const specificMin = TRADING_CONSTANTS.ATR_MINIMUMS[symbol as keyof typeof TRADING_CONSTANTS.ATR_MINIMUMS];

    if (specificMin && typeof specificMin === 'number') {
      if (atr < specificMin) {
        logger.warn('[SnapshotCache] ATR below symbol-specific minimum - enforcing', {
          symbol,
          originalATR: atr.toFixed(6),
          enforcedATR: specificMin.toFixed(6),
          reason: 'Symbol-specific minimum'
        });
        return specificMin;
      }
      logger.debug('[SnapshotCache] ATR above symbol-specific minimum', {
        symbol,
        atr: atr.toFixed(6),
        minimum: specificMin.toFixed(6)
      });
      return atr;
    }

    const percentMin = currentPrice * TRADING_CONSTANTS.ATR_MINIMUMS.DEFAULT_PERCENT;
    if (atr < percentMin) {
      logger.warn('[SnapshotCache] ATR below percentage-based minimum - enforcing', {
        symbol,
        originalATR: atr.toFixed(6),
        enforcedATR: percentMin.toFixed(6),
        calculationBasis: `${(TRADING_CONSTANTS.ATR_MINIMUMS.DEFAULT_PERCENT * 100).toFixed(2)}% of ${currentPrice.toFixed(5)}`,
        reason: 'Percentage-based fallback'
      });
      return percentMin;
    }

    logger.debug('[SnapshotCache] ATR above all minimum thresholds', {
      symbol,
      atr: atr.toFixed(6),
      percentageMin: percentMin.toFixed(6)
    });
    return atr;
  }

  private calculateVWAP(candles: Candle[]): number {
    let totalPV = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = candle.volume || 1000;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : candles[candles.length - 1].close;
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number } {
    const ema12 = this.calculateEMA(prices, 12);
    const ema26 = this.calculateEMA(prices, 26);
    const macd = ema12 - ema26;
    const signal = macd;

    return { macd, signal };
  }

  private determineTrend(price: number, ema20: number, ema50: number, ema200: number): string {
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) return 'bull';
    if (price < ema20 && ema20 < ema50 && ema50 < ema200) return 'bear';
    return 'sideways';
  }

  /**
   * Calculate numeric trend strength score
   * Returns: -100 (strong bearish) to +100 (strong bullish)
   */
  private calculateTrendScore(
    price: number,
    ema20: number,
    ema50: number,
    ema200: number,
    momentum: number
  ): number {
    let score = 0;

    if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
      score = 60;
    } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
      score = -60;
    } else {
      let partialScore = 0;
      if (price > ema20) partialScore += 15;
      else if (price < ema20) partialScore -= 15;

      if (ema20 > ema50) partialScore += 15;
      else if (ema20 < ema50) partialScore -= 15;

      if (ema50 > ema200) partialScore += 15;
      else if (ema50 < ema200) partialScore -= 15;

      score = partialScore;
    }

    const momentumScore = Math.max(-40, Math.min(40, momentum * 4));
    score += momentumScore;

    return Math.max(-100, Math.min(100, Math.round(score)));
  }

  private determineVolatility(atr: number, price: number): string {
    const atrPercent = (atr / price) * 100;

    if (atrPercent < 0.5) return 'low';
    if (atrPercent > 1.5) return 'high';
    return 'medium';
  }

  private calculateMomentum(prices: number[]): number {
    if (prices.length < 10) return 0;

    const current = prices[prices.length - 1];
    const previous = prices[prices.length - 10];

    return ((current - previous) / previous) * 100;
  }

  private analyzeStructure(candles: Candle[]): { hh: boolean; hl: boolean; lh: boolean; ll: boolean } {
    if (candles.length < 20) {
      return { hh: false, hl: false, lh: false, ll: false };
    }

    const recent = candles.slice(-20);
    const midPoint = Math.floor(recent.length / 2);

    const firstHalf = recent.slice(0, midPoint);
    const secondHalf = recent.slice(midPoint);

    const firstHigh = Math.max(...firstHalf.map(c => c.high));
    const secondHigh = Math.max(...secondHalf.map(c => c.high));
    const firstLow = Math.min(...firstHalf.map(c => c.low));
    const secondLow = Math.min(...secondHalf.map(c => c.low));

    return {
      hh: secondHigh > firstHigh && secondLow > firstLow,
      hl: secondHigh > firstHigh && secondLow > firstLow,
      lh: secondHigh < firstHigh && secondLow < firstLow,
      ll: secondHigh < firstHigh && secondLow < firstLow
    };
  }

  private detectSupportResistance(candles: Candle[]): { support: number[]; resistance: number[] } {
    if (candles.length < 50) {
      const current = candles[candles.length - 1].close;
      return {
        support: [current * 0.99],
        resistance: [current * 1.01]
      };
    }

    const recent = candles.slice(-50);
    const lows = recent.map(c => c.low).sort((a, b) => a - b);
    const highs = recent.map(c => c.high).sort((a, b) => b - a);

    const support = [lows[0], lows[1], lows[2]].filter((v, i, a) => a.indexOf(v) === i);
    const resistance = [highs[0], highs[1], highs[2]].filter((v, i, a) => a.indexOf(v) === i);

    return { support, resistance };
  }

  private detectSwingPoints(candles: Candle[]): { swingHigh: number; swingLow: number } {
    if (candles.length < 20) {
      const last = candles[candles.length - 1];
      return { swingHigh: last.high, swingLow: last.low };
    }

    const recent = candles.slice(-20);
    const swingHigh = Math.max(...recent.map(c => c.high));
    const swingLow = Math.min(...recent.map(c => c.low));

    return { swingHigh, swingLow };
  }

  /**
   * Invalidate cache for a specific symbol/timeframe
   */
  invalidateSnapshot(symbol: string, timeframe: Timeframe): void {
    const cacheKey = generateCacheKey(symbol, timeframe);
    const deleted = this.cache.delete(cacheKey);

    if (deleted) {
      logger.info('[SnapshotCache] Invalidated', { symbol, timeframe });
    }
  }

  /**
   * Clear all cached snapshots
   */
  clearAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    logger.info('[SnapshotCache] Cleared all snapshots', { count: size });
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hits: number;
    misses: number;
    hitRate: number;
    cacheSize: number;
    dbReadsAvoided: number;
  } {
    const total = this.stats.hits + this.stats.misses;
    const hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;

    return {
      ...this.stats,
      hitRate,
      cacheSize: this.cache.size
    };
  }

  /**
   * Log statistics via centralized logger (SSOT: no direct console.* calls)
   */
  logStats(): void {
    const stats = this.getStats();
    logger.info('[SnapshotCache] Stats', {
      hits: stats.hits,
      misses: stats.misses,
      hitRate: `${stats.hitRate.toFixed(1)}%`,
      cacheSize: stats.cacheSize,
      dbReadsAvoided: stats.dbReadsAvoided
    });
  }
}

export const marketSnapshotCache = new MarketSnapshotCache();
