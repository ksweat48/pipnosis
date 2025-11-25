/**
 * ENHANCED EXECUTION CONTEXT BUILDER
 *
 * Builds rich context for Layer 5 (LLM Execution Brain) including:
 * - Market structure (support/resistance, liquidity)
 * - Risk parameters and limits
 * - Account state and exposure
 * - Recent performance metrics
 * - Dynamic adjustments
 */

import { hybridRiskManager, type RiskContextForLLM } from './hybrid-risk-manager';
import { marketStructureAnalyzer, type MarketStructure, type CandleData } from './market-structure-analyzer';

export interface EnhancedExecutionContext {
  // Market Data
  symbol: string;
  currentPrice: number;
  timestamp: Date;

  // Technical Indicators
  indicators: {
    ema9: number;
    ema21: number;
    ema50: number;
    rsi: number;
    atr: number;
    vwap: number;
  };

  // Market Structure
  marketStructure: MarketStructure;

  // Risk Context (from Hybrid Risk Manager)
  riskContext: RiskContextForLLM;

  // News Risk (infrastructure placeholder)
  newsRisk: boolean;

  // Session Context
  sessionId: string;
  userId: string;
  tradingMode: 'backtest' | 'live' | 'demo';

  // Skill Level Context
  skillLevel?: {
    currentLevel: string;
    targetLevel: string;
    currentWinRate: number;
    targetWinRate: number;
    currentProfitFactor: number;
    targetProfitFactor: number;
  };

  // Goal Context (if applicable)
  goalContext?: {
    targetAmount: number;
    currentProfit: number;
    progressPercent: number;
    remainingAmount: number;
  };
}

class EnhancedExecutionContextBuilder {

  /**
   * Build complete execution context for Layer 5
   */
  async buildContext(params: {
    symbol: string;
    currentPrice: number;
    indicators: {
      ema9: number;
      ema21: number;
      ema50: number;
      rsi: number;
      atr: number;
      vwap: number;
    };
    recentCandles: CandleData[];
    userId: string;
    sessionId: string;
    tradingMode: 'backtest' | 'live' | 'demo';
    skillLevelContext?: any;
    goalContext?: any;
  }): Promise<EnhancedExecutionContext> {

    // Analyze market structure
    const marketStructure = marketStructureAnalyzer.analyzeStructure(
      params.recentCandles,
      params.currentPrice,
      params.indicators
    );

    // Get risk context from hybrid risk manager
    const riskContext = await hybridRiskManager.getRiskContextForLLM(
      params.userId,
      params.sessionId
    );

    // News risk placeholder (non-blocking)
    const newsRisk = false; // TODO: Integrate news API when available

    return {
      symbol: params.symbol,
      currentPrice: params.currentPrice,
      timestamp: new Date(),
      indicators: params.indicators,
      marketStructure,
      riskContext,
      newsRisk,
      sessionId: params.sessionId,
      userId: params.userId,
      tradingMode: params.tradingMode,
      skillLevel: params.skillLevelContext,
      goalContext: params.goalContext
    };
  }

