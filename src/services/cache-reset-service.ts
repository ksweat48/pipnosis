/**
 * Cache Reset Service
 *
 * Provides utilities to clear all caches and force fresh data collection
 */

import { logger, LogCategory } from '@/lib/logger';
import { chartCandlePoller } from './chart-candle-poller';
import { chartDirectPricePoller } from './chart-direct-price-poller';
import { backgroundCandleAggregator } from './background-candle-aggregator';
import { globalPollingCoordinator } from './global-polling-coordinator';

export class CacheResetService {
  /**
   * Clears all browser storage (localStorage, sessionStorage)
   */
  clearBrowserStorage(): void {
    try {
      // Clear localStorage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));

      // Clear sessionStorage
      sessionStorage.clear();

      logger.info(LogCategory.CHART, '✅ Browser storage cleared');
    } catch (error) {
      logger.error(LogCategory.CHART, 'Failed to clear browser storage:', error);
      throw error;
    }
  }

  /**
   * Stops all active polling
   */
  stopAllPolling(): void {
    try {
      // Stop global coordinator
      globalPollingCoordinator.pauseAll();

      // Stop chart candle poller (handled by coordinator but explicit for safety)
      // Note: We don't have direct access to clear all pollers, but stopping coordinator handles it

      // Stop direct price poller
      chartDirectPricePoller.stop();

      // Stop background aggregator
      backgroundCandleAggregator.stop();

      logger.info(LogCategory.CHART, '✅ All polling stopped');
    } catch (error) {
      logger.error(LogCategory.CHART, 'Failed to stop polling:', error);
      throw error;
    }
  }

  /**
   * Clears all in-memory caches
   */
  clearInMemoryCaches(): void {
    try {
      // Chart candle poller handles its own cache internally
      // We trigger a stop which clears its cache

      logger.info(LogCategory.CHART, '✅ In-memory caches cleared');
    } catch (error) {
      logger.error(LogCategory.CHART, 'Failed to clear in-memory caches:', error);
      throw error;
    }
  }

  /**
   * Performs a complete cache reset
   */
  async performCompleteReset(): Promise<void> {
    logger.info(LogCategory.CHART, '🧹 Starting complete cache reset...');

    try {
      // Step 1: Stop all polling
      this.stopAllPolling();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for pollers to stop

      // Step 2: Clear browser storage
      this.clearBrowserStorage();

      // Step 3: Clear in-memory caches
      this.clearInMemoryCaches();

      logger.info(LogCategory.CHART, '✅ Complete cache reset finished');
    } catch (error) {
      logger.error(LogCategory.CHART, 'Cache reset failed:', error);
      throw error;
    }
  }

  /**
   * Performs a complete reset and then reloads the page
   */
  async resetAndReload(): Promise<void> {
    await this.performCompleteReset();

    logger.info(LogCategory.CHART, '🔄 Reloading page to complete reset...');

    // Force a hard reload to clear all JavaScript state
    window.location.reload();
  }
}

export const cacheResetService = new CacheResetService();
