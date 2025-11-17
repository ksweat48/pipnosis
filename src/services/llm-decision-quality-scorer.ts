import { supabase } from '../lib/supabase';

export interface LLMDecisionQualityBreakdown {
  overallDecisionQuality: number;
  qualityGrade: 'excellent' | 'good' | 'fair' | 'poor';

  llmDecisionAccuracy: number;
  promptEffectivenessScore: number;
  confidenceCalibrationScore: number;
  reasoningQualityScore: number;
  costEfficiencyScore: number;

  decisionBreakdown: {
    totalLLMDecisions: number;
    llmProfitableDecisions: number;
    llmUnprofitableDecisions: number;
    fallbackDecisionsUsed: number;
  };

  recommendationQuality: {
    truePositives: number;
    falsePositives: number;
    trueNegatives: number;
    falseNegatives: number;
    precision: number;
    recall: number;
    f1Score: number;
  };

  marketConditionAccuracy: {
    trending: number;
    ranging: number;
    highVolatility: number;
    lowVolatility: number;
  };

  symbolAccuracy: {
    EURUSD?: number;
    XAUUSD?: number;
    GBPUSD?: number;
    USDJPY?: number;
    US30?: number;
  };

  costAnalysis: {
    totalAPICalls: number;
    totalAPICost: number;
    avgResponseTimeMs: number;
    apiFailureRate: number;
    profitPerAPIDollar: number;
  };

  shortTermCompliance: {
    avgTradeDurationMinutes: number;
    tradesWithinPreferredDurationPercent: number;
    overnightHoldViolations: number;
    pipnosisRuleCompliancePercent: number;
  };

  gapToTarget: number;

  recommendations: {
    primaryWeakness: string;
    promptAdjustments: any;
    recommendedTemperature: number;
    estimatedQualityAfterAdjustments: number;
  };
}

class LLMDecisionQualityScorer {
  async calculateDecisionQuality(
    sessionId: string,
    userId: string
  ): Promise<LLMDecisionQualityBreakdown> {
    console.log(`[LLM Quality Scorer] Calculating decision quality for session ${sessionId}`);

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

    const { data: llmConfig } = await supabase
      .from('llm_backtest_configs')
      .select('*')
      .eq('session_id', sessionId)
      .maybeSingle();

    const { data: recommendations } = await supabase
      .from('llm_recommendation_logs')
      .select('*')
      .eq('session_id', sessionId);

    const llmTrades = (trades || []).filter(t => t.ai_reasoning_used);
    const fallbackTrades = (trades || []).filter(t => !t.ai_reasoning_used);

    const llmDecisionAccuracy = this.calculateLLMDecisionAccuracy(llmTrades);
    const promptEffectivenessScore = this.calculatePromptEffectiveness(llmTrades, recommendations || []);
    const confidenceCalibrationScore = this.calculateConfidenceCalibration(llmTrades);
    const reasoningQualityScore = this.calculateReasoningQuality(llmTrades);
    const costEfficiencyScore = this.calculateCostEfficiency(
      session.total_pnl || 0,
      llmConfig?.actual_total_cost || session.gpt4_calls_made * 0.01 || 0
    );

    const overallDecisionQuality = this.calculateOverallQuality({
      llmDecisionAccuracy,
      promptEffectivenessScore,
      confidenceCalibrationScore,
      reasoningQualityScore,
      costEfficiencyScore
    });

    const qualityGrade = this.determineGrade(overallDecisionQuality);

    const decisionBreakdown = {
      totalLLMDecisions: llmTrades.length,
      llmProfitableDecisions: llmTrades.filter(t => t.outcome === 'win').length,
      llmUnprofitableDecisions: llmTrades.filter(t => t.outcome === 'loss').length,
      fallbackDecisionsUsed: fallbackTrades.length
    };

    const recommendationQuality = this.calculateRecommendationQuality(recommendations || []);
    const marketConditionAccuracy = this.calculateMarketConditionAccuracy(llmTrades);
    const symbolAccuracy = this.calculateSymbolAccuracy(llmTrades);

    const costAnalysis = {
      totalAPICalls: session.gpt4_calls_made || llmTrades.length,
      totalAPICost: llmConfig?.actual_total_cost || session.estimated_api_cost || (session.gpt4_calls_made * 0.01) || 0,
      avgResponseTimeMs: this.calculateAvgResponseTime(recommendations || []),
      apiFailureRate: llmConfig?.fallback_triggered_count ?
        (llmConfig.fallback_triggered_count / (session.gpt4_calls_made || 1)) * 100 : 0,
      profitPerAPIDollar: this.calculateProfitPerDollar(
        session.total_pnl || 0,
        llmConfig?.actual_total_cost || session.estimated_api_cost || (session.gpt4_calls_made * 0.01) || 0
      )
    };

    const shortTermCompliance = this.calculateShortTermCompliance(trades || []);

    const gapToTarget = 75 - overallDecisionQuality;

    const recommendations = this.generateRecommendations(
      overallDecisionQuality,
      {
        llmDecisionAccuracy,
        promptEffectivenessScore,
        confidenceCalibrationScore,
        reasoningQualityScore,
        costEfficiencyScore
      },
      recommendationQuality,
      llmConfig
    );

    const qualityBreakdown: LLMDecisionQualityBreakdown = {
      overallDecisionQuality,
      qualityGrade,
      llmDecisionAccuracy,
      promptEffectivenessScore,
      confidenceCalibrationScore,
      reasoningQualityScore,
      costEfficiencyScore,
      decisionBreakdown,
      recommendationQuality,
      marketConditionAccuracy,
      symbolAccuracy,
      costAnalysis,
      shortTermCompliance,
      gapToTarget,
      recommendations
    };

    await this.saveDecisionQuality(sessionId, userId, qualityBreakdown, session, llmConfig);

    return qualityBreakdown;
  }

