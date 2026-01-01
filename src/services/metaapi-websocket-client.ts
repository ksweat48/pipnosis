/**
 * MetaAPI WebSocket Client
 *
 * Connects to MetaAPI streaming API for real-time forex price feeds.
 * Uses the official MetaAPI JavaScript SDK for browser integration.
 */

import { logger, LogCategory } from '@/lib/logger';
import { WEBSOCKET_CONFIG } from '@/config/websocket-config';

export interface MetaApiTickData {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: Date;
  source: 'metaapi-ws';
}

type TickCallback = (tick: MetaApiTickData) => void;
type StatusCallback = (status: MetaApiConnectionStatus) => void;

export interface MetaApiConnectionStatus {
  connected: boolean;
  synchronized: boolean;
  subscribedSymbols: string[];
  lastTickTime: Date | null;
  tickCount: number;
  errorCount: number;
  reconnectAttempts: number;
}

interface QuoteListener {
  onSymbolPriceUpdated: (
    instanceIndex: string,
    price: {
      symbol: string;
      bid: number;
      ask: number;
      time: Date;
      brokerTime: string;
    }
  ) => void;
}

class MetaApiWebSocketClient {
  private metaApi: unknown = null;
  private account: unknown = null;
  private connection: unknown = null;
  private tickCallbacks: Set<TickCallback> = new Set();
  private statusCallbacks: Set<StatusCallback> = new Set();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectDelay = WEBSOCKET_CONFIG.metaapi.reconnectDelayMs;
  private isIntentionallyClosed = false;
  private isInitializing = false;

  private status: MetaApiConnectionStatus = {
    connected: false,
    synchronized: false,
    subscribedSymbols: [],
    lastTickTime: null,
    tickCount: 0,
    errorCount: 0,
    reconnectAttempts: 0,
  };

  async connect(): Promise<void> {
    if (this.status.connected || this.isInitializing) {
      logger.debug(LogCategory.PRICE, '[MetaApiWS] Already connected or initializing');
      return;
    }

    this.isIntentionallyClosed = false;
    this.isInitializing = true;

    try {
      await this.initializeAndConnect();
    } catch (error) {
      logger.error(LogCategory.PRICE, '[MetaApiWS] Connection failed:', error);
      this.status.errorCount++;
      this.isInitializing = false;
      this.scheduleReconnect();
    }
  }

  private async initializeAndConnect(): Promise<void> {
    logger.info(LogCategory.PRICE, '[MetaApiWS] Initializing MetaAPI SDK...');

    const token = await this.fetchMetaApiToken();
    if (!token) {
      throw new Error('Failed to fetch MetaAPI token');
    }

    const accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID;
    if (!accountId) {
      throw new Error('VITE_METAAPI_ACCOUNT_ID not configured');
    }

    const MetaApi = await this.loadMetaApiSdk();
    if (!MetaApi) {
      throw new Error('Failed to load MetaAPI SDK');
    }

    this.metaApi = new MetaApi(token, {
      application: 'pipnosis-browser',
      domain: 'agiliumtrade.agiliumtrade.ai',
      requestTimeout: 60000,
    });

    logger.info(LogCategory.PRICE, '[MetaApiWS] Getting streaming account...');

    const metatraderAccount = await (this.metaApi as { metatraderAccountApi: { getAccount: (id: string) => Promise<unknown> } })
      .metatraderAccountApi.getAccount(accountId);

    this.account = metatraderAccount;

    const streamingConnection = await (metatraderAccount as { getStreamingConnection: () => Promise<unknown> })
      .getStreamingConnection();

    this.connection = streamingConnection;

    this.setupQuoteListener();

    logger.info(LogCategory.PRICE, '[MetaApiWS] Connecting to streaming API...');
    await (streamingConnection as { connect: () => Promise<void> }).connect();

    logger.info(LogCategory.PRICE, '[MetaApiWS] Waiting for synchronization...');
    await (streamingConnection as { waitSynchronized: (opts: { timeoutInSeconds: number }) => Promise<void> })
      .waitSynchronized({ timeoutInSeconds: 300 });

    this.status.connected = true;
    this.status.synchronized = true;
    this.status.reconnectAttempts = 0;
    this.reconnectDelay = WEBSOCKET_CONFIG.metaapi.reconnectDelayMs;
    this.isInitializing = false;

    logger.info(LogCategory.PRICE, '[MetaApiWS] Connected and synchronized');
    this.notifyStatusChange();

    await this.subscribeToSymbols();
  }

