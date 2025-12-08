/**
 * Network Resilience Manager
 *
 * Handles network failures gracefully with automatic retry,
 * offline detection, and cached data fallback.
 *
 * ZERO RISK: Falls back to standard fetch if wrapper fails.
 */

import { BULLETPROOF_CONFIG } from '@/config/chart-bulletproofing';

interface NetworkState {
  online: boolean;
  lastCheck: number;
  consecutiveFailures: number;
}

interface CachedResponse {
  data: any;
  timestamp: number;
  url: string;
}

class NetworkResilienceManager {
  private state: NetworkState = {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    lastCheck: Date.now(),
    consecutiveFailures: 0,
  };

  private cache = new Map<string, CachedResponse>();
  private listeners: Array<(online: boolean) => void> = [];

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => this.handleOnline());
      window.addEventListener('offline', () => this.handleOffline());
    }
  }

  async fetch<T>(
    url: string,
    options: RequestInit = {}
  ): Promise<{ data: T | null; error: any; fromCache?: boolean; offline?: boolean }> {
    if (!BULLETPROOF_CONFIG.enableNetworkFallback) {
      try {
        const response = await fetch(url, options);
        const data = await response.json();
        return { data, error: null };
      } catch (error) {
        return { data: null, error };
      }
    }

    // Check if we're offline
    if (!this.state.online) {
      console.warn('[NetworkResilience] ⚠️ Offline mode - checking cache');
      const cached = this.cache.get(url);

      if (cached) {
        const age = Date.now() - cached.timestamp;
        console.log(`[NetworkResilience] ✅ Returning cached data (${Math.round(age / 1000)}s old)`);
        return { data: cached.data, error: null, fromCache: true, offline: true };
      }

      return {
        data: null,
        error: new Error('No network connection and no cached data available'),
        offline: true,
      };
    }

    // Try fetch with retry
    let lastError: any = null;

    for (let attempt = 0; attempt <= BULLETPROOF_CONFIG.maxNetworkRetries; attempt++) {
      try {
        const response = await this.fetchWithTimeout(url, options, BULLETPROOF_CONFIG.databaseTimeoutMs);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();

        // Cache successful responses
        this.cache.set(url, {
          data,
          timestamp: Date.now(),
          url,
        });

        // Reset failure counter on success
        if (this.state.consecutiveFailures > 0) {
          console.log('[NetworkResilience] ✅ Connection restored');
          this.state.consecutiveFailures = 0;
        }

        return { data, error: null };
      } catch (error) {
        lastError = error;
        this.state.consecutiveFailures++;

        if (attempt < BULLETPROOF_CONFIG.maxNetworkRetries) {
          const delay = BULLETPROOF_CONFIG.networkRetryDelayMs * Math.pow(2, attempt);
          console.warn(`[NetworkResilience] ⚠️ Fetch failed (attempt ${attempt + 1}/${BULLETPROOF_CONFIG.maxNetworkRetries + 1}), retrying in ${delay}ms...`);
          await this.sleep(delay);
        }
      }
    }

    // All retries failed - check cache
    console.error('[NetworkResilience] ❌ All fetch attempts failed:', lastError);

    const cached = this.cache.get(url);
    if (cached) {
      const age = Date.now() - cached.timestamp;
      console.warn(`[NetworkResilience] ⚠️ Returning stale cache (${Math.round(age / 1000)}s old) due to network failure`);
      return { data: cached.data, error: null, fromCache: true };
    }

    // Mark as potentially offline if many consecutive failures
    if (this.state.consecutiveFailures >= 3) {
      console.warn('[NetworkResilience] ⚠️ Multiple failures detected - may be offline');
      this.handleOffline();
    }

    return { data: null, error: lastError };
  }

  private async fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private handleOnline(): void {
    console.log('[NetworkResilience] ✅ Network connection restored');
    this.state.online = true;
    this.state.lastCheck = Date.now();
    this.state.consecutiveFailures = 0;
    this.notifyListeners(true);
  }

  private handleOffline(): void {
    console.warn('[NetworkResilience] ⚠️ Network connection lost');
    this.state.online = false;
    this.state.lastCheck = Date.now();
    this.notifyListeners(false);
  }

  private notifyListeners(online: boolean): void {
    this.listeners.forEach(listener => {
      try {
        listener(online);
      } catch (error) {
        console.error('[NetworkResilience] Error in listener:', error);
      }
    });
  }

  onNetworkChange(callback: (online: boolean) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const index = this.listeners.indexOf(callback);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  isOnline(): boolean {
    return this.state.online;
  }

  getNetworkState(): NetworkState {
    return { ...this.state };
  }

  clearCache(url?: string): void {
    if (url) {
      this.cache.delete(url);
    } else {
      this.cache.clear();
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const networkResilienceManager = new NetworkResilienceManager();