  private calculateLLMDecisionAccuracy(llmTrades: any[]): number {
    if (llmTrades.length === 0) return 0;
    const profitable = llmTrades.filter(t => t.outcome === 'win').length;
    return Math.round((profitable / llmTrades.length) * 100);
  }

  private calculatePromptEffectiveness(llmTrades: any[], recommendations: any[]): number {
    if (llmTrades.length === 0) return 0;

    const avgConfidence = llmTrades.reduce((sum, t) => sum + (t.ai_conviction || 75), 0) / llmTrades.length;
    const winRate = (llmTrades.filter(t => t.outcome === 'win').length / llmTrades.length) * 100;

    const coherentReasoningCount = llmTrades.filter(t =>
      t.ai_rationale && t.ai_rationale.length > 50
    ).length;
    const reasoningCompleteness = (coherentReasoningCount / llmTrades.length) * 100;

    const score = (
      (winRate * 0.5) +
      (reasoningCompleteness * 0.3) +
      ((avgConfidence / 100) * 20)
    );

    return Math.round(score);
  }

  private calculateConfidenceCalibration(llmTrades: any[]): number {
    if (llmTrades.length === 0) return 0;

    const avgConfidence = llmTrades.reduce((sum, t) => sum + (t.ai_conviction || 75), 0) / llmTrades.length;
    const actualWinRate = (llmTrades.filter(t => t.outcome === 'win').length / llmTrades.length) * 100;

    const calibrationError = Math.abs(avgConfidence - actualWinRate);
    const score = Math.max(0, 100 - (calibrationError * 2));

    return Math.round(score);
  }

  private calculateReasoningQuality(llmTrades: any[]): number {
    if (llmTrades.length === 0) return 0;

    const hasReasoningCount = llmTrades.filter(t => t.ai_rationale && t.ai_rationale.length > 0).length;
    const hasRiskAssessmentCount = llmTrades.filter(t => t.ai_risk_assessment && t.ai_risk_assessment.length > 0).length;
    const detailedReasoningCount = llmTrades.filter(t => t.ai_rationale && t.ai_rationale.length > 50).length;

    const completeness = (hasReasoningCount / llmTrades.length) * 100;
    const riskCoverage = (hasRiskAssessmentCount / llmTrades.length) * 100;
    const depth = (detailedReasoningCount / llmTrades.length) * 100;

    const score = (completeness * 0.4) + (riskCoverage * 0.3) + (depth * 0.3);

    return Math.round(score);
  }

