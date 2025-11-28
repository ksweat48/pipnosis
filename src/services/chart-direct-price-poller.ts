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
        const response = await fetch('/.netlify/functions/get-live-price', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbol })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        if (data.bid && data.ask) {
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

    return data.map(price => ({
      symbol: price.symbol,
      bid: parseFloat(price.bid),
      ask: parseFloat(price.ask),
      timestamp: price.broker_time || price.created_at,
      midPrice: (parseFloat(price.bid) + parseFloat(price.ask)) / 2,
      source: 'database' as const
    }));
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
