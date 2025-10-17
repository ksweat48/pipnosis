import MetaApi, { MetatraderAccount } from 'metaapi.cloud-sdk';
import { errorHandler } from '@/lib/error-handler';

export interface CandleData {
  symbol: string;
  timeframe: string;
  time: Date;
  brokerTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  tickVolume: number;
  spread: number;
  volume: number;
}

export interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  time: Date;
  brokerTime: string;
}

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1' | 'W1' | 'MN1';

type ApiTimeframe = '1m' | '2m' | '3m' | '4m' | '5m' | '6m' | '10m' | '12m' | '15m' | '20m' | '30m' | '1h' | '2h' | '3h' | '4h' | '6h' | '8h' | '12h' | '1d' | '1w' | '1mn';

interface MarketDataListener {
  onCandleUpdate?: (candle: CandleData) => void;
  onTick?: (tick: TickData) => void;
}

class MetaApiService {
  private api: MetaApi | null = null;
  private account: MetatraderAccount | null = null;
  private connection: any = null;
  private isInitialized = false;
  private isInitializing = false;
  private initializationError: Error | null = null;
  private token: string;
  private accountId: string;
  private synchronizationListeners: Map<string, MarketDataListener> = new Map();
  private isListenerRegistered = false;
  private isDemoMode = false;

  constructor() {
    this.token = import.meta.env.VITE_METAAPI_TOKEN || '';
    this.accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID || '';

    if (errorHandler.isWebContainerEnvironment()) {
      this.isDemoMode = true;
      console.info('🌐 Running in WebContainer environment - MetaAPI disabled, using demo mode');
    }
  }

  private convertToApiTimeframe(timeframe: Timeframe): ApiTimeframe {
    const conversionMap: Record<Timeframe, ApiTimeframe> = {
      M1: '1m',
      M5: '5m',
      M15: '15m',
      M30: '30m',
      H1: '1h',
      H4: '4h',
      D1: '1d',
      W1: '1w',
      MN1: '1mn'
    };
    return conversionMap[timeframe];
  }

  private convertFromApiTimeframe(apiTimeframe: string): Timeframe {
    const conversionMap: Record<string, Timeframe> = {
      '1m': 'M1',
      '5m': 'M5',
      '15m': 'M15',
      '30m': 'M30',
      '1h': 'H1',
      '4h': 'H4',
      '1d': 'D1',
      '1w': 'W1',
      '1mn': 'MN1'
    };
    return conversionMap[apiTimeframe] || 'M15';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (this.isDemoMode || errorHandler.isWebContainerEnvironment()) {
      const error = new Error('MetaAPI disabled in preview environment. Using demo mode.');
      this.initializationError = error;
      this.isDemoMode = true;
      return;
    }

    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (this.isInitialized) {
        return;
      }
      if (this.initializationError) {
        throw this.initializationError;
      }
    }

    if (!this.token || !this.accountId) {
      const error = new Error('MetaApi credentials not configured. App running in demo mode. Configure VITE_METAAPI_TOKEN and VITE_METAAPI_ACCOUNT_ID for live trading.');
      this.initializationError = error;
      this.isDemoMode = true;
      console.warn('⚠️ MetaApi not configured - running in demo mode with cached data only');
      throw error;
    }

    this.isInitializing = true;

    try {
      console.log('Initializing MetaApi connection...');
      this.api = new MetaApi(this.token, { enableLatencyMonitor: false });

      try {
        this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);
      } catch (apiError) {
        const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';
        if (errorHandler.isNetworkError(apiError) || errorHandler.isMetaApiError(apiError)) {
          errorHandler.handleMetaApiError(apiError, 'Account Fetch');
          this.isDemoMode = true;
          throw new Error('MetaAPI connection unavailable. Using demo mode.');
        }
        if (errorMessage.includes('ERR_NETWORK') || errorMessage.includes('Failed to fetch')) {
          throw new Error('Network connection failed. Unable to reach MetaApi servers. Check your internet connection or firewall settings.');
        }
        console.error('Failed to get MetaApi account:', errorMessage);
        throw new Error('Invalid MetaApi account ID or credentials. Please verify your configuration.');
      }

      console.log(`Account state: ${this.account.state}`);
      const deployedStates = ['DEPLOYED', 'DEPLOYING'];
      if (!deployedStates.includes(this.account.state)) {
        console.log('Deploying account...');
        try {
          await this.account.deploy();
        } catch (deployError) {
          console.warn('Account deployment failed, attempting to continue:', deployError);
        }
      }

      console.log('Waiting for account deployment...');
      try {
        await this.account.waitDeployed();
      } catch (waitError) {
        console.warn('Wait for deployment timeout, attempting to continue:', waitError);
      }

      console.log('Getting streaming connection...');
      this.connection = this.account.getStreamingConnection();

