/**
 * Multi-Symbol Market Snapshot Builder
 *
 * Fetches and builds market snapshots for multiple symbols in parallel.
 * Includes indicators, regime analysis, adversarial detection, and structure levels.
 */

import { supabase } from '../lib/supabase';
import { calculateEMA, calculateStochRSI } from '../strategies/indicators';
import { calculateVWAP, calculateRSI, calculateATR } from '../utils/technicalIndicators';
import { regimeOracle, type RegimeSnapshot } from './regime-oracle';
import { adversarialDetector, type AdversarialSignal } from './adversarial-detector';
import { computeOmegaSensors, type OmegaSensors } from './omega-sensors';
import { logger } from '../lib/logger';

export interface SymbolSnapshot {
  symbol: string;
  price: number;
  ema20: number;
  ema50: number;
  ema200: number;
  rsi: number;
  stochRsi: number;
  atr: number;
  vwap: number;
  trend: string;
  trendScore: number;
  volatility: string;
  momentum: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  recentCandles: any[];
  structure: {
    hh: boolean;
    hl: boolean;
    lh: boolean;
    ll: boolean;
  };
  omegaSensors: OmegaSensors;
  regime: RegimeSnapshot;
  adversarial: AdversarialSignal;
  tradeable: boolean;
  blockReason?: string;
  fetchedAt: Date;
}

export interface MultiSymbolSnapshotResult {
  snapshots: SymbolSnapshot[];
  tradeableSymbols: string[];
  blockedSymbols: Map<string, string>;
  timestamp: Date;
}

class MultiSymbolSnapshotBuilder {
  private readonly CANDLE_LOOKBACK = 100;
  private readonly TIMEFRAME = 'M5'; // Database uses uppercase format: M5, M15, H1, etc.

  async buildSnapshots(symbols: string[]): Promise<MultiSymbolSnapshotResult> {
    console.log(`[Multi-Symbol] Building snapshots for ${symbols.length} symbols...`);
    const startTime = Date.now();

    const snapshotPromises = symbols.map(symbol =>
      this.buildSingleSnapshot(symbol).catch(error => {
        console.error(`[Multi-Symbol] Failed to build snapshot for ${symbol}:`, error.message);
        return null;
      })
    );

    const snapshots = (await Promise.all(snapshotPromises)).filter((s): s is SymbolSnapshot => s !== null);

    const tradeableSymbols = snapshots.filter(s => s.tradeable).map(s => s.symbol);
    const blockedSymbols = new Map<string, string>();
    snapshots.filter(s => !s.tradeable).forEach(s => {
      if (s.blockReason) {
        blockedSymbols.set(s.symbol, s.blockReason);
      }
    });

    const duration = Date.now() - startTime;
    console.log(`[Multi-Symbol] ✅ Built ${snapshots.length} snapshots in ${duration}ms`);
    console.log(`[Multi-Symbol] Tradeable: ${tradeableSymbols.length}, Blocked: ${blockedSymbols.size}`);

    return {
      snapshots,
      tradeableSymbols,
      blockedSymbols,
      timestamp: new Date()
    };
  }

  private async buildSingleSnapshot(symbol: string): Promise<SymbolSnapshot> {
    // CRITICAL FIX: Query for both timeframe formats (M5 and 5m) to handle database variations
    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('*')
      .eq('symbol', symbol)
      .in('timeframe', ['M5', '5m']) // Query both formats
      .order('open_time', { ascending: false })
      .limit(this.CANDLE_LOOKBACK);

    if (error || !candles || candles.length < 50) {
      throw new Error(`Insufficient candle data for ${symbol}`);
    }

    const sortedCandles = [...candles].reverse();
    const latestCandle = sortedCandles[sortedCandles.length - 1];
    const price = latestCandle.close;

    const closes = sortedCandles.map(c => c.close);
    const highs = sortedCandles.map(c => c.high);
    const lows = sortedCandles.map(c => c.low);
    const volumes = sortedCandles.map(c => c.volume || 0);

    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);
    const ema200 = sortedCandles.length >= 200 ? calculateEMA(closes, 200) : ema50;

