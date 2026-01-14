/**
 * Price Range Learning Service
 *
 * Manages dynamically learned price ranges that automatically expand as markets move.
 * This enables the price validation system to adapt to market conditions without
 * requiring manual code updates when assets hit new highs/lows.
 *
 * Key Features:
 * - Fetches learned ranges from database (with in-memory caching)
 * - Auto-expands ranges when legitimate prices exceed current bounds
 * - Respects admin manual overrides
 * - Provides fallback to static ranges for unknown symbols
 * - Batches updates to reduce database load
 *
 * Architecture:
 * - Single Source of Truth: Database holds authoritative ranges
 * - Cache Layer: 5-minute TTL to reduce DB queries
 * - Batch Updates: Collects updates and flushes every 30 seconds
 * - Circuit Breaker: Rejects extreme expansions (>100%) for safety
 */

import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';

export interface LearnedPriceRange {
  symbol: string;
  min: number;
  max: number;
  typical: number;
  isLearned: boolean;
  observationCount: number;
  lastUpdated: Date;
}

interface RangeCacheEntry {
  range: LearnedPriceRange;
  cachedAt: number;
}

interface PendingUpdate {
  symbol: string;
  price: number;
  timestamp: number;
}

export class PriceRangeLearningService {
  private rangeCache = new Map<string, RangeCacheEntry>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly BATCH_INTERVAL_MS = 30 * 1000; // 30 seconds

  private pendingUpdates = new Map<string, PendingUpdate>();
  private batchTimer: NodeJS.Timeout | null = null;
  private isEnabled = true;