  /**
   * Build human-readable summary for LLM prompt
   */
  buildContextSummary(context: EnhancedExecutionContext): string {
    const summary: string[] = [];

    // Market Structure Summary
    summary.push('=== MARKET STRUCTURE ===');

    if (context.marketStructure.nearestSupport) {
      summary.push(`Nearest Support: ${context.marketStructure.nearestSupport.toFixed(5)}`);
    }

    if (context.marketStructure.nearestResistance) {
      summary.push(`Nearest Resistance: ${context.marketStructure.nearestResistance.toFixed(5)}`);
    }

    if (context.marketStructure.liquidityZones.length > 0) {
      const zones = context.marketStructure.liquidityZones
        .map(z => `${z.low.toFixed(5)}-${z.high.toFixed(5)}`)
        .join(', ');
      summary.push(`Liquidity Zones: ${zones}`);
    }

    summary.push(`Trend Strength: ${context.marketStructure.trendStrength.toFixed(0)}/100`);
    summary.push(`Volatility Regime: ${this.getVolatilityLabel(context.marketStructure.volatilityRegimeScore)}`);

    // Risk Context Summary
    summary.push('\n=== RISK PARAMETERS ===');
    summary.push(`Max Risk Per Trade: ${context.riskContext.effectiveMaxRiskPct.toFixed(1)}%`);
    summary.push(`Current Open Risk: ${context.riskContext.totalOpenRiskPct.toFixed(1)}%`);
    summary.push(`Remaining Capacity: ${context.riskContext.remainingCapacityPct.toFixed(1)}%`);
    summary.push(`Open Trades: ${context.riskContext.openTradesCount}/${context.riskContext.hardLimits.maxOpenTrades}`);

    // Dynamic Adjustments
    if (context.riskContext.drawdownRiskReductionActive) {
      summary.push(`⚠️ DRAWDOWN PROTECTION ACTIVE: Risk reduced by 50% (DD: ${context.riskContext.drawdownPct.toFixed(1)}%)`);
    }

    if (context.riskContext.dailyLossLimitCritical) {
      summary.push(`🚨 DAILY LOSS LIMIT CRITICAL: ${context.riskContext.dailyLossRemainingPct.toFixed(1)}% remaining`);
    }

    if (context.riskContext.aGradeOnlyMode) {
      summary.push(`🎯 A-GRADE ONLY MODE: Goal ${(100 - context.riskContext.dailyGoalRemainingPct).toFixed(0)}% complete`);
    }

    // Performance Summary
    summary.push('\n=== RECENT PERFORMANCE ===');
    summary.push(`Win Rate: ${context.riskContext.recentPerformance.winRate.toFixed(1)}%`);
    summary.push(`Profit Factor: ${context.riskContext.recentPerformance.profitFactor.toFixed(2)}`);

    if (context.riskContext.recentPerformance.winStreak > 0) {
      summary.push(`Win Streak: ${context.riskContext.recentPerformance.winStreak}`);
    } else if (context.riskContext.recentPerformance.lossStreak > 0) {
      summary.push(`Loss Streak: ${context.riskContext.recentPerformance.lossStreak} ⚠️`);
    }

    // News Risk (when implemented)
    if (context.newsRisk) {
      summary.push('\n⚠️ HIGH-IMPACT NEWS EVENT NEARBY');
    }

    return summary.join('\n');
  }

  /**
   * Get volatility label from score
   */
  private getVolatilityLabel(score: number): string {
    if (score < 35) return 'LOW';
    if (score < 65) return 'NORMAL';
    return 'HIGH';
  }

  /**
   * Build technical indicators summary for LLM
   */
  buildTechnicalSummary(context: EnhancedExecutionContext): string {
    const ind = context.indicators;
    const price = context.currentPrice;

    const lines: string[] = [];

    lines.push(`Price: $${price.toFixed(2)}`);
    lines.push(`EMA9: ${ind.ema9.toFixed(2)} | EMA21: ${ind.ema21.toFixed(2)} | EMA50: ${ind.ema50.toFixed(2)}`);
    lines.push(`RSI: ${ind.rsi.toFixed(1)} | ATR: $${ind.atr.toFixed(2)} | VWAP: ${ind.vwap.toFixed(2)}`);

    // EMA alignment
    if (price > ind.ema9 && ind.ema9 > ind.ema21) {
      lines.push(`📈 BULLISH EMA ALIGNMENT`);
    } else if (price < ind.ema9 && ind.ema9 < ind.ema21) {
      lines.push(`📉 BEARISH EMA ALIGNMENT`);
    } else {
      lines.push(`↔️ MIXED/CHOPPY EMA SIGNALS`);
    }

    return lines.join('\n');
  }
}

export const enhancedExecutionContextBuilder = new EnhancedExecutionContextBuilder();
