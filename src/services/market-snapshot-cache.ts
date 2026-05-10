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
import { marketDataService } from './market-data-service';
import { TIME_MS } from '../config/time-constants';
import { logger } from '../lib/logger';
import { priceCoordinator } from './coordinators/price-coordinator';

export interface MarketSnapshotData {
  // Core Price Data
  symbol: string;
  timeframe: Timeframe;
  price: number;          // Last closed candle close — used for structural analysis (EMA, VWAP, regime)
  livePrice: number;      // Live market mid price at snapshot build time — Alpha uses this for entry planning
  livePriceSource: 'realtime' | 'candle_fallback'; // Diagnostic: which source provided livePrice
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
  atrPercent: number; // CCIP-2026-04-07: Raw ATR as % of price — Alpha is sole volatility authority
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
  const ttls: Partial<Record<Timeframe, number>> = {
    'M1':  TIME_MS.CACHE.SNAPSHOT_TTL_M1,
    'M5':  TIME_MS.CACHE.SNAPSHOT_TTL_M5,
    'M15': TIME_MS.CACHE.SNAPSHOT_TTL_M15,
    'H1':  TIME_MS.CACHE.SNAPSHOT_TTL_H1,
    'H4':  TIME_MS.CACHE.SNAPSHOT_TTL_H4,
    'D':   TIME_MS.CACHE.SNAPSHOT_TTL_D,
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
 * CCIP-2026-0510E: Maximum acceptable age of the last candle in a cached snapshot.
 * If the last candle's open_time is older than this, the cache entry is invalidated
 * regardless of remaining TTL. Prevents the "stale candle under fresh TTL" trap where
 * the cache serves a snapshot whose underlying data is already stale by Alpha's standards.
 *
 * Values are ~2x the timeframe interval so a single missed candle write does not
 * thrash the cache, but two consecutive misses force a rebuild.
 */
const MAX_LAST_CANDLE_AGE_MS: Partial<Record<Timeframe, number>> = {
  'M1':  3 * 60 * 1000,
  'M5':  12 * 60 * 1000,
  'M15': 35 * 60 * 1000,
  'H1':  130 * 60 * 1000,
  'H4':  500 * 60 * 1000,
  'D':   50 * 60 * 60 * 1000,
};

function getLastCandleAgeMs(snapshot: MarketSnapshotData): number | null {
  const candles = snapshot?.candles;
  if (!candles || candles.length === 0) return null;
  const last = candles[candles.length - 1];
  const openTimeMs = typeof last.open_time === 'string'
    ? new Date(last.open_time).getTime()
    : (last.open_time instanceof Date ? last.open_time.getTime() : Number(last.open_time));
  if (!Number.isFinite(openTimeMs)) return null;
  return Date.now() - openTimeMs;
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
      // CCIP-2026-0510E: Candle-freshness gate. TTL alone is insufficient — if the
      // underlying candle producer stalls, a cached snapshot can remain "within TTL"
      // while its last candle is 10+ minutes old. Reject stale-candle cache hits.
      const maxAge = MAX_LAST_CANDLE_AGE_MS[effectiveTimeframe] ?? MAX_LAST_CANDLE_AGE_MS['M5']!;
      const candleAgeMs = getLastCandleAgeMs(cached.data);
      if (candleAgeMs !== null && candleAgeMs > maxAge) {
        logger.warn('[SnapshotCache] Invalidating cache — last candle stale', {
          symbol,
          timeframe: effectiveTimeframe,
          candleAgeSeconds: Math.round(candleAgeMs / 1000),
          maxAgeSeconds: Math.round(maxAge / 1000)
        });
        this.cache.delete(cacheKey);
      } else {
        this.stats.hits++;
        const ageSeconds = Math.round((now - cached.data.createdAt) / 1000);
        logger.debug('[SnapshotCache] HIT', { symbol, timeframe: effectiveTimeframe, ageSeconds });
        return cached.data;
      }
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

    // CCIP-2026-0424A: Use timeframe-aware minimum threshold
    const tfKeyMin = (timeframe as string).toUpperCase();
    const minByTf = TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_BY_TF;
    const minCandles = (tfKeyMin in minByTf ? minByTf[tfKeyMin] : minByTf['DEFAULT']) as number;

    logger.debug('[SnapshotCache] Candle fetch result', {
      symbol,
      timeframe,
      candlesReturned: candles.length,
      requiredMinimum: minCandles,
      oldestCandle: candles.length > 0 ? candles[0].open_time : null,
      newestCandle: candles.length > 0 ? candles[candles.length - 1].open_time : null
    });

    if (candles.length < minCandles) {
      const errorMsg = `Insufficient candle data for ${symbol}@${timeframe}: Found ${candles.length} candles, need at least ${minCandles}.`;
      logger.error('[SnapshotCache] Insufficient candles', { symbol, timeframe, found: candles.length, required: minCandles });
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

    // CCIP-2026-0421-LIVE-PRICE: Fetch live market price so Alpha plans entries
    // from where the market actually is, not from a potentially minutes-old candle close.
    // The autonomous price poller already refreshed realtime_prices earlier in the scan cycle,
    // so this read is cheap and will almost always hit a fresh row.
    // Fallback: if realtime price is unavailable, use candle close (same as before).
    let livePrice = currentPrice;
    let livePriceSource: 'realtime' | 'candle_fallback' = 'candle_fallback';
    try {
      const livePriceResult = await priceCoordinator.getPrice(symbol, { allowStale: true, useCacheFirst: true });
      const priceData = livePriceResult?.price;
      if (livePriceResult?.success && priceData?.mid && Number.isFinite(priceData.mid) && priceData.mid > 0 && !priceData.isCriticallyStale) {
        livePrice = priceData.mid;
        livePriceSource = 'realtime';
      }
    } catch {
      // Non-fatal: fall back to candle close
    }
    logger.debug('[SnapshotCache] Live price resolved', { symbol, livePrice, livePriceSource, candleClose: currentPrice });

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
      livePrice,
      livePriceSource,
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
      atr: indicators.atr.value.toFixed(5),
      trend: indicators.trend,
      atrPercent: indicators.atrPercent.toFixed(3) + '%',
      advisoryCount: advisoryFlags.length,
      hash: snapshotHash
    });

    return snapshot;
  }

