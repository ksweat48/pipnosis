import { supabase } from '../lib/supabase';

export interface BlockCategoryStats {
  blockCategory: string;
  totalBlocks: number;
  percentage: number;
  avgStaleSeconds: number;
  symbolsAffected: string[];
}

export interface AutoRefreshStats {
  totalBlocks: number;
  refreshAttempted: number;
  refreshSucceeded: number;
  hardBlocks: number;
  successRate: number;
  rescueRate: number;
}

export interface SymbolBlockBreakdown {
  symbol: string;
  totalBlocks: number;
  staleOmega: number;
  staleAlpha: number;
  priceDrift: number;
  stalePrice: number;
  noPrice: number;
  persistentStale: number;
  mostCommonCause: string;
}

export interface BlockTrend {
  hourBucket: string;
  totalBlocks: number;
  staleBlocks: number;
  driftBlocks: number;
  refreshSuccessRate: number;
}

class FreshnessAnalyticsService {
  private cache: {
    blockStats?: { data: BlockCategoryStats[]; timestamp: number };
    autoRefresh?: { data: AutoRefreshStats; timestamp: number };
    symbolBreakdown?: { data: SymbolBlockBreakdown[]; timestamp: number };
    trends?: { data: BlockTrend[]; timestamp: number };
  } = {};

  private readonly CACHE_TTL = 60000;

