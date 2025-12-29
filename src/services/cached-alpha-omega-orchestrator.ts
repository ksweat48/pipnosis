import { alphaOmegaOrchestrator, FullMarketState } from './alpha-omega-orchestrator';
import { sharedIntelligenceCoordinator, CachedOmegaIntelligence, AlphaStrategicInsight } from './shared-intelligence-coordinator';
import { globalScoutRunner } from './global-scout-runner';
import { omegaTrend } from '../brains/omega/trend';
import { omegaScalper } from '../brains/omega/scalper';
import { omegaConfirmation } from '../brains/omega/confirmation';
import { omegaReversal } from '../brains/omega/reversal';
import { omegaVolatility } from '../brains/omega/volatility';
import { omegaRisk } from '../brains/omega/risk';
import { omega8Hybrid } from '../brains/omega8-hybrid-orderflow';
import type { AlphaDecision, GoalContext } from '../brains/coordinator-alpha';
import type { TraderScore } from './ai-identity';
import type { CandleData } from '../types';

export interface CachedDecisionResult {
  decision: AlphaDecision;
  cacheStats: {
    omegaCacheHits: number;
    omegaCacheMisses: number;
    alphaCacheHit: boolean;
    totalLlmCallsSaved: number;
  };
}

class CachedAlphaOmegaOrchestrator {
  private useCache = true;

  setUseCache(enabled: boolean): void {
    this.useCache = enabled;
    console.log(`[CachedOrchestrator] Cache ${enabled ? 'enabled' : 'disabled'}`);
  }

  async makeTradeDecisionWithCache(
    marketState: FullMarketState,
    traderScore: TraderScore,
    proposedSL: number,
    proposedTP: number,
    goalContext?: GoalContext,
    candles?: CandleData[]
  ): Promise<CachedDecisionResult> {
    if (!this.useCache || !candles || candles.length < 20) {
      const decision = await alphaOmegaOrchestrator.makeTradeDecision(
        marketState,
        traderScore,
        proposedSL,
        proposedTP,
        goalContext
      );

      return {
        decision,
        cacheStats: {
          omegaCacheHits: 0,
          omegaCacheMisses: 7,
          alphaCacheHit: false,
          totalLlmCallsSaved: 0
        }
      };
    }

    const timeframe = 'M15';
    const startTime = Date.now();

    console.log(`[CachedOrchestrator] Starting cached decision pipeline for ${marketState.symbol}...`);

    const omegaIntelligence = await this.getCachedOmegaIntelligence(
      marketState,
      candles,
      timeframe,
      proposedSL,
      proposedTP
    );

    const cacheHits = Array.from(omegaIntelligence.values()).filter(v => v.fromCache).length;
    const cacheMisses = omegaIntelligence.size - cacheHits;

    console.log(`[CachedOrchestrator] Omega cache: ${cacheHits}/${omegaIntelligence.size} hits`);

    const omegaVotes = this.buildOmegaVotesArray(omegaIntelligence);

    const alphaInsight = await this.getCachedAlphaInsight(
      marketState.symbol,
      timeframe,
      omegaVotes,
      omegaIntelligence,
      marketState,
      traderScore,
      goalContext
    );

    console.log(`[CachedOrchestrator] Alpha cache ${alphaInsight.fromCache ? 'HIT' : 'MISS'}`);

    const decision = this.buildDecisionFromInsight(
      alphaInsight,
      omegaIntelligence,
      marketState,
      proposedSL,
      proposedTP
    );

    const totalTime = Date.now() - startTime;
    const llmCallsSaved = cacheHits + (alphaInsight.fromCache ? 1 : 0);

    console.log(`[CachedOrchestrator] Complete in ${totalTime}ms, saved ${llmCallsSaved} LLM calls`);

    return {
      decision,
      cacheStats: {
        omegaCacheHits: cacheHits,
        omegaCacheMisses: cacheMisses,
        alphaCacheHit: alphaInsight.fromCache,
        totalLlmCallsSaved: llmCallsSaved
      }
    };
  }