  private calculateCostEfficiency(totalPnL: number, totalCost: number): number {
    if (totalCost === 0) return 100;
    if (totalPnL <= 0) return 0;

    const efficiency = (totalPnL / totalCost);

    if (efficiency >= 100) return 100;
    if (efficiency >= 50) return 90;
    if (efficiency >= 25) return 75;
    if (efficiency >= 10) return 60;
    if (efficiency >= 5) return 45;
    return 30;
  }

  private calculateOverallQuality(scores: {
    llmDecisionAccuracy: number;
    promptEffectivenessScore: number;
    confidenceCalibrationScore: number;
    reasoningQualityScore: number;
    costEfficiencyScore: number;
  }): number {
    const weights = {
      decisionAccuracy: 0.40,
      promptEffectiveness: 0.25,
      confidenceCalibration: 0.15,
      reasoningQuality: 0.10,
      costEfficiency: 0.10
    };

    const overall = (
      scores.llmDecisionAccuracy * weights.decisionAccuracy +
      scores.promptEffectivenessScore * weights.promptEffectiveness +
      scores.confidenceCalibrationScore * weights.confidenceCalibration +
      scores.reasoningQualityScore * weights.reasoningQuality +
      scores.costEfficiencyScore * weights.costEfficiency
    );

    return Math.round(overall);
  }

  private determineGrade(quality: number): 'excellent' | 'good' | 'fair' | 'poor' {
    if (quality >= 85) return 'excellent';
    if (quality >= 70) return 'good';
    if (quality >= 55) return 'fair';
    return 'poor';
  }

  private calculateRecommendationQuality(recommendations: any[]): any {
    const truePositives = recommendations.filter(r => r.recommendation_type === 'true_positive').length;
    const falsePositives = recommendations.filter(r => r.recommendation_type === 'false_positive').length;
    const trueNegatives = recommendations.filter(r => r.recommendation_type === 'true_negative').length;
    const falseNegatives = recommendations.filter(r => r.recommendation_type === 'false_negative').length;

    const precision = (truePositives + falsePositives) > 0 ?
      (truePositives / (truePositives + falsePositives)) * 100 : 0;
    const recall = (truePositives + falseNegatives) > 0 ?
      (truePositives / (truePositives + falseNegatives)) * 100 : 0;
    const f1Score = (precision + recall) > 0 ?
      (2 * precision * recall) / (precision + recall) : 0;

    return {
      truePositives,
      falsePositives,
      trueNegatives,
      falseNegatives,
      precision: Math.round(precision),
      recall: Math.round(recall),
      f1Score: Math.round(f1Score)
    };
  }

  private calculateMarketConditionAccuracy(llmTrades: any[]): any {
    return {
      trending: 0,
      ranging: 0,
      highVolatility: 0,
      lowVolatility: 0
    };
  }

  private calculateSymbolAccuracy(llmTrades: any[]): any {
    const symbols = ['EURUSD', 'XAUUSD', 'GBPUSD', 'USDJPY', 'US30'];
    const accuracy: any = {};

    for (const symbol of symbols) {
      const symbolTrades = llmTrades.filter(t => t.symbol === symbol);
      if (symbolTrades.length === 0) continue;

      const winRate = (symbolTrades.filter(t => t.outcome === 'win').length / symbolTrades.length) * 100;
      accuracy[symbol] = Math.round(winRate);
    }

    return accuracy;
  }

  private calculateAvgResponseTime(recommendations: any[]): number {
    if (recommendations.length === 0) return 0;

    const responseTimes = recommendations
      .filter(r => r.api_response_time_ms)
      .map(r => r.api_response_time_ms);

    if (responseTimes.length === 0) return 0;

    return Math.round(responseTimes.reduce((sum, t) => sum + t, 0) / responseTimes.length);
  }

