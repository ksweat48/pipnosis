import { io, Socket } from 'socket.io-client';

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
  private maxReconnectAttempts: number = 10;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastHeartbeat: number = 0;
  private readonly HEARTBEAT_INTERVAL = 30000;
  private readonly HEARTBEAT_TIMEOUT = 60000;

  private tickCallbacks: Set<TickCallback> = new Set();
  private connectionCallbacks: Set<ConnectionCallback> = new Set();
  private errorCallbacks: Set<ErrorCallback> = new Set();

  constructor(symbol: string, accountId: string, token: string, region: string = 'new-york') {
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
    console.log(`[WebSocketPriceStream] Connecting to ${this.symbol} via MetaAPI Socket.IO (${this.region})`);

    try {
      const socketUrl = `https://mt-client-api-v1.${this.region}.agiliumtrade.ai`;

      this.socket = io(socketUrl, {
        path: '/ws',
        reconnection: false,
        transports: ['websocket', 'polling'],
        query: {
          'auth-token': this.token
        }
      });

      this.socket.on('connect', () => {
        console.log(`[WebSocketPriceStream] Socket.IO connection opened for ${this.symbol}`);
        this.isConnecting = false;
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.notifyConnectionChange(true);
      });

      this.socket.on('synchronization', (data: any) => {
        if (data.type === 'authenticated') {
          console.log(`[WebSocketPriceStream] Authentication successful for ${this.symbol}`);
          this.isAuthenticated = true;
          this.startHeartbeat();
          this.subscribeToPrice();
        }
      });

      this.socket.on('tick', (data: any) => {
        this.handlePriceTick(data);
      });

      this.socket.on('quote', (data: any) => {
        this.handlePriceTick(data);
      });

      this.socket.on('prices', (data: any) => {
        if (Array.isArray(data)) {
          data.forEach((tick: any) => this.handlePriceTick(tick));
        } else {
          this.handlePriceTick(data);
        }
      });

      this.socket.on('response', (data: any) => {
        if (data.type === 'response') {
          console.log(`[WebSocketPriceStream] Received response:`, data);
        }
      });

      this.socket.on('pong', () => {
        this.lastHeartbeat = Date.now();
      });

      this.socket.on('error', (error: any) => {
        console.error(`[WebSocketPriceStream] Socket.IO error for ${this.symbol}:`, error);
        this.isConnecting = false;
        this.notifyError(new Error(error?.message || 'Socket.IO connection error'));
      });

      this.socket.on('connect_error', (error: any) => {
        console.error(`[WebSocketPriceStream] Connection error for ${this.symbol}:`, error.message);
        this.isConnecting = false;
        this.isConnected = false;
        this.notifyError(new Error(`Connection failed: ${error.message}`));
        this.scheduleReconnect();
      });

      this.socket.on('disconnect', (reason: string) => {
        console.log(`[WebSocketPriceStream] Socket.IO disconnected for ${this.symbol}. Reason: ${reason}`);
        this.isConnected = false;
        this.isConnecting = false;
        this.isAuthenticated = false;
        this.stopHeartbeat();
        this.notifyConnectionChange(false);

        if (reason !== 'io client disconnect') {
          this.scheduleReconnect();
        }
      });

    } catch (error) {
      this.isConnecting = false;
      this.isConnected = false;
      console.error(`[WebSocketPriceStream] Failed to create Socket.IO connection:`, error);
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
      console.warn(`[WebSocketPriceStream] Cannot subscribe - not connected or authenticated`);
      return;
    }

    const subscribeRequest = {
      type: 'subscribeToMarketData',
      symbol: this.symbol,
      subscriptions: [
        { type: 'quotes' }
      ]
    };

    console.log(`[WebSocketPriceStream] Subscribing to price updates for ${this.symbol}`);
    this.socket.emit('request', subscribeRequest);
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

      this.socket.emit('ping');
    }, this.HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WebSocketPriceStream] Max reconnection attempts reached for ${this.symbol}`);
      this.notifyError(new Error('Max reconnection attempts reached'));
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`[WebSocketPriceStream] Scheduling reconnect for ${this.symbol} in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
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
