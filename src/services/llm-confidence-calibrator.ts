import { supabase } from '../lib/supabase';
import { openaiProxyClient } from './openai-proxy-client';
import { llmCostOptimizer } from './llm-cost-optimizer';
import { llmResponseCache } from './llm-response-cache';
import { buildCompressedCalibrationPrompt } from './llm-prompt-compressor';
import { calculateCost } from '../config/llm-optimization-config';

export interface ConfidenceCalibrationResult {
  original_confidence: number;
  calibrated_confidence: number;
  adjustment_applied: number;
  calibration_curve_type: 'aggressive' | 'balanced' | 'conservative';
  historical_accuracy_at_level: number;
  adjustment_reasoning: string;
  confidence_bands: {
    lower_bound: number;
    upper_bound: number;
    confidence_interval: string;
  };
  recommendation: 'increase' | 'maintain' | 'decrease';
  // Learning Mode metadata
  learningMode: boolean;
  totalHistoricalTrades: number;
  minimumConfidenceApplied: number;
  penaltyApplied: number;
  calibratorCanBlockTrade: boolean;
}

class LLMConfidenceCalibrator {
  private enabled: boolean = true;
  private callCount: number = 0;

  constructor() {
    console.log('[LLM Confidence Calibrator] 🎯 Layer 4 initialized (optimized mode)');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async calibrateConfidence(
    userId: string,
    symbol: string,
    originalConfidence: number,
    setupContext: {
      triggerType: string;
      regimeQuality: number;
      setupQuality: number;
      riskLevel: string;
    },
    skillContext?: any,
    sessionId?: string,
    isBacktest?: boolean
  ): Promise<ConfidenceCalibrationResult> {
    if (!this.enabled) {
      return this.createFallbackCalibration(userId, symbol, originalConfidence);
    }

    console.log(`\n[LLM Layer 4 - Confidence Calibrator] 🎯 Calibrating ${originalConfidence}% confidence`);
    const startTime = Date.now();

    try {
      // Get total historical trades to determine mode
      const totalHistoricalTrades = await this.getTotalHistoricalTrades(userId);
      const isLearningMode = totalHistoricalTrades < 100;

      const historicalAccuracy = await this.getHistoricalAccuracyAtLevel(userId, symbol, originalConfidence);
      const recentPerformance = await this.getRecentPerformanceContext(userId);

      // Check cache first (1 hour TTL)
      const cacheContext = {
        orig: Math.floor(originalConfidence / 5) * 5,
        hist: Math.floor(historicalAccuracy / 10) * 10,
        overconf: recentPerformance.overconfidenceTrend,
      };

      const cached = llmResponseCache.get<ConfidenceCalibrationResult>('layer4_calibrator', cacheContext);
      if (cached) {
        console.log('[LLM Layer 4] 💾 Cache hit - skipping API call');
        cached.learningMode = isLearningMode;
        cached.totalHistoricalTrades = totalHistoricalTrades;
        return cached;
      }

      // Select optimal model
      const model = llmCostOptimizer.selectModel('layer4_calibrator', { isBacktest });

      // Check rate limits
      const canProceed = await llmCostOptimizer.canMakeRequest(model);
      if (!canProceed) {
        console.warn('[LLM Layer 4] Rate limit reached, using fallback');
        return this.createFallbackCalibration(userId, symbol, originalConfidence);
      }

      // Build compressed prompt
      const prompt = buildCompressedCalibrationPrompt(
        originalConfidence,
        historicalAccuracy,
        recentPerformance.overconfidenceTrend,
        skillContext ? {
          lvl: skillContext.currentLevel,
          tgt: skillContext.targetLevel,
          wr_gap: skillContext.gaps?.winRateGap || 0,
          pf_gap: skillContext.gaps?.profitFactorGap || 0,
          cons_gap: skillContext.gaps?.consistencyGap || 0,
          wr: skillContext.currentPerformance?.winRate || 0,
        } : undefined
      );

      // Call LLM
      const response = await this.callLLM(prompt, model);
      const rawResult = this.parseCalibrationResult(response.content, originalConfidence);

      // Track usage
      llmCostOptimizer.trackRequest(model);
      this.callCount++;

      // Calculate and log cost
      const cost = calculateCost(model, response.usage.prompt_tokens, response.usage.completion_tokens);
      console.log(`[LLM Layer 4] Model: ${model}, Tokens: ${response.usage.total_tokens}, Cost: $${cost.toFixed(4)}`);

      if (sessionId) {
        await llmCostOptimizer.logCost(
          userId,
          sessionId,
          'layer4_calibrator',
          model,
          response.usage.prompt_tokens,
          response.usage.completion_tokens,
          cost,
          { orig: originalConfidence, calibrated: rawResult.calibrated_confidence }
        );
      }

      // Apply Learning Mode vs Mature Mode rules
      const result = this.applyModeLimits(
        rawResult,
        originalConfidence,
        isLearningMode,
        totalHistoricalTrades
      );

      // Cache result
      llmResponseCache.set('layer4_calibrator', cacheContext, result);

      const duration = Date.now() - startTime;

      const adjustment = result.calibrated_confidence - originalConfidence;
      const direction = adjustment > 0 ? '⬆️' : adjustment < 0 ? '⬇️' : '➡️';

      // Enhanced logging with mode information
      console.log(`\n=== CALIBRATOR DEBUG ===`);
      console.log(`Mode: ${isLearningMode ? 'Learning' : 'Mature'}`);
      console.log(`Total Trades: ${totalHistoricalTrades}`);
      console.log(`Initial Confidence: ${originalConfidence}%`);
      console.log(`Adjustment: ${adjustment > 0 ? '+' : ''}${adjustment.toFixed(1)}%`);
      console.log(`Final Confidence: ${result.calibrated_confidence}%`);
      console.log(`Minimum Allowed: ${result.minimumConfidenceApplied}%`);
      console.log(`Blocking Allowed: ${result.calibratorCanBlockTrade}`);
      console.log(`Historical Accuracy: ${result.historical_accuracy_at_level.toFixed(1)}%`);
      console.log(`Curve Type: ${result.calibration_curve_type}`);
      console.log(`========================\n`);

      return result;
    } catch (error) {
      console.error('[LLM Layer 4] Error:', error);
      return this.createFallbackCalibration(userId, symbol, originalConfidence);
    }
  }

  private async getHistoricalAccuracyAtLevel(
    userId: string,
    symbol: string,
    confidenceLevel: number
  ): Promise<number> {
    try {
      const bucket = this.getConfidenceBucket(confidenceLevel);

      const { data: trades } = await supabase
        .from('ai_confidence_calibration')
        .select('was_accurate, actual_outcome')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('confidence_bucket', bucket);

      if (!trades || trades.length < 5) {
        return 50;
      }

      const nonBreakevenTrades = trades.filter(t => t.actual_outcome !== 'breakeven');
      if (nonBreakevenTrades.length === 0) return 50;

      const accurateTrades = nonBreakevenTrades.filter(t => t.was_accurate).length;
      return (accurateTrades / nonBreakevenTrades.length) * 100;
    } catch (error) {
      return 50;
    }
  }

  private getConfidenceBucket(confidence: number): string {
    if (confidence >= 0 && confidence < 20) return '0-20';
    if (confidence >= 20 && confidence < 40) return '20-40';
    if (confidence >= 40 && confidence < 60) return '40-60';
    if (confidence >= 60 && confidence < 80) return '60-80';
    if (confidence >= 80 && confidence <= 100) return '80-100';
    return '60-80';
  }

  /**
   * Get total historical trades for this user to determine Learning vs Mature mode
   */
  private async getTotalHistoricalTrades(userId: string): Promise<number> {
    try {
      const { count } = await supabase
        .from('trade_history')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .neq('outcome', 'open');

      return count || 0;
    } catch (error) {
      console.warn('[Confidence Calibrator] Error getting total trades:', error);
      return 0;
    }
  }

  /**
   * Apply Learning Mode vs Mature Mode limits to calibration result
   */
  private applyModeLimits(
    rawResult: ConfidenceCalibrationResult,
    originalConfidence: number,
    isLearningMode: boolean,
    totalHistoricalTrades: number
  ): ConfidenceCalibrationResult {
    let maxPenalty: number;
    let minimumConfidence: number;
    let calibratorCanBlockTrade: boolean;

    if (isLearningMode) {
      // LEARNING MODE (0-100 trades)
      maxPenalty = 5; // Cap penalty to -5%
      minimumConfidence = 60; // Minimum 60% confidence
      calibratorCanBlockTrade = false; // Cannot block trades
      console.log('[Layer 4] LEARNING MODE ACTIVE - Minimal penalties, LLM authority preserved');
    } else {
      // MATURE MODE (101+ trades)
      maxPenalty = 10; // Allow full -10% penalty
      minimumConfidence = 70; // Require 70% minimum
      calibratorCanBlockTrade = true; // Can block trades
      console.log('[Layer 4] MATURE MODE ACTIVE - Full discipline engaged');
    }

    // Calculate the adjustment
    let adjustment = rawResult.calibrated_confidence - originalConfidence;

    // Cap negative adjustments in Learning Mode
    if (isLearningMode && adjustment < 0) {
      const cappedAdjustment = Math.max(adjustment, -maxPenalty);
      if (cappedAdjustment !== adjustment) {
        console.log(`[Layer 4] Penalty capped: ${adjustment.toFixed(1)}% → ${cappedAdjustment.toFixed(1)}% (Learning Mode)`);
        adjustment = cappedAdjustment;
      }
    }

    // Apply the capped adjustment
    let calibratedConfidence = originalConfidence + adjustment;

    // Ensure minimum confidence is met
    if (calibratedConfidence < minimumConfidence) {
      console.log(`[Layer 4] Confidence below minimum: ${calibratedConfidence.toFixed(1)}% → ${minimumConfidence}%`);
      calibratedConfidence = minimumConfidence;
    }

    // Clamp to 0-100 range
    calibratedConfidence = Math.max(0, Math.min(100, calibratedConfidence));

    return {
      ...rawResult,
      calibrated_confidence: calibratedConfidence,
      adjustment_applied: calibratedConfidence - originalConfidence,
      learningMode: isLearningMode,
      totalHistoricalTrades: totalHistoricalTrades,
      minimumConfidenceApplied: minimumConfidence,
      penaltyApplied: adjustment,
      calibratorCanBlockTrade: calibratorCanBlockTrade
    };
  }

  private async getRecentPerformanceContext(userId: string): Promise<any> {
    try {
      const { data: recentTrades } = await supabase
        .from('ai_confidence_calibration')
        .select('predicted_confidence, was_accurate, actual_outcome')
        .eq('user_id', userId)
        .order('entry_time', { ascending: false })
        .limit(30);

      if (!recentTrades || recentTrades.length < 10) {
        return {
          total_trades: 0,
          avg_predicted_confidence: 50,
          actual_accuracy: 50,
          calibration_error: 0,
          trend: 'insufficient_data'
        };
      }

      const nonBreakeven = recentTrades.filter(t => t.actual_outcome !== 'breakeven');
      const accurateTrades = nonBreakeven.filter(t => t.was_accurate).length;
      const actualAccuracy = nonBreakeven.length > 0 ? (accurateTrades / nonBreakeven.length) * 100 : 50;
      const avgPredictedConfidence = recentTrades.reduce((sum, t) => sum + t.predicted_confidence, 0) / recentTrades.length;
      const calibrationError = avgPredictedConfidence - actualAccuracy;

      return {
        total_trades: recentTrades.length,
        avg_predicted_confidence: avgPredictedConfidence,
        actual_accuracy: actualAccuracy,
        calibration_error: calibrationError,
        trend: calibrationError > 10 ? 'overconfident' : calibrationError < -10 ? 'underconfident' : 'well_calibrated'
      };
    } catch (error) {
      return {
        total_trades: 0,
        avg_predicted_confidence: 50,
        actual_accuracy: 50,
        calibration_error: 0,
        trend: 'insufficient_data'
      };
    }
  }

  private buildCalibrationPrompt(
    originalConfidence: number,
    setupContext: any,
    historicalAccuracy: number,
    recentPerformance: any,
    skillContext?: any
  ): string {
    let prompt = `You are the Confidence Calibration Layer (Layer 4 of 5) in Pipnosis AI Trading System.

Your responsibility: Adjust the AI's predicted confidence to match historical reality.`;

    if (skillContext) {
      prompt += `

SKILL LEVEL CONTEXT & CALIBRATION GUIDANCE:
Current Level: ${skillContext.currentLevel} → Target: ${skillContext.targetLevel}
Win Rate Gap: ${skillContext.gaps.winRateGap > 0 ? '+' : ''}${skillContext.gaps.winRateGap.toFixed(1)}%
Current Win Rate: ${skillContext.currentPerformance.winRate.toFixed(1)}%

CONFIDENCE CALIBRATION GUIDANCE:
${skillContext.gaps.winRateGap < -5
  ? `Win rate below target. Apply MORE CONSERVATIVE calibration - reduce confidence by additional 5-10%.
     We need to be more cautious until win rate improves.`
  : skillContext.gaps.winRateGap < 0
  ? `Win rate slightly below. Apply slightly conservative calibration - reduce confidence by 2-5%.`
  : `Win rate on/above target. Standard calibration applies.`}
${skillContext.currentPerformance.winRate < 40
  ? `CRITICAL: Win rate under 40%. Maximum conservative calibration. Cap final confidence at 70% even if higher.`
  : ''}`;
    }

    prompt += `

ORIGINAL AI CONFIDENCE: ${originalConfidence}%

SETUP CONTEXT:
Trigger Type: ${setupContext.triggerType}
Regime Quality: ${setupContext.regimeQuality}%
Setup Quality: ${setupContext.setupQuality}/100
Risk Level: ${setupContext.riskLevel}

HISTORICAL PERFORMANCE AT THIS CONFIDENCE LEVEL:
When AI predicted ${this.getConfidenceBucket(originalConfidence)} confidence, actual accuracy was: ${historicalAccuracy.toFixed(1)}%

RECENT OVERALL CALIBRATION (Last 30 trades):
Avg Predicted Confidence: ${recentPerformance.avg_predicted_confidence.toFixed(1)}%
Actual Accuracy: ${recentPerformance.actual_accuracy.toFixed(1)}%
Calibration Error: ${recentPerformance.calibration_error > 0 ? '+' : ''}${recentPerformance.calibration_error.toFixed(1)}%
Trend: ${recentPerformance.trend}

CALIBRATION RULES:
1. If historical accuracy < predicted confidence → LOWER confidence
2. If historical accuracy > predicted confidence → RAISE confidence
3. If recent trend is "overconfident" → apply conservative adjustment
4. If recent trend is "underconfident" → apply aggressive adjustment
5. Never adjust by more than ±15 points in one step

Your task:
1. Calculate appropriate calibrated confidence
2. Determine calibration curve type (aggressive/balanced/conservative)
3. Explain the adjustment reasoning
4. Provide confidence interval bounds

Respond in this EXACT JSON format (no markdown):
{
  "calibrated_confidence": <adjusted confidence 0-100>,
  "adjustment_applied": <positive or negative adjustment>,
  "calibration_curve_type": "<aggressive/balanced/conservative>",
  "historical_accuracy_at_level": <the ${historicalAccuracy.toFixed(1)} value>,
  "adjustment_reasoning": "<why you adjusted up/down/maintained>",
  "confidence_bands": {
    "lower_bound": <calibrated - margin>,
    "upper_bound": <calibrated + margin>,
    "confidence_interval": "<description of uncertainty>"
  },
  "recommendation": "<increase/maintain/decrease>"
}

Be data-driven. Trust historical accuracy over predictions.`;

    return prompt;
  }

  private async callLLM(prompt: string, model: 'gpt-4o' | 'gpt-4o-mini'): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
    const response = await openaiProxyClient.chat({
      messages: [
        {
          role: 'system',
          content: 'Statistical calibration. Match historical reality. Data-driven.'
        },
        { role: 'user', content: prompt }
      ],
      model: model,
      temperature: 0.1,
      max_tokens: 150,
      requestType: 'layer-4-confidence-calibration',
      endpoint: 'llm-confidence-calibrator'
    });

    return {
      content: response.choices[0]?.message?.content || '',
      usage: response.usage
    };
  }

