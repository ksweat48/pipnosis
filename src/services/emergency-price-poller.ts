/**
 * Emergency Price Poller
 *
 * This service provides a fallback mechanism to fetch live prices directly
 * when the server-side polling system is not working or the database is empty.
 * It will automatically activate if no recent prices are found in the database.
 */

import { logger, LogCategory } from '@/lib/logger';
import { marketDataService } from './market-data-service';

interface LivePrice {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
}

interface EmergencyPollerStatus {
  isActive: boolean;
  mode: 'database' | 'direct' | 'emergency';
  lastCheck: Date | null;
  lastPrice: LivePrice | null;
  errorCount: number;
}

class EmergencyPricePoller {
  private isActive = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(price: LivePrice) => void> = new Set();
  private lastPrice: LivePrice | null = null;
  private errorCount = 0;
  private mode: 'database' | 'direct' | 'emergency' = 'database';
  private lastCheck: Date | null = null;
  private readonly CHECK_INTERVAL_MS = 3000;
  private readonly DB_STALE_THRESHOLD_MS = 10000; // 10 seconds

  async start(): Promise<void> {
    if (this.isActive) {
      console.warn('[EmergencyPoller] Already active');
      return;
    }

    logger.warn(LogCategory.SYSTEM, '🚨 Emergency mode activation requested...');
    logger.debug(LogCategory.SYSTEM, 'Performing final validation before activation...');

    // Wait a moment to let other systems stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Re-check if emergency mode is still needed
    const stillNeeded = await this.verifyEmergencyModeNeeded();

    if (!stillNeeded) {
      logger.info(LogCategory.SYSTEM, '✅ Normal systems recovered - emergency mode not needed');
      return;
    }

    logger.warn(LogCategory.SYSTEM, '🚨 Confirmed: Starting emergency price polling system...');
    this.isActive = true;
    this.errorCount = 0;

    // Check if we need emergency mode
    await this.determineMode();

    // Start polling loop
    this.pollInterval = setInterval(() => this.poll(), this.CHECK_INTERVAL_MS);

    // Do first poll immediately
    await this.poll();

    logger.info(LogCategory.SYSTEM, `✅ Active in ${this.mode} mode`);
  }

  /**
   * Verify if emergency mode is needed
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  private async verifyEmergencyModeNeeded(): Promise<boolean> {
    try {
      // Check if database has ANY recent data
      // CRITICAL: Check forex_candles (what trade flow uses) not realtime_prices
      const data = await marketDataService.getLatestCandleAnySymbol();

      if (!data) {
        console.warn('[EmergencyPoller] No data in database - emergency mode needed');
        return true;
      }

      const ageMs = Date.now() - new Date(data.open_time).getTime();
      const ageSeconds = Math.round(ageMs / 1000);

      logger.debug(LogCategory.SYSTEM, `Database check: Last ${data.symbol} candle ${ageSeconds}s ago`);

      // If data is less than 2 minutes old, normal systems are working
      if (ageMs < 120000) {
        logger.debug(LogCategory.SYSTEM, '✅ Database has recent data - normal systems working');
        return false;
      }

      // If data is 2-5 minutes old, emergency mode might be needed
      if (ageMs < 300000) {
        console.warn(`[EmergencyPoller] ⚠️ Database is stale (${ageSeconds}s) - emergency mode needed`);
        return true;
      }

      // Data is very old, definitely need emergency mode
      console.error(`[EmergencyPoller] ❌ Database is very stale (${ageSeconds}s) - emergency mode required`);
      return true;
    } catch (error) {
      console.error('[EmergencyPoller] Verification failed:', error);
      return true;
    }
  }

  /**
   * Determine polling mode based on database freshness
   * ✅ SSOT: Uses MarketDataService for candle queries
   */
  private async determineMode(): Promise<void> {
    try {
      // Check if database has recent data
      // CRITICAL: Check forex_candles (what trade flow uses) not realtime_prices
      const data = await marketDataService.getLatestCandleAnySymbol();

      if (!data) {
        console.warn('[EmergencyPoller] 📭 No candles in database - activating emergency direct polling');
        this.mode = 'emergency';
        return;
      }

      const ageMs = Date.now() - new Date(data.open_time).getTime();

      if (ageMs > this.DB_STALE_THRESHOLD_MS) {
        console.warn(`[EmergencyPoller] ⚠️ Database data is stale (${Math.round(ageMs / 1000)}s old) - using direct polling`);
        this.mode = 'direct';
      } else {
        logger.debug(LogCategory.SYSTEM, '✅ Database has fresh data - using normal mode');
        this.mode = 'database';
      }
    } catch (error) {
      console.error('[EmergencyPoller] Mode determination failed:', error);
      this.mode = 'emergency';
    }
  }

