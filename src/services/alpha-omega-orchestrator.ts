/**
 * Alpha + Omega Orchestrator
 *
 * Central service that:
 * - Builds snapshots for each Omega specialist
 * - Calls all Omegas in parallel
 * - Passes votes to Alpha coordinator
 * - Handles errors gracefully
 * - Provides easy integration point
 */

import { omegaTrend, type TrendSnapshot } from '../brains/omega/trend';
import { omegaScalper, type ScalperSnapshot } from '../brains/omega/scalper';
import { omegaSwing, type SwingSnapshot } from '../brains/omega/swing';
import { omegaReversal, type ReversalSnapshot } from '../brains/omega/reversal';
import { omegaVolatility, type VolatilitySnapshot } from '../brains/omega/volatility';
import { omegaRisk, type RiskSnapshot } from '../brains/omega/risk';
import { alphaCoordinator, type OmegaCouncilVotes, type MarketContext, type AlphaDecision } from '../brains/coordinator-alpha';
import { midTradeMonitor, type MidTradeSnapshot, type MidTradeDecision } from '../brains/midtrade-monitor';
import type { TraderScore } from './ai-identity';

export interface FullMarketState {
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
  volatility: string;
  momentum: number;
  support: number[];
  resistance: number[];
  swingHigh: number;
  swingLow: number;
  recentCandles: any[];
  structure?: { hh: boolean; hl: boolean; lh: boolean; ll: boolean };
}

export interface TradePosition {
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  entryTime: Date;
  symbol: string;
  positionSize: number;
  riskPct: number;
}

class AlphaOmegaOrchestrator {
  /**
   * Run full Alpha + Omega decision pipeline
   */
  async makeTradeDecision(
    marketState: FullMarketState,
    traderScore: TraderScore,
    proposedSL: number,
    proposedTP: number
  ): Promise<AlphaDecision> {
    console.log('[Alpha+Omega] 🎯 Starting decision pipeline...');

    // Build snapshots for each Omega
    const trendSnap = this.buildTrendSnapshot(marketState);
    const scalperSnap = this.buildScalperSnapshot(marketState);
    const swingSnap = this.buildSwingSnapshot(marketState);
    const reversalSnap = this.buildReversalSnapshot(marketState);
    const volatilitySnap = this.buildVolatilitySnapshot(marketState);
    const riskSnap = this.buildRiskSnapshot(marketState, proposedSL, proposedTP, 3);

    // Call all Omegas in parallel
    console.log('[Alpha+Omega] 🔮 Calling Omega Council (parallel)...');
    const startTime = Date.now();

    const [trendVote, scalperVote, swingVote, reversalVote, volatilityVote, riskVote] = await Promise.all([
      omegaTrend.evaluate(trendSnap).catch(err => {
        console.warn('[Omega Trend] Failed:', err.message);
        return null;
      }),
      omegaScalper.evaluate(scalperSnap).catch(err => {
        console.warn('[Omega Scalper] Failed:', err.message);
        return null;
      }),
      omegaSwing.evaluate(swingSnap).catch(err => {
        console.warn('[Omega Swing] Failed:', err.message);
        return null;
      }),
      omegaReversal.evaluate(reversalSnap).catch(err => {
        console.warn('[Omega Reversal] Failed:', err.message);
        return null;
      }),
      omegaVolatility.evaluate(volatilitySnap).catch(err => {
        console.warn('[Omega Volatility] Failed:', err.message);
        return null;
      }),
      omegaRisk.evaluate(riskSnap).catch(err => {
        console.warn('[Omega Risk] Failed:', err.message);
        return null;
      })
    ]);

    const omegaTime = Date.now() - startTime;
    console.log(`[Alpha+Omega] ✅ Omega Council complete (${omegaTime}ms)`);

    // Log Omega votes
    this.logOmegaVotes({
      trend: trendVote,
      scalper: scalperVote,
      swing: swingVote,
      reversal: reversalVote,
      volatility: volatilityVote,
      risk: riskVote
    });

    // Build market context for Alpha
    const marketContext: MarketContext = {
      symbol: marketState.symbol,
      regime: marketState.trend,
      volatility: marketState.volatility,
      price: marketState.price,
      atr: marketState.atr
    };

    // Alpha coordinates the decision
    console.log('[Alpha+Omega] 🧠 Alpha coordinating...');
    const alphaStart = Date.now();

    const decision = await alphaCoordinator.coordinate(
      {
        trend: trendVote,
        scalper: scalperVote,
        swing: swingVote,
        reversal: reversalVote,
        volatility: volatilityVote,
        risk: riskVote
      },
      marketContext,
      traderScore
    );

    const alphaTime = Date.now() - alphaStart;
    const totalTime = Date.now() - startTime;

    console.log(`[Alpha+Omega] ⚡ Alpha complete (${alphaTime}ms)`);
    console.log(`[Alpha+Omega] 📊 Total pipeline: ${totalTime}ms`);
    console.log(`[Alpha+Omega] 🎯 FINAL: ${decision.action} @ ${decision.confidence}%`);

    return decision;
  }

