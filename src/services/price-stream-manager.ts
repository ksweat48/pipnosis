import { WebSocketPriceStream, isSocketIOAvailable } from './websocket-price-stream';
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
  private readonly MAX_WEBSOCKET_FAILURES = 5;
  private retryWebSocketTimeout: NodeJS.Timeout | null = null;
  private readonly WEBSOCKET_RETRY_INTERVAL = 300000;
  private lastTickTime: Date | null = null;
  private tickBuffer: PriceTickData[] = [];
  private bufferFlushInterval: NodeJS.Timeout | null = null;
  private readonly BUFFER_FLUSH_MS = 100;
  private readonly MAX_BUFFER_SIZE = 10;
  private isConnecting: boolean = false;
  private connectionStartTime: number | null = null;
  private readonly MIN_CONNECTION_TIME = 2000; // Minimum time before allowing disconnect

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
    const timestamp = new Date().toISOString();
    console.log(`[PriceStreamManager] [${timestamp}] Starting price stream for ${this.symbol}`);
    console.log(`[PriceStreamManager] Evaluating connection strategy...`);

    this.isConnecting = true;
    this.connectionStartTime = Date.now();
    this.startBufferFlush();

    const useWebSocket = this.shouldUseWebSocket();

    if (useWebSocket) {
      console.log(`[PriceStreamManager] ✅ Strategy selected: WEBSOCKET (real-time Socket.IO)`);
      await this.startWebSocket();
    } else {
      console.log(`[PriceStreamManager] ⚠️ Strategy selected: POLLING (fallback mode)`);
      this.startPolling();
    }

    this.isConnecting = false;
  }

  stop(): void {
    // Prevent stopping while connection is in progress
    if (this.isConnecting) {
      console.warn(`[PriceStreamManager] ⚠️ Cannot stop ${this.symbol}: Connection in progress. Deferring stop...`);
      // Defer the stop until connection completes
      setTimeout(() => this.stop(), 500);
      return;
    }

    // Prevent stopping too soon after connection started
    if (this.connectionStartTime) {
      const timeSinceStart = Date.now() - this.connectionStartTime;
      if (timeSinceStart < this.MIN_CONNECTION_TIME) {
        const waitTime = this.MIN_CONNECTION_TIME - timeSinceStart;
        console.warn(`[PriceStreamManager] ⚠️ Connection for ${this.symbol} is too recent (${timeSinceStart}ms). Waiting ${waitTime}ms before stopping...`);
        setTimeout(() => this.stop(), waitTime);
        return;
      }
    }

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
    this.connectionStartTime = null;
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
    // First check if Socket.IO is available in the browser
    if (!isSocketIOAvailable()) {
      console.warn(`[PriceStreamManager] ❌ WebSocket unavailable: Socket.IO client library not loaded`);
      console.warn(`[PriceStreamManager] This may indicate a build/bundling issue`);
      console.warn(`[PriceStreamManager] Falling back to polling mode`);
      return false;
    }

    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    const region = import.meta.env.VITE_METAAPI_REGION;

    if (!accountId || !region) {
      console.warn(`[PriceStreamManager] ⚠️ WebSocket unavailable: missing credentials`);
      console.warn(`[PriceStreamManager] accountId=${accountId ? 'set' : 'MISSING'}, region=${region || 'MISSING'}`);
      return false;
    }

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] ⚠️ WebSocket disabled due to repeated failures (${this.websocketFailures}/${this.MAX_WEBSOCKET_FAILURES})`);
      return false;
    }

    console.log(`[PriceStreamManager] ✅ Socket.IO available: YES`);
    console.log(`[PriceStreamManager] ✅ WebSocket credentials verified: region=${region}, accountId=${accountId.substring(0, 8)}...`);
    return true;
  }

  private async startWebSocket(): Promise<void> {
    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    const region = import.meta.env.VITE_METAAPI_REGION || 'london';

    const timestamp = new Date().toISOString();
    console.log(`[PriceStreamManager] [${timestamp}] Starting WebSocket connection for ${this.symbol}`);
    console.log(`[PriceStreamManager] Using region: ${region}, accountId: ${accountId?.substring(0, 8)}...`);

    try {
      console.log(`[PriceStreamManager] Fetching MetaAPI token from backend...`);
      const tokenResponse = await fetch('/.netlify/functions/get-metaapi-token');

      if (!tokenResponse.ok) {
        throw new Error(`Token fetch failed with status ${tokenResponse.status}`);
      }

      const tokenData = await tokenResponse.json();
      console.log(`[PriceStreamManager] Token fetch result: success=${tokenData.success}`);

      if (!tokenData.success || !tokenData.token) {
        throw new Error('Failed to get MetaAPI token');
      }

      console.log(`[PriceStreamManager] Token retrieved successfully, length: ${tokenData.token.length}`);

      // Validate token format (should be a JWT)
      if (!tokenData.token.startsWith('eyJ')) {
        throw new Error('Invalid token format - does not appear to be a JWT');
      }

      // Check if token is expired by decoding the JWT payload
      try {
        const tokenParts = tokenData.token.split('.');
        if (tokenParts.length === 3) {
          const payload = JSON.parse(atob(tokenParts[1]));
          const expirationTime = payload.exp * 1000; // Convert to milliseconds
          const currentTime = Date.now();
          const timeUntilExpiry = expirationTime - currentTime;

          if (timeUntilExpiry <= 0) {
            console.error(`[PriceStreamManager] Token has expired`);
            throw new Error('MetaAPI token is expired');
          } else if (timeUntilExpiry < 300000) { // Less than 5 minutes
            console.warn(`[PriceStreamManager] ⚠️ Token expires soon: ${Math.floor(timeUntilExpiry / 60000)} minutes`);
          } else {
            console.log(`[PriceStreamManager] Token is valid, expires in ${Math.floor(timeUntilExpiry / 3600000)} hours`);
          }
        }
      } catch (tokenDecodeError) {
        console.warn(`[PriceStreamManager] Could not decode token for validation:`, tokenDecodeError);
        // Continue anyway - the token might still work
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
        const timestamp = new Date().toISOString();
        if (!connected) {
          console.log(`[PriceStreamManager] [${timestamp}] ❌ WebSocket disconnected for ${this.symbol}`);
          this.handleWebSocketDisconnect();
        } else {
          console.log(`[PriceStreamManager] [${timestamp}] ✅ Socket.IO connected for ${this.symbol}`);
          console.log(`[PriceStreamManager] Resetting failure count (was ${this.websocketFailures})`);
          this.websocketFailures = 0; // Reset on successful connection
          this.currentStrategy = 'websocket';

          if (this.pollingStream) {
            console.log(`[PriceStreamManager] Stopping polling - Socket.IO active`);
            this.pollingStream.stop();
            this.pollingStream = null;
          }

          this.notifyStatusChange();
        }
      });

      this.websocketStream.onError((error) => {
        console.error(`[PriceStreamManager] WebSocket error for ${this.symbol}:`, error);
        this.handleWebSocketError(error);
      });

      await this.websocketStream.connect();

    } catch (error) {
      const timestamp = new Date().toISOString();
      console.error(`[PriceStreamManager] [${timestamp}] ❌ Failed to start WebSocket:`);
      console.error(`[PriceStreamManager] Error details:`, error instanceof Error ? error.message : JSON.stringify(error));
      console.error(`[PriceStreamManager] This was attempt ${this.websocketFailures + 1}`);
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
    const timestamp = new Date().toISOString();
    console.warn(`[PriceStreamManager] [${timestamp}] ⚠️ WebSocket disconnected for ${this.symbol}`);
    this.websocketFailures++;
    console.log(`[PriceStreamManager] Failure count: ${this.websocketFailures}/${this.MAX_WEBSOCKET_FAILURES}`);

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] ➡️ Switching to polling mode after ${this.websocketFailures} failures`);
      this.startPolling();
    }
  }

  private handleWebSocketError(error: Error): void {
    const timestamp = new Date().toISOString();
    console.error(`[PriceStreamManager] [${timestamp}] ❌ WebSocket error for ${this.symbol}:`, error.message);
    this.websocketFailures++;
    console.log(`[PriceStreamManager] Failure count: ${this.websocketFailures}/${this.MAX_WEBSOCKET_FAILURES}`);

    if (this.websocketFailures >= this.MAX_WEBSOCKET_FAILURES) {
      console.log(`[PriceStreamManager] [${timestamp}] ➡️ Permanent fallback to polling mode after ${this.websocketFailures} failures`);
      if (this.websocketStream) {
        console.log(`[PriceStreamManager] Disconnecting failed WebSocket stream...`);
        this.websocketStream.disconnect();
        this.websocketStream = null;
      }
      this.startPolling();
    } else {
      console.log(`[PriceStreamManager] WebSocket will retry (${this.MAX_WEBSOCKET_FAILURES - this.websocketFailures} attempts remaining)`);
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
