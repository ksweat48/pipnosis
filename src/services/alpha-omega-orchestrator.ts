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
import { omegaConfirmation, type ConfirmationSnapshot } from '../brains/omega/confirmation';
import { omegaReversal, type ReversalSnapshot } from '../brains/omega/reversal';
import { omegaVolatility, type VolatilitySnapshot } from '../brains/omega/volatility';
import { omegaRisk, type RiskSnapshot } from '../brains/omega/risk';
import { omega8Hybrid, type Omega8MarketSnapshot } from '../brains/omega8-hybrid-orderflow';
import { alphaCoordinator, type OmegaCouncilVotes, type MarketContext, type AlphaDecision } from '../brains/coordinator-alpha';
import { midTradeMonitor, type MidTradeSnapshot, type MidTradeDecision } from '../brains/midtrade-monitor';
import type { TraderScore } from './ai-identity';
import { omegaAlphaLogger } from './omega-alpha-logger';
import type { OmegaSensors } from './omega-sensors';
import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';
import { sentimentCoordinator } from './sentiment-coordinator';
import type { AggregatedSentiment } from './sentiment-aggregator';

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
  omegaSensors: OmegaSensors; // Pro-trader indicators at zero cost
  regime?: RegimeSnapshot; // Market regime intelligence (session, volatility, structure)
  adversarial?: AdversarialSignal; // Adversarial manipulation detection
  sentiment?: AggregatedSentiment; // Omega-7 market sentiment analysis
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
    proposedTP: number,
    goalContext?: import('../brains/coordinator-alpha').GoalContext
  ): Promise<AlphaDecision> {
    console.log('[Alpha+Omega] 🎯 Starting decision pipeline...');

    // ✅ STEP 0: Get Omega-7 Market Sentiment (if not already provided)
    let sentiment = marketState.sentiment;
    if (!sentiment) {
      try {
        console.log('[Alpha+Omega] 🔮 Fetching Omega-7 sentiment...');
        sentiment = await sentimentCoordinator.getCurrentSentiment();
        if (sentiment) {
          console.log(`[Alpha+Omega] ✅ Omega-7: ${sentiment.sentiment.toUpperCase()} | USD: ${sentiment.usd_strength} | Vol: ${sentiment.volatility} | Confidence: ${sentiment.confidence}%`);
          console.log(`[Alpha+Omega] 📰 Sentiment: ${sentiment.summary}`);
          marketState.sentiment = sentiment; // Add to market state for Omegas
        } else {
          console.warn('[Alpha+Omega] ⚠️ Omega-7 sentiment unavailable - proceeding without');
        }
      } catch (error) {
        console.warn('[Alpha+Omega] ⚠️ Omega-7 failed:', error);
      }
    }

    // Build snapshots for each Omega
    const trendSnap = this.buildTrendSnapshot(marketState);
    const scalperSnap = this.buildScalperSnapshot(marketState);
    const confirmationSnap = this.buildConfirmationSnapshot(marketState);
    const reversalSnap = this.buildReversalSnapshot(marketState);
    const volatilitySnap = this.buildVolatilitySnapshot(marketState);
    const riskSnap = this.buildRiskSnapshot(marketState, proposedSL, proposedTP, 3);
    const omega8Snap = this.buildOmega8HybridSnapshot(marketState);

    // Call all Omegas in parallel
    console.log('[Alpha+Omega] 🔮 Calling Omega Council (parallel)...');
    const startTime = Date.now();

    const [trendVote, scalperVote, confirmationVote, reversalVote, volatilityVote, riskVote, omega8Vote] = await Promise.all([
      omegaTrend.evaluate(trendSnap).catch(err => {
        console.warn('[Omega Trend] Failed:', err.message);
        return null;
      }),
      omegaScalper.evaluate(scalperSnap).catch(err => {
        console.warn('[Omega Scalper] Failed:', err.message);
        return null;
      }),
      omegaConfirmation.evaluate(confirmationSnap).catch(err => {
        console.warn('[Omega Confirmation] Failed:', err.message);
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
      }),
      omega8Hybrid.runOmega8(omega8Snap).catch(err => {
        console.warn('[Omega-8 Hybrid] Failed:', err.message);
        return null;
      })
    ]);

    const omegaTime = Date.now() - startTime;
    console.log(`[Alpha+Omega] ✅ Omega Council complete (${omegaTime}ms)`);

    // Log Omega votes
    this.logOmegaVotes({
      trend: trendVote,
      scalper: scalperVote,
      confirmation: confirmationVote,
      reversal: reversalVote,
      volatility: volatilityVote,
      risk: riskVote,
      omega8: omega8Vote
    });

    // ✅ DETECT Omega conflicts but DON'T BLOCK (Alpha has final authority)
    const conflictCheck = this.detectOmegaConflicts({
      trend: trendVote,
      scalper: scalperVote,
      confirmation: confirmationVote,
      reversal: reversalVote,
      volatility: volatilityVote,
      risk: riskVote,
      omega8: omega8Vote
    }, traderScore);

    // Log conflicts for Alpha's awareness (advisory only)
    if (conflictCheck.hasConflict) {
      console.warn(`[Alpha+Omega] ⚠️  OMEGA CONFLICT DETECTED (ADVISORY)`);
      console.warn(`[Alpha+Omega] Type: ${conflictCheck.conflictType}, Severity: ${conflictCheck.severity}`);
      console.warn(`[Alpha+Omega] Conflict: ${conflictCheck.conflictDescription}`);
      console.warn(`[Alpha+Omega] Alpha has final authority to override`);
    }

    // ✅ NEW: Risk Omega is ADVISORY, not blocking
    // Log Risk concerns but let Alpha decide final action
    if (!riskVote) {
      console.warn('[Alpha+Omega] ⚠️ Risk Omega failed - proceeding with caution');
    } else if (riskVote.vote === 'NO_TRADE' && riskVote.confidence >= 70) {
      console.warn('[Alpha+Omega] ⚠️ Risk Omega concerns (advisory only):');
      console.warn(`[Alpha+Omega] Risk reasoning: ${riskVote.reasoning}`);
      console.warn('[Alpha+Omega] Alpha will consider this input in final decision');
    }

    // Build market context for Alpha
    const marketContext: MarketContext = {
      symbol: marketState.symbol,
      regime: marketState.trend,
      volatility: marketState.volatility,
      price: marketState.price,
      atr: marketState.atr
    };

    // Alpha coordinates the decision (with full authority)
    console.log('[Alpha+Omega] 🧠 Alpha making final decision...');
    const alphaStart = Date.now();

    const decision = await alphaCoordinator.coordinate(
      {
        trend: trendVote,
        scalper: scalperVote,
        confirmation: confirmationVote,
        reversal: reversalVote,
        volatility: volatilityVote,
        risk: riskVote,
        omega8: omega8Vote
      },
      marketContext,
      traderScore,
      undefined, // userId - will be added if needed
      conflictCheck, // Pass conflict info to Alpha
      goalContext // Pass goal context for smart position sizing
    );

    const alphaTime = Date.now() - alphaStart;
    const totalTime = Date.now() - startTime;

    console.log(`[Alpha+Omega] ⚡ Alpha decision complete (${alphaTime}ms)`);
    console.log(`[Alpha+Omega] 📊 Total pipeline: ${totalTime}ms`);
    console.log(`[Alpha+Omega] 🎯 Alpha decided: ${decision.action} @ ${decision.confidence}%`);

    return decision;
  }

  /**
   * Evaluate multiple symbols and return decisions for each
   */
  async evaluateMultipleSymbols(
    marketStates: FullMarketState[],
    traderScore: TraderScore,
    userId?: string,
    goalContext?: import('../brains/coordinator-alpha').GoalContext
  ): Promise<Map<string, AlphaDecision>> {
    console.log(`[Alpha+Omega] 🔍 Evaluating ${marketStates.length} symbols in parallel...`);
    const startTime = Date.now();

    const evaluationPromises = marketStates.map(async (marketState) => {
      try {
        // Calculate dynamic stop loss based on volatility regime
        const { stopLossMultiplier, takeProfitMultiplier } = this.calculateDynamicMultipliers(marketState);

        const proposedSL = marketState.price - (marketState.atr * stopLossMultiplier);
        const proposedTP = marketState.price + (marketState.atr * takeProfitMultiplier);

        console.log(`[Alpha+Omega] Dynamic SL/TP for ${marketState.symbol}: ${stopLossMultiplier.toFixed(2)}x / ${takeProfitMultiplier.toFixed(2)}x ATR`);

        const decision = await this.makeTradeDecision(
          marketState,
          traderScore,
          proposedSL,
          proposedTP,
          goalContext
        );

        return {
          symbol: marketState.symbol,
          decision
        };
      } catch (error) {
        console.error(`[Alpha+Omega] Failed to evaluate ${marketState.symbol}:`, error);
        return {
          symbol: marketState.symbol,
          decision: {
            action: 'NO_TRADE' as const,
            decision: 'NO_TRADE' as const,
            entry: marketState.price,
            stopLoss: marketState.price,
            takeProfit: marketState.price,
            confidence: 0,
            reasoning: `Evaluation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
            omega_summary: 'System error during evaluation'
          }
        };
      }
    });

    const results = await Promise.all(evaluationPromises);
    const decisionMap = new Map<string, AlphaDecision>();

    results.forEach(result => {
      decisionMap.set(result.symbol, result.decision);
    });

    const duration = Date.now() - startTime;
    console.log(`[Alpha+Omega] ✅ Multi-symbol evaluation complete in ${duration}ms`);

    return decisionMap;
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
   * Calculate dynamic stop loss and take profit multipliers based on market conditions
   */
  private calculateDynamicMultipliers(marketState: FullMarketState): {
    stopLossMultiplier: number;
    takeProfitMultiplier: number;
  } {
    let slMultiplier = 1.8; // Base: 1.8x ATR (increased from 1.5x for more breathing room)
    let tpMultiplier = 3.0; // Base: 3.0x ATR (increased from 2.5x for better R:R)

    // Adjust for volatility
    if (marketState.volatility === 'low') {
      slMultiplier = 1.5; // Tighter stops in low volatility
      tpMultiplier = 2.5;
    } else if (marketState.volatility === 'high') {
      slMultiplier = 2.5; // Wider stops in high volatility
      tpMultiplier = 4.0;
    }

    // Adjust for regime if available
    if (marketState.regime) {
      // High risk regime = wider stops
      if (marketState.regime.is_high_risk_regime) {
        slMultiplier *= 1.3;
        tpMultiplier *= 1.2;
      }

      // ATR expansion = wider stops
      if (marketState.regime.atr_expansion > 1.5) {
        slMultiplier *= 1.2;
      }

      // Wick risk = wider stops
      if (marketState.regime.wick_risk === 'high') {
        slMultiplier *= 1.2;
      }
    }

    // Adjust for adversarial conditions
    if (marketState.adversarial) {
      if (marketState.adversarial.level === 'moderate') {
        slMultiplier *= 1.15;
      } else if (marketState.adversarial.level === 'severe') {
        slMultiplier *= 1.3;
      }
    }

    // Ensure minimum R:R ratio of 1.5:1
    if (tpMultiplier / slMultiplier < 1.5) {
      tpMultiplier = slMultiplier * 1.5;
    }

    return {
      stopLossMultiplier: slMultiplier,
      takeProfitMultiplier: tpMultiplier
    };
  }

  /**
   * Build snapshot for Omega Trend
   */
  private buildTrendSnapshot(state: FullMarketState): TrendSnapshot {
    const base: TrendSnapshot = {
      p: state.price,
      e20: state.ema20,
      e50: state.ema50,
      e200: state.ema200,
      mom: state.momentum,
      tr: state.trend,
      vol: state.volatility
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          trend_strength: state.regime.trend_strength_score,
          structure: state.regime.structure,
          bias: state.regime.market_bias
        },
        adv: state.adversarial ? { lvl: state.adversarial.level, score: state.adversarial.suspicion_score } : undefined
      } as any;
    }

    return base;
  }

  /**
   * Build snapshot for Omega Scalper
   */
  private buildScalperSnapshot(state: FullMarketState): ScalperSnapshot {
    const recentCandles = state.recentCandles.slice(-3).map(c => [
      c.open, c.high, c.low, c.close
    ]);

    const base: ScalperSnapshot = {
      p: state.price,
      vw: state.vwap,
      atr: state.atr,
      rsi: state.rsi,
      vol: state.volatility,
      c: recentCandles
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          session: state.regime.session,
          session_open: state.regime.session_open,
          atr_expansion: state.regime.atr_expansion
        },
        adv: state.adversarial ? { lvl: state.adversarial.level, pat: state.adversarial.patterns.slice(0, 2) } : undefined
      } as any;
    }

    return base;
  }

  /**
   * Build snapshot for Omega Confirmation
   */
  private buildConfirmationSnapshot(state: FullMarketState): ConfirmationSnapshot {
    const base: ConfirmationSnapshot = {
      p: state.price,
      sup: state.support,
      res: state.resistance,
      sw: { h: state.swingHigh, l: state.swingLow },
      str: this.determineStructure(state),
      tr: state.trend
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          structure_type: state.regime.structure,
          structure_quality: state.regime.structure_quality
        },
        adv: state.adversarial ? { lvl: state.adversarial.level } : undefined
      } as any;
    }

    return base;
  }

  /**
   * Build snapshot for Omega Reversal
   */
  private buildReversalSnapshot(state: FullMarketState): ReversalSnapshot {
    const base: ReversalSnapshot = {
      p: state.price,
      rsi: state.rsi,
      st: state.stochRsi,
      mom: state.momentum,
      e20: state.ema20,
      e50: state.ema50,
      tr: state.trend,
      vol: state.volatility
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          atr_compression: state.regime.atr_compression,
          wick_risk: state.regime.wick_risk,
          structure: state.regime.structure
        },
        adv: state.adversarial ? { lvl: state.adversarial.level, pat: state.adversarial.patterns.slice(0, 2) } : undefined
      } as any;
    }

    return base;
  }

  /**
   * Build snapshot for Omega Volatility
   */
  private buildVolatilitySnapshot(state: FullMarketState): VolatilitySnapshot {
    const recentCandles = state.recentCandles.slice(-5).map(c => [
      c.open, c.high, c.low, c.close
    ]);

    const wickRatio = this.calculateWickRatio(recentCandles);

    const base: VolatilitySnapshot = {
      atr: state.atr,
      atr_avg: state.atr,
      vol: state.volatility,
      c: recentCandles,
      wick_ratio: wickRatio
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          volatility_score: state.regime.volatility_score,
          atr_compression: state.regime.atr_compression,
          atr_expansion: state.regime.atr_expansion,
          wick_risk: state.regime.wick_risk,
          volatility_trend: state.regime.volatility_trend
        },
        adv: state.adversarial ? { lvl: state.adversarial.level, score: state.adversarial.suspicion_score } : undefined
      } as any;
    }

    return base;
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
    const base: RiskSnapshot = {
      p: state.price,
      proposed_sl: proposedSL,
      proposed_tp: proposedTP,
      atr: state.atr,
      sup: state.support,
      res: state.resistance,
      vol: state.volatility,
      risk_pct: riskPct
    };

    // Add regime data if available
    if (state.regime) {
      return {
        ...base,
        regime: {
          volatility_score: state.regime.volatility_score,
          is_high_risk_regime: state.regime.is_high_risk_regime,
          risk_reduction_factor: state.regime.risk_reduction_factor
        },
        adv: state.adversarial ? { lvl: state.adversarial.level, score: state.adversarial.suspicion_score } : undefined
      } as any;
    }

    return base;
  }

  /**
   * Build snapshot for Omega-8 Hybrid OrderFlow
   */
  private buildOmega8HybridSnapshot(state: FullMarketState): Omega8MarketSnapshot {
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
  /**
   * Detect high-confidence directional conflicts between Omega brains
   * REFINED: Distinguishes between HARD BLOCK and SOFT WARNING
   * PERSONALITY-AWARE: Respects trader personality and risk mode
   */
  private detectOmegaConflicts(votes: OmegaCouncilVotes, traderScore: TraderScore): {
    hasConflict: boolean;
    conflictType: 'HARD' | 'SOFT' | 'NONE';
    severity: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';
    conflictDescription: string;
    confidencePenalty: number; // Multiplier to apply (0.8 = -20%, 1.0 = no change)
  } {
    const HIGH_CONFIDENCE = 70;

    // Personality settings influence conflict resolution
    const isAggressive = traderScore.personality === 'AGGRESSIVE';
    const isHighScore = traderScore.score >= 80;
    const isAggressiveMode = isAggressive && isHighScore;

    // Define conflicting domain pairs
    const conflictingDomains: Record<string, string[]> = {
      'Trend': ['Swing', 'OrderFlow'],
      'Swing': ['Trend', 'Reversal', 'OrderFlow'],
      'OrderFlow': ['Trend', 'Swing', 'Reversal'],
      'Reversal': ['Swing', 'OrderFlow'],
      'Scalper': [] // Scalper can disagree with anyone without being critical
    };

    // Collect ALL directional votes (not just high confidence)
    const allVotes: Array<{ brain: string; direction: 'BUY' | 'SELL'; confidence: number; domain: string }> = [];

    if (votes.trend && (votes.trend.vote === 'BUY' || votes.trend.vote === 'SELL')) {
      allVotes.push({ brain: 'Trend', direction: votes.trend.vote, confidence: votes.trend.confidence, domain: 'Trend' });
    }
    if (votes.scalper && (votes.scalper.vote === 'BUY' || votes.scalper.vote === 'SELL')) {
      allVotes.push({ brain: 'Scalper', direction: votes.scalper.vote, confidence: votes.scalper.confidence, domain: 'Scalper' });
    }
    if (votes.swing && (votes.swing.vote === 'BUY' || votes.swing.vote === 'SELL')) {
      allVotes.push({ brain: 'Swing', direction: votes.swing.vote, confidence: votes.swing.confidence, domain: 'Swing' });
    }
    if (votes.reversal && (votes.reversal.vote === 'BUY' || votes.reversal.vote === 'SELL')) {
      allVotes.push({ brain: 'Reversal', direction: votes.reversal.vote, confidence: votes.reversal.confidence, domain: 'Reversal' });
    }
    if (votes.omega8 && (votes.omega8.vote === 'BUY' || votes.omega8.vote === 'SELL')) {
      allVotes.push({ brain: 'OrderFlow', direction: votes.omega8.vote, confidence: votes.omega8.confidence, domain: 'OrderFlow' });
    }

    // Check for conflicts
    if (allVotes.length < 2) {
      return {
        hasConflict: false,
        conflictType: 'NONE',
        severity: 'NONE',
        conflictDescription: 'No conflict',
        confidencePenalty: 1.0
      };
    }

    const buyVotes = allVotes.filter(v => v.direction === 'BUY');
    const sellVotes = allVotes.filter(v => v.direction === 'SELL');

    if (buyVotes.length === 0 || sellVotes.length === 0) {
      return {
        hasConflict: false,
        conflictType: 'NONE',
        severity: 'NONE',
        conflictDescription: 'No conflict',
        confidencePenalty: 1.0
      };
    }

    // We have conflicting directions - now determine HARD vs SOFT

    // Filter for high-confidence votes
    const highConfBuyVotes = buyVotes.filter(v => v.confidence >= HIGH_CONFIDENCE);
    const highConfSellVotes = sellVotes.filter(v => v.confidence >= HIGH_CONFIDENCE);

    // Check for conflicting domains
    const hasConflictingDomains = highConfBuyVotes.some(buy =>
      highConfSellVotes.some(sell =>
        conflictingDomains[buy.domain]?.includes(sell.domain) ||
        conflictingDomains[sell.domain]?.includes(buy.domain)
      )
    );

    const buyBrains = buyVotes.map(v => `${v.brain}(${v.confidence}%)`).join(', ');
    const sellBrains = sellVotes.map(v => `${v.brain}(${v.confidence}%)`).join(', ');
    const description = `BUY: [${buyBrains}] vs SELL: [${sellBrains}]`;

    // Check for overwhelming majority (5+ vs 1 or 1 vs 5+)
    const hasOverwhelmingMajority =
      (buyVotes.length >= 5 && sellVotes.length === 1) ||
      (sellVotes.length >= 5 && buyVotes.length === 1);

    // HARD BLOCK CONDITIONS:
    // 1. At least 2 Omegas disagree in direction
    // 2. Their disagreement confidence >= 70%
    // 3. They are from conflicting domains
    // 4. NOT in aggressive mode with overwhelming majority
    const hardBlockCondition1 = highConfBuyVotes.length >= 1 && highConfSellVotes.length >= 1;
    const hardBlockCondition2 = hardBlockCondition1; // Already filtered for >= 70%
    const hardBlockCondition3 = hasConflictingDomains;
    const hardBlockCondition4 = !(isAggressiveMode && hasOverwhelmingMajority);

    if (hardBlockCondition1 && hardBlockCondition2 && hardBlockCondition3 && hardBlockCondition4) {
      console.log('[Omega Conflict] HARD BLOCK: Conflicting high-confidence signals from opposing domains');
      return {
        hasConflict: true,
        conflictType: 'HARD',
        severity: 'HIGH',
        conflictDescription: description,
        confidencePenalty: 0.0 // Will block, so penalty doesn't matter
      };
    }

    // AGGRESSIVE MODE OVERRIDE: Downgrade HARD to SOFT when overwhelming majority exists
    if (isAggressiveMode && hasOverwhelmingMajority && hardBlockCondition1 && hardBlockCondition2 && hardBlockCondition3) {
      const majorityDirection = buyVotes.length > sellVotes.length ? 'BUY' : 'SELL';
      const majorityCount = Math.max(buyVotes.length, sellVotes.length);
      const minorityCount = Math.min(buyVotes.length, sellVotes.length);

      console.log(`[Omega Conflict] 🔥 AGGRESSIVE MODE OVERRIDE: ${majorityCount} vs ${minorityCount} - Taking ${majorityDirection} with reduced confidence`);
      console.log('[Omega Conflict] Personality: AGGRESSIVE | Score: ' + traderScore.score + ' | Respecting majority consensus');

      return {
        hasConflict: true,
        conflictType: 'SOFT',
        severity: 'MEDIUM',
        conflictDescription: `${description} (Aggressive: Following ${majorityCount}-vote majority)`,
        confidencePenalty: 0.85 // -15% penalty for aggressive override
      };
    }

    // SOFT WARNING CONDITIONS:
    // - Only one Omega disagrees
    // - OR confidence < 70%
    // - OR disagreement is between similar-domain Omegas
    if (highConfBuyVotes.length <= 1 || highConfSellVotes.length <= 1 || !hasConflictingDomains) {
      const lowConfCount = buyVotes.filter(v => v.confidence < HIGH_CONFIDENCE).length +
                           sellVotes.filter(v => v.confidence < HIGH_CONFIDENCE).length;

      let penalty = 1.0;
      let severityLevel: 'LOW' | 'MEDIUM' = 'LOW';

      if (lowConfCount > 0) {
        penalty = isAggressiveMode ? 0.95 : 0.9; // Aggressive: -5%, Normal: -10%
        severityLevel = 'LOW';
      } else if (!hasConflictingDomains) {
        penalty = isAggressiveMode ? 0.92 : 0.85; // Aggressive: -8%, Normal: -15%
        severityLevel = 'LOW';
      } else {
        penalty = isAggressiveMode ? 0.88 : 0.8; // Aggressive: -12%, Normal: -20%
        severityLevel = 'MEDIUM';
      }

      const modeLabel = isAggressiveMode ? 'AGGRESSIVE' : 'STANDARD';
      console.warn(`[Omega Conflict] SOFT conflict (${modeLabel}), applying ${penalty}x confidence penalty`);
      return {
        hasConflict: true,
        conflictType: 'SOFT',
        severity: severityLevel,
        conflictDescription: description,
        confidencePenalty: penalty
      };
    }

    // Default: no conflict
    return {
      hasConflict: false,
      conflictType: 'NONE',
      severity: 'NONE',
      conflictDescription: 'No conflict',
      confidencePenalty: 1.0
    };
  }

  private logOmegaVotes(votes: OmegaCouncilVotes): void {
    console.log('[Omega Council Votes]:');
    console.log(`  Trend:      ${votes.trend?.vote || 'N/A'} @ ${votes.trend?.confidence || 0}% - ${votes.trend?.reasoning || ''}`);
    console.log(`  Scalper:    ${votes.scalper?.vote || 'N/A'} @ ${votes.scalper?.confidence || 0}% - ${votes.scalper?.reasoning || ''}`);
    console.log(`  Swing:      ${votes.swing?.vote || 'N/A'} @ ${votes.swing?.confidence || 0}% - ${votes.swing?.reasoning || ''}`);
    console.log(`  Reversal:   ${votes.reversal?.vote || 'N/A'} @ ${votes.reversal?.confidence || 0}% - ${votes.reversal?.reasoning || ''}`);
    console.log(`  Volatility: ${votes.volatility?.vote || 'N/A'} @ ${votes.volatility?.confidence || 0}% - ${votes.volatility?.reasoning || ''}`);
    console.log(`  Risk:       ${votes.risk?.vote || 'N/A'} @ ${votes.risk?.confidence || 0}% - ${votes.risk?.reasoning || ''}`);
    if (votes.omega8) {
      const usedLLM = (votes.omega8 as any).usedLLM ? ' [LLM]' : ' [DET]';
      console.log(`  OrderFlow:  ${votes.omega8.vote || 'N/A'} @ ${votes.omega8.confidence || 0}%${usedLLM} - ${votes.omega8.reasoning || ''} | Liq: ${votes.omega8.liquidity_bias}`);
    } else {
      console.log(`  OrderFlow:  N/A`);
    }
  }
}

export const alphaOmegaOrchestrator = new AlphaOmegaOrchestrator();