  private calculateProfitPerDollar(totalPnL: number, totalCost: number): number {
    if (totalCost === 0) return 0;
    return totalPnL / totalCost;
  }

  private calculateShortTermCompliance(trades: any[]): any {
    if (trades.length === 0) {
      return {
        avgTradeDurationMinutes: 0,
        tradesWithinPreferredDurationPercent: 0,
        overnightHoldViolations: 0,
        pipnosisRuleCompliancePercent: 100
      };
    }

    const durations = trades
      .filter(t => t.holding_duration_minutes)
      .map(t => t.holding_duration_minutes);

    const avgDuration = durations.length > 0 ?
      durations.reduce((sum, d) => sum + d, 0) / durations.length : 0;

    const withinPreferred = trades.filter(t =>
      t.holding_duration_minutes && t.holding_duration_minutes <= 120
    ).length;

    const tradesWithinPreferredPercent = (withinPreferred / trades.length) * 100;

    const overnightViolations = trades.filter(t =>
      t.holding_duration_minutes && t.holding_duration_minutes > 1440
    ).length;

    const compliancePercent = 100 - ((overnightViolations / trades.length) * 100);

    return {
      avgTradeDurationMinutes: Math.round(avgDuration),
      tradesWithinPreferredDurationPercent: Math.round(tradesWithinPreferredPercent),
      overnightHoldViolations: overnightViolations,
      pipnosisRuleCompliancePercent: Math.round(compliancePercent)
    };
  }

  private generateRecommendations(
    overallQuality: number,
    componentScores: any,
    recommendationQuality: any,
    llmConfig: any
  ): any {
    const weaknesses = [
      { name: 'LLM Decision Accuracy', score: componentScores.llmDecisionAccuracy },
      { name: 'Prompt Effectiveness', score: componentScores.promptEffectivenessScore },
      { name: 'Confidence Calibration', score: componentScores.confidenceCalibrationScore },
      { name: 'Reasoning Quality', score: componentScores.reasoningQualityScore },
      { name: 'Cost Efficiency', score: componentScores.costEfficiencyScore }
    ];

    weaknesses.sort((a, b) => a.score - b.score);
    const primaryWeakness = weaknesses[0].name;

    const promptAdjustments: any = {};
    let recommendedTemperature = llmConfig?.temperature || 0.3;

    if (componentScores.confidenceCalibrationScore < 70) {
      promptAdjustments.improveCalibration = {
        current: 'Standard prompt',
        suggested: 'Add explicit confidence calibration instructions',
        reason: `Low calibration score (${componentScores.confidenceCalibrationScore}%). LLM confidence doesn't match reality.`
      };
    }

    if (recommendationQuality.falseNegatives > recommendationQuality.truePositives * 0.3) {
      promptAdjustments.reduceConservatism = {
        current: `Temperature: ${recommendedTemperature}`,
        suggested: `Temperature: ${Math.min(0.5, recommendedTemperature + 0.1)}`,
        reason: `High false negative rate. LLM is too conservative.`
      };
      recommendedTemperature = Math.min(0.5, recommendedTemperature + 0.1);
    }

    if (recommendationQuality.falsePositives > recommendationQuality.truePositives * 0.3) {
      promptAdjustments.increaseSelectivity = {
        current: `Temperature: ${recommendedTemperature}`,
        suggested: `Temperature: ${Math.max(0.1, recommendedTemperature - 0.1)}`,
        reason: `High false positive rate. LLM is too aggressive.`
      };
      recommendedTemperature = Math.max(0.1, recommendedTemperature - 0.1);
    }

    if (componentScores.reasoningQualityScore < 70) {
      promptAdjustments.enhanceReasoning = {
        current: 'Standard reasoning depth',
        suggested: 'Require explicit risk/reward analysis and alternative scenarios',
        reason: `Low reasoning quality score (${componentScores.reasoningQualityScore}%)`
      };
    }

    const estimatedImprovement = Math.min(15, (75 - overallQuality) / 2);
    const estimatedQualityAfterAdjustments = Math.min(100, overallQuality + estimatedImprovement);

    return {
      primaryWeakness,
      promptAdjustments,
      recommendedTemperature: Math.round(recommendedTemperature * 100) / 100,
      estimatedQualityAfterAdjustments: Math.round(estimatedQualityAfterAdjustments)
    };
  }

