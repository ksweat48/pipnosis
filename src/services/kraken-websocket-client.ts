/**
 * Kraken WebSocket Client
 *
 * Connects to Kraken WebSocket v1 API for real-time crypto price feeds.
 * Provides real-time bid/ask updates for BTC and ETH.
 */

import { logger, LogCategory } from '@/lib/logger';
import { WEBSOCKET_CONFIG, getKrakenSymbol, getPlatformSymbol } from '@/config/websocket-config';

export interface KrakenTickData {
  symbol: string;
  bid: number;
  ask: number;
  last: number;
  volume: number;
  timestamp: Date;
  source: 'kraken-ws';
}

type TickCallback = (tick: KrakenTickData) => void;
type StatusCallback = (status: KrakenConnectionStatus) => void;

export interface KrakenConnectionStatus {
  connected: boolean;
  subscribedSymbols: string[];
  lastTickTime: Date | null;
  tickCount: number;
  errorCount: number;
  reconnectAttempts: number;
}

// Kraken v1 API: Ticker data format [channelID, tickerData, "ticker", "PAIR"]
// tickerData structure:
// a: [ask_price, ask_whole_lot_volume, ask_lot_volume]
// b: [bid_price, bid_whole_lot_volume, bid_lot_volume]
// c: [last_price, last_volume]
// v: [volume_today, volume_24h]
// etc.

class KrakenWebSocketClient {
  private ws: WebSocket | null = null;
  private tickCallbacks: Set<TickCallback> = new Set();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private reconnectDelay = WEBSOCKET_CONFIG.kraken.reconnectDelayMs;
  private isIntentionallyClosed = false;

