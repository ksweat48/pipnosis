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
 */

import { supabase } from '../lib/supabase';
import { computeOmegaSensors, type OmegaSensors, type Candle } from './omega-sensors';
import { getMTFConfig, type Timeframe, type RiskMode } from '../config/timeframe-hierarchy';
import { regimeOracle, type RegimeSnapshot } from './regime-oracle';
import { adversarialDetector, type AdversarialSignal } from './adversarial-detector';
import { createATRValue, type ATRValue, type ATRTimeframe } from '../types/atr';
import type { AggregatedSentiment } from './sentiment-aggregator';
import { TRADING_CONSTANTS } from '../config/trading-constants';

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
 * TTL Configuration based on timeframe
 * ISSUE #4 FIX: Increased TTLs for better cache hit rates
 * - M5: 5s → 10s (2x)
 * - M15: 30s → 60s (2x)
 * - H1: 2min → 5min (2.5x)
 * - H4: 5min → 10min (2x)
 * - D: 10min → 15min (1.5x)
 */
function getTTLForTimeframe(timeframe: Timeframe): number {
  const ttls: Record<Timeframe, number> = {
    'M5': 10000,     // 10 seconds (was 5s)
    'M15': 60000,    // 1 minute (was 30s)
    'H1': 300000,    // 5 minutes (was 2min)
    'H4': 600000,    // 10 minutes (was 5min)
    'D': 900000      // 15 minutes (was 10min)
  };

  return ttls[timeframe] || 60000; // Default: 1 minute (was 30s)
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
   * All Omegas for this symbol/timeframe will receive the SAME snapshot
   */
  async getSnapshot(
    symbol: string,
    timeframe: Timeframe,
    riskMode?: RiskMode
  ): Promise<MarketSnapshotData> {
    // Use dynamic timeframe based on risk mode if provided
    const effectiveTimeframe = riskMode
      ? getMTFConfig(riskMode).entryTimeframe
      : timeframe;

    const cacheKey = generateCacheKey(symbol, effectiveTimeframe);
    const now = Date.now();

    // Check cache first
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      this.stats.hits++;
      const ageSeconds = Math.round((now - cached.data.createdAt) / 1000);
      console.log(`[SnapshotCache] ⚡ HIT: ${symbol}@${effectiveTimeframe} (age: ${ageSeconds}s) | Saved DB read`);
      return cached.data;
    }

    // Cache miss - build fresh snapshot
    this.stats.misses++;
    console.log(`[SnapshotCache] 🔄 MISS: ${symbol}@${effectiveTimeframe} - Building fresh snapshot`);

    const snapshot = await this.buildFreshSnapshot(symbol, effectiveTimeframe);

    // Cache the snapshot
    const ttl = getTTLForTimeframe(effectiveTimeframe);
    this.cache.set(cacheKey, {
      data: snapshot,
      expiresAt: now + ttl
    });

    console.log(`[SnapshotCache] ✅ Snapshot cached: ${symbol}@${effectiveTimeframe} (TTL: ${ttl / 1000}s)`);

    return snapshot;
  }

  /**
   * Build a fresh snapshot from scratch
   * This is the EXPENSIVE operation we want to do ONCE per cycle
   */
  private async buildFreshSnapshot(
    symbol: string,
    timeframe: Timeframe
  ): Promise<MarketSnapshotData> {
    console.log(`[SnapshotCache] 📊 Building snapshot: ${symbol}@${timeframe}`);

    // Step 1: Fetch candles (ONE DB QUERY)
    const candles = await this.fetchCandles(symbol, timeframe);

    if (candles.length < 50) {
      throw new Error(`Insufficient candle data for ${symbol}@${timeframe}: ${candles.length} candles`);
    }

    // Step 2: Compute technical indicators (ONCE)
    const indicators = this.computeIndicators(candles, timeframe, symbol);

    // Step 3: Compute OmegaSensors (ONCE)
    const omegaSensors = computeOmegaSensors(
      candles,
      indicators.rsi,
      indicators.macd,
      indicators.macdSignal,
      indicators.atr.value,
      indicators.vwap
    );

    // Step 4: Analyze structure
    const structure = this.analyzeStructure(candles);

    // Step 5: Detect support/resistance
    const { support, resistance } = this.detectSupportResistance(candles);

    // Step 6: Swing points
    const { swingHigh, swingLow } = this.detectSwingPoints(candles);

    const currentPrice = candles[candles.length - 1].close;
    const snapshotHash = generateSnapshotHash(candles);

    // Step 7: Evaluate regime (time-of-day, session, volatility, structure)
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

    // Step 8: Evaluate adversarial patterns (stop runs, manipulation)
    const adversarial = adversarialDetector.evaluate(
      {
        ...marketState,
        atr: indicators.atr,
        swingHigh,
        swingLow
      },
      candles.slice(-20),
      regime
    );

    // Step 9: ADVISORY-ONLY MODEL - No hard blocks, only warnings and penalties
    // ALWAYS tradeable - Alpha has final authority
    const tradeable = true; // ALWAYS true - advisory system only

    // Collect advisory warnings for Alpha to consider
    const advisoryFlags: string[] = [];
    const confidencePenalties: Array<{ source: string; penalty: number; reason: string }> = [];

    // Advisory flag from regime (DEPRECATED: avoid_trading always false now)
    if (regime.avoid_trading) {
      advisoryFlags.push(`Regime advisory: ${regime.reason || 'unfavorable conditions'}`);
    }
    // Add regime risk reduction as penalty
    if (regime.risk_reduction_factor < 1.0) {
      confidencePenalties.push({
        source: 'regime',
        penalty: regime.risk_reduction_factor,
        reason: regime.reason || 'risk reduction applied'
      });
    }

    // Advisory flag from adversarial detector
    if (adversarial.recommended_action === 'delay') {
      advisoryFlags.push(`Adversarial advisory: ${adversarial.notes}`);
    }
    // Add adversarial confidence penalty
    if (adversarial.confidence_penalty && adversarial.confidence_penalty < 1.0) {
      confidencePenalties.push({
        source: 'adversarial',
        penalty: adversarial.confidence_penalty,
        reason: adversarial.notes
      });
    }

    // Log advisory status
    if (advisoryFlags.length > 0) {
      console.log(`[Market Snapshot - ADVISORY] Warnings for ${symbol}:`);
      advisoryFlags.forEach(flag => console.log(`  ⚠️ ${flag}`));
    }
    if (confidencePenalties.length > 0) {
      console.log(`[Market Snapshot - ADVISORY] Confidence Penalties for ${symbol}:`);
      confidencePenalties.forEach(p =>
        console.log(`  📉 ${p.source}: ${((1 - p.penalty) * 100).toFixed(0)}% (${p.reason})`)
      );
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
      tradeable, // ALWAYS true now
      blockReason: undefined, // DEPRECATED - kept for backward compatibility
      advisoryFlags, // NEW: Array of advisory warnings
      confidencePenalties, // NEW: Array of confidence penalty objects
      snapshotHash,
      createdAt: Date.now()
    };

    console.log(`[SnapshotCache] ✅ Snapshot built: ${symbol}@${timeframe}`);
    console.log(`  Price: ${currentPrice.toFixed(5)} | ATR: ${indicators.atr.value.toFixed(5)}`);
    console.log(`  Trend: ${indicators.trend} | Volatility: ${indicators.volatility}`);
    console.log(`  Tradeable: ✅ ALWAYS (advisory-only system)`);
    if (advisoryFlags.length > 0) {
      console.log(`  Advisory Warnings: ${advisoryFlags.length}`);
    }
    if (confidencePenalties.length > 0) {
      const totalPenalty = confidencePenalties.reduce((min, p) => Math.min(min, p.penalty), 1.0);
      console.log(`  Total Confidence Penalty: ${((1 - totalPenalty) * 100).toFixed(0)}%`);
    }
    console.log(`  Hash: ${snapshotHash}`);

    return snapshot;
  }

  /**
   * Fetch candles from database
   *
   * CRITICAL FIX: Database stores timeframes in UPPERCASE (M5, M15, H1, etc.)
   * The Timeframe type already uses uppercase, so use it directly - no conversion needed
   */
  private async fetchCandles(symbol: string, timeframe: Timeframe): Promise<Candle[]> {
    // Database uses UPPERCASE: 'M5', 'M15', 'H1', 'H4', 'D1'
    // Timeframe type already matches this format - use directly
    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('open_time, open, high, low, close, volume')
      .eq('symbol', symbol)
      .eq('timeframe', timeframe)
      .order('open_time', { ascending: false })
      .limit(300);

    if (error) {
      console.error(`[SnapshotCache] ❌ Failed to fetch candles for ${symbol}@${timeframe}:`, error);
      throw new Error(`Database error: ${error.message}`);
    }

    if (!candles || candles.length === 0) {
      console.error(`[SnapshotCache] ❌ No candle data found for ${symbol}@${timeframe} (queried: timeframe='${timeframe}')`);
      throw new Error(`No candle data found for ${symbol}@${timeframe}`);
    }

    // Reverse to chronological order
    return candles.reverse().map(c => ({
      open_time: c.open_time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || undefined
    }));
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
    // Simplified Stoch RSI calculation
    const rsi = this.calculateRSI(prices, period);
    return rsi; // Return RSI as approximation
  }

  private calculateATR(candles: Candle[]): number {
    if (candles.length < 14) return 0.001;

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

      // CRITICAL FIX: Filter out zero-range candles (flat MetaAPI placeholders)
      // These pollute the ATR with artificial zeros
      if (tr > 0) {
        trs.push(tr);
      }
    }

    // Need at least 10 non-zero ranges for valid ATR
    if (trs.length < 10) {
      console.warn(`[SnapshotCache] ⚠️ Insufficient valid candles for ATR (${trs.length}/14 non-zero)`);
      return 0.001;
    }

    // Use last 14 valid (non-zero) ranges
    const validTRs = trs.slice(-14);
    return validTRs.reduce((sum, tr) => sum + tr, 0) / validTRs.length;
  }

  /**
   * Enforce instrument-specific ATR minimums
   * Prevents impossibly low ATR values caused by bad data
   */
  private enforceATRMinimum(atr: number, symbol: string, currentPrice: number): number {
    // Check if we have a specific minimum for this symbol
    const specificMin = TRADING_CONSTANTS.ATR_MINIMUMS[symbol as keyof typeof TRADING_CONSTANTS.ATR_MINIMUMS];

    if (specificMin && typeof specificMin === 'number') {
      if (atr < specificMin) {
        console.warn(
          `[SnapshotCache] ⚠️ ATR too low for ${symbol}: ${atr.toFixed(6)} < ${specificMin}. ` +
          `Enforcing minimum. Likely caused by flat placeholder candles.`
        );
        return specificMin;
      }
      return atr;
    }

    // Fallback: use percentage-based minimum
    const percentMin = currentPrice * TRADING_CONSTANTS.ATR_MINIMUMS.DEFAULT_PERCENT;
    if (atr < percentMin) {
      console.warn(
        `[SnapshotCache] ⚠️ ATR too low for ${symbol}: ${atr.toFixed(6)} < ${percentMin.toFixed(6)} (0.02% of price). ` +
        `Enforcing minimum.`
      );
      return percentMin;
    }

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

    // Signal line (9-period EMA of MACD)
    const macdLine = [macd]; // Simplified: use current MACD as signal
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

    // EMA alignment (base score: -60 to +60)
    if (price > ema20 && ema20 > ema50 && ema50 > ema200) {
      // Perfect bullish stack
      score = 60;
    } else if (price < ema20 && ema20 < ema50 && ema50 < ema200) {
      // Perfect bearish stack
      score = -60;
    } else {
      // Partial alignment or mixed
      let partialScore = 0;
      if (price > ema20) partialScore += 15;
      else if (price < ema20) partialScore -= 15;

      if (ema20 > ema50) partialScore += 15;
      else if (ema20 < ema50) partialScore -= 15;

      if (ema50 > ema200) partialScore += 15;
      else if (ema50 < ema200) partialScore -= 15;

      score = partialScore;
    }

    // Add momentum component (-40 to +40)
    // momentum is already in percentage form from calculateMomentum
    const momentumScore = Math.max(-40, Math.min(40, momentum * 4));
    score += momentumScore;

    // Clamp final score to [-100, 100]
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
      console.log(`[SnapshotCache] 🗑️ Invalidated: ${symbol}@${timeframe}`);
    }
  }

  /**
   * Clear all cached snapshots
   */
  clearAll(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[SnapshotCache] 🗑️ Cleared ${size} cached snapshots`);
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
   * Log statistics
   */
  logStats(): void {
    const stats = this.getStats();
    console.log(`[SnapshotCache] 📊 Stats:`);
    console.log(`  Hits: ${stats.hits} | Misses: ${stats.misses} | Hit Rate: ${stats.hitRate.toFixed(1)}%`);
    console.log(`  Cache Size: ${stats.cacheSize} snapshots`);
    console.log(`  DB Reads Avoided: ${stats.dbReadsAvoided}`);
  }
}

export const marketSnapshotCache = new MarketSnapshotCache();
