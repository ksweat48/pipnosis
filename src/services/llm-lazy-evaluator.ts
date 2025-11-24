/**
 * LLM Lazy Evaluator
 *
 * Pre-filter system that decides whether to run full LLM pipeline.
 * Reduces unnecessary LLM calls by 50-70%.
 */

import { LLM_OPTIMIZATION_CONFIG } from '../config/llm-optimization-config';

export interface LazyEvaluationResult {
  shouldProceed: boolean;
  tier: 'A' | 'B' | 'C';
  reason: string;
  runLayers: number[]; // Which layers to run (1-5)
}

class LLMLazyEvaluator {
  /**
   * Evaluate if we should run LLM pipeline and which layers
   */
  evaluate(context: {
    setupQuality?: number;
    triggerConfidence?: number;
    volatility?: string;
    openPositions?: number;
  }): LazyEvaluationResult {
    if (!LLM_OPTIMIZATION_CONFIG.lazyEvaluation.enabled) {
      return {
        shouldProceed: true,
        tier: 'C',
        reason: 'Lazy evaluation disabled',
        runLayers: [1, 2, 3, 4, 5],
      };
    }

    const quality = context.setupQuality || 0;
    const config = LLM_OPTIMIZATION_CONFIG.lazyEvaluation;

    // Tier A: Auto-reject (< 55 quality)
    if (quality < config.tierA_autoReject_threshold) {
      return {
        shouldProceed: false,
        tier: 'A',
        reason: `Quality ${quality} < ${config.tierA_autoReject_threshold} threshold`,
        runLayers: [],
      };
    }

    // Tier B: Partial pipeline (55-69 quality) - only layers 1-3
    if (quality < config.tierB_partialPipeline_threshold) {
      return {
        shouldProceed: true,
        tier: 'B',
        reason: `Quality ${quality} warrants partial evaluation`,
        runLayers: [1, 2, 3], // Skip calibration and strategy
      };
    }

    // Tier C: Full pipeline (>= 70 quality)
    return {
      shouldProceed: true,
      tier: 'C',
      reason: `Quality ${quality} warrants full pipeline`,
      runLayers: [1, 2, 3, 4, 5],
    };
  }

  /**
   * Quick quality estimate before running setup evaluator
   * Uses simple heuristics to avoid LLM call
   */
  quickQualityEstimate(context: {
    triggerConfidence?: number;
    trend?: string;
    volatility?: string;
    priceVsVWAP?: number;
  }): number {
    let quality = 50; // Base score

    // Trigger confidence factor
    const confidence = context.triggerConfidence || 50;
    quality += (confidence - 50) * 0.5; // ±25 points max

    // Trend clarity
    if (context.trend === 'bullish' || context.trend === 'bearish') {
      quality += 10;
    } else if (context.trend === 'sideways') {
      quality -= 15;
    }

    // Volatility appropriateness
    if (context.volatility === 'medium') {
      quality += 5;
    } else if (context.volatility === 'high') {
      quality -= 10;
    } else if (context.volatility === 'low') {
      quality -= 5;
    }

    // Price vs VWAP (indicates momentum)
    const vwapDiff = Math.abs(context.priceVsVWAP || 0);
    if (vwapDiff > 0.5) {
      quality += 5; // Strong momentum
    }

    return Math.max(0, Math.min(100, quality));
  }

  /**
   * Check if setup should be instantly rejected (pre-LLM)
   */
  shouldInstantReject(context: {
    openPositions?: number;
    accountExposure?: number;
    triggerConfidence?: number;
    volatility?: string;
  }): { reject: boolean; reason: string } {
    // Too many open positions
    if (context.openPositions && context.openPositions >= 3) {
      return { reject: true, reason: 'Max concurrent positions reached' };
    }

    // Too much exposure
    if (context.accountExposure && context.accountExposure >= 10) {
      return { reject: true, reason: 'Account exposure too high' };
    }

    // Very low trigger confidence
    if (context.triggerConfidence && context.triggerConfidence < 30) {
      return { reject: true, reason: 'Trigger confidence too low' };
    }

    return { reject: false, reason: '' };
  }
}

export const llmLazyEvaluator = new LLMLazyEvaluator();
