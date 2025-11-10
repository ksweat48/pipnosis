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

    console.log('[EmergencyPoller] 🚨 Starting emergency price polling system...');
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

      // Emergency/Direct mode - fetch from Netlify function
      const response = await fetch('/.netlify/functions/get-live-price', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbols: ['EURUSD', 'XAUUSD', 'US30', 'GBPUSD', 'USDJPY']
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.prices && Array.isArray(data.prices)) {
        for (const priceData of data.prices) {
          if (priceData.bid && priceData.ask) {
            const livePrice: LivePrice = {
              symbol: priceData.symbol,
              bid: parseFloat(priceData.bid),
              ask: parseFloat(priceData.ask),
              timestamp: priceData.time || new Date().toISOString()
            };

            this.lastPrice = livePrice;
            this.errorCount = 0;

            // Save to database for persistence
            await this.savePriceToDatabase(livePrice);

            // Notify listeners
            this.notifyListeners(livePrice);

            console.log(`[EmergencyPoller] ✅ ${livePrice.symbol}: ${livePrice.bid}/${livePrice.ask}`);
          }
        }
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
