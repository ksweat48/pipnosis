import { WebSocketPriceStream } from './websocket-price-stream';
import { LivePricePolling } from './livePricePolling';

export interface PriceTickData {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: Date;
  source: 'websocket' | 'polling';
}

export interface ConnectionStatus {
  isConnected: boolean;
  connectionType: 'websocket' | 'polling' | 'none';
  websocketAttempts: number;
  quality: 'excellent' | 'good' | 'poor' | 'disconnected';
  lastUpdate: Date | null;
}

type PriceCallback = (tick: PriceTickData) => void;
type StatusCallback = (status: ConnectionStatus) => void;

export class PriceStreamManager {
  private symbol: string;
  private websocketStream: WebSocketPriceStream | null = null;
  private pollingStream: LivePricePolling | null = null;
  private currentStrategy: 'websocket' | 'polling' | 'none' = 'none';
  private websocketFailures: number = 0;
  private readonly MAX_WEBSOCKET_FAILURES = 3;
  private retryWebSocketTimeout: NodeJS.Timeout | null = null;
  private readonly WEBSOCKET_RETRY_INTERVAL = 300000;
  private lastTickTime: Date | null = null;
  private tickBuffer: PriceTickData[] = [];
  private bufferFlushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_FLUSH_MS = 100;
  private readonly MAX_BUFFER_SIZE = 10;

  private priceCallbacks: Set<PriceCallback> = new Set();
  private statusCallbacks: Set<StatusCallback> = new Set();

  constructor(symbol: string) {
    this.symbol = symbol;
  }

  onPrice(callback: PriceCallback): void {
    this.priceCallbacks.add(callback);
  }

  offPrice(callback: PriceCallback): void {
    this.priceCallbacks.delete(callback);
  }

  onStatusChange(callback: StatusCallback): void {
    this.statusCallbacks.add(callback);
  }

  offStatusChange(callback: StatusCallback): void {
    this.statusCallbacks.delete(callback);
  }

  async start(): Promise<void> {
    console.log(`[PriceStreamManager] Starting price stream for ${this.symbol}`);

    this.startBufferFlush();

    const useWebSocket = this.shouldUseWebSocket();

    if (useWebSocket) {
      await this.startWebSocket();
    } else {
      this.startPolling();
    }
  }

  stop(): void {
    console.log(`[PriceStreamManager] Stopping price stream for ${this.symbol}`);

    this.stopBufferFlush();

    if (this.websocketStream) {
      this.websocketStream.disconnect();
      this.websocketStream = null;
    }

    if (this.pollingStream) {
      this.pollingStream.stop();
      this.pollingStream = null;
    }

    if (this.retryWebSocketTimeout) {
      clearTimeout(this.retryWebSocketTimeout);
      this.retryWebSocketTimeout = null;
    }

    this.currentStrategy = 'none';
    this.notifyStatusChange();
  }

  changeSymbol(newSymbol: string): void {
    const wasActive = this.currentStrategy !== 'none';
    this.stop();
    this.symbol = newSymbol;

    if (wasActive) {
      setTimeout(() => this.start(), 500);
    }
  }

  getStatus(): ConnectionStatus {
    return {
      isConnected: this.currentStrategy !== 'none',
      connectionType: this.currentStrategy,
      websocketAttempts: this.websocketFailures,
      quality: this.calculateQuality(),
      lastUpdate: this.lastTickTime
    };
  }

  forcePolling(): void {
    console.log(`[PriceStreamManager] Forcing polling mode for ${this.symbol}`);

    if (this.websocketStream) {
      this.websocketStream.disconnect();
      this.websocketStream = null;
    }

    if (this.retryWebSocketTimeout) {
      clearTimeout(this.retryWebSocketTimeout);
      this.retryWebSocketTimeout = null;
    }

    this.websocketFailures = this.MAX_WEBSOCKET_FAILURES;
    this.startPolling();
  }

  retryWebSocket(): void {
    console.log(`[PriceStreamManager] Manually retrying WebSocket for ${this.symbol}`);
    this.websocketFailures = 0;

    if (this.pollingStream) {
      this.pollingStream.stop();
      this.pollingStream = null;
    }

    this.startWebSocket();
  }