  /**
   * Get learned price range for a symbol
   * Uses cache first, falls back to database
   */
  async getLearnedRange(symbol: string): Promise<LearnedPriceRange | null> {
    // Check cache first
    const cached = this.getCachedRange(symbol);
    if (cached) {
      return cached;
    }

    // Fetch from database
    try {
      const { data, error } = await supabase
        .rpc('get_current_price_range', { p_symbol: symbol });

      if (error) {
        logger.error(LogCategory.CHART, `[PriceRangeLearning] Error fetching range for ${symbol}: ${error.message}`);
        return null;
      }

      if (!data || data.length === 0) {
        // Symbol has no learned range yet
        return null;
      }

      const row = data[0];
      const range: LearnedPriceRange = {
        symbol,
        min: parseFloat(row.min_price),
        max: parseFloat(row.max_price),
        typical: parseFloat(row.typical),
        isLearned: row.is_learned,
        observationCount: row.observation_count,
        lastUpdated: new Date()
      };

      // Cache for future lookups
      this.setCachedRange(symbol, range);

      return range;
    } catch (error) {
      logger.error(LogCategory.CHART, `[PriceRangeLearning] Exception fetching range for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Update learned range with new price observation
   * Updates are batched and flushed periodically to reduce DB load
   */
  async observePrice(symbol: string, price: number): Promise<void> {
    if (!this.isEnabled) {
      return;
    }

    // Validate price is a valid number
    if (typeof price !== 'number' || isNaN(price) || !isFinite(price) || price <= 0) {
      return;
    }

    // Add to pending updates (overwrites previous pending update for this symbol)
    this.pendingUpdates.set(symbol, {
      symbol,
      price,
      timestamp: Date.now()
    });

    // Start batch timer if not already running
    if (!this.batchTimer) {
      this.batchTimer = setTimeout(() => {
        this.flushPendingUpdates();
      }, this.BATCH_INTERVAL_MS);
    }
  }

  /**
   * Immediately flush all pending updates to database
   * Called automatically on batch timer, or manually when needed
   */
  async flushPendingUpdates(): Promise<void> {
    if (this.pendingUpdates.size === 0) {
      return;
    }

    const updates = Array.from(this.pendingUpdates.values());
    this.pendingUpdates.clear();

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    logger.debug(LogCategory.CHART, `[PriceRangeLearning] Flushing ${updates.length} pending range updates`);

    // Process updates in parallel
    const updatePromises = updates.map(async (update) => {
      try {
        const { error } = await supabase
          .rpc('update_learned_price_range', {
            p_symbol: update.symbol,
            p_price: update.price
          });

        if (error) {
          logger.error(LogCategory.CHART, `[PriceRangeLearning] Error updating range for ${update.symbol}: ${error.message}`);
        } else {
          // Invalidate cache so next fetch gets fresh data
          this.rangeCache.delete(update.symbol);
        }
      } catch (error) {
        logger.error(LogCategory.CHART, `[PriceRangeLearning] Exception updating range for ${update.symbol}:`, error);
      }
    });

    await Promise.allSettled(updatePromises);
  }

  /**
   * Check if a price would be a legitimate range expansion
   * Returns confidence score (0-100) that this is legitimate vs contamination
   */
  async isLegitimateExpansion(symbol: string, price: number): Promise<{
    isLegitimate: boolean;
    confidence: number;
    reason: string;
  }> {
    const range = await this.getLearnedRange(symbol);

    if (!range) {
      // No learned range - assume legitimate
      return {
        isLegitimate: true,
        confidence: 70,
        reason: 'No learned range exists for symbol'
      };
    }

    // Calculate how far price exceeds current range
    let exceedancePercent = 0;
    if (price < range.min) {
      exceedancePercent = ((range.min - price) / range.typical) * 100;
    } else if (price > range.max) {
      exceedancePercent = ((price - range.max) / range.typical) * 100;
    } else {
      // Price is within range
      return {
        isLegitimate: true,
        confidence: 100,
        reason: 'Price within learned range'
      };
    }

    // Circuit breaker: Reject extreme expansions (>100%)
    if (exceedancePercent > 100) {
      return {
        isLegitimate: false,
        confidence: 95,
        reason: `Price exceeds range by ${exceedancePercent.toFixed(1)}% - likely data corruption`
      };
    }

    // Large expansion (50-100%) - probably legitimate but unusual
    if (exceedancePercent > 50) {
      return {
        isLegitimate: true,
        confidence: 60,
        reason: `Large expansion (${exceedancePercent.toFixed(1)}%) - verify if legitimate`
      };
    }

    // Moderate expansion (20-50%) - likely legitimate market movement
    if (exceedancePercent > 20) {
      return {
        isLegitimate: true,
        confidence: 80,
        reason: `Moderate expansion (${exceedancePercent.toFixed(1)}%) - normal volatility`
      };
    }

    // Small expansion (<20%) - definitely legitimate
    return {
      isLegitimate: true,
      confidence: 95,
      reason: `Small expansion (${exceedancePercent.toFixed(1)}%) - normal price movement`
    };
  }

  /**
   * Get cached range for symbol
   */
  private getCachedRange(symbol: string): LearnedPriceRange | null {
    const cached = this.rangeCache.get(symbol);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() - cached.cachedAt > this.CACHE_TTL_MS) {
      this.rangeCache.delete(symbol);
      return null;
    }

    return cached.range;
  }

  /**
   * Store range in cache
   */
  private setCachedRange(symbol: string, range: LearnedPriceRange): void {
    this.rangeCache.set(symbol, {
      range,
      cachedAt: Date.now()
    });
  }

  /**
   * Clear all cached ranges
   * Useful after admin manual overrides
   */
  clearCache(): void {
    this.rangeCache.clear();
    logger.info(LogCategory.CHART, '[PriceRangeLearning] Cache cleared');
  }

  /**
   * Clear cache for specific symbol
   */
  clearCacheForSymbol(symbol: string): void {
    this.rangeCache.delete(symbol);
  }

  /**
   * Enable or disable range learning
   * Useful for testing or emergency shutdown
   */
  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled && this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
      this.pendingUpdates.clear();
    }
    logger.info(LogCategory.CHART, `[PriceRangeLearning] Learning ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get statistics about cached ranges and pending updates
   */
  getStats() {
    return {
      cachedRanges: this.rangeCache.size,
      pendingUpdates: this.pendingUpdates.size,
      isEnabled: this.isEnabled,
      batchTimerActive: this.batchTimer !== null
    };
  }
}

export const priceRangeLearningService = new PriceRangeLearningService();

// Flush pending updates when window/process is about to close
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    priceRangeLearningService.flushPendingUpdates();
  });
}