  async getBlockCategoryStats(hours: number = 24): Promise<BlockCategoryStats[]> {
    const cacheKey = 'blockStats';
    const cached = this.cache[cacheKey];

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const { data, error } = await supabase.rpc('get_freshness_block_stats', { p_hours: hours });

      if (error) throw error;

      const result = (data || []).map((row: any) => ({
        blockCategory: row.block_category,
        totalBlocks: parseInt(row.total_blocks),
        percentage: parseFloat(row.percentage),
        avgStaleSeconds: parseFloat(row.avg_stale_seconds) || 0,
        symbolsAffected: row.symbols_affected || []
      }));

      this.cache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    } catch (err) {
      console.error('[FreshnessAnalytics] Failed to get block category stats:', err);
      return [];
    }
  }

  async getAutoRefreshStats(hours: number = 24): Promise<AutoRefreshStats | null> {
    const cacheKey = 'autoRefresh';
    const cached = this.cache[cacheKey];

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const { data, error } = await supabase.rpc('get_auto_refresh_stats', { p_hours: hours });

      if (error) throw error;

      if (!data || data.length === 0) return null;

      const row = data[0];
      const result: AutoRefreshStats = {
        totalBlocks: parseInt(row.total_blocks) || 0,
        refreshAttempted: parseInt(row.refresh_attempted) || 0,
        refreshSucceeded: parseInt(row.refresh_succeeded) || 0,
        hardBlocks: parseInt(row.hard_blocks) || 0,
        successRate: parseFloat(row.success_rate) || 0,
        rescueRate: parseFloat(row.rescue_rate) || 0
      };

      this.cache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    } catch (err) {
      console.error('[FreshnessAnalytics] Failed to get auto-refresh stats:', err);
      return null;
    }
  }

  async getSymbolBlockBreakdown(hours: number = 24): Promise<SymbolBlockBreakdown[]> {
    const cacheKey = 'symbolBreakdown';
    const cached = this.cache[cacheKey];

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const { data, error } = await supabase.rpc('get_symbol_block_breakdown', { p_hours: hours });

      if (error) throw error;

      const result = (data || []).map((row: any) => ({
        symbol: row.symbol,
        totalBlocks: parseInt(row.total_blocks),
        staleOmega: parseInt(row.stale_omega),
        staleAlpha: parseInt(row.stale_alpha),
        priceDrift: parseInt(row.price_drift),
        stalePrice: parseInt(row.stale_price),
        noPrice: parseInt(row.no_price),
        persistentStale: parseInt(row.persistent_stale),
        mostCommonCause: row.most_common_cause
      }));

      this.cache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    } catch (err) {
      console.error('[FreshnessAnalytics] Failed to get symbol block breakdown:', err);
      return [];
    }
  }

  async getBlockTrends(hours: number = 24): Promise<BlockTrend[]> {
    const cacheKey = 'trends';
    const cached = this.cache[cacheKey];

    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data;
    }

    try {
      const { data, error } = await supabase.rpc('get_block_trends_hourly', { p_hours: hours });

      if (error) throw error;

      const result = (data || []).map((row: any) => ({
        hourBucket: row.hour_bucket,
        totalBlocks: parseInt(row.total_blocks),
        staleBlocks: parseInt(row.stale_blocks),
        driftBlocks: parseInt(row.drift_blocks),
        refreshSuccessRate: parseFloat(row.refresh_success_rate) || 0
      }));

      this.cache[cacheKey] = { data: result, timestamp: Date.now() };
      return result;
    } catch (err) {
      console.error('[FreshnessAnalytics] Failed to get block trends:', err);
      return [];
    }
  }

  clearCache(): void {
    this.cache = {};
  }

  getCategoryLabel(category: string): string {
    const labels: Record<string, string> = {
      'BLOCK_STALE_OMEGA_INTELLIGENCE': 'Stale Omega Intelligence',
      'BLOCK_STALE_ALPHA_INTELLIGENCE': 'Stale Alpha Intelligence',
      'BLOCK_PRICE_DRIFT': 'Price Drift',
      'BLOCK_STALE_PRICE_FEED': 'Stale Price Feed',
      'BLOCK_NO_PRICE_DATA': 'No Price Data',
      'BLOCK_PERSISTENT_STALENESS': 'Persistent Staleness'
    };
    return labels[category] || category;
  }

  getCategoryColor(category: string): string {
    const colors: Record<string, string> = {
      'BLOCK_STALE_OMEGA_INTELLIGENCE': 'bg-cyan-500',
      'BLOCK_STALE_ALPHA_INTELLIGENCE': 'bg-amber-500',
      'BLOCK_PRICE_DRIFT': 'bg-red-500',
      'BLOCK_STALE_PRICE_FEED': 'bg-orange-500',
      'BLOCK_NO_PRICE_DATA': 'bg-purple-500',
      'BLOCK_PERSISTENT_STALENESS': 'bg-rose-500'
    };
    return colors[category] || 'bg-slate-500';
  }

  generateRecommendations(
    blockStats: BlockCategoryStats[],
    autoRefreshStats: AutoRefreshStats | null,
    symbolBreakdown: SymbolBlockBreakdown[]
  ): string[] {
    const recommendations: string[] = [];

    if (blockStats.length > 0) {
      const topBlock = blockStats[0];

      if (topBlock.blockCategory === 'BLOCK_STALE_OMEGA_INTELLIGENCE' && topBlock.percentage > 40) {
        recommendations.push(`Consider increasing Omega cache TTL - ${topBlock.percentage.toFixed(0)}% of blocks are due to stale Omega intelligence`);
      }

      if (topBlock.blockCategory === 'BLOCK_PRICE_DRIFT' && topBlock.percentage > 30) {
        recommendations.push(`High price drift blocks (${topBlock.percentage.toFixed(0)}%) - consider adjusting drift threshold or increasing price refresh rate`);
      }
    }

    if (autoRefreshStats && autoRefreshStats.refreshAttempted > 0) {
      if (autoRefreshStats.successRate < 50) {
        recommendations.push(`Auto-refresh success rate is low (${autoRefreshStats.successRate.toFixed(0)}%) - investigate refresh callback implementation`);
      } else if (autoRefreshStats.rescueRate > 60) {
        recommendations.push(`Auto-refresh is working well (${autoRefreshStats.rescueRate.toFixed(0)}% rescue rate) - saving many trades from false blocks`);
      }
    }

    symbolBreakdown.slice(0, 3).forEach(symbol => {
      if (symbol.priceDrift > symbol.totalBlocks * 0.6) {
        recommendations.push(`${symbol.symbol}: High price drift blocks - consider tighter price update intervals`);
      }
      if (symbol.staleOmega > symbol.totalBlocks * 0.7) {
        recommendations.push(`${symbol.symbol}: Frequent Omega staleness - increase TTL for this volatile symbol`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('Freshness gate is performing well - no critical issues detected');
    }

    return recommendations;
  }
}

export const freshnessAnalyticsService = new FreshnessAnalyticsService();