  private shouldUseWebSocket(): boolean {
    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    const region = import.meta.env.VITE_METAAPI_REGION;

    if (!accountId || !region) {
      console.warn(`[PriceStreamManager] WebSocket unavailable: missing credentials`);
      return false;
    }

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] WebSocket disabled due to repeated failures (${this.websocketFailures})`);
      return false;
    }

    return true;
  }

  private async startWebSocket(): Promise<void> {
    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    const region = import.meta.env.VITE_METAAPI_REGION || 'new-york';

    try {
      const tokenResponse = await fetch('/.netlify/functions/get-metaapi-token');
      const tokenData = await tokenResponse.json();

      if (!tokenData.success || !tokenData.token) {
        throw new Error('Failed to get MetaAPI token');
      }

      this.websocketStream = new WebSocketPriceStream(
        this.symbol,
        accountId,
        tokenData.token,
        region
      );

      this.websocketStream.onTick((tick) => {
        this.handleWebSocketTick(tick);
      });

      this.websocketStream.onConnectionChange((connected) => {
        if (!connected) {
          this.handleWebSocketDisconnect();
        } else {
          console.log(`[PriceStreamManager] WebSocket connected for ${this.symbol}`);
          this.currentStrategy = 'websocket';
          this.notifyStatusChange();
        }
      });

      this.websocketStream.onError((error) => {
        console.error(`[PriceStreamManager] WebSocket error for ${this.symbol}:`, error);
        this.handleWebSocketError(error);
      });

      await this.websocketStream.connect();

    } catch (error) {
      console.error(`[PriceStreamManager] Failed to start WebSocket:`, error);
      this.handleWebSocketError(error as Error);
    }
  }

  private startPolling(): void {
    console.log(`[PriceStreamManager] Starting polling fallback for ${this.symbol}`);

    this.pollingStream = new LivePricePolling(this.symbol, 2000);

    this.pollingStream.onTick((tick) => {
      this.handlePollingTick(tick);
    });

    this.pollingStream.start();
    this.currentStrategy = 'polling';
    this.notifyStatusChange();

    if (this.websocketFailures < this.MAX_WEBSOCKET_FAILURES) {
      this.scheduleWebSocketRetry();
    }
  }

  private handleWebSocketTick(tick: any): void {
    const priceTick: PriceTickData = {
      symbol: this.symbol,
      bid: tick.bid,
      ask: tick.ask,
      mid: tick.mid,
      spread: tick.spread,
      time: tick.time,
      source: 'websocket'
    };

    this.addToBuffer(priceTick);
    this.lastTickTime = new Date();
  }

  private handlePollingTick(tick: any): void {
    const priceTick: PriceTickData = {
      symbol: this.symbol,
      bid: tick.bid || 0,
      ask: tick.ask || 0,
      mid: tick.price,
      spread: tick.spread || 0,
      time: tick.time,
      source: 'polling'
    };

    this.addToBuffer(priceTick);
    this.lastTickTime = new Date();
  }

  private handleWebSocketDisconnect(): void {
    console.warn(`[PriceStreamManager] WebSocket disconnected for ${this.symbol}`);
    this.websocketFailures++;

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] Switching to polling mode after ${this.websocketFailures} failures`);
      this.startPolling();
    }
  }

  private handleWebSocketError(error: Error): void {
    console.error(`[PriceStreamManager] WebSocket error for ${this.symbol}:`, error.message);
    this.websocketFailures++;

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] Permanent fallback to polling mode`);
      if (this.websocketStream) {
        this.websocketStream.disconnect();
        this.websocketStream = null;
      }
      this.startPolling();
    }
  }

  private scheduleWebSocketRetry(): void {
    if (this.retryWebSocketTimeout) {
      clearTimeout(this.retryWebSocketTimeout);
    }

    console.log(`[PriceStreamManager] Scheduling WebSocket retry in ${this.WEBSOCKET_RETRY_INTERVAL / 1000}s`);

    this.retryWebSocketTimeout = setTimeout(() => {
      if (this.currentStrategy === 'polling' && this.websocketFailures < this.MAX_WEBSOCKET_FAILURES) {
        console.log(`[PriceStreamManager] Attempting to restore WebSocket connection`);
        this.retryWebSocket();
      }
    }, this.WEBSOCKET_RETRY_INTERVAL);
  }

  private addToBuffer(tick: PriceTickData): void {
    this.tickBuffer.push(tick);

    if (this.tickBuffer.length >= this.MAX_BUFFER_SIZE) {
      this.flushBuffer();
    }
  }

  private startBufferFlush(): void {
    this.bufferFlushInterval = setInterval(() => {
      if (this.tickBuffer.length > 0) {
        this.flushBuffer();
      }
    }, this.BUFFER_FLUSH_MS);
  }

  private stopBufferFlush(): void {
    if (this.bufferFlushInterval) {
      clearInterval(this.bufferFlushInterval);
      this.bufferFlushInterval = null;
    }
  }

  private flushBuffer(): void {
    if (this.tickBuffer.length === 0) {
      return;
    }

    const latestTick = this.tickBuffer[this.tickBuffer.length - 1];
    this.tickBuffer = [];

    this.priceCallbacks.forEach(callback => {
      try {
        callback(latestTick);
      } catch (err) {
        console.error('[PriceStreamManager] Error in price callback:', err);
      }
    });
  }

  private notifyStatusChange(): void {
    const status = this.getStatus();
    this.statusCallbacks.forEach(callback => {
      try {
        callback(status);
      } catch (err) {
        console.error('[PriceStreamManager] Error in status callback:', err);
      }
    });
  }

  private calculateQuality(): 'excellent' | 'good' | 'poor' | 'disconnected' {
    if (this.currentStrategy === 'none') {
      return 'disconnected';
    }

    if (!this.lastTickTime) {
      return 'poor';
    }

    const timeSinceLastTick = Date.now() - this.lastTickTime.getTime();

    if (this.currentStrategy === 'websocket') {
      if (timeSinceLastTick < 5000) return 'excellent';
      if (timeSinceLastTick < 15000) return 'good';
      return 'poor';
    }

    if (this.currentStrategy === 'polling') {
      if (timeSinceLastTick < 5000) return 'good';
      if (timeSinceLastTick < 15000) return 'poor';
      return 'disconnected';
    }

    return 'disconnected';
  }
}
