/**
 * Aggregator Health Monitor
 *
 * Monitors the health of the background candle aggregator
 * to ensure real-time data pipeline is functioning.
 *
 * ✅ SSOT COMPLIANT: Uses MarketDataService for all candle queries
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { backgroundCandleAggregator } from './background-candle-aggregator';
import { marketDataService } from './market-data-service';

export interface AggregatorHealthStatus {
  isRunning: boolean;
  isReceivingTicks: boolean;
  lastCandleTime: Date | null;
  candleAge: number | null; // milliseconds
  isHealthy: boolean;
  reason?: string;
}

const MAX_CANDLE_AGE_MS = 600000; // 10 minutes (2x M5 candle)
const MAX_REALTIME_PRICE_AGE_MS = 60000; // 60 seconds

class AggregatorHealthMonitor {
  /**
   * Check if background aggregator is healthy and producing candles
   */
  async checkAggregatorHealth(symbol: string): Promise<AggregatorHealthStatus> {
    try {
      // Check if aggregator is running (always true in browser)
      const isRunning = true;

      // Check if we're receiving recent price ticks
      const isReceivingTicks = await this.checkRecentTicks(symbol);

      // Check when last M5 candle was created
      const { lastCandleTime, candleAge } = await this.getLastCandleInfo(symbol);

      // Determine if aggregator is healthy
      let isHealthy = true;
      let reason: string | undefined;

      if (!isReceivingTicks) {
        isHealthy = false;
        reason = 'No recent price ticks received - WebSocket may be disconnected';
      } else if (!lastCandleTime) {
        isHealthy = false;
        reason = 'No M5 candles found in database';
      } else if (candleAge && candleAge > MAX_CANDLE_AGE_MS) {
        isHealthy = false;
        reason = `Last M5 candle is ${Math.floor(candleAge / 60000)} minutes old (stale)`;
      }

      return {
        isRunning,
        isReceivingTicks,
        lastCandleTime,
        candleAge,
        isHealthy,
        reason
      };
    } catch (error) {
      logger.error('[AggregatorHealth] Health check error:', error);
      return {
        isRunning: false,
        isReceivingTicks: false,
        lastCandleTime: null,
        candleAge: null,
        isHealthy: false,
        reason: 'Health check failed'
      };
    }
  }

  /**
   * Check if we're receiving recent price ticks
   */
  private async checkRecentTicks(symbol: string): Promise<boolean> {
    try {
      const { data: recentPrice, error } = await supabase
        .from('realtime_prices')
        .select('created_at')
        .eq('symbol', symbol)
        .maybeSingle();

      if (error || !recentPrice) {
        return false;
      }

      const lastUpdate = new Date(recentPrice.created_at).getTime();
      const now = Date.now();
      const ageMs = now - lastUpdate;

      return ageMs < MAX_REALTIME_PRICE_AGE_MS;
    } catch (error) {
      logger.error('[AggregatorHealth] Tick check error:', error);
      return false;
    }
  }

  /**
   * Get information about the most recent M5 candle
   * ✅ SSOT: Uses MarketDataService
   */
  private async getLastCandleInfo(
    symbol: string
  ): Promise<{ lastCandleTime: Date | null; candleAge: number | null }> {
    try {
      const lastCandle = await marketDataService.getLastCandle(symbol, 'M5');

      if (!lastCandle) {
        return { lastCandleTime: null, candleAge: null };
      }

      const lastCandleTime = new Date(lastCandle.open_time);
      const candleAge = Date.now() - lastCandleTime.getTime();

      return { lastCandleTime, candleAge };
    } catch (error) {
      logger.error('[AggregatorHealth] Last candle check error:', error);
      return { lastCandleTime: null, candleAge: null };
    }
  }

  /**
   * Attempt to restart aggregator if unhealthy (for crypto pairs)
   */
  async attemptRestart(symbol: string): Promise<boolean> {
    try {
      logger.info(`[AggregatorHealth] Attempting to restart aggregator for ${symbol}`);

      // Check if this is a crypto symbol
      const cryptoSymbols = ['BTCUSD', 'ETHUSD'];
      if (!cryptoSymbols.includes(symbol)) {
        logger.debug('[AggregatorHealth] Not a crypto symbol, skip restart');
        return false;
      }

      // Background aggregator should auto-restart WebSocket connections
      // Just verify it's running
      const status = await this.checkAggregatorHealth(symbol);

      if (status.isHealthy) {
        logger.info('[AggregatorHealth] Aggregator is now healthy');
        return true;
      }

      logger.warn('[AggregatorHealth] Aggregator still unhealthy after restart attempt');
      return false;
    } catch (error) {
      logger.error('[AggregatorHealth] Restart attempt error:', error);
      return false;
    }
  }

  /**
   * Get detailed aggregator statistics
   * ✅ SSOT: Uses MarketDataService
   */
  async getAggregatorStats(symbol: string): Promise<{
    totalCandles: number;
    candlesLast24h: number;
    averageCandleInterval: number | null;
  }> {
    try {
      // Get total M5 candles for symbol
      const totalCandles = await marketDataService.getCandleCount(symbol, 'M5');

      // Get candles from last 24 hours
      const yesterday = new Date();
      yesterday.setHours(yesterday.getHours() - 24);

      const candlesLast24h = await marketDataService.getCandleCount(
        symbol,
        'M5',
        yesterday
      );

      // Calculate average interval between candles (last 10)
      const recentCandles = await marketDataService.getCandles(symbol, 'M5', 10);

      let averageCandleInterval: number | null = null;
      if (recentCandles && recentCandles.length > 1) {
        let totalInterval = 0;
        let intervalCount = 0;

        for (let i = 0; i < recentCandles.length - 1; i++) {
          const currentTime = new Date(recentCandles[i].open_time).getTime();
          const previousTime = new Date(recentCandles[i + 1].open_time).getTime();
          totalInterval += currentTime - previousTime;
          intervalCount++;
        }

        averageCandleInterval = Math.floor(totalInterval / intervalCount);
      }

      return {
        totalCandles,
        candlesLast24h,
        averageCandleInterval
      };
    } catch (error) {
      logger.error('[AggregatorHealth] Stats error:', error);
      return {
        totalCandles: 0,
        candlesLast24h: 0,
        averageCandleInterval: null
      };
    }
  }
}

export const aggregatorHealthMonitor = new AggregatorHealthMonitor();
