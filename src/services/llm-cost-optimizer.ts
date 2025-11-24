/**
 * LLM Cost Optimizer
 *
 * Manages model selection, rate limiting, and cost tracking.
 */

import { LLM_OPTIMIZATION_CONFIG, calculateCost } from '../config/llm-optimization-config';
import { supabase } from '../lib/supabase';

export type LLMLayer = 'layer1_regime' | 'layer2_setup' | 'layer3_mistake' | 'layer4_calibrator' | 'layer5_strategy';

interface RateLimitState {
  gpt4o: { count: number; windowStart: number };
  gpt4o_mini: { count: number; windowStart: number };
}

class LLMCostOptimizer {
  private rateLimitState: RateLimitState = {
    gpt4o: { count: 0, windowStart: Date.now() },
    gpt4o_mini: { count: 0, windowStart: Date.now() },
  };

  private totalCostThisHour: number = 0;
  private costWindowStart: number = Date.now();

  /**
   * Select optimal model for a given layer
   */
  selectModel(
    layer: LLMLayer,
    context?: {
      setupQuality?: number;
      isBacktest?: boolean;
      isNovel?: boolean;
    }
  ): 'gpt-4o' | 'gpt-4o-mini' {
    if (!LLM_OPTIMIZATION_CONFIG.enabled) {
      return 'gpt-4o'; // Default to full model if optimization disabled
    }

    const config = LLM_OPTIMIZATION_CONFIG;

    // Backtest mode: prefer mini unless novel
    if (context?.isBacktest && config.backtestMode.preferMiniModel && !context?.isNovel) {
      return 'gpt-4o-mini';
    }

    // Layer 5 special logic: use mini for high-quality setups
    if (layer === 'layer5_strategy') {
      const quality = context?.setupQuality || 0;
      if (quality >= config.models.layer5_high_quality_threshold && !context?.isNovel) {
        return 'gpt-4o-mini';
      }
      return config.models.layer5_strategy;
    }

    // All other layers: use configured model
    return config.models[layer];
  }

  /**
   * Check if we can make a request (rate limiting)
   */
  async canMakeRequest(model: 'gpt-4o' | 'gpt-4o-mini'): Promise<boolean> {
    if (!LLM_OPTIMIZATION_CONFIG.rateLimits.enable_queuing) {
      return true; // Rate limiting disabled
    }

    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    const state = model === 'gpt-4o' ? this.rateLimitState.gpt4o : this.rateLimitState.gpt4o_mini;
    const limit = model === 'gpt-4o'
      ? LLM_OPTIMIZATION_CONFIG.rateLimits.gpt4o_requests_per_hour
      : LLM_OPTIMIZATION_CONFIG.rateLimits.gpt4o_mini_requests_per_hour;

    // Reset window if expired
    if (now - state.windowStart > oneHour) {
      state.count = 0;
      state.windowStart = now;
    }

    return state.count < limit;
  }

  /**
   * Track a request (increment counter)
   */
  trackRequest(model: 'gpt-4o' | 'gpt-4o-mini'): void {
    const state = model === 'gpt-4o' ? this.rateLimitState.gpt4o : this.rateLimitState.gpt4o_mini;
    state.count++;
  }

  /**
   * Log cost to database
   */
  async logCost(
    userId: string,
    sessionId: string,
    layer: LLMLayer,
    model: 'gpt-4o' | 'gpt-4o-mini',
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
    context?: any
  ): Promise<void> {
    if (!LLM_OPTIMIZATION_CONFIG.costTracking.enabled) {
      return;
    }

    // Track cumulative cost
    this.trackCumulativeCost(costUsd);

    if (!LLM_OPTIMIZATION_CONFIG.costTracking.logToDatabase) {
      return;
    }

    try {
      await supabase.from('llm_cost_tracking').insert({
        user_id: userId,
        session_id: sessionId,
        layer_name: layer,
        model_used: model,
        tokens_input: inputTokens,
        tokens_output: outputTokens,
        cost_usd: costUsd,
        context: context || {},
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[Cost Optimizer] Failed to log cost:', error);
    }
  }

  /**
   * Track cumulative cost and alert if threshold exceeded
   */
  private trackCumulativeCost(costUsd: number): void {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;

    // Reset window if expired
    if (now - this.costWindowStart > oneHour) {
      this.totalCostThisHour = 0;
      this.costWindowStart = now;
    }

    this.totalCostThisHour += costUsd;

    // Alert if threshold exceeded
    if (this.totalCostThisHour > LLM_OPTIMIZATION_CONFIG.costTracking.alertThreshold_usd_per_hour) {
      console.warn(`⚠️ [Cost Alert] Spending exceeded $${LLM_OPTIMIZATION_CONFIG.costTracking.alertThreshold_usd_per_hour}/hour. Current: $${this.totalCostThisHour.toFixed(2)}`);
    }
  }

  /**
   * Get current usage stats
   */
  getUsageStats() {
    return {
      rateLimits: {
        gpt4o: {
          used: this.rateLimitState.gpt4o.count,
          limit: LLM_OPTIMIZATION_CONFIG.rateLimits.gpt4o_requests_per_hour,
        },
        gpt4o_mini: {
          used: this.rateLimitState.gpt4o_mini.count,
          limit: LLM_OPTIMIZATION_CONFIG.rateLimits.gpt4o_mini_requests_per_hour,
        },
      },
      cost: {
        thisHour: this.totalCostThisHour,
        threshold: LLM_OPTIMIZATION_CONFIG.costTracking.alertThreshold_usd_per_hour,
      },
    };
  }

  /**
   * Calculate cost for a potential request
   */
  estimateCost(model: 'gpt-4o' | 'gpt-4o-mini', estimatedInputTokens: number, estimatedOutputTokens: number): number {
    return calculateCost(model, estimatedInputTokens, estimatedOutputTokens);
  }
}

export const llmCostOptimizer = new LLMCostOptimizer();
