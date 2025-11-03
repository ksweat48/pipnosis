import { supabase } from '@/lib/supabase';
import { pollingConfigService } from './polling-config-service';

interface VolatilityData {
  symbol: string;
  timeframe: string;
  volatilityScore: number;
  priceStdDev: number;
  suggestedInterval: number;
  lastUpdated: Date;
}

export class VolatilityTracker {
  private volatilityCache: Map<string, VolatilityData> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private readonly CACHE_TTL = 30000;

  start(): void {
    if (this.updateInterval) return;

    console.log('[VolatilityTracker] Starting volatility tracking');
    this.updateInterval = setInterval(() => {
      this.cleanupCache();
    }, this.CACHE_TTL);
  }

  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
    this.volatilityCache.clear();
    console.log('[VolatilityTracker] Stopped volatility tracking');
  }

  async getVolatility(symbol: string, timeframe: string = 'M5'): Promise<VolatilityData | null> {
    const cacheKey = `${symbol}-${timeframe}`;
    const cached = this.volatilityCache.get(cacheKey);

    if (cached && Date.now() - cached.lastUpdated.getTime() < this.CACHE_TTL) {
      return cached;
    }

    try {
      const { data, error } = await supabase
        .from('symbol_volatility_tracking')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .maybeSingle();

      if (error) throw error;

      if (!data) return null;

      const volatilityData: VolatilityData = {
        symbol: data.symbol,
        timeframe: data.timeframe,
        volatilityScore: parseFloat(data.volatility_score),
        priceStdDev: parseFloat(data.price_std_dev),
        suggestedInterval: data.suggested_interval,
        lastUpdated: new Date(data.last_updated),
      };

      this.volatilityCache.set(cacheKey, volatilityData);
      return volatilityData;
    } catch (error) {
      console.error(`[VolatilityTracker] Failed to fetch volatility for ${symbol}:`, error);
      return null;
    }
  }

  async updateVolatility(symbol: string, price: number, timeframe: string = 'M5'): Promise<void> {
    try {
      const { error } = await supabase.rpc('update_symbol_volatility', {
        p_symbol: symbol,
        p_timeframe: timeframe,
        p_current_price: price,
      });

      if (error) throw error;

      const cacheKey = `${symbol}-${timeframe}`;
      this.volatilityCache.delete(cacheKey);
    } catch (error) {
      console.error(`[VolatilityTracker] Failed to update volatility for ${symbol}:`, error);
    }
  }

  getSuggestedInterval(symbol: string, baseInterval: number, volatilityData?: VolatilityData | null): number {
    if (!pollingConfigService.getConfig().enableVolatilityAdjustment) {
      return baseInterval;
    }

    if (!volatilityData) {
      return baseInterval;
    }

    if (volatilityData.suggestedInterval) {
      return Math.max(500, Math.min(volatilityData.suggestedInterval, baseInterval));
    }

    return baseInterval;
  }

  getVolatilityLevel(volatilityScore: number): 'low' | 'medium' | 'high' | 'extreme' {
    if (volatilityScore < 0.3) return 'low';
    if (volatilityScore < 0.6) return 'medium';
    if (volatilityScore < 1.0) return 'high';
    return 'extreme';
  }

  private cleanupCache(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.volatilityCache.forEach((data, key) => {
      if (now - data.lastUpdated.getTime() > this.CACHE_TTL) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach(key => this.volatilityCache.delete(key));

    if (keysToDelete.length > 0) {
      console.log(`[VolatilityTracker] Cleaned up ${keysToDelete.length} stale cache entries`);
    }
  }

  getCacheStats(): { size: number; symbols: string[] } {
    return {
      size: this.volatilityCache.size,
      symbols: Array.from(this.volatilityCache.keys()),
    };
  }
}

export const volatilityTracker = new VolatilityTracker();
