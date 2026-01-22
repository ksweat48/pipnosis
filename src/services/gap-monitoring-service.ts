import { logger, LogCategory } from '@/lib/logger';
import { marketDataService } from './market-data-service';

export interface GapStatistics {
  symbol: string;
  timeframe: string;
  totalGaps: number;
  totalMissingCandles: number;
  largestGap: number;
  lastChecked: Date;
  dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
}

export interface SystemGapStatus {
  overallHealth: 'healthy' | 'degraded' | 'critical';
  totalGapsAcrossSystem: number;
  symbolsWithGaps: number;
  lastAutoFillTime: Date | null;
  backfillProgress: number;
}

const TIMEFRAME_SECONDS: Record<string, number> = {
  'M1': 60,
  'M5': 300,
  'M15': 900,
  'M30': 1800,
  'H1': 3600,
  'H4': 14400,
  'D1': 86400
};

class GapMonitoringService {
  private gapCache: Map<string, GapStatistics> = new Map();
  private lastSystemCheck: Date | null = null;

  /**
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  async detectGaps(
    symbol: string,
    timeframe: string,
    lookbackDays: number = 7
  ): Promise<GapStatistics> {
    const cacheKey = `${symbol}_${timeframe}`;
    const cached = this.gapCache.get(cacheKey);

    if (cached && Date.now() - cached.lastChecked.getTime() < 300000) {
      return cached;
    }

    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

      const candles = await marketDataService.getCandlesInRange(
        symbol,
        timeframe,
        startTime,
        endTime,
        true // ascending order
      );

      if (!candles || candles.length < 2) {
        const stats: GapStatistics = {
          symbol,
          timeframe,
          totalGaps: 0,
          totalMissingCandles: 0,
          largestGap: 0,
          lastChecked: new Date(),
          dataQuality: 'poor'
        };
        this.gapCache.set(cacheKey, stats);
        return stats;
      }

      const intervalMs = TIMEFRAME_SECONDS[timeframe] * 1000;
      const gapThreshold = intervalMs * 1.5;

      let totalGaps = 0;
      let totalMissingCandles = 0;
      let largestGap = 0;

      for (let i = 1; i < candles.length; i++) {
        const prevTime = new Date(candles[i - 1].open_time);
        const currTime = new Date(candles[i].open_time);
        const timeDiff = currTime.getTime() - prevTime.getTime();

        if (timeDiff > gapThreshold) {
          const prevDay = prevTime.getUTCDay();
          const currDay = currTime.getUTCDay();

          const isWeekendGap =
            (prevDay === 5 && (currDay === 0 || currDay === 1)) ||
            (prevDay === 6 && (currDay === 0 || currDay === 1));

          if (!isWeekendGap) {
            const missingCandles = Math.floor(timeDiff / intervalMs) - 1;

            if (missingCandles > 0) {
              totalGaps++;
              totalMissingCandles += missingCandles;
              largestGap = Math.max(largestGap, missingCandles);
            }
          }
        }
      }

      let dataQuality: 'excellent' | 'good' | 'fair' | 'poor';
      if (totalGaps === 0) {
        dataQuality = 'excellent';
      } else if (totalGaps <= 3 && totalMissingCandles <= 10) {
        dataQuality = 'good';
      } else if (totalGaps <= 10 && totalMissingCandles <= 50) {
        dataQuality = 'fair';
      } else {
        dataQuality = 'poor';
      }

      const stats: GapStatistics = {
        symbol,
        timeframe,
        totalGaps,
        totalMissingCandles,
        largestGap,
        lastChecked: new Date(),
        dataQuality
      };

      this.gapCache.set(cacheKey, stats);
      return stats;

    } catch (error) {
      logger.error('[GapMonitoring] Error detecting gaps:', error);

      const stats: GapStatistics = {
        symbol,
        timeframe,
        totalGaps: -1,
        totalMissingCandles: -1,
        largestGap: -1,
        lastChecked: new Date(),
        dataQuality: 'poor'
      };

      return stats;
    }
  }

  async getSystemGapStatus(): Promise<SystemGapStatus> {
    const now = new Date();

    if (this.lastSystemCheck && now.getTime() - this.lastSystemCheck.getTime() < 300000) {
      return this.getCachedSystemStatus();
    }

    try {
      const symbols = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
      const timeframes = ['M15', 'H1', 'H4'];

      const allStats = await Promise.all(
        symbols.flatMap(symbol =>
          timeframes.map(timeframe => this.detectGaps(symbol, timeframe, 7))
        )
      );

      const totalGapsAcrossSystem = allStats.reduce((sum, stat) => sum + Math.max(0, stat.totalGaps), 0);
      const symbolsWithGaps = new Set(
        allStats.filter(stat => stat.totalGaps > 0).map(stat => stat.symbol)
      ).size;

      let overallHealth: 'healthy' | 'degraded' | 'critical';
      if (totalGapsAcrossSystem === 0) {
        overallHealth = 'healthy';
      } else if (totalGapsAcrossSystem <= 20) {
        overallHealth = 'degraded';
      } else {
        overallHealth = 'critical';
      }

      const status: SystemGapStatus = {
        overallHealth,
        totalGapsAcrossSystem,
        symbolsWithGaps,
        lastAutoFillTime: null,
        backfillProgress: 0
      };

      this.lastSystemCheck = now;

      return status;

    } catch (error) {
      logger.error('[GapMonitoring] Error getting system status:', error);

      return {
        overallHealth: 'critical',
        totalGapsAcrossSystem: -1,
        symbolsWithGaps: -1,
        lastAutoFillTime: null,
        backfillProgress: 0
      };
    }
  }

  private getCachedSystemStatus(): SystemGapStatus {
    const allCached = Array.from(this.gapCache.values());
    const totalGapsAcrossSystem = allCached.reduce((sum, stat) => sum + Math.max(0, stat.totalGaps), 0);
    const symbolsWithGaps = new Set(
      allCached.filter(stat => stat.totalGaps > 0).map(stat => stat.symbol)
    ).size;

    let overallHealth: 'healthy' | 'degraded' | 'critical';
    if (totalGapsAcrossSystem === 0) {
      overallHealth = 'healthy';
    } else if (totalGapsAcrossSystem <= 20) {
      overallHealth = 'degraded';
    } else {
      overallHealth = 'critical';
    }

    return {
      overallHealth,
      totalGapsAcrossSystem,
      symbolsWithGaps,
      lastAutoFillTime: this.lastSystemCheck,
      backfillProgress: 0
    };
  }

  clearCache(): void {
    this.gapCache.clear();
    this.lastSystemCheck = null;
  }

  async triggerManualGapFill(symbol?: string, timeframe?: string): Promise<boolean> {
    try {
      logger.info('[GapMonitoring] Triggering manual gap fill');

      const response = await fetch('/.netlify/functions/automatic-gap-filler', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: symbol || 'all',
          timeframe: timeframe || 'all',
          manual: true
        })
      });

      if (!response.ok) {
        throw new Error(`Gap fill failed: ${response.status}`);
      }

      this.clearCache();

      logger.info('[GapMonitoring] Manual gap fill triggered successfully');
      return true;

    } catch (error) {
      logger.error('[GapMonitoring] Manual gap fill failed:', error);
      return false;
    }
  }
}

export const gapMonitoringService = new GapMonitoringService();
