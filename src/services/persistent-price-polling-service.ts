import { supabase } from '@/lib/supabase';

interface PollingStatus {
  isRunning: boolean;
  lastPollTime: Date | null;
  lastSuccessTime: Date | null;
  pollCount: number;
  successCount: number;
  errorCount: number;
  lastError: string | null;
}

class PersistentPricePollingService {
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL_MS = 3000; // 3 seconds
  private readonly EDGE_FUNCTION_URL = '/functions/v1/continuous-price-poller';

  private status: PollingStatus = {
    isRunning: false,
    lastPollTime: null,
    lastSuccessTime: null,
    pollCount: 0,
    successCount: 0,
    errorCount: 0,
    lastError: null
  };

  private listeners: Set<(status: PollingStatus) => void> = new Set();

  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[PersistentPricePolling] Already running');
      return;
    }

    console.log('[PersistentPricePolling] 🚀 Starting persistent background price polling...');
    console.log(`[PersistentPricePolling] Poll interval: ${this.POLL_INTERVAL_MS}ms`);
    console.log('[PersistentPricePolling] 📡 This feeds the server-side candle aggregation system');
    console.log('[PersistentPricePolling] 🎯 Price data enables candle collection even when browser is closed');

    this.isRunning = true;
    this.status.isRunning = true;

    // Immediately invoke once
    await this.pollPrices();

    // Then set up interval
    this.pollInterval = setInterval(async () => {
      await this.pollPrices();
    }, this.POLL_INTERVAL_MS);

    console.log('[PersistentPricePolling] ✅ Service started successfully');
    console.log('[PersistentPricePolling] ℹ️ Note: Database triggers automatically aggregate prices into candles');
    this.notifyListeners();
  }

  private async pollPrices(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.status.lastPollTime = new Date();
    this.status.pollCount++;

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      if (!supabaseUrl) {
        throw new Error('Supabase URL not configured');
      }

      const functionUrl = `${supabaseUrl}/functions/v1/continuous-price-poller?action=poll`;

      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();

      if (data.success) {
        this.status.lastSuccessTime = new Date();
        this.status.successCount++;
        this.status.lastError = null;

        console.log(
          `[PersistentPricePolling] ✅ Poll #${this.status.pollCount}: ` +
          `${data.successfulUpdates}/${data.totalPairs} pairs updated in ${data.durationMs}ms`
        );
      } else {
        throw new Error(data.error || 'Unknown error from Edge Function');
      }

      this.notifyListeners();
    } catch (error) {
      this.status.errorCount++;
      this.status.lastError = error instanceof Error ? error.message : String(error);

      console.error('[PersistentPricePolling] ❌ Poll failed:', this.status.lastError);
      this.notifyListeners();
    }
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[PersistentPricePolling] 🛑 Stopping persistent price polling...');

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    this.isRunning = false;
    this.status.isRunning = false;

    console.log('[PersistentPricePolling] ✅ Service stopped');
    this.notifyListeners();
  }

  getStatus(): PollingStatus {
    return { ...this.status };
  }

  onStatusChange(callback: (status: PollingStatus) => void): () => void {
    this.listeners.add(callback);
    callback(this.getStatus());

    return () => {
      this.listeners.delete(callback);
    };
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.listeners.forEach(listener => {
      try {
        listener(status);
      } catch (error) {
        console.error('[PersistentPricePolling] Error in listener:', error);
      }
    });
  }

  async checkServiceHealth(): Promise<{
    healthy: boolean;
    details: {
      pollingActive: boolean;
      lastPollAge: number | null;
      lastSuccessAge: number | null;
      successRate: number;
      recentErrors: string | null;
    };
  }> {
    const now = Date.now();
    const lastPollAge = this.status.lastPollTime
      ? now - this.status.lastPollTime.getTime()
      : null;
    const lastSuccessAge = this.status.lastSuccessTime
      ? now - this.status.lastSuccessTime.getTime()
      : null;

    const totalPolls = this.status.pollCount;
    const successRate = totalPolls > 0
      ? (this.status.successCount / totalPolls) * 100
      : 0;

    const isHealthy =
      this.status.isRunning &&
      lastSuccessAge !== null &&
      lastSuccessAge < 30000 && // Last success within 30 seconds
      successRate > 50; // More than 50% success rate

    return {
      healthy: isHealthy,
      details: {
        pollingActive: this.status.isRunning,
        lastPollAge,
        lastSuccessAge,
        successRate: Math.round(successRate * 10) / 10,
        recentErrors: this.status.lastError
      }
    };
  }
}

export const persistentPricePollingService = new PersistentPricePollingService();
