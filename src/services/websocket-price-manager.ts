/**
 * WebSocket Price Manager
 *
 * Orchestrates browser WebSocket connections for real-time price feeds.
 * This is an enhancement layer on top of server-side REST polling.
 *
 * Architecture:
 * - Kraken WebSocket for crypto (BTCUSD, ETHUSD)
 * - MetaAPI WebSocket for forex (XAUUSD, EURUSD, etc.)
 * - Rate-limited persistence to realtime_prices table
 * - Automatic fallback to REST polling when WebSocket fails
 */

import { logger, LogCategory } from '@/lib/logger';
import { isWebSocketEnabled, isCryptoSymbol, WEBSOCKET_CONFIG } from '@/config/websocket-config';
import { krakenWebSocketClient, KrakenTickData } from './kraken-websocket-client';
import { metaApiWebSocketClient, MetaApiTickData } from './metaapi-websocket-client';

export interface WebSocketTickData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  timestamp: Date;
  source: 'kraken-ws' | 'metaapi-ws';
}

export interface WebSocketManagerStatus {
  enabled: boolean;
  krakenConnected: boolean;
  metaapiConnected: boolean;
  totalTicksReceived: number;
  totalTicksPersisted: number;
  ticksPerSecond: number;
  lastTickTime: Date | null;
  persistenceQueueSize: number;
}

type TickCallback = (tick: WebSocketTickData) => void;
type StatusCallback = (status: WebSocketManagerStatus) => void;

interface RateLimitState {
  lastWriteTime: number;
  writeCount: number;
}

class WebSocketPriceManager {
  private tickCallbacks: Map<string, Set<TickCallback>> = new Map();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private isRunning = false;
  private isVisible = true;

  private rateLimitState: Map<string, RateLimitState> = new Map();
  private persistenceQueue: WebSocketTickData[] = [];
  private persistenceInterval: NodeJS.Timeout | null = null;

  private tickCountLastSecond = 0;
  private ticksPerSecond = 0;
  private tickCounterInterval: NodeJS.Timeout | null = null;

  private status: WebSocketManagerStatus = {
    enabled: false,
    krakenConnected: false,
    metaapiConnected: false,
    totalTicksReceived: 0,
    totalTicksPersisted: 0,
    ticksPerSecond: 0,
    lastTickTime: null,
    persistenceQueueSize: 0,
  };

  private krakenUnsubscribe: (() => void) | null = null;
  private metaapiUnsubscribe: (() => void) | null = null;
  private krakenStatusUnsubscribe: (() => void) | null = null;
  private metaapiStatusUnsubscribe: (() => void) | null = null;

  constructor() {
    this.setupVisibilityDetection();
  }

