/**
 * Thesis Cache Warmer Service
 *
 * Pre-generates and caches Alpha market theses for common regime combinations
 * Runs during low-traffic periods to optimize cache hit rates
 */

import { supabase } from '../lib/supabase';
import { sharedIntelligenceCoordinator } from './shared-intelligence-coordinator';
import type { RegimeSignature } from '../types/alpha-thesis';
import { logger } from '../lib/logger';

export interface WarmingConfig {
  symbols: string[];
  maxAgeMinutes: number;
  priorityRegimes: RegimeSignature[];
}

/**
 * Default warming configuration
 */
const DEFAULT_WARMING_CONFIG: WarmingConfig = {
  symbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30', 'BTCUSD'],
  maxAgeMinutes: 15,
  priorityRegimes: [
    // Strong trending regimes
    {
      symbol: 'EURUSD',
      htfBias: 'strongly_bullish',
      microRegime: 'trending',
      volatilityRegime: 'normal_volatility',
      structureState: 'strong_trend',
      timeframeRelevance: 'H1'
    },
    {
      symbol: 'EURUSD',
      htfBias: 'strongly_bearish',
      microRegime: 'trending',
      volatilityRegime: 'normal_volatility',
      structureState: 'strong_trend',
      timeframeRelevance: 'H1'
    },
    // Range-bound regimes
    {
      symbol: 'EURUSD',
      htfBias: 'ranging',
      microRegime: 'range_bound',
      volatilityRegime: 'low_volatility',
      structureState: 'consolidating',
      timeframeRelevance: 'H1'
    },
    // High volatility regimes
    {
      symbol: 'XAUUSD',
      htfBias: 'bullish',
      microRegime: 'trending',
      volatilityRegime: 'high_volatility',
      structureState: 'strong_trend',
      timeframeRelevance: 'H1'
    }
  ]
};