  private async fetchPriceForSymbol(symbol: string): Promise<LivePrice | null> {
    try {
      const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.bid && data.ask) {
        return {
          symbol: data.symbol,
          bid: parseFloat(data.bid),
          ask: parseFloat(data.ask),
          timestamp: data.timestamp || new Date().toISOString()
        };
      }

      return null;
    } catch (error) {
      console.error(`[EmergencyPoller] Failed to fetch ${symbol}:`, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  private async poll(): Promise<void> {
    this.lastCheck = new Date();

    try {
      if (this.mode === 'database') {
        // Periodically recheck if we should switch modes
        if (Math.random() < 0.1) { // 10% chance each poll
          await this.determineMode();
        }
        // Don't poll in database mode - let the normal system handle it
        return;
      }

      // Emergency/Direct mode - fetch from Netlify function (one symbol at a time)
      const FOREX_PAIRS = ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY'];
      const CRYPTO_PAIRS = ['BTCUSD', 'ETHUSD'];
      const ALL_TRADING_PAIRS = [...FOREX_PAIRS, ...CRYPTO_PAIRS];
      logger.debug(LogCategory.SYSTEM, `Fetching prices for ${ALL_TRADING_PAIRS.length} symbols (${FOREX_PAIRS.length} forex + ${CRYPTO_PAIRS.length} crypto)...`);

      let successCount = 0;
      const pricePromises = ALL_TRADING_PAIRS.map(symbol => this.fetchPriceForSymbol(symbol));
      const prices = await Promise.allSettled(pricePromises);

      for (const result of prices) {
        if (result.status === 'fulfilled' && result.value) {
          const livePrice = result.value;
          this.lastPrice = livePrice;

          // NOTE: Database writes are handled by Netlify continuous-price-collector
          // Client-side emergency poller only fetches and notifies listeners

          // Notify listeners (BackgroundAggregator)
          this.notifyListeners(livePrice);

          successCount++;
          logger.debug(LogCategory.SYSTEM, `✅ ${livePrice.symbol}: ${livePrice.bid}/${livePrice.ask}`);
        }
      }

      if (successCount > 0) {
        this.errorCount = 0;
        logger.debug(LogCategory.SYSTEM, `📊 Successfully polled ${successCount}/${FOREX_PAIRS.length} symbols`);
      } else {
        throw new Error('All symbol fetches failed');
      }

    } catch (error) {
      this.errorCount++;
      console.error(`[EmergencyPoller] ❌ Poll failed (${this.errorCount} errors):`, error);

      // If too many errors, try switching mode
      if (this.errorCount > 5) {
        logger.warn(LogCategory.SYSTEM, '🔄 Too many errors, rechecking mode...');
        await this.determineMode();
        this.errorCount = 0;
      }
    }
  }

  private notifyListeners(price: LivePrice): void {
    this.listeners.forEach(listener => {
      try {
        listener(price);
      } catch (error) {
        console.error('[EmergencyPoller] Listener error:', error);
      }
    });
  }

  onPriceUpdate(callback: (price: LivePrice) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    logger.info(LogCategory.SYSTEM, '🛑 Stopping...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.listeners.clear();
    this.isActive = false;

    logger.info(LogCategory.SYSTEM, '✅ Stopped');
  }

  getStatus(): EmergencyPollerStatus {
    return {
      isActive: this.isActive,
      mode: this.mode,
      lastCheck: this.lastCheck,
      lastPrice: this.lastPrice,
      errorCount: this.errorCount
    };
  }

  async forceDirectMode(): Promise<void> {
    logger.warn(LogCategory.SYSTEM, '🔧 Forcing direct mode...');
    this.mode = 'emergency';
    this.errorCount = 0;
    await this.poll();
  }
}

export const emergencyPricePoller = new EmergencyPricePoller();
