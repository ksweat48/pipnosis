/**
 * Browser Price Poller with Graduated Error Response
 *
 * Calls the Netlify get-live-price function for all symbols.
 * Implements three-tier degraded mode system:
 * - Normal: 3 second polling
 * - Degraded: 10 second polling (after 10 errors)
 * - Critical: 30 second polling (after 30 errors)
 * - Stopped: After 50 consecutive errors
 *
 * Automatically recovers to normal mode when errors clear.
 */

import { tickBufferService } from './tick-buffer-service';
import { logger, LogCategory, LogLevel } from '@/lib/logger';

// Silence verbose polling logs in production
logger.setCategoryLevel(LogCategory.BROWSER_POLLER, LogLevel.SILENT);
// polling-health-monitor removed
import { circuitBreakerService } from './circuit-breaker-service';
import { pageContext } from './page-context';
import { shouldDisableMetaAPI, areFunctionsAvailable } from '@/lib/environment';

const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD'];
const ALL_PAIRS = [...FOREX_PAIRS, ...CRYPTO_PAIRS];
const POLL_INTERVAL_NORMAL_MS = 3000;
const POLL_INTERVAL_DEGRADED_MS = 10000;
const POLL_INTERVAL_CRITICAL_MS = 30000;
const REQUEST_TIMEOUT_MS = 8000;

type PollingMode = 'normal' | 'degraded' | 'critical' | 'stopped';

interface SymbolErrorTracking {
  consecutiveErrors: number;
  lastError: Date | null;
  lastSuccess: Date | null;
}

class BrowserPricePoller {
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private mode: PollingMode = 'normal';
  private symbolErrors: Map<string, SymbolErrorTracking> = new Map();
  private totalConsecutiveErrors = 0;
  private readonly ERROR_THRESHOLD_DEGRADED = 10;
  private readonly ERROR_THRESHOLD_CRITICAL = 30;
  private readonly ERROR_THRESHOLD_STOPPED = 50;

  async start(): Promise<void> {
    // CRITICAL: Disable polling in development/WebContainer environments
    // Netlify Functions don't exist in these environments, causing 900+ failed requests
    if (shouldDisableMetaAPI() || !areFunctionsAvailable()) {
      logger.info(LogCategory.BROWSER_POLLER, '🔴 Browser Price Poller disabled in development/WebContainer environment');
      logger.info(LogCategory.BROWSER_POLLER, '   Charts will use database-only mode with historical data');
      return;
    }

    if (this.isActive) {
      logger.warn(LogCategory.BROWSER_POLLER, 'Already active');
      return;
    }

    logger.info(LogCategory.BROWSER_POLLER, '🚀 Starting browser-based price polling with auto-recovery...');
    logger.info(LogCategory.BROWSER_POLLER, 'Graduated error response: normal -> degraded -> critical -> stopped');

    this.isActive = true;
    this.mode = 'normal';
    this.totalConsecutiveErrors = 0;

    // Initialize error tracking for each symbol (forex + crypto)
    for (const symbol of ALL_PAIRS) {
      this.symbolErrors.set(symbol, {
        consecutiveErrors: 0,
        lastError: null,
        lastSuccess: null
      });

      // Health recovery callback removed
    }

    await this.poll();
    this.startPollingWithCurrentMode();

    logger.info(LogCategory.BROWSER_POLLER, `✅ Polling started in ${this.mode} mode (${this.getCurrentInterval()}ms)`);
  }

  private startPollingWithCurrentMode(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    const interval = this.getCurrentInterval();
    this.pollInterval = setInterval(() => this.poll(), interval);
    logger.info(LogCategory.BROWSER_POLLER, `Polling interval set to ${interval}ms (${this.mode} mode)`);
  }

  private getCurrentInterval(): number {
    switch (this.mode) {
      case 'critical':
        return POLL_INTERVAL_CRITICAL_MS;
      case 'degraded':
        return POLL_INTERVAL_DEGRADED_MS;
      case 'normal':
      default:
        return POLL_INTERVAL_NORMAL_MS;
    }
  }

  private async recoverSymbol(symbol: string): Promise<void> {
    logger.info(LogCategory.BROWSER_POLLER, `🔄 Attempting recovery for ${symbol}`);

    const tracking = this.symbolErrors.get(symbol);
    if (tracking) {
      tracking.consecutiveErrors = Math.max(0, tracking.consecutiveErrors - 5);
      this.symbolErrors.set(symbol, tracking);
    }

    // Try to upgrade mode if errors have decreased
    this.evaluateMode();
  }

