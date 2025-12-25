/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🚨 CRITICAL INFRASTRUCTURE - DO NOT MODIFY WITHOUT EXPLICIT APPROVAL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Chart Direct Price Poller
 *
 * Provides smooth, real-time price updates for the chart by polling MetaAPI directly.
 * Only runs when the chart is visible to minimize API usage.
 * Falls back to database polling if MetaAPI is unavailable.
 *
 * CRITICAL CONFIGURATION:
 * - Update interval: 3000ms (3 seconds) - Industry standard for retail forex
 * - Matches TradingView and MetaTrader 5 behavior
 * - Balances real-time feel with API rate limits
 *
 * DO NOT CHANGE:
 * - interval: 3000 (line 50)
 * - Visibility detection logic
 * - Fallback mechanism (MetaAPI → Database)
 *
 * See: docs/CRITICAL_SYSTEMS.md for details
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { logger, LogCategory } from '@/lib/logger';
import { priceValidationService } from './price-validation-service';
import { getForexMarketStatus } from '@/utils/marketHours';

interface LivePrice {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
  midPrice: number;
  source: 'metaapi' | 'database';
}

interface PollerOptions {
  interval: number; // milliseconds
  enabled: boolean;
}

type PriceUpdateCallback = (price: LivePrice) => void;
type StatusUpdateCallback = (status: PollerStatus) => void;

interface PollerStatus {
  isActive: boolean;
  source: 'metaapi' | 'database' | 'offline';
  lastUpdate: Date | null;
  updateCount: number;
  errorCount: number;
}

class ChartDirectPricePoller {
  private pollInterval: NodeJS.Timeout | null = null;
  // CRITICAL FIX: Store listeners per-symbol to prevent cross-contamination
  private priceListeners: Map<string, Set<PriceUpdateCallback>> = new Map();
  private statusListeners: Set<StatusUpdateCallback> = new Set();

  private status: PollerStatus = {
    isActive: false,
    source: 'offline',
    lastUpdate: null,
    updateCount: 0,
    errorCount: 0
  };

  private options: PollerOptions = {
    interval: 3000, // 🚨 CRITICAL: 3 seconds - DO NOT CHANGE (industry standard)
    enabled: false
  };

  private trackedSymbols: Set<string> = new Set();
  private isVisible = true;
  private lastPriceCache = new Map<string, LivePrice>();

  constructor() {
    this.setupVisibilityDetection();
  }