    const candlesWithTime = sortedCandles.map((c, i) => ({
      time: new Date(c.open_time || c.time).getTime(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume || 0
    }));

    const rsiResults = calculateRSI(candlesWithTime, 14);
    const rsi = rsiResults.length > 0 ? rsiResults[rsiResults.length - 1].value : 50;

    const stochRsi = calculateStochRSI(closes, 14);

    const atrResults = calculateATR(candlesWithTime, 14);
    const atr = atrResults.length > 0 ? atrResults[atrResults.length - 1].value : 0.001;

    const vwapResults = calculateVWAP(candlesWithTime);
    const vwap = vwapResults.length > 0 ? vwapResults[vwapResults.length - 1].value : price;

    const trendScore = this.calculateTrendScore(price, ema20, ema50, ema200);
    const trend = this.determineTrend(trendScore);
    const volatility = this.categorizeVolatility(atr, price);
    const momentum = this.calculateMomentum(closes);

    const swingHigh = Math.max(...highs.slice(-20));
    const swingLow = Math.min(...lows.slice(-20));

    const support = this.findSupportLevels(sortedCandles, price);
    const resistance = this.findResistanceLevels(sortedCandles, price);

    const structure = this.detectStructure(sortedCandles);

    const marketState = {
      price,
      ema20,
      ema50,
      ema200,
      rsi,
      atr,
      vwap,
      swingHigh,
      swingLow
    };

    const omegaSensors = computeOmegaSensors(sortedCandles, marketState);

    // CRITICAL FIX: Use correct method name and parameter order
    // RegimeOracle.evaluate(marketState, timestamp, candles, symbol)
    const latestTimestamp = latestCandle.open_time || latestCandle.time || new Date();
    const regime = regimeOracle.evaluate(
      marketState,
      latestTimestamp,
      sortedCandles,
      symbol  // Pass symbol for session-aware risk calculation
    );

    const adversarial = adversarialDetector.evaluate(
      marketState,
      sortedCandles,
      regime
    );

    // ALPHA HAS FINAL AUTHORITY: Symbol is ALWAYS tradeable
    // Rule-based systems (regime, adversarial) are ADVISORY ONLY
    // Only catastrophic conditions block trades before Alpha evaluation
    let tradeable = true;
    let blockReason: string | undefined;

    // Only block for catastrophic adversarial conditions
    if (adversarial.is_adversarial && adversarial.level === 'severe') {
      tradeable = false;
      blockReason = 'severe_manipulation';
    } else if (adversarial.stop_run_classification?.should_block) {
      tradeable = false;
      blockReason = 'active_stop_run';
    }

    // NOTE: regime.avoid_trading is IGNORED - Alpha decides with full context
    // Dead zone and other regime risks are passed as modifiers, not blocks

    return {
      symbol,
      price,
      ema20,
      ema50,
      ema200,
      rsi,
      stochRsi,
      atr,
      vwap,
      trend,
      trendScore,
      volatility,
      momentum,
      support,
      resistance,
      swingHigh,
      swingLow,
      recentCandles: sortedCandles.slice(-50),
      structure,
      omegaSensors,
      regime,
      adversarial,
      tradeable,
      blockReason,
      fetchedAt: new Date()
    };
  }

  private calculateTrendScore(price: number, ema20: number, ema50: number, ema200: number): number {
    let score = 0;

    if (price > ema20) score += 2;
    if (price > ema50) score += 3;
    if (price > ema200) score += 2;
    if (ema20 > ema50) score += 2;
    if (ema50 > ema200) score += 1;

    if (price < ema20) score -= 2;
    if (price < ema50) score -= 3;
    if (price < ema200) score -= 2;
    if (ema20 < ema50) score -= 2;
    if (ema50 < ema200) score -= 1;

    return Math.max(-10, Math.min(10, score));
  }

  private determineTrend(trendScore: number): string {
    if (trendScore >= 5) return 'strong_uptrend';
    if (trendScore >= 2) return 'uptrend';
    if (trendScore <= -5) return 'strong_downtrend';
    if (trendScore <= -2) return 'downtrend';
    return 'sideways';
  }

  private categorizeVolatility(atr: number, price: number): string {
    const atrPercent = (atr / price) * 100;
    if (atrPercent > 1.5) return 'high';
    if (atrPercent > 0.7) return 'medium';
    return 'low';
  }

  private calculateMomentum(closes: number[]): number {
    if (closes.length < 20) return 0;
    const recent = closes.slice(-10);
    const older = closes.slice(-20, -10);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    return ((recentAvg - olderAvg) / olderAvg) * 100;
  }

  private findSupportLevels(candles: any[], currentPrice: number): number[] {
    const lows = candles.slice(-50).map(c => c.low);
    const levels: number[] = [];

    for (let i = 2; i < lows.length - 2; i++) {
      if (lows[i] < lows[i - 1] && lows[i] < lows[i - 2] &&
          lows[i] < lows[i + 1] && lows[i] < lows[i + 2]) {
        if (lows[i] < currentPrice) {
          levels.push(lows[i]);
        }
      }
    }

    return levels.sort((a, b) => b - a).slice(0, 3);
  }

  private findResistanceLevels(candles: any[], currentPrice: number): number[] {
    const highs = candles.slice(-50).map(c => c.high);
    const levels: number[] = [];

    for (let i = 2; i < highs.length - 2; i++) {
      if (highs[i] > highs[i - 1] && highs[i] > highs[i - 2] &&
          highs[i] > highs[i + 1] && highs[i] > highs[i + 2]) {
        if (highs[i] > currentPrice) {
          levels.push(highs[i]);
        }
      }
    }

    return levels.sort((a, b) => a - b).slice(0, 3);
  }

  private detectStructure(candles: any[]): { hh: boolean; hl: boolean; lh: boolean; ll: boolean } {
    if (candles.length < 30) {
      return { hh: false, hl: false, lh: false, ll: false };
    }

    const recent = candles.slice(-15);
    const older = candles.slice(-30, -15);

    const recentHighs = recent.map(c => c.high);
    const recentLows = recent.map(c => c.low);
    const olderHighs = older.map(c => c.high);
    const olderLows = older.map(c => c.low);

    const recentMaxHigh = Math.max(...recentHighs);
    const recentMinLow = Math.min(...recentLows);
    const olderMaxHigh = Math.max(...olderHighs);
    const olderMinLow = Math.min(...olderLows);

    return {
      hh: recentMaxHigh > olderMaxHigh,
      hl: recentMinLow > olderMinLow,
      lh: recentMaxHigh < olderMaxHigh,
      ll: recentMinLow < olderMinLow
    };
  }
}

export const multiSymbolSnapshotBuilder = new MultiSymbolSnapshotBuilder();
