/**
 * Emergency Price Poller
 *
 * This service provides a fallback mechanism to fetch live prices directly
 * when the server-side polling system is not working or the database is empty.
 * It will automatically activate if no recent prices are found in the database.
 */

import { supabase } from '@/lib/supabase';

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

    console.log('[EmergencyPoller] 🚨 Emergency mode activation requested...');
    console.log('[EmergencyPoller] Performing final validation before activation...');

    // Wait a moment to let other systems stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Re-check if emergency mode is still needed
    const stillNeeded = await this.verifyEmergencyModeNeeded();

    if (!stillNeeded) {
      console.log('[EmergencyPoller] ✅ Normal systems recovered - emergency mode not needed');
      return;
    }

    console.log('[EmergencyPoller] 🚨 Confirmed: Starting emergency price polling system...');
    this.isActive = true;
    this.errorCount = 0;

    // Check if we need emergency mode
    await this.determineMode();

    // Start polling loop
    this.pollInterval = setInterval(() => this.poll(), this.CHECK_INTERVAL_MS);

    // Do first poll immediately
    await this.poll();

    console.log(`[EmergencyPoller] ✅ Active in ${this.mode} mode`);
  }

  private async verifyEmergencyModeNeeded(): Promise<boolean> {
    try {
      // Check if database has ANY recent data
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('created_at, symbol')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[EmergencyPoller] Database check failed:', error);
        return true;
      }

      if (!data) {
        console.warn('[EmergencyPoller] No data in database - emergency mode needed');
        return true;
      }

      const ageMs = Date.now() - new Date(data.created_at).getTime();
      const ageSeconds = Math.round(ageMs / 1000);

      console.log(`[EmergencyPoller] Database check: Last ${data.symbol} price ${ageSeconds}s ago`);

      // If data is less than 2 minutes old, normal systems are working
      if (ageMs < 120000) {
        console.log('[EmergencyPoller] ✅ Database has recent data - normal systems working');
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

  private async determineMode(): Promise<void> {
    try {
      // Check if database has recent data
      const { data, error } = await supabase
        .from('realtime_prices')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('[EmergencyPoller] Database check failed:', error);
        this.mode = 'emergency';
        return;
      }

      if (!data) {
        console.warn('[EmergencyPoller] 📭 No prices in database - activating emergency direct polling');
        this.mode = 'emergency';
        return;
      }

      const ageMs = Date.now() - new Date(data.created_at).getTime();

      if (ageMs > this.DB_STALE_THRESHOLD_MS) {
        console.warn(`[EmergencyPoller] ⚠️ Database data is stale (${Math.round(ageMs / 1000)}s old) - using direct polling`);
        this.mode = 'direct';
      } else {
        console.log('[EmergencyPoller] ✅ Database has fresh data - using normal mode');
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

      if (data.ok && data.bid && data.ask) {
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
      console.log(`[EmergencyPoller] Fetching prices for ${FOREX_PAIRS.length} symbols...`);

      let successCount = 0;
      const pricePromises = FOREX_PAIRS.map(symbol => this.fetchPriceForSymbol(symbol));
      const prices = await Promise.allSettled(pricePromises);

      for (const result of prices) {
        if (result.status === 'fulfilled' && result.value) {
          const livePrice = result.value;
          this.lastPrice = livePrice;

          // Save to database for persistence
          await this.savePriceToDatabase(livePrice);

          // Notify listeners (BackgroundAggregator)
          this.notifyListeners(livePrice);

          successCount++;
          console.log(`[EmergencyPoller] ✅ ${livePrice.symbol}: ${livePrice.bid}/${livePrice.ask}`);
        }
      }

      if (successCount > 0) {
        this.errorCount = 0;
        console.log(`[EmergencyPoller] 📊 Successfully polled ${successCount}/${FOREX_PAIRS.length} symbols`);
      } else {
        throw new Error('All symbol fetches failed');
      }

    } catch (error) {
      this.errorCount++;
      console.error(`[EmergencyPoller] ❌ Poll failed (${this.errorCount} errors):`, error);

      // If too many errors, try switching mode
      if (this.errorCount > 5) {
        console.log('[EmergencyPoller] 🔄 Too many errors, rechecking mode...');
        await this.determineMode();
        this.errorCount = 0;
      }
    }
  }

  private async savePriceToDatabase(price: LivePrice): Promise<void> {
    try {
      const { error } = await supabase
        .from('realtime_prices')
        .insert({
          symbol: price.symbol,
          bid: price.bid.toString(),
          ask: price.ask.toString(),
          mid: ((price.bid + price.ask) / 2).toString(),
          spread: (price.ask - price.bid).toString(),
          broker_time: price.timestamp,
          source: 'emergency_poller'
        });

      if (error) {
        console.error(`[EmergencyPoller] Failed to save ${price.symbol} to DB:`, error);
      } else {
        console.log(`[EmergencyPoller] 💾 Saved ${price.symbol} to database`);
      }
    } catch (error) {
      console.error('[EmergencyPoller] Exception saving price:', error);
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

    console.log('[EmergencyPoller] 🛑 Stopping...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.listeners.clear();
    this.isActive = false;

    console.log('[EmergencyPoller] ✅ Stopped');
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
    console.log('[EmergencyPoller] 🔧 Forcing direct mode...');
    this.mode = 'emergency';
    this.errorCount = 0;
    await this.poll();
  }
}

export const emergencyPricePoller = new EmergencyPricePoller();
