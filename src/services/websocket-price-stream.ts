import ioClient from 'socket.io-client';
import type { Socket } from 'socket.io-client';

// Using Socket.IO v2.x for compatibility with MetaAPI server (v2.x)
// MetaAPI server at mt-client-api-v1.*.agiliumtrade.ai runs Socket.IO v2.x

// Extract io function - handle both default and named exports
const io = (typeof ioClient === 'function' ? ioClient : (ioClient as any).default) || (window as any).io;

// Check if Socket.IO is available
export function isSocketIOAvailable(): boolean {
  try {
    // Check both the imported io and window.io (CDN fallback)
    const ioFunction = io || (window as any).io;
    const isAvailable = typeof ioFunction === 'function';

    if (!isAvailable) {
      console.error('[WebSocketPriceStream] Socket.IO client library is not available');
      console.error('[WebSocketPriceStream] Checked: module import and window.io');
    }

    return isAvailable;
  } catch (error) {
    console.error('[WebSocketPriceStream] Socket.IO is not available:', error);
    return false;
  }
}

interface WebSocketTickData {
  symbol: string;
  bid: number;
  ask: number;
  time: Date;
  mid: number;
  spread: number;
}

type TickCallback = (tick: WebSocketTickData) => void;
type ConnectionCallback = (connected: boolean) => void;
type ErrorCallback = (error: Error) => void;

export class WebSocketPriceStream {
  private socket: Socket | null = null;
  private symbol: string;
  private accountId: string;
  private token: string;
  private region: string;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;
  private isAuthenticated: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 20;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = 0;
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly HEARTBEAT_TIMEOUT = 60000;
  private requestId: number = 0;
  private lastTickReceived: number = 0;
  private tickWatchdogInterval: NodeJS.Timeout | null = null;
  private readonly TICK_WATCHDOG_INTERVAL = 10000;
  private readonly TICK_TIMEOUT = 15000;

  private tickCallbacks: Set<TickCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();

  constructor(symbol: string, accountId: string, token: string, region: string = 'london') {
    this.symbol = symbol;
    this.accountId = accountId;
    this.token = token;
    this.region = region;
  }

  onTick(callback: TickCallback): void {
    this.tickCallbacks.add(callback);
  }

  offTick(callback: TickCallback): void {
    this.tickCallbacks.delete(callback);
  }

  onConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallbacks.add(callback);
  }

  offConnectionChange(callback: ConnectionCallback): void {
    this.connectionCallbacks.delete(callback);
  }

  onError(callback: ErrorCallback): void {
    this.errorCallbacks.add(callback);
  }

  offError(callback: ErrorCallback): void {
    this.errorCallbacks.delete(callback);
  }

  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      console.warn(`[WebSocketPriceStream] Already connected or connecting to ${this.symbol}`);
      return;
    }

    // Check if Socket.IO is available before attempting connection
    if (!isSocketIOAvailable()) {
      const error = new Error('Socket.IO client library is not available in the browser. This may be due to a build or bundling issue.');
      console.error(`[WebSocketPriceStream] ❌ ${error.message}`);
      console.error(`[WebSocketPriceStream] Please ensure socket.io-client is properly installed and bundled.`);
      this.notifyError(error);
      return;
    }

    this.isConnecting = true;
    const timestamp = new Date().toISOString();
    console.log(`[WebSocketPriceStream] [${timestamp}] Connecting to ${this.symbol} via Socket.IO`);
    console.log(`[WebSocketPriceStream] Socket.IO availability check: PASSED`);
    console.log(`[WebSocketPriceStream] Configuration: region=${this.region}, accountId=${this.accountId}`);

    try {
      const socketUrl = `https://mt-client-api-v1.${this.region}.agiliumtrade.ai`;
      console.log(`[WebSocketPriceStream] Socket.IO URL: ${socketUrl}`);
      console.log(`[WebSocketPriceStream] Token length: ${this.token.length} chars, Token prefix: ${this.token.substring(0, 20)}...`);
      console.log(`[WebSocketPriceStream] Initializing Socket.IO connection with io() function...`);

      if (typeof io !== 'function') {
        throw new Error('Socket.IO io() function is not available - library may not be loaded correctly');
      }

      this.socket = io(socketUrl, {
        path: '/ws',
        reconnection: false,
        query: {
          'auth-token': this.token
        },
        transports: ['websocket', 'polling']
      });

      // Add catch-all event listener to capture ALL events from MetaAPI
      this.socket.onAny((eventName: string, ...args: any[]) => {
        console.log(`[WebSocketPriceStream] 📨 RAW EVENT from MetaAPI:`, {
          event: eventName,
          symbol: this.symbol,
          argsCount: args.length,
          data: args
        });
      });

      this.socket.on('connect', () => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] ✅ Socket.IO connection established for ${this.symbol}`);
        console.log(`[WebSocketPriceStream] Socket ID: ${this.socket?.id}`);
        console.log(`[WebSocketPriceStream] Connected to URL: ${socketUrl}`);
        console.log(`[WebSocketPriceStream] Transport: ${this.socket?.io?.engine?.transport?.name}`);
        this.isConnecting = false;
        this.isConnected = true;
        this.isAuthenticated = true;
        this.reconnectAttempts = 0;
        this.lastTickReceived = Date.now();
        this.notifyConnectionChange(true);
        this.startHeartbeat();
        this.startTickWatchdog();
        this.subscribeToPrice();
      });

      this.socket.on('authenticated', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] ✅ Authenticated event received for ${this.symbol}`, data);
        this.isAuthenticated = true;
      });

      this.socket.on('synchronization', (data: any) => {
        this.handleMessage(data);
      });

      this.socket.on('response', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] 📬 Received 'response' event:`, {
          type: data?.type,
          requestId: data?.requestId,
          hasData: !!data,
          fullData: data
        });
        this.handleMessage(data);
      });

      this.socket.on('prices', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] 💰 'prices' event received:`, {
          isArray: Array.isArray(data),
          hasPricesArray: data?.prices && Array.isArray(data.prices),
          dataType: typeof data,
          data: data
        });
        if (Array.isArray(data)) {
          data.forEach((tick: any) => this.handlePriceTick(tick));
        } else if (data.prices && Array.isArray(data.prices)) {
          data.prices.forEach((tick: any) => this.handlePriceTick(tick));
        } else {
          this.handlePriceTick(data);
        }
      });

      this.socket.on('tick', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] 📊 'tick' event received:`, data);
        this.handlePriceTick(data);
      });

      this.socket.on('quote', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] 📈 'quote' event received:`, data);
        this.handlePriceTick(data);
      });

      this.socket.on('price', (data: any) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] 💲 'price' event received:`, data);
        this.handlePriceTick(data);
      });

      this.socket.on('error', (error: any) => {
        const timestamp = new Date().toISOString();
        console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Socket.IO error for ${this.symbol}:`, error);
        this.isConnecting = false;
        this.notifyError(new Error(typeof error === 'string' ? error : JSON.stringify(error)));
      });

      this.socket.on('connect_error', (error: any) => {
        const timestamp = new Date().toISOString();
        console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Socket.IO connection error for ${this.symbol}:`, error);
        console.error(`[WebSocketPriceStream] Error message: ${error.message}`);
        console.error(`[WebSocketPriceStream] Connection state - isConnected: ${this.isConnected}, isConnecting: ${this.isConnecting}`);
        this.isConnecting = false;
        this.notifyError(error);
      });

      this.socket.on('disconnect', (reason: string) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] ⚠️ Socket.IO disconnected for ${this.symbol}`);
        console.log(`[WebSocketPriceStream] Disconnect reason: ${reason}`);
        console.log(`[WebSocketPriceStream] Was authenticated: ${this.isAuthenticated}`);
        console.log(`[WebSocketPriceStream] Reconnect attempts so far: ${this.reconnectAttempts}`);

        this.isConnected = false;
        this.isConnecting = false;
        this.isAuthenticated = false;
        this.stopHeartbeat();
        this.notifyConnectionChange(false);

        if (reason === 'io server disconnect' || reason === 'io client disconnect') {
          console.log(`[WebSocketPriceStream] Clean disconnect - no reconnection`);
        } else {
          console.log(`[WebSocketPriceStream] Abnormal disconnect, will attempt reconnection...`);
          this.scheduleReconnect();
        }
      });

    } catch (error) {
      const timestamp = new Date().toISOString();
      this.isConnecting = false;
      this.isConnected = false;
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Failed to create Socket.IO connection`);
      console.error(`[WebSocketPriceStream] Exception: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      console.error(`[WebSocketPriceStream] Stack trace:`, error instanceof Error ? error.stack : 'N/A');
      this.notifyError(error as Error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    console.log(`[WebSocketPriceStream] Disconnecting from ${this.symbol}`);

    this.stopHeartbeat();
    this.stopTickWatchdog();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }

    this.isConnected = false;
    this.isConnecting = false;
    this.isAuthenticated = false;
    this.reconnectAttempts = 0;
  }

  changeSymbol(newSymbol: string): void {
    const wasConnected = this.isConnected;
    this.disconnect();
    this.symbol = newSymbol;

    if (wasConnected) {
      setTimeout(() => this.connect(), 500);
    }
  }

  getConnectionStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.isConnected && this.isAuthenticated,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  private subscribeToPrice(): void {
    if (!this.socket || !this.socket.connected || !this.isAuthenticated) {
      console.warn(`[WebSocketPriceStream] ⚠️ Cannot subscribe - not connected or authenticated`);
      console.warn(`[WebSocketPriceStream] State: socket=${!!this.socket}, connected=${this.socket?.connected}, authenticated=${this.isAuthenticated}`);
      return;
    }

    const subscribeRequest = {
      type: 'subscribeToMarketData',
      accountId: this.accountId,
      symbol: this.symbol,
      subscriptions: [
        { type: 'quotes' }
      ],
      requestId: this.generateRequestId()
    };

    const timestamp = new Date().toISOString();
    console.log(`[WebSocketPriceStream] [${timestamp}] 📡 Subscribing to price updates for ${this.symbol}`);
    console.log(`[WebSocketPriceStream] Subscription request:`, JSON.stringify(subscribeRequest));
    console.log(`[WebSocketPriceStream] Using accountId: ${this.accountId}`);
    console.log(`[WebSocketPriceStream] Socket connected: ${this.socket.connected}, authenticated: ${this.isAuthenticated}`);

    // Set up one-time acknowledgment listener for this specific request
    const ackTimeout = setTimeout(() => {
      console.warn(`[WebSocketPriceStream] ⚠️ No acknowledgment received for subscription request after 5 seconds`);
      console.warn(`[WebSocketPriceStream] This may indicate the server is not processing the subscription`);
    }, 5000);

    this.socket.emit('request', subscribeRequest, (ack: any) => {
      clearTimeout(ackTimeout);
      const timestamp = new Date().toISOString();
      console.log(`[WebSocketPriceStream] [${timestamp}] ✅ Subscription acknowledgment received:`, ack);
    });

    console.log(`[WebSocketPriceStream] Subscription request emitted, waiting for confirmation...`);
  }

  private handleMessage(data: any): void {
    const timestamp = new Date().toISOString();

    if (!data || typeof data !== 'object') {
      console.warn(`[WebSocketPriceStream] [${timestamp}] ⚠️ handleMessage received invalid data:`, data);
      return;
    }

    console.log(`[WebSocketPriceStream] [${timestamp}] 📥 handleMessage processing:`, {
      type: data.type,
      hasSymbol: !!data.symbol,
      symbol: data.symbol,
      keys: Object.keys(data)
    });

    if (data.type === 'authenticated' || (data.type === 'response' && data.authenticated)) {
      console.log(`[WebSocketPriceStream] [${timestamp}] ✅ Authentication confirmed by server for ${this.symbol}`);
      this.isAuthenticated = true;
      return;
    }

    if (data.type === 'authenticationError' || (data.type === 'error' && !this.isAuthenticated)) {
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Authentication failed for ${this.symbol}`);
      console.error(`[WebSocketPriceStream] Error details:`, JSON.stringify(data));
      this.notifyError(new Error('Authentication failed'));
      this.disconnect();
      return;
    }

    if (data.type === 'tick' || data.type === 'quote' || data.type === 'price') {
      console.log(`[WebSocketPriceStream] [${timestamp}] 🎯 Price data detected in message, forwarding to handlePriceTick`);
      this.handlePriceTick(data);
      return;
    }

    if (data.type === 'prices' && Array.isArray(data.prices)) {
      console.log(`[WebSocketPriceStream] [${timestamp}] 🎯 Prices array detected (${data.prices.length} items), forwarding to handlePriceTick`);
      data.prices.forEach((tick: any) => this.handlePriceTick(tick));
      return;
    }

    if (data.type === 'response') {
      console.log(`[WebSocketPriceStream] [${timestamp}] 📩 Generic response received:`, data);
      return;
    }

    if (data.type === 'error') {
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Server error:`, data);
      return;
    }

    console.log(`[WebSocketPriceStream] [${timestamp}] ❔ Unhandled message type: ${data.type}`);
  }

  private handlePriceTick(data: any): void {
    const timestamp = new Date().toISOString();

    console.log(`[WebSocketPriceStream] [${timestamp}] 🎯 handlePriceTick called:`, {
      hasSymbol: !!data.symbol,
      symbol: data.symbol,
      expectedSymbol: this.symbol,
      hasBid: !!data.bid,
      hasAsk: !!data.ask,
      bid: data.bid,
      ask: data.ask,
      rawData: data
    });

    if (!data.symbol || data.symbol !== this.symbol) {
      console.warn(`[WebSocketPriceStream] [${timestamp}] ⚠️ Tick rejected - symbol mismatch: got ${data.symbol}, expected ${this.symbol}`);
      return;
    }

    if (!data.bid || !data.ask) {
      console.warn(`[WebSocketPriceStream] [${timestamp}] ⚠️ Tick rejected - missing bid/ask:`, { bid: data.bid, ask: data.ask });
      return;
    }

    const bid = parseFloat(data.bid);
    const ask = parseFloat(data.ask);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;

    const tick: WebSocketTickData = {
      symbol: this.symbol,
      bid,
      ask,
      mid,
      spread,
      time: new Date(data.time || data.timestamp || Date.now())
    };

    this.lastTickReceived = Date.now();

    console.log(`[WebSocketPriceStream] [${timestamp}] ✅ TICK PROCESSED:`, {
      symbol: tick.symbol,
      bid: tick.bid.toFixed(5),
      ask: tick.ask.toFixed(5),
      mid: tick.mid.toFixed(5),
      spread: tick.spread.toFixed(5),
      callbackCount: this.tickCallbacks.size
    });

    this.tickCallbacks.forEach(callback => {
      try {
        callback(tick);
        console.log(`[WebSocketPriceStream] [${timestamp}] 📤 Tick callback executed successfully`);
      } catch (err) {
        console.error('[WebSocketPriceStream] Error in tick callback:', err);
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeat = Date.now();

    this.heartbeatInterval = setInterval(() => {
      if (!this.socket || !this.socket.connected) {
        return;
      }

      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

      if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        console.warn(`[WebSocketPriceStream] Heartbeat timeout for ${this.symbol}, reconnecting...`);
        this.disconnect();
        this.scheduleReconnect();
        return;
      }

      this.socket.emit('request', { type: 'ping', requestId: this.generateRequestId() });
      this.lastHeartbeat = Date.now();
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private startTickWatchdog(): void {
    this.stopTickWatchdog();
    this.lastTickReceived = Date.now();

    this.tickWatchdogInterval = setInterval(() => {
      const timeSinceLastTick = Date.now() - this.lastTickReceived;
      const timestamp = new Date().toISOString();

      if (timeSinceLastTick > this.TICK_TIMEOUT) {
        console.error(`[WebSocketPriceStream] [${timestamp}] ❌ TICK TIMEOUT for ${this.symbol}`);
        console.error(`[WebSocketPriceStream] No ticks received for ${(timeSinceLastTick / 1000).toFixed(1)}s`);
        console.error(`[WebSocketPriceStream] Connection appears dead despite being connected: ${this.isConnected}`);
        console.error(`[WebSocketPriceStream] Triggering reconnection to restore data stream...`);

        this.disconnect();
        this.scheduleReconnect();
      } else {
        console.log(`[WebSocketPriceStream] [${timestamp}] 💚 Tick watchdog OK: last tick ${(timeSinceLastTick / 1000).toFixed(1)}s ago`);
      }
    }, this.TICK_WATCHDOG_INTERVAL);
  }

  private stopTickWatchdog(): void {
    if (this.tickWatchdogInterval) {
      clearInterval(this.tickWatchdogInterval);
      this.tickWatchdogInterval = null;
    }
  }

  private generateRequestId(): string {
    return `req_${Date.now()}_${++this.requestId}`;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      const timestamp = new Date().toISOString();
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Max reconnection attempts (${this.maxReconnectAttempts}) reached for ${this.symbol}`);
      console.error(`[WebSocketPriceStream] Configuration used: region=${this.region}, accountId=${this.accountId}`);
      console.error(`[WebSocketPriceStream] Giving up on WebSocket, will use polling fallback`);
      this.notifyError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;

    let delay: number;
    if (this.reconnectAttempts <= 4) {
      delay = 1000 * Math.pow(2, this.reconnectAttempts - 1);
    } else if (this.reconnectAttempts <= 6) {
      delay = 15000;
    } else if (this.reconnectAttempts <= 10) {
      delay = 30000;
    } else {
      delay = 60000;
    }

    const timestamp = new Date().toISOString();
    console.log(`[WebSocketPriceStream] [${timestamp}] 🔄 Scheduling reconnect for ${this.symbol}`);
    console.log(`[WebSocketPriceStream] Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms (${(delay / 1000).toFixed(0)}s)`);

    this.reconnectTimeout = setTimeout(() => {
      console.log(`[WebSocketPriceStream] Executing reconnect attempt ${this.reconnectAttempts}...`);
      this.connect();
    }, delay);
  }

  private notifyConnectionChange(connected: boolean): void {
    this.connectionCallbacks.forEach(callback => {
      try {
        callback(connected);
      } catch (err) {
        console.error('[WebSocketPriceStream] Error in connection callback:', err);
      }
    });
  }

  private notifyError(error: Error): void {
    this.errorCallbacks.forEach(callback => {
      try {
        callback(error);
      } catch (err) {
        console.error('[WebSocketPriceStream] Error in error callback:', err);
      }
    });
  }
}