  private async saveDecisionQuality(
    sessionId: string,
    userId: string,
    quality: LLMDecisionQualityBreakdown,
    session: any,
    llmConfig: any
  ): Promise<void> {
    await supabase
      .from('llm_decision_quality_scores')
      .insert({
        user_id: userId,
        session_id: sessionId,
        measurement_period: `Backtest: ${session.session_name}`,
        period_start: session.start_date,
        period_end: session.end_date,
        overall_decision_quality_percent: quality.overallDecisionQuality,
        quality_grade: quality.qualityGrade,
        llm_decision_accuracy: quality.llmDecisionAccuracy,
        prompt_effectiveness_score: quality.promptEffectivenessScore,
        confidence_calibration_score: quality.confidenceCalibrationScore,
        reasoning_quality_score: quality.reasoningQualityScore,
        cost_efficiency_score: quality.costEfficiencyScore,
        total_llm_decisions: quality.decisionBreakdown.totalLLMDecisions,
        llm_profitable_decisions: quality.decisionBreakdown.llmProfitableDecisions,
        llm_unprofitable_decisions: quality.decisionBreakdown.llmUnprofitableDecisions,
        fallback_decisions_used: quality.decisionBreakdown.fallbackDecisionsUsed,
        true_positives: quality.recommendationQuality.truePositives,
        false_positives: quality.recommendationQuality.falsePositives,
        true_negatives: quality.recommendationQuality.trueNegatives,
        false_negatives: quality.recommendationQuality.falseNegatives,
        trending_market_accuracy: quality.marketConditionAccuracy.trending,
        ranging_market_accuracy: quality.marketConditionAccuracy.ranging,
        high_volatility_accuracy: quality.marketConditionAccuracy.highVolatility,
        low_volatility_accuracy: quality.marketConditionAccuracy.lowVolatility,
        eurusd_accuracy: quality.symbolAccuracy.EURUSD,
        xauusd_accuracy: quality.symbolAccuracy.XAUUSD,
        gbpusd_accuracy: quality.symbolAccuracy.GBPUSD,
        usdjpy_accuracy: quality.symbolAccuracy.USDJPY,
        us30_accuracy: quality.symbolAccuracy.US30,
        total_api_calls: quality.costAnalysis.totalAPICalls,
        total_api_cost: quality.costAnalysis.totalAPICost,
        avg_response_time_ms: quality.costAnalysis.avgResponseTimeMs,
        api_failure_rate: quality.costAnalysis.apiFailureRate,
        profit_per_api_dollar: quality.costAnalysis.profitPerAPIDollar,
        prompt_template_id: llmConfig?.prompt_template_id,
        prompt_temperature: llmConfig?.temperature,
        prompt_max_tokens: llmConfig?.max_tokens,
        avg_trade_duration_minutes: quality.shortTermCompliance.avgTradeDurationMinutes,
        trades_within_preferred_duration_percent: quality.shortTermCompliance.tradesWithinPreferredDurationPercent,
        overnight_hold_violations: quality.shortTermCompliance.overnightHoldViolations,
        pipnosis_rule_compliance_percent: quality.shortTermCompliance.pipnosisRuleCompliancePercent,
        gap_to_target: quality.gapToTarget,
        primary_weakness: quality.recommendations.primaryWeakness,
        recommended_prompt_adjustments: quality.recommendations.promptAdjustments,
        recommended_temperature: quality.recommendations.recommendedTemperature,
        estimated_quality_after_adjustments: quality.recommendations.estimatedQualityAfterAdjustments,
        target_quality_percent: 75
      });

    console.log(`[LLM Quality Scorer] Saved decision quality: ${quality.overallDecisionQuality}% (${quality.qualityGrade})`);
  }
}

export const llmDecisionQualityScorer = new LLMDecisionQualityScorer();