  private async loadMetaApiSdk(): Promise<unknown> {
    try {
      const module = await import('metaapi.cloud-sdk');
      return module.default || module;
    } catch (error) {
      logger.error(LogCategory.PRICE, '[MetaApiWS] Failed to load MetaAPI SDK:', error);
      return null;
    }
  }

  private async fetchMetaApiToken(): Promise<string | null> {
    try {
      const response = await fetch('/.netlify/functions/get-metaapi-token');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      if (!data.success || !data.token) {
        throw new Error('Invalid token response');
      }
      return data.token;
    } catch (error) {
      logger.error(LogCategory.PRICE, '[MetaApiWS] Failed to fetch token:', error);
      return null;
    }
  }

  private setupQuoteListener(): void {
    if (!this.connection) return;

    const listener: QuoteListener = {
      onSymbolPriceUpdated: (_instanceIndex, price) => {
        if (!WEBSOCKET_CONFIG.metaapi.symbols.includes(price.symbol)) {
          return;
        }

        const tickData: MetaApiTickData = {
          symbol: price.symbol,
          bid: price.bid,
          ask: price.ask,
          timestamp: price.time,
          source: 'metaapi-ws',
        };

        this.status.tickCount++;
        this.status.lastTickTime = tickData.timestamp;

        this.tickCallbacks.forEach(callback => {
          try {
            callback(tickData);
          } catch (error) {
            logger.error(LogCategory.PRICE, '[MetaApiWS] Tick callback error:', error);
          }
        });
      },
    };

    (this.connection as { addSynchronizationListener: (listener: QuoteListener) => void })
      .addSynchronizationListener(listener);
  }

  private async subscribeToSymbols(): Promise<void> {
    if (!this.connection) return;

    for (const symbol of WEBSOCKET_CONFIG.metaapi.symbols) {
      try {
        await (this.connection as { subscribeToMarketData: (symbol: string, subscriptions?: unknown[]) => Promise<void> })
          .subscribeToMarketData(symbol, [{ type: 'quotes' }]);

        if (!this.status.subscribedSymbols.includes(symbol)) {
          this.status.subscribedSymbols.push(symbol);
        }
        logger.info(LogCategory.PRICE, `[MetaApiWS] Subscribed to ${symbol}`);
      } catch (error) {
        logger.error(LogCategory.PRICE, `[MetaApiWS] Failed to subscribe to ${symbol}:`, error);
      }
    }

    this.notifyStatusChange();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.status.reconnectAttempts++;
    logger.info(LogCategory.PRICE, `[MetaApiWS] Reconnecting in ${this.reconnectDelay}ms (attempt ${this.status.reconnectAttempts})`);

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);

    this.reconnectDelay = Math.min(
      this.reconnectDelay * 2,
      WEBSOCKET_CONFIG.metaapi.maxReconnectDelayMs
    );
  }

  async disconnect(): Promise<void> {
    logger.info(LogCategory.PRICE, '[MetaApiWS] Disconnecting...');
    this.isIntentionallyClosed = true;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    try {
      if (this.connection) {
        await (this.connection as { close: () => Promise<void> }).close();
      }
    } catch (error) {
      logger.error(LogCategory.PRICE, '[MetaApiWS] Error closing connection:', error);
    }

    this.connection = null;
    this.account = null;
    this.status.connected = false;
    this.status.synchronized = false;
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
        logger.error(LogCategory.PRICE, '[MetaApiWS] Status callback error:', error);
      }
    });
  }

  getStatus(): MetaApiConnectionStatus {
    return { ...this.status };
  }

  isConnected(): boolean {
    return this.status.connected && this.status.synchronized;
  }
}

export const metaApiWebSocketClient = new MetaApiWebSocketClient();