      if (!this.connection) {
        throw new Error('Failed to get streaming connection from MetaApi account');
      }

      console.log('Connecting to streaming endpoint...');
      try {
        await this.connection.connect();
      } catch (connectError) {
        if (errorHandler.isNetworkError(connectError) || errorHandler.isMetaApiError(connectError)) {
          errorHandler.handleMetaApiError(connectError, 'Streaming Connect');
          this.isDemoMode = true;
          throw new Error('MetaAPI streaming unavailable. Using demo mode.');
        }
        const errorMessage = connectError instanceof Error ? connectError.message : 'Unknown error';
        console.error('Connection error:', errorMessage);
        throw new Error('Failed to connect to MetaApi streaming endpoint. Please check your network connection.');
      }

      console.log('Waiting for synchronization...');
      try {
        await this.connection.waitSynchronized();
      } catch (syncError) {
        console.warn('Synchronization wait timeout, continuing with partial sync:', syncError);
      }

      this.isInitialized = true;
      this.isInitializing = false;
      this.initializationError = null;
      console.log('✅ MetaApi initialized successfully with streaming connection');
      console.log('Connection ready for live market data streaming');
    } catch (error) {
      this.isInitializing = false;
      this.initializationError = error as Error;
      console.error('Failed to initialize MetaApi:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('ERR_NETWORK') || errorMessage.includes('CSP') || errorMessage.includes('ERR_QUIC')) {
        throw new Error('Network connection blocked. MetaApi requires WebSocket connectivity. Please check your network and firewall settings.');
      } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('401') || errorMessage.includes('Invalid MetaApi')) {
        throw new Error('Invalid MetaApi credentials. Please check your token and account ID in environment variables.');
      } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
        throw new Error('Connection timeout. MetaApi servers may be temporarily unavailable.');
      } else {
        throw error;
      }
    }
  }

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime?: Date,
    limit: number = 500
  ): Promise<CandleData[]> {
    if (this.isDemoMode || this.initializationError) {
      throw this.initializationError || new Error('MetaApi not available in demo mode');
    }
    await this.ensureInitialized();

    if (!this.account) {
      throw new Error('MetaApi account not initialized');
    }

    try {
      const endTime = new Date();
      const calculatedStartTime = startTime || this.calculateStartTime(timeframe, limit, endTime);
      const apiTimeframe = this.convertToApiTimeframe(timeframe);

      console.log(`Fetching historical candles: ${symbol} ${timeframe} (API: ${apiTimeframe})`);
      console.log(`Time range: ${calculatedStartTime.toISOString()} to ${endTime.toISOString()}`);

      const candles = await this.account.getHistoricalCandles(
        symbol,
        apiTimeframe,
        calculatedStartTime,
        limit
      );

      const mappedCandles = candles.map((candle: any) => ({
        symbol,
        timeframe,
        time: new Date(candle.time),
        brokerTime: candle.brokerTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        tickVolume: candle.tickVolume || 0,
        spread: candle.spread || 0,
        volume: candle.volume || 0
      }));

      console.log(`Received ${mappedCandles.length} candles, latest: ${mappedCandles.length > 0 ? mappedCandles[mappedCandles.length - 1].time.toISOString() : 'none'}`);
      return mappedCandles;
    } catch (error) {
      console.error(`Failed to fetch historical candles for ${symbol} ${timeframe}:`, error);
      throw error;
    }
  }

  private createCompleteSynchronizationListener() {
    const self = this;
    return {
      async onConnected(instanceIndex: string, replicas: number) {
      },

      async onHealthStatus(instanceIndex: string, status: any) {
      },

      async onDisconnected(instanceIndex: string) {
      },

      async onBrokerConnectionStatusChanged(instanceIndex: string, connected: boolean) {
      },

      async onSynchronizationStarted(instanceIndex: string) {
      },

      async onAccountInformationUpdated(instanceIndex: string, accountInformation: any) {},

      async onPositionsReplaced(instanceIndex: string, positions: any[]) {},

      async onPositionsSynchronized(instanceIndex: string, synchronizationId: string) {},

      async onPendingOrdersReplaced(instanceIndex: string, orders: any[]) {},

      async onPendingOrdersSynchronized(instanceIndex: string, synchronizationId: string) {},

      async onHistoryOrderAdded(instanceIndex: string, historyOrder: any) {},

      async onHistoryOrdersSynchronized(instanceIndex: string, synchronizationId: string) {},

      async onDealAdded(instanceIndex: string, deal: any) {},

      async onDealsSynchronized(instanceIndex: string, synchronizationId: string) {},

      async onOrderUpdated(instanceIndex: string, order: any) {},

      async onOrderCompleted(instanceIndex: string, orderId: string) {},

      async onPositionUpdated(instanceIndex: string, position: any) {},

      async onPositionRemoved(instanceIndex: string, positionId: string) {},

      async onPendingOrderUpdated(instanceIndex: string, order: any) {},

      async onPendingOrderCompleted(instanceIndex: string, orderId: string) {},

      async onUpdate(instanceIndex: string, update: any) {},

      async onCandlesUpdated(instanceIndex: string, candles: any[]) {
        candles.forEach(candle => {
          self.synchronizationListeners.forEach((listener, symbol) => {
            if (candle.symbol === symbol && listener.onCandleUpdate) {
              const internalTimeframe = candle.timeframe ?
                self.convertFromApiTimeframe(candle.timeframe) :
                'M15';

              console.log(`📊 Candle update: ${symbol} ${internalTimeframe} @ ${candle.close}`);
              listener.onCandleUpdate({
                symbol: candle.symbol,
                timeframe: internalTimeframe,
                time: new Date(candle.time),
                brokerTime: candle.brokerTime,
                open: candle.open,
                high: candle.high,
                low: candle.low,
                close: candle.close,
                tickVolume: candle.tickVolume || 0,
                spread: candle.spread || 0,
                volume: candle.volume || 0
              });
            }
          });
        });
      },

      async onSymbolPricesUpdated(instanceIndex: string, prices: any[]) {
        prices.forEach(price => {
          self.synchronizationListeners.forEach((listener, symbol) => {
            if (price.symbol === symbol && listener.onTick) {
              listener.onTick({
                symbol: price.symbol,
                bid: price.bid,
                ask: price.ask,
                time: new Date(price.time),
                brokerTime: price.brokerTime
              });
            }
          });
        });
      },

      async onSymbolSpecificationUpdated(instanceIndex: string, specifications: any[]) {},

      async onSymbolSpecificationsUpdated(instanceIndex: string, specifications: any[], removedSymbols: string[]) {},

      async onSymbolPriceUpdated(instanceIndex: string, price: any) {},

      async onSubscriptionDowngraded(instanceIndex: string, symbol: string, updates: any[], unsubscriptions: any[]) {}
    };
  }

  async subscribeToMarketData(
    symbol: string,
    listener: MarketDataListener
  ): Promise<void> {
    if (this.isDemoMode || this.initializationError) {
      throw this.initializationError || new Error('MetaApi not available in demo mode');
    }
    await this.ensureInitialized();

    if (!this.connection) {
      throw new Error('Connection not established');
    }

    try {
      if (typeof this.connection.subscribeToMarketData !== 'function') {
        console.error('Connection object:', this.connection);
        throw new Error('Invalid connection type: subscribeToMarketData method not available. Ensure streaming connection is used.');
      }

      if (!this.isListenerRegistered) {
        const completeListener = this.createCompleteSynchronizationListener();
        this.connection.addSynchronizationListener(completeListener);
        this.isListenerRegistered = true;
      }

      this.synchronizationListeners.set(symbol, listener);

      await this.connection.subscribeToMarketData(symbol);
    } catch (error) {
      console.error(`Failed to subscribe to market data for ${symbol}:`, error);
      throw error;
    }
  }

  async unsubscribeFromMarketData(symbol: string): Promise<void> {
    if (!this.connection) {
      return;
    }

    try {
      this.synchronizationListeners.delete(symbol);
      await this.connection.unsubscribeFromMarketData(symbol);
      console.log(`Unsubscribed from market data for ${symbol}`);
    } catch (error) {
      console.error(`Failed to unsubscribe from market data for ${symbol}:`, error);
    }
  }

  async getSymbolPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    if (this.isDemoMode || this.initializationError) {
      throw this.initializationError || new Error('MetaApi not available in demo mode');
    }
    await this.ensureInitialized();

    try {
      const price = await this.connection.getSymbolPrice(symbol);
      return {
        bid: price.bid,
        ask: price.ask
      };
    } catch (error) {
      console.error(`Failed to get price for ${symbol}:`, error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      try {
        this.synchronizationListeners.clear();
        this.isListenerRegistered = false;
        await this.connection.close();
        this.connection = null;
        this.isInitialized = false;
        this.isInitializing = false;
        this.initializationError = null;
        console.log('MetaApi disconnected');
      } catch (error) {
        console.error('Error disconnecting MetaApi:', error);
      }
    }
  }

  isConnected(): boolean {
    return this.isInitialized && this.connection !== null;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  private calculateStartTime(timeframe: Timeframe, limit: number, endTime: Date = new Date()): Date {
    const minutes = this.timeframeToMinutes(timeframe);
    const totalMinutes = minutes * limit;
    return new Date(endTime.getTime() - totalMinutes * 60 * 1000);
  }

  private timeframeToMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080,
      MN1: 43200
    };
    return map[timeframe] || 15;
  }
}

export const metaApiService = new MetaApiService();