  /**
   * Fetch candles from database
   * ✅ SSOT: Uses MarketDataService
   * CCIP COMPLIANCE: Structured logging for governance
   *
   * CCIP-2026-0424A: Uses timeframe-aware fetch limit to reduce M1 query payload.
   * M1 limit = 100 (down from 300), preventing statement timeout (57014) on SCALP sessions.
   */
  private async fetchCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    const tfKey = (timeframe as string).toUpperCase();
    const limitByTf = TIME_MS.CACHE.SNAPSHOT_CANDLE_FETCH_LIMIT_BY_TF;
    const fetchLimit = (tfKey in limitByTf ? limitByTf[tfKey] : limitByTf['DEFAULT']) as number;

    logger.debug('[SnapshotCache] Fetching candles', {
      symbol,
      timeframe,
      requestedLimit: fetchLimit,
      source: 'marketDataService.getCandles'
    });

    const candles = await marketDataService.getCandles(symbol, timeframe, fetchLimit);

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
    atrRaw: number;
    vwap: number;
    macd: number;
    macdSignal: number;
    trend: string;
    trendScore: number;
    atrPercent: number; // CCIP-2026-04-07: Raw ATR % — no static classification
    momentum: number;
  } {
    const closes = candles.map(c => c.close);

    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, 200);
    const rsi = this.calculateRSI(closes, 14);
    const stochRsi = this.calculateStochRSI(closes, 14);
    const atrRaw = this.calculateATR(candles);
    const atr = createATRValue(atrRaw, timeframe as ATRTimeframe, 14);
    const vwap = this.calculateVWAP(candles.slice(-20));
    const { macd, signal } = this.calculateMACD(closes);

    const currentPrice = closes[closes.length - 1];
    const momentum = this.calculateMomentum(closes);
    const trend = this.determineTrend(currentPrice, ema20, ema50, ema200);
    const trendScore = this.calculateTrendScore(currentPrice, ema20, ema50, ema200, momentum);
    // CCIP-2026-04-07: Provide raw ATR% — Alpha is the sole volatility authority.
    // Static thresholds (e.g. atrPercent < 0.3 → 'low') produce incorrect labels for
    // high-price instruments like NAS100 and US30. The coordinator and wall engine
    // must not gate on a pre-classified label.
    const atrPercent = (atr.value / currentPrice) * 100;

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
      atrPercent,
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

  private calculateStochRSI(prices: number[], period: number = 14, lookback: number = 14): number {
    if (prices.length < period + lookback + 1) {
      throw new Error(
        `[SnapshotCache] StochRSI: Insufficient prices — need ${period + lookback + 1}, got ${prices.length}. Cannot produce valid StochRSI.`
      );
    }

    const rsiSeries: number[] = [];
    for (let i = period; i <= prices.length - 1; i++) {
      rsiSeries.push(this.calculateRSI(prices.slice(0, i + 1), period));
    }

    if (rsiSeries.length < lookback) {
      throw new Error(
        `[SnapshotCache] StochRSI: Insufficient RSI history — need ${lookback} RSI readings, got ${rsiSeries.length}.`
      );
    }

    const window = rsiSeries.slice(-lookback);
    const minRSI = Math.min(...window);
    const maxRSI = Math.max(...window);
    const currentRSI = rsiSeries[rsiSeries.length - 1];

    if (maxRSI === minRSI) {
      return 0.5;
    }

    return (currentRSI - minRSI) / (maxRSI - minRSI);
  }

  /**
   * Calculate ATR with comprehensive error handling
   * CCIP COMPLIANCE: Structured logging via logger.* for governance
   * SSOT COMPLIANCE: Single authority for ATR calculation in snapshot cache
   */
  private calculateATR(candles: Candle[]): number {
    if (candles.length < 14) {
      throw new Error(
        `[SnapshotCache] ATR: Insufficient candles — need 14, got ${candles.length}. Snapshot aborted to prevent corrupt ATR flowing to Alpha.`
      );
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
      throw new Error(
        `[SnapshotCache] ATR: Insufficient valid price ranges — need ${TIME_MS.CACHE.SNAPSHOT_MIN_CANDLES_ATR} non-zero ranges, got ${trs.length} (${zeroRangeCount} zero-range candles). Snapshot aborted to prevent corrupt ATR flowing to Alpha.`
      );
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

  private calculateVWAP(candles: Candle[]): number {
    let totalPV = 0;
    let totalVolume = 0;

    for (const candle of candles) {
      const typical = (candle.high + candle.low + candle.close) / 3;
      const volume = (candle.volume && candle.volume > 0) ? candle.volume : undefined;
      if (!volume) continue;
      totalPV += typical * volume;
      totalVolume += volume;
    }

    return totalVolume > 0 ? totalPV / totalVolume : candles[candles.length - 1].close;
  }

  private calculateMACD(prices: number[]): { macd: number; signal: number } {
    const signalPeriod = 9;
    const minRequired = 26 + signalPeriod;

    if (prices.length < minRequired) {
      throw new Error(
        `[SnapshotCache] MACD: Insufficient prices — need ${minRequired}, got ${prices.length}. Cannot produce valid MACD signal line.`
      );
    }

    const macdSeries: number[] = [];
    for (let i = 26; i <= prices.length; i++) {
      const slice = prices.slice(0, i);
      const ema12 = this.calculateEMA(slice, 12);
      const ema26 = this.calculateEMA(slice, 26);
      macdSeries.push(ema12 - ema26);
    }

    const macd = macdSeries[macdSeries.length - 1];

    const signalMultiplier = 2 / (signalPeriod + 1);
    let signal = macdSeries.slice(0, signalPeriod).reduce((sum, v) => sum + v, 0) / signalPeriod;
    for (let i = signalPeriod; i < macdSeries.length; i++) {
      signal = (macdSeries[i] - signal) * signalMultiplier + signal;
    }

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
      hl: secondHigh > firstHigh && secondLow < firstLow,
      lh: secondHigh < firstHigh && secondLow > firstLow,
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