  private setupVisibilityDetection(): void {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.isVisible = !document.hidden;

        if (this.isVisible && this.status.enabled && !this.isRunning) {
          logger.info(LogCategory.PRICE, '[WebSocketManager] Tab visible - resuming WebSocket connections');
          this.start();
        } else if (!this.isVisible && this.isRunning) {
          logger.info(LogCategory.PRICE, '[WebSocketManager] Tab hidden - pausing WebSocket connections');
          this.pause();
        }
      });

      window.addEventListener('beforeunload', () => {
        this.stop();
      });
    }
  }

  async start(): Promise<void> {
    if (!isWebSocketEnabled()) {
      logger.debug(LogCategory.PRICE, '[WebSocketManager] WebSocket disabled via feature flag');
      return;
    }

    if (this.isRunning) {
      logger.debug(LogCategory.PRICE, '[WebSocketManager] Already running');
      return;
    }

    if (!this.isVisible) {
      logger.debug(LogCategory.PRICE, '[WebSocketManager] Tab not visible - not starting');
      this.status.enabled = true;
      return;
    }

    logger.info(LogCategory.PRICE, '[WebSocketManager] Starting WebSocket connections...');
    this.isRunning = true;
    this.status.enabled = true;

    this.setupTickListeners();
    this.setupStatusListeners();
    this.startPersistenceLoop();
    this.startTickCounter();

    krakenWebSocketClient.connect();
    metaApiWebSocketClient.connect();

    this.notifyStatusChange();
  }

  private setupTickListeners(): void {
    this.krakenUnsubscribe = krakenWebSocketClient.onTick((tick: KrakenTickData) => {
      this.handleTick({
        symbol: tick.symbol,
        bid: tick.bid,
        ask: tick.ask,
        mid: (tick.bid + tick.ask) / 2,
        spread: tick.ask - tick.bid,
        timestamp: tick.timestamp,
        source: 'kraken-ws',
      });
    });

    this.metaapiUnsubscribe = metaApiWebSocketClient.onTick((tick: MetaApiTickData) => {
      this.handleTick({
        symbol: tick.symbol,
        bid: tick.bid,
        ask: tick.ask,
        mid: (tick.bid + tick.ask) / 2,
        spread: tick.ask - tick.bid,
        timestamp: tick.timestamp,
        source: 'metaapi-ws',
      });
    });
  }

  private setupStatusListeners(): void {
    this.krakenStatusUnsubscribe = krakenWebSocketClient.onStatusChange((krakenStatus) => {
      this.status.krakenConnected = krakenStatus.connected;
      this.notifyStatusChange();
    });

    this.metaapiStatusUnsubscribe = metaApiWebSocketClient.onStatusChange((metaapiStatus) => {
      this.status.metaapiConnected = metaapiStatus.connected && metaapiStatus.synchronized;
      this.notifyStatusChange();
    });
  }

  private handleTick(tick: WebSocketTickData): void {
    this.status.totalTicksReceived++;
    this.status.lastTickTime = tick.timestamp;
    this.tickCountLastSecond++;

    const symbolCallbacks = this.tickCallbacks.get(tick.symbol);
    if (symbolCallbacks) {
      symbolCallbacks.forEach(callback => {
        try {
          callback(tick);
        } catch (error) {
          logger.error(LogCategory.PRICE, `[WebSocketManager] Tick callback error for ${tick.symbol}:`, error);
        }
      });
    }

    if (this.shouldPersistTick(tick.symbol)) {
      this.persistenceQueue.push(tick);
      this.status.persistenceQueueSize = this.persistenceQueue.length;
    }
  }

  private shouldPersistTick(symbol: string): boolean {
    const now = Date.now();
    const state = this.rateLimitState.get(symbol) || { lastWriteTime: 0, writeCount: 0 };
    const minIntervalMs = 1000 / WEBSOCKET_CONFIG.persistence.maxWritesPerSecondPerSymbol;

    if (now - state.lastWriteTime >= minIntervalMs) {
      this.rateLimitState.set(symbol, { lastWriteTime: now, writeCount: state.writeCount + 1 });
      return true;
    }

    return false;
  }

  private startPersistenceLoop(): void {
    if (this.persistenceInterval) return;

    this.persistenceInterval = setInterval(() => {
      this.flushPersistenceQueue();
    }, WEBSOCKET_CONFIG.persistence.batchIntervalMs);
  }

  private async flushPersistenceQueue(): Promise<void> {
    if (this.persistenceQueue.length === 0) return;

    const batch = this.persistenceQueue.splice(0, WEBSOCKET_CONFIG.persistence.maxBatchSize);
    this.status.persistenceQueueSize = this.persistenceQueue.length;

    try {
      const response = await fetch('/.netlify/functions/save-websocket-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prices: batch }),
      });

      if (response.ok) {
        const result = await response.json();
        this.status.totalTicksPersisted += result.savedCount || batch.length;
      } else {
        logger.error(LogCategory.PRICE, `[WebSocketManager] Persistence failed: ${response.status}`);
      }
    } catch (error) {
      logger.error(LogCategory.PRICE, '[WebSocketManager] Persistence error:', error);
    }
  }

  private startTickCounter(): void {
    if (this.tickCounterInterval) return;

    this.tickCounterInterval = setInterval(() => {
      this.ticksPerSecond = this.tickCountLastSecond;
      this.status.ticksPerSecond = this.ticksPerSecond;
      this.tickCountLastSecond = 0;
    }, 1000);
  }

  pause(): void {
    if (!this.isRunning) return;

    logger.info(LogCategory.PRICE, '[WebSocketManager] Pausing WebSocket connections');
    this.isRunning = false;

    krakenWebSocketClient.disconnect();
    metaApiWebSocketClient.disconnect();

    this.cleanupListeners();
    this.stopPersistenceLoop();
    this.stopTickCounter();

    this.notifyStatusChange();
  }

  stop(): void {
    logger.info(LogCategory.PRICE, '[WebSocketManager] Stopping WebSocket manager');
    this.status.enabled = false;
    this.pause();
  }

  private cleanupListeners(): void {
    if (this.krakenUnsubscribe) {
      this.krakenUnsubscribe();
      this.krakenUnsubscribe = null;
    }
    if (this.metaapiUnsubscribe) {
      this.metaapiUnsubscribe();
      this.metaapiUnsubscribe = null;
    }
    if (this.krakenStatusUnsubscribe) {
      this.krakenStatusUnsubscribe();
      this.krakenStatusUnsubscribe = null;
    }
    if (this.metaapiStatusUnsubscribe) {
      this.metaapiStatusUnsubscribe();
      this.metaapiStatusUnsubscribe = null;
    }
  }

  private stopPersistenceLoop(): void {
    if (this.persistenceInterval) {
      clearInterval(this.persistenceInterval);
      this.persistenceInterval = null;
    }
    this.flushPersistenceQueue();
  }

  private stopTickCounter(): void {
    if (this.tickCounterInterval) {
      clearInterval(this.tickCounterInterval);
      this.tickCounterInterval = null;
    }
  }

  onTick(symbol: string, callback: TickCallback): () => void {
    if (!this.tickCallbacks.has(symbol)) {
      this.tickCallbacks.set(symbol, new Set());
    }
    this.tickCallbacks.get(symbol)!.add(callback);

    return () => {
      const callbacks = this.tickCallbacks.get(symbol);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.tickCallbacks.delete(symbol);
        }
      }
    };
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusCallbacks.add(callback);
    callback(this.getStatus());
    return () => this.statusCallbacks.delete(callback);
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (error) {
        logger.error(LogCategory.PRICE, '[WebSocketManager] Status callback error:', error);
      }
    });
  }

  getStatus(): WebSocketManagerStatus {
    return { ...this.status };
  }

  isEnabled(): boolean {
    return this.status.enabled;
  }

  isConnected(symbol?: string): boolean {
    if (!symbol) {
      return this.status.krakenConnected || this.status.metaapiConnected;
    }

    if (isCryptoSymbol(symbol)) {
      return this.status.krakenConnected;
    }

    return this.status.metaapiConnected;
  }

  getSourceForSymbol(symbol: string): 'kraken-ws' | 'metaapi-ws' | null {
    if (!this.isConnected(symbol)) return null;
    return isCryptoSymbol(symbol) ? 'kraken-ws' : 'metaapi-ws';
  }
}

export const webSocketPriceManager = new WebSocketPriceManager();
