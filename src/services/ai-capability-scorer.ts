import { supabase } from '../lib/supabase';

export interface CapabilityScoreBreakdown {
  overallCapability: number;
  capabilityGrade: 'excellent' | 'good' | 'fair' | 'poor';
  signalQualityScore: number;
  executionTimingScore: number;
  riskManagementScore: number;
  winRateScore: number;
  profitConsistencyScore: number;
  symbolBreakdown: {
    EURUSD?: number;
    XAUUSD?: number;
    US30?: number;
    GBPUSD?: number;
    USDJPY?: number;
  };
  marketConditionBreakdown: {
    trending: number;
    ranging: number;
    highVolatility: number;
    lowVolatility: number;
  };
  aiMetrics: {
    gpt4DecisionAccuracy: number;
    thresholdOptimizationScore: number;
    falseNegativeRate: number;
    falsePositiveRate: number;
  };
  gapToTarget: number;
  recommendations: {
    primaryWeakness: string;
    suggestedAdjustments: any;
    estimatedCapabilityAfterAdjustments: number;
  };
}

class AICapabilityScorer {
  async calculateCapabilityScore(
    sessionId: string,
    userId: string
  ): Promise<CapabilityScoreBreakdown> {
    console.log(`[Capability Scorer] Calculating score for session ${sessionId}`);

    const { data: session } = await supabase
      .from('backtest_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (!session) {
      throw new Error('Backtest session not found');
    }

    const { data: trades } = await supabase
      .from('backtest_trades')
      .select('*')
      .eq('session_id', sessionId);

    const { data: missedOpportunities } = await supabase
      .from('missed_opportunities')
      .select('*')
      .eq('session_id', sessionId);

    const signalQualityScore = this.calculateSignalQuality(trades || []);
    const executionTimingScore = this.calculateExecutionTiming(trades || []);
    const riskManagementScore = this.calculateRiskManagement(trades || []);
    const winRateScore = this.calculateWinRateScore(session.win_rate || 0);
    const profitConsistencyScore = this.calculateProfitConsistency(trades || []);

    const overallCapability = this.calculateOverallCapability({
      signalQualityScore,
      executionTimingScore,
      riskManagementScore,
      winRateScore,
      profitConsistencyScore
    });

    const capabilityGrade = this.determineGrade(overallCapability);

    const symbolBreakdown = this.calculateSymbolBreakdown(trades || []);
    const marketConditionBreakdown = this.calculateMarketConditionBreakdown(trades || []);
    const aiMetrics = this.calculateAIMetrics(trades || [], missedOpportunities || []);

    const gapToTarget = 75 - overallCapability;

    const recommendations = this.generateRecommendations(
      overallCapability,
      {
        signalQualityScore,
        executionTimingScore,
        riskManagementScore,
        winRateScore,
        profitConsistencyScore
      },
      aiMetrics
    );

    const capabilityScore: CapabilityScoreBreakdown = {
      overallCapability,
      capabilityGrade,
      signalQualityScore,
      executionTimingScore,
      riskManagementScore,
      winRateScore,
      profitConsistencyScore,
      symbolBreakdown,
      marketConditionBreakdown,
      aiMetrics,
      gapToTarget,
      recommendations
    };

    await this.saveCapabilityScore(sessionId, userId, capabilityScore, session);

    return capabilityScore;
  }

  private calculateSignalQuality(trades: any[]): number {
    if (trades.length === 0) return 0;

    const avgConfidence = trades.reduce((sum, t) => sum + t.flow_v2_confidence, 0) / trades.length;
    const avgRiskReward = trades.reduce((sum, t) => sum + t.risk_reward_ratio, 0) / trades.length;
    const allPhasesPassedRate = trades.filter(t =>
      t.h1_bias && t.m5_filter_passed && t.m1_execution_ready
    ).length / trades.length;

    const score = (
      (avgConfidence / 100) * 40 +
      (Math.min(avgRiskReward / 3, 1) * 30) +
      (allPhasesPassedRate * 30)
    ) * 100;

    return Math.round(score);
  }

  private calculateExecutionTiming(trades: any[]): number {
    if (trades.length === 0) return 0;

    const avgHoldingTime = trades
      .filter(t => t.holding_duration_minutes)
      .reduce((sum, t) => sum + t.holding_duration_minutes, 0) / trades.length;

    const optimalHoldingTimeRange = [60, 240];

    let timingScore = 0;
    if (avgHoldingTime >= optimalHoldingTimeRange[0] && avgHoldingTime <= optimalHoldingTimeRange[1]) {
      timingScore = 100;
    } else if (avgHoldingTime < optimalHoldingTimeRange[0]) {
      timingScore = (avgHoldingTime / optimalHoldingTimeRange[0]) * 100;
    } else {
      const excess = avgHoldingTime - optimalHoldingTimeRange[1];
      timingScore = Math.max(0, 100 - (excess / 60));
    }

    return Math.round(timingScore);
  }