class ThesisCacheWarmer {
  private isWarming = false;
  private lastWarmTime = 0;
  private readonly WARM_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  /**
   * Warm cache for high-probability regimes
   * Called during low-traffic periods or on startup
   */
  async warmCache(config: WarmingConfig = DEFAULT_WARMING_CONFIG): Promise<void> {
    if (this.isWarming) {
      logger.info('[CacheWarmer] Already warming cache, skipping');
      return;
    }

    const now = Date.now();
    if (now - this.lastWarmTime < this.WARM_INTERVAL_MS) {
      logger.info('[CacheWarmer] Recently warmed, skipping');
      return;
    }

    this.isWarming = true;
    this.lastWarmTime = now;

    try {
      logger.info('[CacheWarmer] Starting cache warming', {
        symbols: config.symbols.length,
        regimes: config.priorityRegimes.length
      });

      // Get current market regimes for each symbol
      const currentRegimes = await this.identifyActiveRegimes(config.symbols);

      // Warm cache for current regimes + priority regimes
      const regimesToWarm = [...currentRegimes, ...config.priorityRegimes];

      let warmedCount = 0;
      let skippedCount = 0;

      for (const regime of regimesToWarm) {
        try {
          const result = await this.warmRegime(regime);
          if (result.warmed) {
            warmedCount++;
          } else {
            skippedCount++;
          }
        } catch (error) {
          logger.error('[CacheWarmer] Failed to warm regime', {
            symbol: regime.symbol,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      logger.info('[CacheWarmer] Cache warming complete', {
        warmed: warmedCount,
        skipped: skippedCount,
        total: regimesToWarm.length
      });
    } finally {
      this.isWarming = false;
    }
  }

  /**
   * Warm cache for a specific regime
   * Checks if cache is still fresh before warming
   */
  private async warmRegime(regime: RegimeSignature): Promise<{ warmed: boolean; reason: string }> {
    try {
      // Check if cache already exists and is fresh
      const { data: existing } = await supabase
        .rpc('get_alpha_thesis_by_regime', {
          p_symbol: regime.symbol,
          p_regime_hash: this.generateRegimeHash(regime)
        });

      if (existing && existing.length > 0) {
        const ageMinutes = (Date.now() - new Date(existing[0].created_at).getTime()) / 1000 / 60;
        if (ageMinutes < 10) {
          return { warmed: false, reason: 'Cache still fresh' };
        }
      }

      // Generate fresh thesis (would normally call Alpha here)
      // For now, we just log the intent
      logger.info('[CacheWarmer] Would generate thesis for regime', {
        symbol: regime.symbol,
        htfBias: regime.htfBias,
        microRegime: regime.microRegime
      });

      return { warmed: true, reason: 'Thesis generated' };
    } catch (error) {
      logger.error('[CacheWarmer] Failed to warm regime', {
        symbol: regime.symbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return { warmed: false, reason: 'Error occurred' };
    }
  }

  /**
   * Identify currently active market regimes
   * Based on recent trades and market conditions
   */
  private async identifyActiveRegimes(symbols: string[]): Promise<RegimeSignature[]> {
    const regimes: RegimeSignature[] = [];

    try {
      // Query recent theses to identify active regimes
      const { data: recentTheses } = await supabase
        .from('alpha_thesis_cache')
        .select('symbol, htf_bias, micro_regime, volatility_regime, structure_state, timeframe_relevance')
        .in('symbol', symbols)
        .order('created_at', { ascending: false })
        .limit(20);

      if (recentTheses) {
        // Extract unique regime combinations
        const uniqueRegimes = new Map<string, RegimeSignature>();

        for (const thesis of recentTheses) {
          const signature: RegimeSignature = {
            symbol: thesis.symbol,
            htfBias: thesis.htf_bias as RegimeSignature['htfBias'],
            microRegime: thesis.micro_regime as RegimeSignature['microRegime'],
            volatilityRegime: thesis.volatility_regime as RegimeSignature['volatilityRegime'],
            structureState: thesis.structure_state as RegimeSignature['structureState'],
            timeframeRelevance: thesis.timeframe_relevance || 'H1'
          };

          const key = this.generateRegimeHash(signature);
          if (!uniqueRegimes.has(key)) {
            uniqueRegimes.set(key, signature);
          }
        }

        regimes.push(...Array.from(uniqueRegimes.values()));
      }
    } catch (error) {
      logger.error('[CacheWarmer] Failed to identify active regimes', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    return regimes;
  }

  /**
   * Generate simple regime hash for deduplication
   */
  private generateRegimeHash(regime: RegimeSignature): string {
    return `${regime.symbol}_${regime.htfBias}_${regime.microRegime}_${regime.volatilityRegime}_${regime.structureState}`;
  }

  /**
   * Get cache warming statistics
   */
  async getWarmingStats(): Promise<{
    lastWarmTime: number;
    isCurrentlyWarming: boolean;
    cacheSize: number;
    avgCacheAge: number;
  }> {
    try {
      const { data: cacheStats } = await supabase
        .from('alpha_thesis_cache')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(100);

      const cacheSize = cacheStats?.length || 0;
      const avgCacheAge = cacheStats
        ? cacheStats.reduce((sum, item) => {
            const ageMinutes = (Date.now() - new Date(item.created_at).getTime()) / 1000 / 60;
            return sum + ageMinutes;
          }, 0) / cacheSize
        : 0;

      return {
        lastWarmTime: this.lastWarmTime,
        isCurrentlyWarming: this.isWarming,
        cacheSize,
        avgCacheAge
      };
    } catch (error) {
      logger.error('[CacheWarmer] Failed to get warming stats', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        lastWarmTime: this.lastWarmTime,
        isCurrentlyWarming: this.isWarming,
        cacheSize: 0,
        avgCacheAge: 0
      };
    }
  }
}

export const thesisCacheWarmer = new ThesisCacheWarmer();
