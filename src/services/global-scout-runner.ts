import { supabase } from '../lib/supabase';
import { sharedIntelligenceCoordinator, ScoutState } from './shared-intelligence-coordinator';
import {
  generateMarketStateHash,
  buildMarketStateSnapshot,
  calculateVolatilityBucket,
  calculateTrendBucket
} from './cache-key-generator';
import { DEFAULT_WATCHLIST } from '../config/watchlist';
import type { CandleData } from '../types';

export interface GlobalScoutResult {
  symbol: string;
  timeframe: string;
  state: ScoutState | null;
  wasUpdated: boolean;
  error?: string;
}

interface PreviousScoutSnapshot {
  snapshotHash: string;
  price: number;
  volatilityState: string;
  trendState: string;
  rsi: number;
  createdAt: Date;
}

class GlobalScoutRunner {
  private previousSnapshots = new Map<string, PreviousScoutSnapshot>();
  private runningScout = false;
  private lastGlobalRunTime = 0;
  private readonly MIN_RUN_INTERVAL_MS = 30000;

  async runGlobalScout(
    symbols: string[] = [...DEFAULT_WATCHLIST],
    timeframe: string = 'M15'
  ): Promise<GlobalScoutResult[]> {
    if (this.runningScout) {
      console.log('[GlobalScout] Scout already running, skipping...');
      return [];
    }

    const now = Date.now();
    if (now - this.lastGlobalRunTime < this.MIN_RUN_INTERVAL_MS) {
      console.log('[GlobalScout] Too soon since last run, skipping...');
      return [];
    }

    this.runningScout = true;
    this.lastGlobalRunTime = now;

    console.log(`[GlobalScout] Starting global scout for ${symbols.length} symbols...`);

    try {
      const results: GlobalScoutResult[] = [];

      const promises = symbols.map(async (symbol) => {
        try {
          const result = await this.scoutSymbol(symbol, timeframe);
          return result;
        } catch (error) {
          console.error(`[GlobalScout] Error scouting ${symbol}:`, error);
          return {
            symbol,
            timeframe,
            state: null,
            wasUpdated: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      });

      const allResults = await Promise.all(promises);
      results.push(...allResults);

      const updatedCount = results.filter(r => r.wasUpdated).length;
      const reconveneCount = results.filter(r => r.state?.shouldReconvene).length;

      console.log(`[GlobalScout] Complete: ${updatedCount}/${symbols.length} updated, ${reconveneCount} suggest reconvene`);

      return results;
    } finally {
      this.runningScout = false;
    }
  }

  private async scoutSymbol(symbol: string, timeframe: string): Promise<GlobalScoutResult> {
    const candles = await this.fetchCandlesForSymbol(symbol, timeframe);
    if (!candles || candles.length < 50) {
      return {
        symbol,
        timeframe,
        state: null,
        wasUpdated: false,
        error: 'Insufficient candle data'
      };
    }

    const snapshot = buildMarketStateSnapshot(symbol, timeframe, candles);
    if (!snapshot) {
      return {
        symbol,
        timeframe,
        state: null,
        wasUpdated: false,
        error: 'Failed to build market snapshot'
      };
    }

    const { hash } = generateMarketStateHash(snapshot);

    const cacheKey = `${symbol}:${timeframe}`;
    const previous = this.previousSnapshots.get(cacheKey);

    const volatilityState = calculateVolatilityBucket(snapshot.atr, snapshot.price);
    const trendState = calculateTrendBucket(snapshot.price, snapshot.emaFast, snapshot.emaSlow);

    if (previous && previous.snapshotHash === hash) {
      const existingState = await sharedIntelligenceCoordinator.getScoutState(symbol, timeframe);
      return {
        symbol,
        timeframe,
        state: existingState,
        wasUpdated: false
      };
    }

    const analysis = this.analyzeChanges(previous, {
      snapshotHash: hash,
      price: snapshot.price,
      volatilityState,
      trendState,
      rsi: snapshot.rsi,
      createdAt: new Date()
    });

    const newState: Omit<ScoutState, 'cacheAgeSeconds'> = {
      improvementScore: analysis.improvementScore,
      shouldReconvene: analysis.shouldReconvene,
      keyChanges: analysis.keyChanges,
      marketSummary: this.buildMarketSummary(symbol, snapshot, trendState, volatilityState),
      volatilityState,
      trendState,
      priceAtScan: snapshot.price
    };

    await sharedIntelligenceCoordinator.updateScoutState(symbol, timeframe, newState, hash);

    this.previousSnapshots.set(cacheKey, {
      snapshotHash: hash,
      price: snapshot.price,
      volatilityState,
      trendState,
      rsi: snapshot.rsi,
      createdAt: new Date()
    });

    return {
      symbol,
      timeframe,
      state: { ...newState, cacheAgeSeconds: 0 },
      wasUpdated: true
    };
  }

  private analyzeChanges(
    previous: PreviousScoutSnapshot | undefined,
    current: PreviousScoutSnapshot
  ): {
    improvementScore: number;
    shouldReconvene: boolean;
    keyChanges: string[];
  } {
    if (!previous) {
      return {
        improvementScore: 0,
        shouldReconvene: true,
        keyChanges: ['Initial scan - no previous data']
      };
    }

    const keyChanges: string[] = [];
    let improvementScore = 0;

    const pricePctChange = Math.abs((current.price - previous.price) / previous.price) * 100;
    if (pricePctChange > 0.5) {
      keyChanges.push(`Price moved ${pricePctChange.toFixed(2)}%`);
      improvementScore += Math.min(pricePctChange * 10, 30);
    }

    if (current.trendState !== previous.trendState) {
      keyChanges.push(`Trend changed: ${previous.trendState} -> ${current.trendState}`);
      improvementScore += 25;
    }

    if (current.volatilityState !== previous.volatilityState) {
      keyChanges.push(`Volatility changed: ${previous.volatilityState} -> ${current.volatilityState}`);
      improvementScore += 20;
    }

    const rsiChange = Math.abs(current.rsi - previous.rsi);
    if (rsiChange > 10) {
      keyChanges.push(`RSI shifted ${rsiChange.toFixed(0)} points`);
      improvementScore += Math.min(rsiChange, 25);
    }

    const crossedOverbought = (previous.rsi < 70 && current.rsi >= 70) ||
                              (previous.rsi >= 70 && current.rsi < 70);
    const crossedOversold = (previous.rsi < 30 && current.rsi >= 30) ||
                            (previous.rsi >= 30 && current.rsi < 30);
    if (crossedOverbought) {
      keyChanges.push(`RSI crossed 70 level`);
      improvementScore += 15;
    }
    if (crossedOversold) {
      keyChanges.push(`RSI crossed 30 level`);
      improvementScore += 15;
    }

    improvementScore = Math.min(improvementScore, 100);

    const shouldReconvene = improvementScore >= 50;

    return {
      improvementScore,
      shouldReconvene,
      keyChanges
    };
  }

  private buildMarketSummary(
    symbol: string,
    snapshot: { price: number; rsi: number; atr: number },
    trendState: string,
    volatilityState: string
  ): string {
    const trendLabel = {
      'strong_bull': 'Strong bullish',
      'bull': 'Bullish',
      'sideways': 'Ranging',
      'bear': 'Bearish',
      'strong_bear': 'Strong bearish'
    }[trendState] || 'Unknown';

    const volLabel = {
      'low': 'calm',
      'medium': 'normal',
      'high': 'elevated',
      'extreme': 'extremely volatile'
    }[volatilityState] || 'normal';

    let rsiStatus = 'neutral';
    if (snapshot.rsi >= 70) rsiStatus = 'overbought';
    else if (snapshot.rsi <= 30) rsiStatus = 'oversold';

    return `${symbol}: ${trendLabel} trend, ${volLabel} volatility, RSI ${rsiStatus} (${snapshot.rsi.toFixed(0)})`;
  }

  private async fetchCandlesForSymbol(symbol: string, timeframe: string): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('forex_candles')
        .select('time, open, high, low, close, volume')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('time', { ascending: false })
        .limit(100);

      if (error) {
        console.error(`[GlobalScout] Supabase error for ${symbol}:`, error);
        return [];
      }

      const candles = (data || []).reverse().map(c => ({
        time: typeof c.time === 'number' ? c.time : new Date(c.time).getTime() / 1000,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume
      }));

      return candles;
    } catch (error) {
      console.error(`[GlobalScout] Failed to fetch candles for ${symbol}:`, error);
      return [];
    }
  }

  async getScoutStateForSymbol(symbol: string, timeframe: string = 'M15'): Promise<ScoutState | null> {
    return sharedIntelligenceCoordinator.getScoutState(symbol, timeframe);
  }

  async getAllScoutStates(timeframe: string = 'M15'): Promise<Map<string, ScoutState>> {
    const results = new Map<string, ScoutState>();

    for (const symbol of DEFAULT_WATCHLIST) {
      const state = await sharedIntelligenceCoordinator.getScoutState(symbol, timeframe);
      if (state) {
        results.set(symbol, state);
      }
    }

    return results;
  }

  getSymbolsRequiringReconvene(scoutResults: GlobalScoutResult[]): string[] {
    return scoutResults
      .filter(r => r.state?.shouldReconvene)
      .map(r => r.symbol);
  }

  clearLocalSnapshots(): void {
    this.previousSnapshots.clear();
    console.log('[GlobalScout] Local snapshots cleared');
  }
}

export const globalScoutRunner = new GlobalScoutRunner();