  private calculateRiskManagement(trades: any[]): number {
    if (trades.length === 0) return 0;

    const maxDrawdownTrades = this.calculateMaxConsecutiveLosses(trades);
    const avgRiskReward = trades.reduce((sum, t) => sum + t.risk_reward_ratio, 0) / trades.length;
    const stopLossHitRate = trades.filter(t => t.exit_reason === 'stop_loss').length / trades.length;

    const drawdownScore = Math.max(0, 100 - (maxDrawdownTrades * 10));
    const rrScore = Math.min(avgRiskReward / 2, 1) * 100;
    const slScore = stopLossHitRate < 0.5 ? 100 : (1 - stopLossHitRate) * 100;

    const score = (drawdownScore * 0.4) + (rrScore * 0.3) + (slScore * 0.3);

    return Math.round(score);
  }

  private calculateMaxConsecutiveLosses(trades: any[]): number {
    let maxLosses = 0;
    let currentLosses = 0;

    for (const trade of trades) {
      if (trade.outcome === 'loss') {
        currentLosses++;
        maxLosses = Math.max(maxLosses, currentLosses);
      } else {
        currentLosses = 0;
      }
    }

    return maxLosses;
  }

  private calculateWinRateScore(winRate: number): number {
    if (winRate >= 75) return 100;
    if (winRate >= 65) return 90;
    if (winRate >= 55) return 75;
    if (winRate >= 50) return 60;
    if (winRate >= 45) return 45;
    return 30;
  }

  private calculateProfitConsistency(trades: any[]): number {
    if (trades.length < 5) return 0;

    const pnls = trades.map(t => t.pnl);
    const avgPnL = pnls.reduce((sum, p) => sum + p, 0) / pnls.length;
    const variance = pnls.reduce((sum, p) => sum + Math.pow(p - avgPnL, 2), 0) / pnls.length;
    const stdDev = Math.sqrt(variance);

    const coefficientOfVariation = avgPnL !== 0 ? (stdDev / Math.abs(avgPnL)) : 999;

    let consistencyScore = 0;
    if (coefficientOfVariation < 0.5) {
      consistencyScore = 100;
    } else if (coefficientOfVariation < 1) {
      consistencyScore = 80;
    } else if (coefficientOfVariation < 2) {
      consistencyScore = 60;
    } else if (coefficientOfVariation < 3) {
      consistencyScore = 40;
    } else {
      consistencyScore = 20;
    }

    return Math.round(consistencyScore);
  }

  private calculateOverallCapability(scores: {
    signalQualityScore: number;
    executionTimingScore: number;
    riskManagementScore: number;
    winRateScore: number;
    profitConsistencyScore: number;
  }): number {
    const weights = {
      signalQuality: 0.25,
      executionTiming: 0.15,
      riskManagement: 0.20,
      winRate: 0.30,
      profitConsistency: 0.10
    };

    const overallCapability = (
      scores.signalQualityScore * weights.signalQuality +
      scores.executionTimingScore * weights.executionTiming +
      scores.riskManagementScore * weights.riskManagement +
      scores.winRateScore * weights.winRate +
      scores.profitConsistencyScore * weights.profitConsistency
    );

    return Math.round(overallCapability);
  }

  private determineGrade(capability: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (capability >= 85) return 'excellent';
    if (capability >= 70) return 'good';
    if (capability >= 55) return 'fair';
    return 'poor';
  }

  private calculateSymbolBreakdown(trades: any[]): any {
    const symbols = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
    const breakdown: any = {};

    for (const symbol of symbols) {
      const symbolTrades = trades.filter(t => t.symbol === symbol);
      if (symbolTrades.length === 0) continue;

      const winRate = (symbolTrades.filter(t => t.outcome === 'win').length / symbolTrades.length) * 100;
      breakdown[symbol] = Math.round(winRate);
    }

    return breakdown;
  }

  private calculateMarketConditionBreakdown(trades: any[]): any {
    return {
      trending: 0,
      ranging: 0,
      highVolatility: 0,
      lowVolatility: 0
    };
  }