  private async poll(): Promise<void> {
    if (!this.isActive || this.mode === 'stopped') {
      return;
    }

    // CRYPTO FIX: Check if ANY market is open (crypto trades 24/7)
    const { hasAnyOpenMarket, isSymbolMarketOpen } = await import('../utils/marketHours');
    const anyMarketOpen = hasAnyOpenMarket(ALL_PAIRS);
    if (!anyMarketOpen) {
      logger.info(LogCategory.BROWSER_POLLER, '🔒 All markets closed - skipping poll');
      return;
    }

    // Check if browser polling should be active on current page
    if (!pageContext.shouldEnableBrowserPolling()) {
      logger.info(
        LogCategory.BROWSER_POLLER,
        `⏸️ Browser polling paused (page: ${pageContext.getCurrentPage()}, backtest: ${pageContext.isBacktestRunning()}) - Server cron provides updates every 2 min`
      );
      return;
    }

    // Check circuit breaker before polling
    const circuitStatus = circuitBreakerService.getStatus();
    if (circuitStatus.state === 'open') {
      logger.warn(LogCategory.BROWSER_POLLER, '⚠️ Circuit breaker is open, using cached data only');
    }

    try {
      let successCount = 0;
      let errorCount = 0;

      for (const symbol of ALL_PAIRS) {
        // CRYPTO FIX: Skip symbols with closed markets
        if (!isSymbolMarketOpen(symbol)) {
          logger.debug(LogCategory.BROWSER_POLLER, `⏸️ ${symbol} market closed - skipping`);
          continue;
        }
        try {
          // Skip if circuit is open and we should wait
          const canAttempt = circuitBreakerService.canAttemptRequest();
          if (!canAttempt && circuitStatus.state === 'open') {
            continue;
          }

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

              await this.recordSymbolSuccess(symbol, data.dataQuality || 'live');

              await tickBufferService.bufferTick(
                symbol,
                parseFloat(data.bid),
                parseFloat(data.ask),
                new Date().toISOString(),
                data.broker_time
              );

              // Record success with circuit breaker
              if (response.status === 200) {
                await circuitBreakerService.recordSuccess();
              }
            }
          } else {
            errorCount++;
            const errorText = await response.text().catch(() => 'Unknown error');
            logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            await this.recordSymbolError(symbol, `HTTP ${response.status}`);

            // Record failure with circuit breaker
            await circuitBreakerService.recordFailure(new Error(`HTTP ${response.status}`));
          }
        } catch (error) {
          errorCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);

          if (error instanceof Error && error.name === 'AbortError') {
            logger.warn(LogCategory.BROWSER_POLLER, `⏱️ ${symbol} timeout after ${REQUEST_TIMEOUT_MS}ms`);
            await this.recordSymbolError(symbol, 'Timeout');
          } else {
            logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} fetch error:`, errorMsg);
            await this.recordSymbolError(symbol, errorMsg);
          }

          // Record failure with circuit breaker
          await circuitBreakerService.recordFailure(error instanceof Error ? error : new Error(errorMsg));
        }
      }

      // Update total consecutive errors
      if (successCount > 0) {
        this.totalConsecutiveErrors = 0;
      } else {
        this.totalConsecutiveErrors++;
      }

      // Evaluate and potentially change mode
      this.evaluateMode();

    } catch (error) {
      logger.error(LogCategory.BROWSER_POLLER, 'Poll error:', error);
      this.totalConsecutiveErrors++;
      this.evaluateMode();
    }
  }

  private async recordSymbolSuccess(symbol: string, dataQuality: string): Promise<void> {
    const tracking = this.symbolErrors.get(symbol);
    if (tracking) {
      tracking.consecutiveErrors = 0;
      tracking.lastSuccess = new Date();
      this.symbolErrors.set(symbol, tracking);
    }

    // Success recording removed
  }

  private async recordSymbolError(symbol: string, errorMessage: string): Promise<void> {
    const tracking = this.symbolErrors.get(symbol) || {
      consecutiveErrors: 0,
      lastError: null,
      lastSuccess: null
    };

    tracking.consecutiveErrors++;
    tracking.lastError = new Date();
    this.symbolErrors.set(symbol, tracking);

    // Error recording removed
  }

  private evaluateMode(): void {
    const oldMode = this.mode;
    let newMode: PollingMode = 'normal';

    // Check if we should stop
    if (this.totalConsecutiveErrors >= this.ERROR_THRESHOLD_STOPPED) {
      newMode = 'stopped';
      logger.error(LogCategory.BROWSER_POLLER, `❌ Stopping after ${this.totalConsecutiveErrors} consecutive errors`);
      this.stop();
      return;
    }

    // Check if we should be in critical mode
    if (this.totalConsecutiveErrors >= this.ERROR_THRESHOLD_CRITICAL) {
      newMode = 'critical';
    }
    // Check if we should be in degraded mode
    else if (this.totalConsecutiveErrors >= this.ERROR_THRESHOLD_DEGRADED) {
      newMode = 'degraded';
    }
    // Otherwise stay in or return to normal
    else {
      newMode = 'normal';
    }

    if (newMode !== oldMode) {
      this.mode = newMode;
      logger.warn(
        LogCategory.BROWSER_POLLER,
        `⚠️ Mode changed: ${oldMode} -> ${newMode} (errors: ${this.totalConsecutiveErrors})`
      );

      // Restart polling with new interval
      if (this.isActive) {
        this.startPollingWithCurrentMode();
      }
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
    this.mode = 'stopped';
    logger.info(LogCategory.BROWSER_POLLER, '✅ Stopped');
  }

  isRunning(): boolean {
    return this.isActive && this.mode !== 'stopped';
  }

  getStatus(): {
    isActive: boolean;
    mode: PollingMode;
    totalConsecutiveErrors: number;
    interval: number;
    symbolErrors: Map<string, SymbolErrorTracking>;
  } {
    return {
      isActive: this.isActive,
      mode: this.mode,
      totalConsecutiveErrors: this.totalConsecutiveErrors,
      interval: this.getCurrentInterval(),
      symbolErrors: new Map(this.symbolErrors)
    };
  }

  getMode(): PollingMode {
    return this.mode;
  }
}

export const browserPricePoller = new BrowserPricePoller();
