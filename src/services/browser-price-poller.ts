/**
 * Browser Price Poller
 *
 * Calls the Netlify get-live-price function every 2 seconds for all symbols.
 * The Netlify function automatically saves prices to the database.
 * This provides a reliable fallback when server-side cron jobs aren't working.
 * Now includes tick buffering for offline resilience.
 */

import { tickBufferService } from './tick-buffer-service';
import { logger, LogCategory } from '@/lib/logger';

const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
const POLL_INTERVAL_MS = 3000;
const REQUEST_TIMEOUT_MS = 8000;

class BrowserPricePoller {
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  async start(): Promise<void> {
    if (this.isActive) {
      logger.warn(LogCategory.BROWSER_POLLER, 'Already active');
      return;
    }

    logger.info(LogCategory.BROWSER_POLLER, '🚀 Starting browser-based price polling...');
    logger.info(LogCategory.BROWSER_POLLER, 'This ensures prices flow even without server-side cron');

    this.isActive = true;
    this.consecutiveErrors = 0;

    await this.poll();

    this.pollInterval = setInterval(() => this.poll(), POLL_INTERVAL_MS);

    logger.info(LogCategory.BROWSER_POLLER, `✅ Polling started (every ${POLL_INTERVAL_MS}ms)`);
  }

  private async poll(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      let successCount = 0;

      for (const symbol of FOREX_PAIRS) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

          const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`, {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (response.ok || response.status === 206) {
            const data = await response.json();
            if (data.bid && data.ask) {
              successCount++;
              const quality = response.status === 206 ? 'CACHED' : 'LIVE';
              logger.debug(LogCategory.BROWSER_POLLER, `✅ ${symbol}: ${data.bid}/${data.ask} (${quality})`);

              await tickBufferService.bufferTick(
                symbol,
                parseFloat(data.bid),
                parseFloat(data.ask),
                new Date().toISOString(),
                data.broker_time
              );
            }
          } else {
            const errorText = await response.text().catch(() => 'Unknown error');
            logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} HTTP ${response.status}: ${errorText.substring(0, 100)}`);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            logger.warn(LogCategory.BROWSER_POLLER, `⏱️ ${symbol} timeout after ${REQUEST_TIMEOUT_MS}ms`);
          } else {
            logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} fetch error:`, error instanceof Error ? error.message : String(error));
          }
        }
      }

      if (successCount > 0) {
        this.consecutiveErrors = 0;
      } else {
        this.consecutiveErrors++;
        logger.warn(LogCategory.BROWSER_POLLER, `⚠️ No successful fetches (${this.consecutiveErrors}/${this.MAX_CONSECUTIVE_ERRORS})`);

        if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          logger.error(LogCategory.BROWSER_POLLER, '❌ Too many consecutive errors, stopping poller');
          this.stop();
        }
      }
    } catch (error) {
      logger.error(LogCategory.BROWSER_POLLER, 'Poll error:', error);
      this.consecutiveErrors++;
    }
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info(LogCategory.BROWSER_POLLER, '🛑 Stopping...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isActive = false;
    logger.info(LogCategory.BROWSER_POLLER, '✅ Stopped');
  }

  isRunning(): boolean {
    return this.isActive;
  }

  getStatus(): { isActive: boolean; consecutiveErrors: number } {
    return {
      isActive: this.isActive,
      consecutiveErrors: this.consecutiveErrors
    };
  }
}

export const browserPricePoller = new BrowserPricePoller();