  private calculateAIMetrics(trades: any[], missedOpportunities: any[]): any {
    const totalSignals = trades.length + missedOpportunities.length;

    const aiTrades = trades.filter(t => t.ai_reasoning_used);
    const aiWins = aiTrades.filter(t => t.outcome === 'win').length;
    const gpt4DecisionAccuracy = aiTrades.length > 0 ? (aiWins / aiTrades.length) * 100 : 0;

    const qualityMissed = missedOpportunities.filter(o => o.was_quality_trade).length;
    const falseNegativeRate = totalSignals > 0 ? (qualityMissed / totalSignals) * 100 : 0;

    const badTrades = trades.filter(t => t.outcome === 'loss' && t.flow_v2_confidence < 70).length;
    const falsePositiveRate = totalSignals > 0 ? (badTrades / totalSignals) * 100 : 0;

    const thresholdOptimizationScore = Math.max(0, 100 - falseNegativeRate - falsePositiveRate);

    return {
      gpt4DecisionAccuracy: Math.round(gpt4DecisionAccuracy),
      thresholdOptimizationScore: Math.round(thresholdOptimizationScore),
      falseNegativeRate: Math.round(falseNegativeRate),
      falsePositiveRate: Math.round(falsePositiveRate)
    };
  }

  private generateRecommendations(
    overallCapability: number,
    componentScores: any,
    aiMetrics: any
  ): any {
    const weaknesses = [
      { name: 'Signal Quality', score: componentScores.signalQualityScore },
      { name: 'Execution Timing', score: componentScores.executionTimingScore },
      { name: 'Risk Management', score: componentScores.riskManagementScore },
      { name: 'Win Rate', score: componentScores.winRateScore },
      { name: 'Profit Consistency', score: componentScores.profitConsistencyScore }
    ];

    weaknesses.sort((a, b) => a.score - b.score);
    const primaryWeakness = weaknesses[0].name;

    const suggestedAdjustments: any = {};

    if (aiMetrics.falseNegativeRate > 20) {
      suggestedAdjustments.lowerConfidenceThreshold = {
        current: 75,
        suggested: 70,
        reason: `High false negative rate (${aiMetrics.falseNegativeRate}%) indicates AI is too conservative`
      };
    }

    if (aiMetrics.falsePositiveRate > 20) {
      suggestedAdjustments.raiseConfidenceThreshold = {
        current: 75,
        suggested: 80,
        reason: `High false positive rate (${aiMetrics.falsePositiveRate}%) indicates AI is too aggressive`
      };
    }

    if (componentScores.riskManagementScore < 70) {
      suggestedAdjustments.improveRiskRewardRatio = {
        current: 1.5,
        suggested: 2.0,
        reason: 'Risk management score is below target'
      };
    }

    const estimatedImprovement = Math.min(15, (75 - overallCapability) / 2);
    const estimatedCapabilityAfterAdjustments = Math.min(100, overallCapability + estimatedImprovement);

    return {
      primaryWeakness,
      suggestedAdjustments,
      estimatedCapabilityAfterAdjustments
    };
  }

  private async saveCapabilityScore(
    sessionId: string,
    userId: string,
    score: CapabilityScoreBreakdown,
    session: any
  ): Promise<void> {
    await supabase
      .from('ai_capability_scores')
      .insert({
        user_id: userId,
        measurement_period: `Backtest: ${session.session_name}`,
        period_start: session.start_date,
        period_end: session.end_date,
        overall_capability_percent: score.overallCapability,
        capability_grade: score.capabilityGrade,
        signal_quality_score: score.signalQualityScore,
        execution_timing_score: score.executionTimingScore,
        risk_management_score: score.riskManagementScore,
        win_rate_score: score.winRateScore,
        profit_consistency_score: score.profitConsistencyScore,
        eurusd_capability: score.symbolBreakdown.EURUSD,
        xauusd_capability: score.symbolBreakdown.XAUUSD,
        us30_capability: score.symbolBreakdown.US30,
        gbpusd_capability: score.symbolBreakdown.GBPUSD,
        usdjpy_capability: score.symbolBreakdown.USDJPY,
        trending_market_capability: score.marketConditionBreakdown.trending,
        ranging_market_capability: score.marketConditionBreakdown.ranging,
        high_volatility_capability: score.marketConditionBreakdown.highVolatility,
        low_volatility_capability: score.marketConditionBreakdown.lowVolatility,
        gpt4_decision_accuracy: score.aiMetrics.gpt4DecisionAccuracy,
        threshold_optimization_score: score.aiMetrics.thresholdOptimizationScore,
        false_negative_rate: score.aiMetrics.falseNegativeRate,
        false_positive_rate: score.aiMetrics.falsePositiveRate,
        gap_to_target: score.gapToTarget,
        primary_weakness: score.recommendations.primaryWeakness,
        recommended_adjustments: score.recommendations.suggestedAdjustments,
        estimated_capability_after_adjustments: score.recommendations.estimatedCapabilityAfterAdjustments,
        target_capability_percent: 75
      });

    console.log(`[Capability Scorer] Saved capability score: ${score.overallCapability}% (${score.capabilityGrade})`);
  }
}

export const aiCapabilityScorer = new AICapabilityScorer();
