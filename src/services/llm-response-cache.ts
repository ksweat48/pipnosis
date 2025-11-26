/**
 * LLM Response Cache
 *
 * In-memory caching with TTL support to reduce redundant LLM calls.
 * Safe for regime validation, mistake prevention, and calibration.
 * NEVER used for setup quality or strategy execution (needs candle accuracy).
 */

import { LLM_OPTIMIZATION_CONFIG } from '../config/llm-optimization-config';
import { supabase } from '../lib/supabase';
import { LLMLayer } from './llm-cost-optimizer';

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

class LLMResponseCache {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Generate cache key from context
   */
  private generateKey(layer: LLMLayer, context: any): string {
    // Create deterministic key from context
    const keyParts = [
      layer,
      context.symbol || '',
      context.trend || '',
      context.volatility || '',
      context.trigger || '',
      Math.floor(context.confidence || 0),
      context.quality || '', // Setup quality score
      context.consecutive || '', // Consecutive losses
      context.similar || '', // Similar patterns
      context.priceRange || '' // Price range for Layer 3 specificity
    ];

    return keyParts.join('|');
  }

  /**
   * Get cached response if available and not expired
   */
  get<T>(layer: LLMLayer, context: any): T | null {
    if (!LLM_OPTIMIZATION_CONFIG.caching.enabled) {
      return null;
    }

    const key = this.generateKey(layer, context);
    const entry = this.cache.get(key);

    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // Check if expired
    if (age > entry.ttl * 1000) {
      this.cache.delete(key);
      return null;
    }

    console.log(`[LLM Cache] ✅ HIT for ${layer} (age: ${(age / 1000).toFixed(1)}s)`);
    return entry.value as T;
  }

  /**
   * Store response in cache
   */
  set<T>(layer: LLMLayer, context: any, value: T, ttl?: number): void {
    if (!LLM_OPTIMIZATION_CONFIG.caching.enabled) {
      return;
    }

    // Get TTL from config if not provided
    const effectiveTtl = ttl || this.getTTL(layer);

    if (effectiveTtl === 0) {
      return; // Caching disabled for this layer
    }

    const key = this.generateKey(layer, context);
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: effectiveTtl,
    });

    console.log(`[LLM Cache] 💾 STORED ${layer} (TTL: ${effectiveTtl}s)`);
  }

  /**
   * Get TTL for a layer from config
   */
  private getTTL(layer: LLMLayer): number {
    const ttlConfig = LLM_OPTIMIZATION_CONFIG.caching.ttl;

    switch (layer) {
      case 'layer1_regime':
        return ttlConfig.layer1_regime_seconds;
      case 'layer2_setup':
        return ttlConfig.layer2_setup_seconds;
      case 'layer3_mistake':
        return ttlConfig.layer3_mistake_seconds;
      case 'layer4_calibrator':
        return ttlConfig.layer4_calibrator_seconds;
      case 'layer5_strategy':
        return ttlConfig.layer5_strategy_seconds;
      default:
        return 0;
    }
  }

  /**
   * Clear expired entries (cleanup)
   */
  cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > entry.ttl * 1000) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      console.log(`[LLM Cache] 🧹 Cleaned ${removed} expired entries`);
    }
  }

  /**
   * Invalidate a specific cache entry
   */
  invalidate(layer: LLMLayer, context: any): void {
    const key = this.generateKey(layer, context);
    const existed = this.cache.delete(key);
    if (existed) {
      console.log(`[LLM Cache] 🗑️ Invalidated cache for ${layer}`);
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
    console.log('[LLM Cache] 🗑️ Cache cleared');
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      entries: this.cache.size,
      enabled: LLM_OPTIMIZATION_CONFIG.caching.enabled,
    };
  }
}

export const llmResponseCache = new LLMResponseCache();

// Run cleanup every 5 minutes
setInterval(() => {
  llmResponseCache.cleanup();
}, 5 * 60 * 1000);
