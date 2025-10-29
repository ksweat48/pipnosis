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
  private ws: WebSocket | null = null;
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

    this.isConnecting = true;
    const timestamp = new Date().toISOString();
    console.log(`[WebSocketPriceStream] [${timestamp}] Connecting to ${this.symbol} via Native WebSocket`);
    console.log(`[WebSocketPriceStream] Configuration: region=${this.region}, accountId=${this.accountId}`);

    try {
      const wsUrl = `wss://mt-client-api-v1.${this.region}.agiliumtrade.ai`;
      console.log(`[WebSocketPriceStream] WebSocket URL: ${wsUrl}`);
      console.log(`[WebSocketPriceStream] Token length: ${this.token.length} chars, Token prefix: ${this.token.substring(0, 20)}...`);

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] ✅ WebSocket connection opened for ${this.symbol}`);
        console.log(`[WebSocketPriceStream] Ready state: ${this.ws?.readyState}`);
        this.isConnecting = false;
        this.isConnected = true;
        this.reconnectAttempts = 0;

        this.authenticate();
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error(`[WebSocketPriceStream] Failed to parse message:`, error);
        }
      };

      this.ws.onerror = (error) => {
        const timestamp = new Date().toISOString();
        console.error(`[WebSocketPriceStream] [${timestamp}] ❌ WebSocket error for ${this.symbol}:`, error);
        console.error(`[WebSocketPriceStream] Connection state - isConnected: ${this.isConnected}, isConnecting: ${this.isConnecting}, isAuthenticated: ${this.isAuthenticated}`);
        this.isConnecting = false;
        this.notifyError(new Error('WebSocket connection error'));
      };

      this.ws.onclose = (event) => {
        const timestamp = new Date().toISOString();
        console.log(`[WebSocketPriceStream] [${timestamp}] ⚠️ WebSocket closed for ${this.symbol}`);
        console.log(`[WebSocketPriceStream] Close code: ${event.code}, reason: ${event.reason || 'No reason provided'}`);
        console.log(`[WebSocketPriceStream] Was clean: ${event.wasClean}, Was authenticated: ${this.isAuthenticated}`);
        console.log(`[WebSocketPriceStream] Reconnect attempts so far: ${this.reconnectAttempts}`);

        this.isConnected = false;
        this.isConnecting = false;
        this.isAuthenticated = false;
        this.stopHeartbeat();
        this.notifyConnectionChange(false);

        if (event.code !== 1000) {
          console.log(`[WebSocketPriceStream] Abnormal closure, will attempt reconnection...`);
          this.scheduleReconnect();
        } else {
          console.log(`[WebSocketPriceStream] Normal closure - no reconnection`);
        }
      };

    } catch (error) {
      const timestamp = new Date().toISOString();
      this.isConnecting = false;
      this.isConnected = false;
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Failed to create WebSocket connection`);
      console.error(`[WebSocketPriceStream] Exception: ${error instanceof Error ? error.message : JSON.stringify(error)}`);
      console.error(`[WebSocketPriceStream] Stack trace:`, error instanceof Error ? error.stack : 'N/A');
      this.notifyError(error as Error);
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    console.log(`[WebSocketPriceStream] Disconnecting from ${this.symbol}`);

    this.stopHeartbeat();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Client disconnect');
      }
      this.ws = null;
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

  private authenticate(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WebSocketPriceStream] ⚠️ Cannot authenticate - WebSocket not open`);
      return;
    }

    const authMessage = {
      type: 'authenticate',
      accountId: this.accountId,
      token: this.token,
      application: 'MetaApi',
      requestId: this.generateRequestId()
    };

    const timestamp = new Date().toISOString();
    console.log(`[WebSocketPriceStream] [${timestamp}] 🔐 Sending authentication for ${this.symbol}`);
    console.log(`[WebSocketPriceStream] Account ID: ${this.accountId}`);

    this.send(authMessage);
  }

  private subscribeToPrice(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isAuthenticated) {
      console.warn(`[WebSocketPriceStream] ⚠️ Cannot subscribe - not connected or authenticated`);
      console.warn(`[WebSocketPriceStream] State: ws=${!!this.ws}, readyState=${this.ws?.readyState}, authenticated=${this.isAuthenticated}`);
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

    this.send(subscribeRequest);
  }

  private handleMessage(data: any): void {
    if (!data || typeof data !== 'object') {
      return;
    }

    if (data.type === 'authenticated' || (data.type === 'response' && data.authenticated)) {
      const timestamp = new Date().toISOString();
      console.log(`[WebSocketPriceStream] [${timestamp}] ✅ Authentication successful for ${this.symbol}`);
      this.isAuthenticated = true;
      this.notifyConnectionChange(true);
      this.startHeartbeat();
      this.subscribeToPrice();
      return;
    }

    if (data.type === 'authenticationError' || (data.type === 'error' && !this.isAuthenticated)) {
      const timestamp = new Date().toISOString();
      console.error(`[WebSocketPriceStream] [${timestamp}] ❌ Authentication failed for ${this.symbol}`);
      console.error(`[WebSocketPriceStream] Error details:`, JSON.stringify(data));
      this.notifyError(new Error('Authentication failed'));
      this.disconnect();
      return;
    }

    if (data.type === 'tick' || data.type === 'quote' || data.type === 'price') {
      this.handlePriceTick(data);
      return;
    }

    if (data.type === 'prices' && Array.isArray(data.prices)) {
      data.prices.forEach((tick: any) => this.handlePriceTick(tick));
      return;
    }

    if (data.type === 'response') {
      console.log(`[WebSocketPriceStream] Received response:`, data);
      return;
    }

    if (data.type === 'pong') {
      this.lastHeartbeat = Date.now();
      return;
    }

    if (data.type === 'error') {
      console.error(`[WebSocketPriceStream] Server error:`, data);
      return;
    }
  }

  private handlePriceTick(data: any): void {
    if (!data.symbol || data.symbol !== this.symbol) {
      return;
    }

    if (!data.bid || !data.ask) {
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

    this.tickCallbacks.forEach(callback => {
      try {
        callback(tick);
      } catch (err) {
        console.error('[WebSocketPriceStream] Error in tick callback:', err);
      }
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeat = Date.now();

    this.heartbeatInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        return;
      }

      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat;

      if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        console.warn(`[WebSocketPriceStream] Heartbeat timeout for ${this.symbol}, reconnecting...`);
        this.disconnect();
        this.scheduleReconnect();
        return;
      }

      this.send({ type: 'ping', requestId: this.generateRequestId() });
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private send(message: any): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn(`[WebSocketPriceStream] Cannot send message - WebSocket not open`);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error(`[WebSocketPriceStream] Failed to send message:`, error);
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
