/**
 * LLM Cost Optimization Configuration
 *
 * Central configuration for all cost optimization features.
 * Adjust these settings to balance cost vs. performance.
 */

export interface LLMOptimizationConfig {
  enabled: boolean;

  // Model selection per layer
  models: {
    layer1_regime: 'gpt-4o' | 'gpt-4o-mini';
    layer2_setup: 'gpt-4o' | 'gpt-4o-mini';
    layer3_mistake: 'gpt-4o' | 'gpt-4o-mini';
    layer4_calibrator: 'gpt-4o' | 'gpt-4o-mini';
    layer5_strategy: 'gpt-4o' | 'gpt-4o-mini';
    layer5_high_quality_threshold: number; // Use mini if quality >= this
  };

  // Caching configuration
  caching: {
    enabled: boolean;
    ttl: {
      layer1_regime_seconds: number;
      layer2_setup_seconds: number; // 0 = no cache
      layer3_mistake_seconds: number;
      layer4_calibrator_seconds: number;
      layer5_strategy_seconds: number; // 0 = no cache
    };
  };

  // Lazy evaluation (pre-filter before LLM)
  lazyEvaluation: {
    enabled: boolean;
    tierA_autoReject_threshold: number; // quality < this = auto reject
    tierB_partialPipeline_threshold: number; // quality < this = layers 1-3 only
    tierC_fullPipeline_threshold: number; // quality >= this = full pipeline
  };

  // Pattern matching (skip LLM if similar pattern found)
  patternMatching: {
    enabled: boolean;
    similarityThreshold: number; // 0-100, higher = more similar required
    maxPatternAge_hours: number;
  };

  // Rate limiting
  rateLimits: {
    gpt4o_requests_per_hour: number;
    gpt4o_mini_requests_per_hour: number;
    enable_queuing: boolean;
  };

  // Cost tracking
  costTracking: {
    enabled: boolean;
    logToDatabase: boolean;
    alertThreshold_usd_per_hour: number;
  };

  // Backtest-specific optimizations
  backtestMode: {
    forceAggressiveOptimization: boolean;
    preferMiniModel: boolean; // Use mini unless absolutely necessary
    enableBatching: boolean;
  };
}

export const LLM_OPTIMIZATION_CONFIG: LLMOptimizationConfig = {
  enabled: true, // Master switch

  models: {
    layer1_regime: 'gpt-4o-mini',
    layer2_setup: 'gpt-4o-mini',
    layer3_mistake: 'gpt-4o-mini',
    layer4_calibrator: 'gpt-4o-mini',
    layer5_strategy: 'gpt-4o-mini', // Switched to mini - Flow V2 pre-validates
    layer5_high_quality_threshold: 85, // Use mini if quality >= 85
  },

  caching: {
    enabled: true,
    ttl: {
      layer1_regime_seconds: 300, // 5 minutes - regime doesn't change quickly
      layer2_setup_seconds: 0, // NO CACHE - must be candle-accurate
      layer3_mistake_seconds: 7200, // 2 hours - mistake patterns are static
      layer4_calibrator_seconds: 86400, // 24 hours - historical stats stable
      layer5_strategy_seconds: 0, // NO CACHE - execution must be fresh
    },
  },

  lazyEvaluation: {
    enabled: true,
    tierA_autoReject_threshold: 55, // < 55 quality = instant reject
    tierB_partialPipeline_threshold: 70, // 55-69 = layers 1-3 only
    tierC_fullPipeline_threshold: 70, // >= 70 = full pipeline
  },

  patternMatching: {
    enabled: true,
    similarityThreshold: 70, // 70%+ similarity = reuse pattern
    maxPatternAge_hours: 24, // Only use patterns from last 24h
  },

  rateLimits: {
    gpt4o_requests_per_hour: 60,
    gpt4o_mini_requests_per_hour: 500,
    enable_queuing: true,
  },

  costTracking: {
    enabled: true,
    logToDatabase: true,
    alertThreshold_usd_per_hour: 5.0, // Alert if spending > $5/hour
  },

  backtestMode: {
    forceAggressiveOptimization: true,
    preferMiniModel: true,
    enableBatching: false, // Not yet implemented
  },
};

// Pricing constants (per 1M tokens)
export const MODEL_PRICING = {
  'gpt-4o': {
    input: 5.00,
    output: 15.00,
  },
  'gpt-4o-mini': {
    input: 0.15,
    output: 0.60,
  },
};

export function calculateCost(model: 'gpt-4o' | 'gpt-4o-mini', inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) {
    console.warn(`[calculateCost] Unknown model: ${model}, defaulting to gpt-4o-mini pricing`);
    const fallbackPricing = MODEL_PRICING['gpt-4o-mini'];
    const inputCost = (inputTokens / 1_000_000) * fallbackPricing.input;
    const outputCost = (outputTokens / 1_000_000) * fallbackPricing.output;
    return inputCost + outputCost;
  }
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}