  private setupVisibilityDetection(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.isVisible = !document.hidden;

        if (this.isVisible && this.options.enabled && !this.status.isActive) {
          logger.info(LogCategory.CHART, '👁️ Chart visible - resuming price polling');
          this.start();
          // CRITICAL FIX: Immediately fetch fresh prices when tab becomes visible
          logger.info(LogCategory.CHART, '🔄 Fetching fresh prices to clear stale data');
          this.poll().catch(err => {
            logger.error(LogCategory.CHART, 'Error fetching fresh prices on visibility change:', err);
          });
        } else if (!this.isVisible && this.status.isActive) {
          logger.info(LogCategory.CHART, '🙈 Chart hidden - pausing price polling');
          this.pause();
        }
      });
    }
  }

  addSymbol(symbol: string): void {
    this.trackedSymbols.add(symbol);
    // Initialize listener set for this symbol if it doesn't exist
    if (!this.priceListeners.has(symbol)) {
      this.priceListeners.set(symbol, new Set());
    }
    logger.debug(LogCategory.CHART, `📊 Tracking ${symbol} (${this.trackedSymbols.size} total)`);
  }

  removeSymbol(symbol: string): void {
    this.trackedSymbols.delete(symbol);
    this.lastPriceCache.delete(symbol);
    // Clean up listeners for this symbol
    this.priceListeners.delete(symbol);
    logger.debug(LogCategory.CHART, `📊 Stopped tracking ${symbol} (${this.trackedSymbols.size} remaining)`);
  }

  // CRITICAL FIX: Accept symbol parameter to register listener for specific symbol only
  onPriceUpdate(symbol: string, callback: PriceUpdateCallback): () => void {
    if (!this.priceListeners.has(symbol)) {
      this.priceListeners.set(symbol, new Set());
    }
    const listeners = this.priceListeners.get(symbol)!;
    listeners.add(callback);

    logger.debug(LogCategory.CHART, `[${symbol}] Registered price listener (${listeners.size} total for this symbol)`);

    return () => {
      listeners.delete(callback);
      logger.debug(LogCategory.CHART, `[${symbol}] Unregistered price listener (${listeners.size} remaining)`);
    };
  }

  onStatusUpdate(callback: StatusUpdateCallback): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  async start(): Promise<void> {
    if (this.status.isActive) {
      return;
    }

    if (!this.isVisible) {
      logger.debug(LogCategory.CHART, '🙈 Chart not visible - not starting poller');
      this.options.enabled = true;
      return;
    }

    // Check market hours before starting
    const marketStatus = getForexMarketStatus();
    if (!marketStatus.isOpen) {
      logger.info(LogCategory.CHART, '🔴 Market closed - direct price polling not started');
      this.options.enabled = true; // Mark as enabled so it can resume when market opens
      return;
    }

    logger.info(LogCategory.CHART, '🚀 Starting direct price polling (3s interval)');

    this.status.isActive = true;
    this.status.errorCount = 0;
    this.options.enabled = true;
    this.notifyStatusUpdate();

    // Immediate first poll
    await this.poll();

    // Start interval
    this.pollInterval = setInterval(() => this.poll(), this.options.interval);
  }

  pause(): void {
    if (!this.status.isActive) {
      return;
    }

    logger.info(LogCategory.CHART, '⏸️ Pausing price polling');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.status.isActive = false;
    this.notifyStatusUpdate();
  }

  stop(): void {
    logger.info(LogCategory.CHART, '⏹️ Stopping price polling');

    this.pause();
    this.options.enabled = false;
    this.trackedSymbols.clear();
    this.lastPriceCache.clear();
    this.status.source = 'offline';
    this.notifyStatusUpdate();
  }

  getStatus(): PollerStatus {
    return { ...this.status };
  }

  private async poll(): Promise<void> {
    if (this.trackedSymbols.size === 0) {
      return;
    }

    // CRITICAL: Check market hours before polling
    const marketStatus = getForexMarketStatus();
    if (!marketStatus.isOpen) {
      logger.debug(LogCategory.CHART, '[DirectPricePoller] Market closed - skipping price poll');
      return;
    }

    try {
      // Try MetaAPI direct first
      const prices = await this.fetchFromMetaAPI();

      if (prices.length > 0) {
        this.status.source = 'metaapi';
        this.status.errorCount = 0;
        this.processPrices(prices);
        return;
      }
    } catch (error) {
      logger.debug(LogCategory.CHART, 'MetaAPI fetch failed, falling back to database');
      this.status.errorCount++;
    }

    // Fallback to database
    try {
      const prices = await this.fetchFromDatabase();
      this.status.source = 'database';
      this.processPrices(prices);
    } catch (error) {
      logger.error(LogCategory.CHART, 'Price polling error:', error);
      this.status.errorCount++;
      this.status.source = 'offline';
    }

    this.notifyStatusUpdate();
  }

  private async fetchFromMetaAPI(): Promise<LivePrice[]> {
    const results: LivePrice[] = [];

    for (const symbol of this.trackedSymbols) {
      try {
        // CRITICAL FIX: Add symbol as URL param to prevent cache collisions between parallel requests
        const url = `/.netlify/functions/get-live-price?symbol=${encodeURIComponent(symbol)}&t=${Date.now()}`;
        logger.debug(LogCategory.CHART, `[${symbol}] 🔄 Fetching price from: ${url}`);

        const response = await fetch(url, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // CRITICAL: Verify the response is actually for the symbol we requested
        if (data.symbol && data.symbol !== symbol) {
          logger.error(LogCategory.CHART, `[${symbol}] 🚨 RESPONSE MISMATCH! Requested ${symbol} but got ${data.symbol}`);
          continue;
        }

        if (data.bid && data.ask) {
          // CRITICAL: Validate prices before accepting them
          const bidValidation = priceValidationService.validatePrice(symbol, data.bid);
          const askValidation = priceValidationService.validatePrice(symbol, data.ask);

          if (!bidValidation.isValid || !askValidation.isValid) {
            logger.error(LogCategory.CHART, `[DirectPoller] ❌ REJECTED invalid price for ${symbol}: bid=${data.bid} ask=${data.ask}`);

            // Check if this might be a cross-symbol contamination
            const suspectedSymbol = priceValidationService.detectPossibleSymbolMismatch(symbol, data.bid);
            if (suspectedSymbol) {
              logger.error(LogCategory.CHART, `[DirectPoller] 🚨 CROSS-CONTAMINATION: ${symbol} received ${suspectedSymbol} price!`);
            }
            continue; // Skip this price
          }

          const midPrice = (data.bid + data.ask) / 2;
          results.push({
            symbol,
            bid: data.bid,
            ask: data.ask,
            timestamp: new Date().toISOString(),
            midPrice,
            source: 'metaapi'
          });
        }
      } catch (error) {
        // Silent fail - will fallback to database
      }
    }

    return results;
  }

  private async fetchFromDatabase(): Promise<LivePrice[]> {
    const { supabase } = await import('@/lib/supabase');

    const symbolList = Array.from(this.trackedSymbols);

    const { data, error } = await supabase
      .from('realtime_prices')
      .select('symbol, bid, ask, broker_time, created_at')
      .in('symbol', symbolList)
      .order('broker_time', { ascending: false })
      .limit(symbolList.length);

    if (error) {
      throw error;
    }

    if (!data || data.length === 0) {
      return [];
    }

    return data
      .map(price => {
        const bid = parseFloat(price.bid);
        const ask = parseFloat(price.ask);

        // CRITICAL: Validate prices from database too
        const bidValidation = priceValidationService.validatePrice(price.symbol, bid);
        const askValidation = priceValidationService.validatePrice(price.symbol, ask);

        if (!bidValidation.isValid || !askValidation.isValid) {
          logger.error(LogCategory.CHART, `[DirectPoller] ❌ REJECTED invalid DB price for ${price.symbol}: bid=${bid} ask=${ask}`);
          return null; // Filter out this price
        }

        return {
          symbol: price.symbol,
          bid,
          ask,
          timestamp: price.broker_time || price.created_at,
          midPrice: (bid + ask) / 2,
          source: 'database' as const
        };
      })
      .filter((price): price is LivePrice => price !== null);
  }

  private processPrices(prices: LivePrice[]): void {
    for (const price of prices) {
      // Check if this is a new price
      const cached = this.lastPriceCache.get(price.symbol);

      if (cached &&
          cached.bid === price.bid &&
          cached.ask === price.ask &&
          cached.timestamp === price.timestamp) {
        // Duplicate price, skip
        continue;
      }

      // Update cache
      this.lastPriceCache.set(price.symbol, price);

      // CRITICAL FIX: Only notify listeners registered for THIS symbol
      const symbolListeners = this.priceListeners.get(price.symbol);
      if (symbolListeners && symbolListeners.size > 0) {
        logger.debug(LogCategory.CHART, `[${price.symbol}] Notifying ${symbolListeners.size} listeners for price update`);

        symbolListeners.forEach(listener => {
          try {
            listener(price);
          } catch (error) {
            logger.error(LogCategory.CHART, `[${price.symbol}] Error in price listener:`, error);
          }
        });
      }

      this.status.updateCount++;
      this.status.lastUpdate = new Date();
    }
  }

  private notifyStatusUpdate(): void {
    this.statusListeners.forEach(listener => {
      try {
        listener(this.getStatus());
      } catch (error) {
        logger.error(LogCategory.CHART, 'Error in status listener:', error);
      }
    });
  }
}

export const chartDirectPricePoller = new ChartDirectPricePoller();
