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
import { pollingStrategyCoordinator } from './polling-strategy-coordinator';
import { priceRefreshTrigger } from './price-refresh-trigger';

const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'NAS100', 'GBPUSD', 'USDJPY'];
const ALL_PAIRS = [...FOREX_PAIRS];
const REQUEST_TIMEOUT_MS = 8000;

interface SymbolPollingState {
  consecutiveErrors: number;
  lastError: Date | null;
  lastSuccess: Date | null;
  lastFreshCheck: Date | null;
}

class BrowserPricePoller {
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private symbolErrors: Map<string, SymbolPollingState> = new Map();
  private totalConsecutiveErrors = 0;

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

    logger.info(LogCategory.BROWSER_POLLER, '🚀 Starting browser-based price polling...');
    logger.info(LogCategory.BROWSER_POLLER, 'Using PollingStrategyCoordinator for interval management');

    this.isActive = true;
    this.totalConsecutiveErrors = 0;

    // Initialize error tracking for each symbol
    for (const symbol of ALL_PAIRS) {
      this.symbolErrors.set(symbol, {
        consecutiveErrors: 0,
        lastError: null,
        lastSuccess: null,
        lastFreshCheck: null
      });
    }

    // Initialize polling strategy coordinator with safety checks
    try {
      // Only initialize if not already initialized (idempotent)
      if (!pollingStrategyCoordinator.isCoordinatorInitialized()) {
        pollingStrategyCoordinator.initializeSymbols(ALL_PAIRS);
      }

      pollingStrategyCoordinator.setSessionState('monitoring');

      // Validate coordinator is in working state
      const testStrategy = pollingStrategyCoordinator.getStrategy('EURUSD');
      if (!testStrategy || testStrategy.intervalMs <= 0) {
        throw new Error('Coordinator validation failed - invalid interval returned');
      }

      logger.debug(LogCategory.BROWSER_POLLER, 'Coordinator initialization and validation successful');
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(LogCategory.BROWSER_POLLER, `Failed to initialize coordinator: ${errorMsg}`);
      this.isActive = false;
      throw error; // Propagate to orchestrator
    }

    await this.poll();
    this.startPollingWithCoordinator();

    logger.info(LogCategory.BROWSER_POLLER, `✅ Polling started (strategy-based intervals)`);
  }

  private startPollingWithCoordinator(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Use dynamic polling with coordinator - check every 1 second to adjust intervals
    // Coordinator will provide the appropriate interval for each symbol
    const checkInterval = 1000; // Check every second if we need to poll
    this.pollInterval = setInterval(() => this.pollWithAdaptiveIntervals(), checkInterval);
    logger.debug(LogCategory.BROWSER_POLLER, `Polling started with adaptive strategy intervals`);
  }

  private async pollWithAdaptiveIntervals(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    // Get current strategies from coordinator
    const strategies = pollingStrategyCoordinator.getAllStrategies();

    // Poll only symbols that need it based on their strategy
    for (const [symbol, strategy] of strategies) {
      const state = this.symbolErrors.get(symbol);
      if (!state) continue;

      // Check if enough time has passed since last poll for this symbol
      const lastPoll = state.lastFreshCheck || new Date(0);
      const timeSinceLastPoll = Date.now() - lastPoll.getTime();

      if (timeSinceLastPoll >= strategy.intervalMs) {
        await this.pollSymbol(symbol);
      }
    }
  }

  private async pollSymbol(symbol: string): Promise<void> {
    const { isSymbolMarketOpen } = await import('../utils/marketHours');

    // Skip if market is closed
    if (!isSymbolMarketOpen(symbol)) {
      logger.debug(LogCategory.BROWSER_POLLER, `⏸️ ${symbol} market closed - skipping`);
      return;
    }

    // Update market status in coordinator
    pollingStrategyCoordinator.updateMarketStatus(symbol, true);

    try {
      // Check circuit breaker
      const circuitStatus = circuitBreakerService.getStatus();
      const canAttempt = circuitBreakerService.canAttemptRequest();

      if (!canAttempt && circuitStatus.state === 'open') {
        return;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(new Error(`Price request timeout after ${REQUEST_TIMEOUT_MS}ms`)), REQUEST_TIMEOUT_MS);

      const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok || response.status === 206) {
        const data = await response.json();
        if (data.bid && data.ask) {
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

          // Update coordinator
          pollingStrategyCoordinator.recordPoll(symbol);

          // Record success with circuit breaker
          if (response.status === 200) {
            await circuitBreakerService.recordSuccess();
          }
        }
      } else {
        logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} HTTP ${response.status}`);
        await this.recordSymbolError(symbol, `HTTP ${response.status}`);

        // Record failure with circuit breaker
        await circuitBreakerService.recordFailure(new Error(`HTTP ${response.status}`));
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(LogCategory.BROWSER_POLLER, `❌ ${symbol} fetch error:`, errorMsg);
      await this.recordSymbolError(symbol, errorMsg);

      // Record failure with circuit breaker
      await circuitBreakerService.recordFailure(error instanceof Error ? error : new Error(errorMsg));
    }

    // Update fresh check timestamp
    const state = this.symbolErrors.get(symbol);
    if (state) {
      state.lastFreshCheck = new Date();
    }
  }


  private async poll(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    const { hasAnyOpenMarket } = await import('../utils/marketHours');
    const anyMarketOpen = hasAnyOpenMarket(ALL_PAIRS);
    if (!anyMarketOpen) {
      logger.info(LogCategory.BROWSER_POLLER, '🔒 All markets closed - skipping poll');
      return;
    }

    if (!pageContext.shouldEnableBrowserPolling()) {
      logger.debug(
        LogCategory.BROWSER_POLLER,
        `⏸️ Browser polling paused (page: ${pageContext.getCurrentPage()})`
      );
      return;
    }

    let successCount = 0;
    for (const symbol of ALL_PAIRS) {
      await this.pollSymbol(symbol);
    }

    if (successCount === 0) {
      this.totalConsecutiveErrors++;
    } else {
      this.totalConsecutiveErrors = 0;
    }
  }

  private async recordSymbolSuccess(symbol: string, dataQuality: string): Promise<void> {
    const tracking = this.symbolErrors.get(symbol);
    if (tracking) {
      tracking.consecutiveErrors = 0;
      tracking.lastSuccess = new Date();
      this.symbolErrors.set(symbol, tracking);
    }
  }

  private async recordSymbolError(symbol: string, errorMessage: string): Promise<void> {
    const tracking = this.symbolErrors.get(symbol) || {
      consecutiveErrors: 0,
      lastError: null,
      lastSuccess: null,
      lastFreshCheck: null
    };

    tracking.consecutiveErrors++;
    tracking.lastError = new Date();
    this.symbolErrors.set(symbol, tracking);
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

  getStatus() {
    return {
      isActive: this.isActive,
      totalConsecutiveErrors: this.totalConsecutiveErrors,
      strategies: pollingStrategyCoordinator.getAllStrategies(),
      symbolErrors: new Map(this.symbolErrors)
    };
  }
}

export const browserPricePoller = new BrowserPricePoller();
