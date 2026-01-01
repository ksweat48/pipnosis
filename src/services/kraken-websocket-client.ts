/**
 * Kraken WebSocket Client
 *
 * Connects to Kraken WebSocket v2 API for real-time crypto price feeds.
 * Provides 10-100 ticks per second for BTC and ETH.
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

interface KrakenTickerMessage {
  channel: 'ticker';
  type: 'snapshot' | 'update';
  data: Array<{
    symbol: string;
    bid: number;
    bid_qty: number;
    ask: number;
    ask_qty: number;
    last: number;
    volume: number;
    vwap: number;
    low: number;
    high: number;
    change: number;
    change_pct: number;
  }>;
}

interface KrakenSubscribeResponse {
  method: 'subscribe';
  result: {
    channel: string;
    symbol: string;
    snapshot: boolean;
  };
  success: boolean;
  time_in: string;
  time_out: string;
}

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

    const subscribeMessage = {
      method: 'subscribe',
      params: {
        channel: 'ticker',
        symbol: krakenSymbols,
        event_trigger: 'trades',
        snapshot: true,
      },
    };

    logger.info(LogCategory.PRICE, `[KrakenWS] Subscribing to: ${krakenSymbols.join(', ')}`);
    this.ws?.send(JSON.stringify(subscribeMessage));
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data);

      if (message.method === 'subscribe' && message.success) {
        const response = message as KrakenSubscribeResponse;
        const platformSymbol = getPlatformSymbol(response.result.symbol);
        if (platformSymbol && !this.status.subscribedSymbols.includes(platformSymbol)) {
          this.status.subscribedSymbols.push(platformSymbol);
          logger.info(LogCategory.PRICE, `[KrakenWS] Subscribed to ${platformSymbol}`);
          this.notifyStatusChange();
        }
        return;
      }

      if (message.channel === 'ticker' && message.data) {
        const tickerMessage = message as KrakenTickerMessage;
        this.processTickerData(tickerMessage);
        return;
      }

      if (message.channel === 'heartbeat') {
        return;
      }

      if (message.error) {
        logger.error(LogCategory.PRICE, '[KrakenWS] Error message:', message.error);
        this.status.errorCount++;
        this.notifyStatusChange();
      }
    } catch (error) {
      logger.error(LogCategory.PRICE, '[KrakenWS] Failed to parse message:', error);
    }
  }

  private processTickerData(message: KrakenTickerMessage): void {
    for (const ticker of message.data) {
      const platformSymbol = getPlatformSymbol(ticker.symbol);
      if (!platformSymbol) {
        continue;
      }

      const tickData: KrakenTickData = {
        symbol: platformSymbol,
        bid: ticker.bid,
        ask: ticker.ask,
        last: ticker.last,
        volume: ticker.volume,
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
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ method: 'ping' }));
      }
    }, WEBSOCKET_CONFIG.kraken.heartbeatIntervalMs);
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