  private status: KrakenConnectionStatus = {
    connected: false,
    subscribedSymbols: [],
    lastTickTime: null,
    tickCount: 0,
    errorCount: 0,
    reconnectAttempts: 0,
  };

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      logger.debug(LogCategory.PRICE, '[KrakenWS] Already connected');
      return;
    }

    this.isIntentionallyClosed = false;
    this.createConnection();
  }

  private createConnection(): void {
    try {
      logger.info(LogCategory.PRICE, '[KrakenWS] Connecting to Kraken WebSocket v2...');

      this.ws = new WebSocket(WEBSOCKET_CONFIG.kraken.url);

      this.ws.onopen = () => {
        logger.info(LogCategory.PRICE, '[KrakenWS] Connected successfully');
        this.status.connected = true;
        this.status.reconnectAttempts = 0;
        this.reconnectDelay = WEBSOCKET_CONFIG.kraken.reconnectDelayMs;
        this.notifyStatusChange();
        this.subscribeToSymbols();
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data);
      };

      this.ws.onerror = (error) => {
        logger.error(LogCategory.PRICE, '[KrakenWS] WebSocket error:', error);
        this.status.errorCount++;
        this.notifyStatusChange();
      };

      this.ws.onclose = (event) => {
        logger.warn(LogCategory.PRICE, `[KrakenWS] Connection closed: ${event.code} ${event.reason}`);
        this.status.connected = false;
        this.status.subscribedSymbols = [];
        this.stopHeartbeat();
        this.notifyStatusChange();

        if (!this.isIntentionallyClosed) {
          this.scheduleReconnect();
        }
      };
    } catch (error) {
      logger.error(LogCategory.PRICE, '[KrakenWS] Failed to create connection:', error);
      this.status.errorCount++;
      this.scheduleReconnect();
    }
  }

  private subscribeToSymbols(): void {
    const krakenSymbols = WEBSOCKET_CONFIG.kraken.symbols
      .map(s => getKrakenSymbol(s))
      .filter((s): s is string => s !== null);

    if (krakenSymbols.length === 0) {
      logger.warn(LogCategory.PRICE, '[KrakenWS] No symbols to subscribe to');
      return;
    }

    // Kraken v1 API subscription format
    const subscribeMessage = {
      event: 'subscribe',
      pair: krakenSymbols,
      subscription: {
        name: 'ticker',
      },
    };

    logger.info(LogCategory.PRICE, `[KrakenWS] Subscribing to: ${krakenSymbols.join(', ')}`);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      // v1 API: Handle subscription confirmations (object format)
      if (message.event === 'subscriptionStatus' && message.status === 'subscribed') {
        const platformSymbol = getPlatformSymbol(message.pair);
        if (platformSymbol && !this.status.subscribedSymbols.includes(platformSymbol)) {
          this.status.subscribedSymbols.push(platformSymbol);
          logger.info(LogCategory.PRICE, `[KrakenWS] Subscribed to ${platformSymbol}`);
          this.notifyStatusChange();
        }
        return;
      }

      // v1 API: Handle heartbeat
      if (message.event === 'heartbeat') {
        return;
      }

      // v1 API: Handle system status
      if (message.event === 'systemStatus') {
        logger.debug(LogCategory.PRICE, `[KrakenWS] System status: ${message.status}`);
        return;
      }

      // v1 API: Ticker data comes in array format [channelID, data, "ticker", "PAIR"]
      if (Array.isArray(message) && message[2] === 'ticker') {
        this.processV1TickerData(message);
        return;
      }

      // Handle errors
      if (message.errorMessage) {
        logger.error(LogCategory.PRICE, '[KrakenWS] Error:', message.errorMessage);
        this.status.errorCount++;
        this.notifyStatusChange();
      }
    } catch (error) {
      logger.error(LogCategory.PRICE, '[KrakenWS] Failed to parse message:', error);
    }
  }

  private processV1TickerData(message: unknown[]): void {
    // message format: [channelID, data, "ticker", "PAIR"]
    const tickerData = message[1] as {
      a: [string, string, string];  // ask [price, whole lot volume, lot volume]
      b: [string, string, string];  // bid [price, whole lot volume, lot volume]
      c: [string, string];           // last trade [price, volume]
      v: [string, string];           // volume [today, 24h]
      h?: [string, string];          // high [today, 24h]
      l?: [string, string];          // low [today, 24h]
    };
    const krakenPair = message[3] as string;

    const platformSymbol = getPlatformSymbol(krakenPair);
    if (!platformSymbol) {
      return;
    }

    const bid = parseFloat(tickerData.b[0]);
    const ask = parseFloat(tickerData.a[0]);
    const last = parseFloat(tickerData.c[0]);
    const volume = parseFloat(tickerData.v[0]);

    // Validate parsed numbers
    if (isNaN(bid) || isNaN(ask) || isNaN(last)) {
      logger.warn(LogCategory.PRICE, `[KrakenWS] Invalid ticker data for ${platformSymbol}`);
      return;
    }

    const tickData: KrakenTickData = {
      symbol: platformSymbol,
      bid,
      ask,
      last,
      volume,
      timestamp: new Date(),
      source: 'kraken-ws',
    };

    this.status.tickCount++;
    this.status.lastTickTime = tickData.timestamp;

    this.tickCallbacks.forEach(callback => {
      try {
        callback(tickData);
      } catch (error) {
        logger.error(LogCategory.PRICE, '[KrakenWS] Tick callback error:', error);
      }
    });
  }

  private startHeartbeat(): void {
    // Kraken v1 API sends automatic heartbeats - no need to ping
    // Keep the heartbeat interval for monitoring connection health
    this.stopHeartbeat();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.status.reconnectAttempts++;
    logger.info(LogCategory.PRICE, `[KrakenWS] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.status.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.createConnection();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      WEBSOCKET_CONFIG.kraken.maxReconnectDelayMs
    );
  }

  disconnect(): void {
    logger.info(LogCategory.PRICE, '[KrakenWS] Disconnecting...');
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.status.connected = false;
    this.status.subscribedSymbols = [];
    this.notifyStatusChange();
  }

  onTick(callback: TickCallback): () => void {
    this.tickCallbacks.add(callback);
    return () => this.tickCallbacks.delete(callback);
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
        logger.error(LogCategory.PRICE, '[KrakenWS] Status callback error:', error);
      }
    });
  }

  getStatus(): KrakenConnectionStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const krakenWebSocketClient = new KrakenWebSocketClient();