  private parseCalibrationResult(content: string, originalConfidence: number): ConfidenceCalibrationResult {
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanContent);

    // Handle BOTH compressed format and full format
    // Compressed: {cal, adj, curve}
    // Full: {calibrated_confidence, adjustment_applied, calibration_curve_type}

    const isCompressed = 'cal' in parsed;

    let calibrated: number;
    let curveType: string;

    if (isCompressed) {
      calibrated = parsed.cal || originalConfidence;
      curveType = parsed.curve || 'balanced';
    } else {
      calibrated = parsed.calibrated_confidence || originalConfidence;
      curveType = parsed.calibration_curve_type || 'balanced';
    }

    const clamped = Math.max(0, Math.min(100, calibrated));

    return {
      original_confidence: originalConfidence,
      calibrated_confidence: clamped,
      adjustment_applied: clamped - originalConfidence,
      calibration_curve_type: curveType,
      historical_accuracy_at_level: parsed.historical_accuracy_at_level || 50,
      adjustment_reasoning: parsed.adjustment_reasoning || parsed.reasoning || '',
      confidence_bands: parsed.confidence_bands || {
        lower_bound: clamped - 5,
        upper_bound: clamped + 5,
        confidence_interval: '±5%'
      },
      recommendation: parsed.recommendation || 'maintain',
      learningMode: false,
      totalHistoricalTrades: 0,
      minimumConfidenceApplied: 0,
      penaltyApplied: 0,
      calibratorCanBlockTrade: false
    };
  }

  private async createFallbackCalibration(
    userId: string,
    symbol: string,
    originalConfidence: number
  ): Promise<ConfidenceCalibrationResult> {
    const totalHistoricalTrades = await this.getTotalHistoricalTrades(userId);
    const isLearningMode = totalHistoricalTrades < 100;
    const historicalAccuracy = await this.getHistoricalAccuracyAtLevel(userId, symbol, originalConfidence);
    const recentPerformance = await this.getRecentPerformanceContext(userId);

    let adjustment = 0;
    const maxPenalty = isLearningMode ? 5 : 10;

    if (recentPerformance.calibration_error > 10) {
      adjustment = -5;
    } else if (recentPerformance.calibration_error < -10) {
      adjustment = +5;
    }

    if (historicalAccuracy < originalConfidence - 10) {
      adjustment -= 5;
    } else if (historicalAccuracy > originalConfidence + 10) {
      adjustment += 5;
    }

    // Cap adjustment in Learning Mode
    if (isLearningMode && adjustment < 0) {
      adjustment = Math.max(adjustment, -maxPenalty);
    }

    const minimumConfidence = isLearningMode ? 60 : 70;
    let calibrated = originalConfidence + adjustment;
    calibrated = Math.max(minimumConfidence, Math.min(100, calibrated));

    return {
      original_confidence: originalConfidence,
      calibrated_confidence: calibrated,
      adjustment_applied: calibrated - originalConfidence,
      calibration_curve_type: 'balanced',
      historical_accuracy_at_level: historicalAccuracy,
      adjustment_reasoning: 'Fallback calibration based on historical accuracy and recent trends',
      confidence_bands: {
        lower_bound: calibrated - 5,
        upper_bound: calibrated + 5,
        confidence_interval: '±5%'
      },
      recommendation: adjustment > 0 ? 'increase' : adjustment < 0 ? 'decrease' : 'maintain',
      learningMode: isLearningMode,
      totalHistoricalTrades: totalHistoricalTrades,
      minimumConfidenceApplied: minimumConfidence,
      penaltyApplied: adjustment,
      calibratorCanBlockTrade: !isLearningMode
    };
  }

  getUsageStats(): { calls: number } {
    return { calls: this.callCount };
  }
}

export const llmConfidenceCalibrator = new LLMConfidenceCalibrator();