  /**
   * Monitor open trade (mid-trade evaluation)
   */
  async monitorOpenTrade(
    position: TradePosition,
    marketState: FullMarketState,
    traderScore: TraderScore,
    currentPrice: number,
    currentTime: Date
  ): Promise<MidTradeDecision | null> {
    // Calculate drawdown
    const directionFactor = position.direction === 'buy' ? 1 : -1;
    const drawdown = (position.entryPrice - currentPrice) * directionFactor;
    const slDistance = (position.entryPrice - position.stopLoss) * directionFactor;
    const drawdownPct = slDistance > 0 ? drawdown / slDistance : 0;

    // Thresholds
    const SOFT_TRIGGER = 0.30;
    const HARD_TRIGGER = 0.50;
    const EMERGENCY_TRIGGER = 0.70;

    if (drawdownPct < SOFT_TRIGGER) {
      // No monitoring needed
      return null;
    }

    // Build mid-trade snapshot
    const snapshot: MidTradeSnapshot = {
      p: currentPrice,
      ep: position.entryPrice,
      sl: position.stopLoss,
      tp: position.takeProfit,
      dir: position.direction,
      dd: drawdownPct,
      e20: marketState.ema20,
      e50: marketState.ema50,
      rsi: marketState.rsi,
      atr: marketState.atr,
      vw_d: currentPrice - marketState.vwap,
      tr: marketState.trend,
      vol: marketState.volatility,
      t: Math.floor((currentTime.getTime() - position.entryTime.getTime()) / 60000),
      risk_pct: position.riskPct,
      sym: position.symbol,
      structure: marketState.structure
    };

    // Determine check level
    if (drawdownPct >= EMERGENCY_TRIGGER) {
      console.log(`[MidTrade] 🚨 EMERGENCY check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateEmergency(snapshot, traderScore);
    } else if (drawdownPct >= HARD_TRIGGER) {
      console.log(`[MidTrade] ⚠️ HARD check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateHard(snapshot, traderScore);
    } else {
      console.log(`[MidTrade] ℹ️ SOFT check @ ${(drawdownPct * 100).toFixed(0)}% drawdown`);
      return await midTradeMonitor.evaluateSoft(snapshot, traderScore);
    }
  }

  /**
   * Build snapshot for Omega Trend
   */
  private buildTrendSnapshot(state: FullMarketState): TrendSnapshot {
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

  /**
   * Build snapshot for Omega Scalper
   */
  private buildScalperSnapshot(state: FullMarketState): ScalperSnapshot {
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

  /**
   * Build snapshot for Omega Swing
   */
  private buildSwingSnapshot(state: FullMarketState): SwingSnapshot {
    return {
      p: state.price,
      sup: state.support,
      res: state.resistance,
      sw: { h: state.swingHigh, l: state.swingLow },
      str: this.determineStructure(state),
      tr: state.trend
    };
  }

  /**
   * Build snapshot for Omega Reversal
   */
  private buildReversalSnapshot(state: FullMarketState): ReversalSnapshot {
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

  /**
   * Build snapshot for Omega Volatility
   */
  private buildVolatilitySnapshot(state: FullMarketState): VolatilitySnapshot {
    const recentCandles = state.recentCandles.slice(-5).map(c => [
      c.open, c.high, c.low, c.close
    ]);

    const wickRatio = this.calculateWickRatio(recentCandles);

    return {
      atr: state.atr,
      atr_avg: state.atr,
      vol: state.volatility,
      c: recentCandles,
      wick_ratio: wickRatio
    };
  }

  /**
   * Build snapshot for Omega Risk
   */
  private buildRiskSnapshot(
    state: FullMarketState,
    proposedSL: number,
    proposedTP: number,
    riskPct: number
  ): RiskSnapshot {
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

  /**
   * Determine structure pattern
   */
  private determineStructure(state: FullMarketState): string {
    if (state.structure) {
      if (state.structure.hh && state.structure.hl) return 'hh';
      if (state.structure.ll && state.structure.lh) return 'll';
    }
    return 'unknown';
  }

  /**
   * Calculate wick/body ratio
   */
  private calculateWickRatio(candles: number[][]): number {
    if (candles.length === 0) return 0;

    let totalWickRatio = 0;
    for (const [open, high, low, close] of candles) {
      const body = Math.abs(close - open);
      const upperWick = high - Math.max(open, close);
      const lowerWick = Math.min(open, close) - low;
      const totalWick = upperWick + lowerWick;

      if (body > 0) {
        totalWickRatio += totalWick / body;
      }
    }

    return totalWickRatio / candles.length;
  }

  /**
   * Log Omega votes
   */
  private logOmegaVotes(votes: OmegaCouncilVotes): void {
    console.log('[Omega Council Votes]:');
    console.log(`  Trend:      ${votes.trend?.vote || 'N/A'} @ ${votes.trend?.confidence || 0}% - ${votes.trend?.reasoning || ''}`);
    console.log(`  Scalper:    ${votes.scalper?.vote || 'N/A'} @ ${votes.scalper?.confidence || 0}% - ${votes.scalper?.reasoning || ''}`);
    console.log(`  Swing:      ${votes.swing?.vote || 'N/A'} @ ${votes.swing?.confidence || 0}% - ${votes.swing?.reasoning || ''}`);
    console.log(`  Reversal:   ${votes.reversal?.vote || 'N/A'} @ ${votes.reversal?.confidence || 0}% - ${votes.reversal?.reasoning || ''}`);
    console.log(`  Volatility: ${votes.volatility?.vote || 'N/A'} @ ${votes.volatility?.confidence || 0}% - ${votes.volatility?.reasoning || ''}`);
    console.log(`  Risk:       ${votes.risk?.vote || 'N/A'} @ ${votes.risk?.confidence || 0}% - ${votes.risk?.reasoning || ''}`);
  }
}

export const alphaOmegaOrchestrator = new AlphaOmegaOrchestrator();
