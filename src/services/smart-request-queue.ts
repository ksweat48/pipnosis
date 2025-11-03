import { pollingConfigService, SymbolPriority } from './polling-config-service';
import { supabase } from '@/lib/supabase';

interface QueuedRequest {
  id: string;
  symbol: string;
  priority: SymbolPriority;
  timestamp: number;
  retryCount: number;
  callback: (data: PriceData) => void;
  errorCallback: (error: Error) => void;
}

interface PriceData {
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: string;
  source: string;
}

interface InFlightRequest {
  symbol: string;
  startTime: number;
  promise: Promise<PriceData>;
}

export class SmartRequestQueue {
  private queue: QueuedRequest[] = [];
  private inFlight: Map<string, InFlightRequest> = new Map();
  private priceCache: Map<string, { data: PriceData; timestamp: number }> = new Map();
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private lastRequestTimes: Map<string, number> = new Map();

  private readonly CACHE_TTL = 1000;
  private readonly MIN_REQUEST_INTERVAL = 500;
  private readonly MAX_RETRY_COUNT = 3;
  private readonly PROCESSING_INTERVAL = 100;

  start(): void {
    if (this.processingInterval) return;

    console.log('[SmartQueue] Starting request queue processor');
    this.processingInterval = setInterval(() => {
      this.processQueue();
    }, this.PROCESSING_INTERVAL);
  }

  stop(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('[SmartQueue] Stopped request queue processor');
  }

  async requestPrice(
    symbol: string,
    priority: SymbolPriority = 'normal'
  ): Promise<PriceData> {
    const cached = this.getCachedPrice(symbol);
    if (cached) {
      console.log(`[SmartQueue] Returning cached price for ${symbol} (${Date.now() - cached.timestamp}ms old)`);
      return cached.data;
    }

    const inFlight = this.inFlight.get(symbol);
    if (inFlight) {
      console.log(`[SmartQueue] Coalescing request for ${symbol} with in-flight request`);
      return inFlight.promise;
    }

    return new Promise((resolve, reject) => {
      const requestId = `${symbol}-${Date.now()}-${Math.random()}`;

      const request: QueuedRequest = {
        id: requestId,
        symbol,
        priority,
        timestamp: Date.now(),
        retryCount: 0,
        callback: resolve,
        errorCallback: reject,
      };

      this.queue.push(request);
      this.sortQueue();

      console.log(`[SmartQueue] Queued ${symbol} with priority ${priority} (queue size: ${this.queue.length})`);
    });
  }

  private getCachedPrice(symbol: string): { data: PriceData; timestamp: number } | null {
    const cached = this.priceCache.get(symbol);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.CACHE_TTL) {
      this.priceCache.delete(symbol);
      return null;
    }

    return cached;
  }

  private sortQueue(): void {
    const priorityOrder: Record<SymbolPriority, number> = {
      critical: 0,
      high: 1,
      normal: 2,
      low: 3,
    };

    this.queue.sort((a, b) => {
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      return a.timestamp - b.timestamp;
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    if (!pollingConfigService.canMakeRequest()) {
      if (pollingConfigService.shouldThrottle()) {
        console.warn('[SmartQueue] Rate limit approaching, throttling requests');
      }
      return;
    }

    this.isProcessing = true;

    try {
      const request = this.queue.shift();
      if (!request) return;

      const lastRequestTime = this.lastRequestTimes.get(request.symbol) || 0;
      const timeSinceLastRequest = Date.now() - lastRequestTime;

      if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
        this.queue.unshift(request);
        return;
      }

      await this.executeRequest(request);
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeRequest(request: QueuedRequest): Promise<void> {
    const { symbol, callback, errorCallback } = request;

    try {
      console.log(`[SmartQueue] Executing request for ${symbol} (priority: ${request.priority})`);

      const promise = this.fetchPrice(symbol);

      this.inFlight.set(symbol, {
        symbol,
        startTime: Date.now(),
        promise,
      });

      this.lastRequestTimes.set(symbol, Date.now());

      const data = await promise;

      this.priceCache.set(symbol, {
        data,
        timestamp: Date.now(),
      });

      pollingConfigService.recordRequest();

      this.inFlight.delete(symbol);

      callback(data);

      await this.updateVolatility(symbol, data.mid);

      console.log(`[SmartQueue] Successfully fetched ${symbol}: ${data.bid}/${data.ask}`);
    } catch (error) {
      this.inFlight.delete(symbol);

      if (request.retryCount < this.MAX_RETRY_COUNT) {
        console.warn(`[SmartQueue] Request failed for ${symbol}, requeueing (attempt ${request.retryCount + 1}/${this.MAX_RETRY_COUNT})`);
        request.retryCount++;
        request.priority = 'low';
        this.queue.push(request);
        this.sortQueue();
      } else {
        console.error(`[SmartQueue] Request failed for ${symbol} after ${this.MAX_RETRY_COUNT} attempts`);
        errorCallback(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private async fetchPrice(symbol: string): Promise<PriceData> {
    const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();

    if (!data.ok || !data.bid || !data.ask) {
      throw new Error(`Invalid price data: ${JSON.stringify(data)}`);
    }

    const bid = parseFloat(data.bid);
    const ask = parseFloat(data.ask);

    return {
      bid,
      ask,
      mid: (bid + ask) / 2,
      spread: ask - bid,
      timestamp: data.timestamp || new Date().toISOString(),
      source: data.source || 'unknown',
    };
  }

  private async updateVolatility(symbol: string, price: number): Promise<void> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.rpc('update_symbol_volatility', {
        p_symbol: symbol,
        p_timeframe: 'M5',
        p_current_price: price,
      });
    } catch (error) {
      console.error(`[SmartQueue] Failed to update volatility for ${symbol}:`, error);
    }
  }

  getQueueStatus(): {
    queueLength: number;
    inFlightCount: number;
    cacheSize: number;
    priorityBreakdown: Record<SymbolPriority, number>;
  } {
    const priorityBreakdown: Record<SymbolPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    this.queue.forEach((req) => {
      priorityBreakdown[req.priority]++;
    });

    return {
      queueLength: this.queue.length,
      inFlightCount: this.inFlight.size,
      cacheSize: this.priceCache.size,
      priorityBreakdown,
    };
  }

  clearCache(): void {
    this.priceCache.clear();
    console.log('[SmartQueue] Cache cleared');
  }

  clearQueue(): void {
    this.queue.forEach((req) => {
      req.errorCallback(new Error('Queue cleared'));
    });
    this.queue = [];
    console.log('[SmartQueue] Queue cleared');
  }
}

export const smartRequestQueue = new SmartRequestQueue();