  private async getCachedOmegaIntelligence(
    marketState: FullMarketState,
    candles: CandleData[],
    timeframe: string,
    proposedSL: number,
    proposedTP: number
  ): Promise<Map<string, CachedOmegaIntelligence>> {
    const results = new Map<string, CachedOmegaIntelligence>();

    const brainConfigs: Array<{
      name: string;
      fetcher: () => Promise<{ vote: string; confidence: number; reasoning: string }>;
    }> = [
      {
        name: 'trend',
        fetcher: async () => {
          const snap = this.buildTrendSnapshot(marketState);
          const result = await omegaTrend.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'scalper',
        fetcher: async () => {
          const snap = this.buildScalperSnapshot(marketState);
          const result = await omegaScalper.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'confirmation',
        fetcher: async () => {
          const snap = this.buildConfirmationSnapshot(marketState);
          const result = await omegaConfirmation.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'reversal',
        fetcher: async () => {
          const snap = this.buildReversalSnapshot(marketState);
          const result = await omegaReversal.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'volatility',
        fetcher: async () => {
          const snap = this.buildVolatilitySnapshot(marketState);
          const result = await omegaVolatility.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'risk',
        fetcher: async () => {
          const snap = this.buildRiskSnapshot(marketState, proposedSL, proposedTP, 3);
          const result = await omegaRisk.evaluate(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      },
      {
        name: 'orderflow',
        fetcher: async () => {
          const snap = this.buildOmega8Snapshot(marketState);
          const result = await omega8Hybrid.runOmega8(snap);
          return result || { vote: 'NO_TRADE', confidence: 0, reasoning: 'Failed' };
        }
      }
    ];

    const promises = brainConfigs.map(async ({ name, fetcher }) => {
      try {
        const result = await sharedIntelligenceCoordinator.getOmegaIntelligence(
          marketState.symbol,
          timeframe,
          name as any,
          candles,
          async () => {
            const r = await fetcher();
            return {
              vote: r.vote as any,
              confidence: r.confidence,
              reasoning: r.reasoning
            };
          }
        );
        return { name, result };
      } catch (err) {
        console.warn(`[CachedOrchestrator] ${name} brain failed:`, err);
        return {
          name,
          result: {
            brainName: name,
            vote: { vote: 'NO_TRADE' as const, confidence: 0, reasoning: 'Error' },
            cacheAgeSeconds: 0,
            fromCache: false
          }
        };
      }
    });

    const allResults = await Promise.all(promises);
    for (const { name, result } of allResults) {
      results.set(name, result);
    }

    return results;
  }

  private async getCachedAlphaInsight(
    symbol: string,
    timeframe: string,
    omegaVotes: Array<{ brainName: string; vote: string; confidence: number }>,
    omegaIntelligence: Map<string, CachedOmegaIntelligence>,
    marketState: FullMarketState,
    traderScore: TraderScore,
    goalContext?: GoalContext
  ): Promise<AlphaStrategicInsight> {
    return sharedIntelligenceCoordinator.getAlphaStrategicInsight(
      symbol,
      timeframe,
      omegaVotes,
      async () => {
        const buyVotes = omegaVotes.filter(v => v.vote === 'BUY');
        const sellVotes = omegaVotes.filter(v => v.vote === 'SELL');

        let marketBias: 'bullish' | 'bearish' | 'neutral' | 'mixed' = 'neutral';
        let suggestedDirection: 'buy' | 'sell' | 'wait' | 'no_trade' = 'wait';

        const buyConfidence = buyVotes.reduce((sum, v) => sum + v.confidence, 0) / Math.max(buyVotes.length, 1);
        const sellConfidence = sellVotes.reduce((sum, v) => sum + v.confidence, 0) / Math.max(sellVotes.length, 1);

        if (buyVotes.length > sellVotes.length + 2 && buyConfidence > 60) {
          marketBias = 'bullish';
          suggestedDirection = 'buy';
        } else if (sellVotes.length > buyVotes.length + 2 && sellConfidence > 60) {
          marketBias = 'bearish';
          suggestedDirection = 'sell';
        } else if (buyVotes.length > 0 && sellVotes.length > 0) {
          marketBias = 'mixed';
          suggestedDirection = 'wait';
        }

        const conviction = Math.max(buyConfidence, sellConfidence);
        const waitRecommended = conviction < 60 || marketBias === 'mixed';

        const omegaSummary: Record<string, unknown> = {};
        for (const [name, intel] of omegaIntelligence) {
          omegaSummary[name] = {
            vote: intel.vote.vote,
            confidence: intel.vote.confidence
          };
        }

        return {
          marketBias,
          conviction: Math.round(conviction),
          suggestedDirection,
          rrRangeMin: 1.5,
          rrRangeMax: 3.0,
          waitRecommended,
          keyReasoning: `${buyVotes.length} buy vs ${sellVotes.length} sell votes. ${marketBias} bias with ${conviction.toFixed(0)}% conviction.`,
          omegaSummary
        };
      }
    );
  }

  private buildOmegaVotesArray(
    omegaIntelligence: Map<string, CachedOmegaIntelligence>
  ): Array<{ brainName: string; vote: string; confidence: number }> {
    const votes: Array<{ brainName: string; vote: string; confidence: number }> = [];

    for (const [name, intel] of omegaIntelligence) {
      votes.push({
        brainName: name,
        vote: intel.vote.vote,
        confidence: intel.vote.confidence
      });
    }

    return votes;
  }

  private buildDecisionFromInsight(
    alphaInsight: AlphaStrategicInsight,
    omegaIntelligence: Map<string, CachedOmegaIntelligence>,
    marketState: FullMarketState,
    proposedSL: number,
    proposedTP: number
  ): AlphaDecision {
    let action: 'BUY' | 'SELL' | 'NO_TRADE' | 'WAIT' = 'NO_TRADE';

    if (alphaInsight.waitRecommended) {
      action = 'WAIT';
    } else if (alphaInsight.suggestedDirection === 'buy' && alphaInsight.conviction >= 60) {
      action = 'BUY';
    } else if (alphaInsight.suggestedDirection === 'sell' && alphaInsight.conviction >= 60) {
      action = 'SELL';
    } else {
      action = 'NO_TRADE';
    }

    let entry = marketState.price;
    let stopLoss = proposedSL;
    let takeProfit = proposedTP;

    if (action === 'SELL') {
      stopLoss = marketState.price + (marketState.price - proposedSL);
      takeProfit = marketState.price - (proposedTP - marketState.price);
    }

    const omegaSummaryParts: string[] = [];
    for (const [name, intel] of omegaIntelligence) {
      omegaSummaryParts.push(`${name}: ${intel.vote.vote}@${intel.vote.confidence}%`);
    }

    return {
      action,
      decision: action,
      entry,
      stopLoss,
      takeProfit,
      confidence: alphaInsight.conviction,
      reasoning: alphaInsight.keyReasoning,
      omega_summary: omegaSummaryParts.join(', ')
    };
  }

  async checkScoutShouldReconvene(symbol: string, timeframe: string = 'M15'): Promise<boolean> {
    const scoutState = await globalScoutRunner.getScoutStateForSymbol(symbol, timeframe);
    return scoutState?.shouldReconvene ?? true;
  }

  private buildTrendSnapshot(state: FullMarketState) {
    return {
      p: state.price,
      e20: state.ema20,
      e50: state.ema50,
      e200: state.ema200,
      mom: state.momentum,
      tr: state.trend,
      vol: state.volatility
    };
  }

  private buildScalperSnapshot(state: FullMarketState) {
    const recentCandles = state.recentCandles.slice(-3).map(c => [
      c.open, c.high, c.low, c.close
    ]);
    return {
      p: state.price,
      vw: state.vwap,
      atr: state.atr,
      rsi: state.rsi,
      vol: state.volatility,
      c: recentCandles
    };
  }

  private buildConfirmationSnapshot(state: FullMarketState) {
    return {
      p: state.price,
      sup: state.support,
      res: state.resistance,
      sw: { h: state.swingHigh, l: state.swingLow },
      str: 'unknown',
      tr: state.trend
    };
  }

  private buildReversalSnapshot(state: FullMarketState) {
    return {
      p: state.price,
      rsi: state.rsi,
      st: state.stochRsi,
      mom: state.momentum,
      e20: state.ema20,
      e50: state.ema50,
      tr: state.trend,
      vol: state.volatility
    };
  }

  private buildVolatilitySnapshot(state: FullMarketState) {
    const recentCandles = state.recentCandles.slice(-5).map(c => [
      c.open, c.high, c.low, c.close
    ]);
    return {
      atr: state.atr,
      atr_avg: state.atr,
      vol: state.volatility,
      c: recentCandles,
      wick_ratio: 0.5
    };
  }

  private buildRiskSnapshot(state: FullMarketState, proposedSL: number, proposedTP: number, riskPct: number) {
    return {
      p: state.price,
      proposed_sl: proposedSL,
      proposed_tp: proposedTP,
      atr: state.atr,
      sup: state.support,
      res: state.resistance,
      vol: state.volatility,
      risk_pct: riskPct
    };
  }

  private buildOmega8Snapshot(state: FullMarketState) {
    const candles = state.recentCandles.slice(-30).map(c => ({
      time: c.time || Date.now(),
      open: c.open || c[0],
      high: c.high || c[1],
      low: c.low || c[2],
      close: c.close || c[3],
      volume: c.volume || c[4] || 1000
    }));

    let trendBias: 'up' | 'down' | 'sideways' = 'sideways';
    if (state.trend === 'bull') trendBias = 'up';
    else if (state.trend === 'bear') trendBias = 'down';

    return {
      symbol: state.symbol,
      timeframe: 'M15',
      price: state.price,
      atr: state.atr,
      candles,
      trendBias,
      support: state.support,
      resistance: state.resistance
    };
  }
}

export const cachedAlphaOmegaOrchestrator = new CachedAlphaOmegaOrchestrator();
