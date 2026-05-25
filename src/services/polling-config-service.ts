import { supabase } from '@/lib/supabase';

export type PollingSpeed = 'conservative' | 'balanced' | 'aggressive';
export type SymbolPriority = 'ultra-critical' | 'critical' | 'high' | 'normal' | 'low';

export interface PollingConfig {
  speed: PollingSpeed;
  enableVolatilityAdjustment: boolean;
  pauseOnInactive: boolean;
  customIntervals?: {
    [symbol: string]: number;
  };
}

export interface MetaApiRateLimits {
  cpuCreditsPerSecond: number;
  cpuCreditsPerTenSeconds: number;
  cpuCreditsPerAccount: number;
  priceCallCost: number;
  maxCallsPerSecond: number;
  maxCallsPerTenSeconds: number;
}

export interface PollingStrategy {
  ultraCriticalInterval: number;
  criticalInterval: number;
  highInterval: number;
  normalInterval: number;
  lowInterval: number;
  maxConcurrentSymbols: number;
}

export const META_API_LIMITS: MetaApiRateLimits = {
  cpuCreditsPerSecond: 1000,
  cpuCreditsPerTenSeconds: 5000,
  cpuCreditsPerAccount: 5000,
  priceCallCost: 50,
  maxCallsPerSecond: 20,
  maxCallsPerTenSeconds: 100,
};

export const POLLING_STRATEGIES: Record<PollingSpeed, PollingStrategy> = {
  conservative: {
    ultraCriticalInterval: 3000,
    criticalInterval: 5000,
    highInterval: 8000,
    normalInterval: 15000,
    lowInterval: 30000,
    maxConcurrentSymbols: 8,
  },
  balanced: {
    ultraCriticalInterval: 2000,
    criticalInterval: 3000,
    highInterval: 5000,
    normalInterval: 8000,
    lowInterval: 15000,
    maxConcurrentSymbols: 10,
  },
  aggressive: {
    ultraCriticalInterval: 1000,
    criticalInterval: 2000,
    highInterval: 3000,
    normalInterval: 5000,
    lowInterval: 10000,
    maxConcurrentSymbols: 12,
  },
};

export class PollingConfigService {
  private config: PollingConfig = {
    speed: 'balanced',
    enableVolatilityAdjustment: true,
    pauseOnInactive: true,
  };

  private cpuCreditsUsed: number = 0;
  private creditsResetTime: number = Date.now();
  private usageHistory: Array<{ timestamp: number; credits: number }> = [];

  async loadUserConfig(userId: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('polling_config')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data?.polling_config) {
        this.config = {
          ...this.config,
          ...data.polling_config,
        };
      }
    } catch (error) {
      console.error('[PollingConfig] Failed to load user config:', error);
    }
  }

  async saveUserConfig(userId: string, config: Partial<PollingConfig>): Promise<void> {
    try {
      this.config = { ...this.config, ...config };

      const { error } = await supabase
        .from('user_profiles')
        .update({ polling_config: this.config })
        .eq('id', userId);

      if (error) throw error;
    } catch (error) {
      console.error('[PollingConfig] Failed to save user config:', error);
    }
  }

  getConfig(): PollingConfig {
    return { ...this.config };
  }

  getStrategy(): PollingStrategy {
    return POLLING_STRATEGIES[this.config.speed];
  }

  getIntervalForPriority(priority: SymbolPriority): number {
    const strategy = this.getStrategy();
    const customInterval = this.config.customIntervals?.[priority];

    if (customInterval) return customInterval;

    switch (priority) {
      case 'ultra-critical':
        return strategy.ultraCriticalInterval;
      case 'critical':
        return strategy.criticalInterval;
      case 'high':
        return strategy.highInterval;
      case 'normal':
        return strategy.normalInterval;
      case 'low':
        return strategy.lowInterval;
      default:
        return strategy.normalInterval;
    }
  }

  canMakeRequest(): boolean {
    this.cleanupOldUsage();

    const now = Date.now();
    const tenSecondsAgo = now - 10000;

    const recentCredits = this.usageHistory
      .filter((entry) => entry.timestamp > tenSecondsAgo)
      .reduce((sum, entry) => sum + entry.credits, 0);

    return recentCredits + META_API_LIMITS.priceCallCost <= META_API_LIMITS.cpuCreditsPerTenSeconds;
  }

  recordRequest(): void {
    const now = Date.now();
    this.cpuCreditsUsed += META_API_LIMITS.priceCallCost;
    this.usageHistory.push({
      timestamp: now,
      credits: META_API_LIMITS.priceCallCost,
    });

    this.cleanupOldUsage();
  }

  private cleanupOldUsage(): void {
    const tenSecondsAgo = Date.now() - 10000;
    this.usageHistory = this.usageHistory.filter(
      (entry) => entry.timestamp > tenSecondsAgo
    );
  }

  getCreditUsage(): {
    used: number;
    limit: number;
    percentage: number;
    callsRemaining: number;
  } {
    this.cleanupOldUsage();

    const now = Date.now();
    const tenSecondsAgo = now - 10000;

    const used = this.usageHistory
      .filter((entry) => entry.timestamp > tenSecondsAgo)
      .reduce((sum, entry) => sum + entry.credits, 0);

    const percentage = (used / META_API_LIMITS.cpuCreditsPerTenSeconds) * 100;
    const callsRemaining = Math.floor(
      (META_API_LIMITS.cpuCreditsPerTenSeconds - used) / META_API_LIMITS.priceCallCost
    );

    return {
      used,
      limit: META_API_LIMITS.cpuCreditsPerTenSeconds,
      percentage,
      callsRemaining,
    };
  }

  getUsageStats(): {
    creditsPerSecond: number;
    callsPerSecond: number;
    projectedUsage: number;
  } {
    this.cleanupOldUsage();

    const now = Date.now();
    const oneSecondAgo = now - 1000;

    const lastSecondCredits = this.usageHistory
      .filter((entry) => entry.timestamp > oneSecondAgo)
      .reduce((sum, entry) => sum + entry.credits, 0);

    const creditsPerSecond = lastSecondCredits;
    const callsPerSecond = lastSecondCredits / META_API_LIMITS.priceCallCost;
    const projectedUsage = (creditsPerSecond * 10) / META_API_LIMITS.cpuCreditsPerTenSeconds * 100;

    return {
      creditsPerSecond,
      callsPerSecond,
      projectedUsage,
    };
  }

  resetUsage(): void {
    this.cpuCreditsUsed = 0;
    this.creditsResetTime = Date.now();
    this.usageHistory = [];
  }

  isApproachingLimit(): boolean {
    const usage = this.getCreditUsage();
    return usage.percentage > 80;
  }

  shouldThrottle(): boolean {
    const usage = this.getCreditUsage();
    return usage.percentage > 90;
  }

  getRecommendedDelay(): number {
    if (this.shouldThrottle()) {
      return 2000;
    }
    if (this.isApproachingLimit()) {
      return 1500;
    }
    return 0;
  }
}

export const pollingConfigService = new PollingConfigService();
