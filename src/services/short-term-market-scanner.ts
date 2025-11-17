/**
 * Short-Term Market Scanner
 *
 * Scans for high-probability scalp and intraday opportunities.
 * Focuses exclusively on minutes-to-hours setups.
 */

import { PIPNOSIS_CORE_RULES } from '../lib/pipnosis-core-rules';
import { marketSnapshotBuilder } from './market-snapshot-builder';
import { llmStrategyBrain } from './llm-strategy-brain';

export interface ShortTermOpportunity {
  symbol: string;
  timeframe: string;
  setupType: string;
  direction: 'long' | 'short';
  confidence: number;
  entryZone: {
    min: number;
    max: number;
    ideal: number;
  };
  stopLoss: number;
  takeProfit: number;
  expectedDurationMinutes: number;
  reasoning: string;
  urgency: 'immediate' | 'developing' | 'watch';
  marketConditions: {
    trend: string;
    volatility: string;
    priceAction: string;
  };
}

class ShortTermMarketScanner {
  private lastScanResults: Map<string, ShortTermOpportunity[]> = new Map();
  private scanInProgress: boolean = false;

  async scanWatchlist(
    symbols: string[],
    minConfidence: number = 65
  ): Promise<ShortTermOpportunity[]> {
    if (this.scanInProgress) {
      console.log('[Short-Term Scanner] Scan already in progress, skipping');
      return this.getLastResults(symbols[0]);
    }

    this.scanInProgress = true;

    try {
      console.log(`[Short-Term Scanner] Scanning ${symbols.length} symbols for short-term opportunities`);

      const opportunities: ShortTermOpportunity[] = [];

      for (const symbol of symbols) {
        const snapshot = await marketSnapshotBuilder.buildSnapshot(symbol, 0, 0);
        if (!snapshot) continue;

        const opportunity = await this.analyzeForShortTermSetup(symbol, snapshot, minConfidence);
        if (opportunity) {
          opportunities.push(opportunity);
        }
      }

      const sortedOpps = opportunities.sort((a, b) => {
        const urgencyWeight = { immediate: 3, developing: 2, watch: 1 };
        const urgencyDiff = urgencyWeight[b.urgency] - urgencyWeight[a.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        return b.confidence - a.confidence;
      });

      this.lastScanResults.set('latest', sortedOpps);

      console.log(`[Short-Term Scanner] Found ${sortedOpps.length} opportunities`);

      return sortedOpps;

    } finally {
      this.scanInProgress = false;
    }
  }

  private async analyzeForShortTermSetup(
    symbol: string,
    snapshot: any,
    minConfidence: number
  ): Promise<ShortTermOpportunity | null> {
    const decision = await llmStrategyBrain.makeDecision(snapshot);

    if (decision.action === 'no_trade' || decision.action === 'hold') {
      return null;
    }

    if (decision.confidence < minConfidence) {
      return null;
    }

    if ((decision.expectedDurationMinutes || 0) > PIPNOSIS_CORE_RULES.TRADE_DURATION_MAX_MINUTES) {
      return null;
    }

    const tfData = snapshot.timeframes.M15;
    const urgency = this.determineUrgency(decision, tfData);

    return {
      symbol,
      timeframe: 'M15',
      setupType: decision.setupType,
      direction: decision.action === 'enter_long' ? 'long' : 'short',
      confidence: decision.confidence,
      entryZone: decision.entryZone || {
        min: tfData.currentPrice * 0.9995,
        max: tfData.currentPrice * 1.0005,
        ideal: tfData.currentPrice
      },
      stopLoss: decision.stopLoss || 0,
      takeProfit: decision.takeProfit || 0,
      expectedDurationMinutes: decision.expectedDurationMinutes || 90,
      reasoning: decision.reasoning,
      urgency,
      marketConditions: {
        trend: tfData.trend,
        volatility: tfData.volatility,
        priceAction: snapshot.recentPriceAction
      }
    };
  }

  private determineUrgency(
    decision: any,
    tfData: any
  ): 'immediate' | 'developing' | 'watch' {
    if (decision.confidence >= 80) {
      const priceVsVwap = Math.abs((tfData.currentPrice - tfData.vwap) / tfData.vwap) * 100;
      if (priceVsVwap < 0.1) {
        return 'immediate';
      }
    }

    if (decision.confidence >= 70) {
      return 'developing';
    }

    return 'watch';
  }

  async quickScan(symbol: string): Promise<ShortTermOpportunity | null> {
    const snapshot = await marketSnapshotBuilder.buildSnapshot(symbol, 0, 0);
    if (!snapshot) return null;

    return this.analyzeForShortTermSetup(symbol, snapshot, 60);
  }

  getLastResults(key: string = 'latest'): ShortTermOpportunity[] {
    return this.lastScanResults.get(key) || [];
  }

  async findScalpingOpportunities(symbols: string[]): Promise<ShortTermOpportunity[]> {
    const allOpps = await this.scanWatchlist(symbols, 70);

    return allOpps.filter(opp =>
      opp.expectedDurationMinutes <= 60 &&
      opp.urgency === 'immediate' &&
      opp.marketConditions.volatility !== 'low'
    );
  }

  async findIntradaySwings(symbols: string[]): Promise<ShortTermOpportunity[]> {
    const allOpps = await this.scanWatchlist(symbols, 65);

    return allOpps.filter(opp =>
      opp.expectedDurationMinutes > 60 &&
      opp.expectedDurationMinutes <= PIPNOSIS_CORE_RULES.TRADE_DURATION_PREFERRED_MAX_HOURS * 60 &&
      opp.marketConditions.trend !== 'sideways'
    );
  }

  async scanByTimeframe(
    symbols: string[],
    preferredDuration: 'ultra_fast' | 'fast' | 'normal'
  ): Promise<ShortTermOpportunity[]> {
    const durationLimits = {
      ultra_fast: 30,
      fast: 90,
      normal: 180
    };

    const maxDuration = durationLimits[preferredDuration];
    const allOpps = await this.scanWatchlist(symbols, 65);

    return allOpps.filter(opp => opp.expectedDurationMinutes <= maxDuration);
  }

  clearCache(): void {
    this.lastScanResults.clear();
    console.log('[Short-Term Scanner] Cache cleared');
  }

  getStats(): {
    isScanningNow: boolean;
    cachedResults: number;
  } {
    return {
      isScanningNow: this.scanInProgress,
      cachedResults: Array.from(this.lastScanResults.values()).flat().length
    };
  }
}

export const shortTermMarketScanner = new ShortTermMarketScanner();
