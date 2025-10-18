import MetaApi, { MetatraderAccount } from 'metaapi.cloud-sdk';
import { errorHandler } from '@/lib/error-handler';
import { metaApiTokenManager } from './metaapi-token-manager';

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

interface RequestQueueItem {
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  symbol: string;
  timeframe: string;
  retryCount: number;
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
  private region: string;
  private synchronizationListeners: Map<string, MarketDataListener> = new Map();
  private isListenerRegistered = false;
  private isDemoMode = false;
  private isDataOnlyMode = false;
  private latestPrices: Map<string, { bid: number; ask: number; timestamp: number }> = new Map();
  private readonly PRICE_CACHE_TTL = 60000;

  private requestQueue: RequestQueueItem[] = [];
  private isProcessingQueue = false;
  private readonly MAX_CONCURRENT_REQUESTS = 2;
  private activeRequests = 0;
  private readonly REQUEST_DELAY_MS = 600;
  private readonly MAX_RETRIES = 3;
  private candleCache: Map<string, { data: CandleData[]; timestamp: number }> = new Map();
  private readonly CANDLE_CACHE_TTL = {
    'H1': 1800000,
    'M5': 120000,
    'M1': 30000,
    'M15': 300000,
    'M30': 600000,
    'H4': 3600000,
    'D1': 7200000,
    'W1': 14400000,
    'MN1': 28800000
  };
  private lastRateLimitTime: number = 0;
  private rateLimitCooldownMs = 60000;

  constructor() {
    this.token = import.meta.env.VITE_METAAPI_TOKEN || '';
    this.accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID || '';
    this.region = import.meta.env.VITE_METAAPI_REGION || 'new-york';

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
      console.log(`Region: ${this.region}`);
      console.log(`Account ID: ${this.accountId}`);

      // Fetch secure token from edge function
      let secureToken: string;
      try {
        secureToken = await metaApiTokenManager.getToken(this.accountId, this.region);
      } catch (tokenError) {
        const tokenErrorMsg = tokenError instanceof Error ? tokenError.message : 'Unknown error';

        if (tokenErrorMsg.includes('SSL') || tokenErrorMsg.includes('certificate') || tokenErrorMsg.includes('ERR_CERT')) {
          throw new Error(
            'SSL Certificate Validation Error\n\n' +
            'Unable to establish a secure connection to MetaAPI Token Service.\n\n' +
            'Possible causes:\n' +
            '• SSL certificate validation failed for MetaAPI endpoints\n' +
            '• System date/time is incorrect\n' +
            '• Network security policies are blocking HTTPS connections\n' +
            '• Browser or system CA certificates need updating\n\n' +
            'Please verify your system settings and network configuration.'
          );
        }

        if (tokenErrorMsg.includes('502') || tokenErrorMsg.includes('Failed to generate')) {
          throw new Error(
            'MetaAPI Token Service Error\n\n' +
            'Unable to generate a secure token from MetaAPI.\n\n' +
            'Possible causes:\n' +
            '• MetaAPI admin token is invalid or expired\n' +
            '• MetaAPI account does not exist or is not accessible\n' +
            '• Region mismatch between configuration and account\n\n' +
            'Please verify your MetaAPI configuration and account status.'
          );
        }

        throw new Error(`Token fetch failed: ${tokenErrorMsg}`);
      }

      this.api = new MetaApi(secureToken, {
        application: 'Pipnosis',
        domain: `${this.region}.metaapi.cloud`,
        enableLatencyMonitor: false,
        requestTimeout: 60000,
        connectTimeout: 60000
      });

      try {
        this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);
      } catch (apiError) {
        const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';

        if (errorHandler.isSSLCertificateError(apiError)) {
          console.warn('⚠️ SSL Certificate error on MetaAPI account endpoint (server-side issue)');
          console.log('📊 Continuing in data-only mode - candle fetching available, account management unavailable');
          errorHandler.handleMetaApiError(apiError, 'Account Fetch');

          this.isDataOnlyMode = true;
          this.isInitialized = true;
          this.isInitializing = false;
          this.initializationError = null;

          console.log('✅ MetaApi initialized in data-only mode (SSL cert issue on account API)');
          console.log('🔍 Live candle data fetching is available via cached token');
          return;
        }

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
      console.log(`Account region: ${this.account.region}`);
      console.log(`Broker server: ${this.account.server || 'Unknown'}`);

      if (this.account.region && this.account.region !== this.region) {
        throw new Error(
          `Region mismatch: Account is in '${this.account.region}' region but SDK is configured for '${this.region}'. ` +
          `Please set VITE_METAAPI_REGION=${this.account.region} in your .env file.`
        );
      }

      const deployedStates = ['DEPLOYED', 'DEPLOYING'];
      if (!deployedStates.includes(this.account.state)) {
        console.log('⚠️ Account is not deployed. Current state:', this.account.state);
        console.log('Attempting to deploy account...');
        try {
          await this.account.deploy();
          console.log('✓ Account deployment initiated');
        } catch (deployError) {
          const deployMessage = deployError instanceof Error ? deployError.message : 'Unknown error';
          throw new Error(`Account deployment failed: ${deployMessage}. Please deploy your account manually in the MetaAPI dashboard.`);
        }
      }

      console.log('Waiting for account deployment...');
      try {
        await this.account.waitDeployed({ timeoutInSeconds: 300, intervalInMilliseconds: 1000 });
        console.log('✓ Account deployed successfully');
      } catch (waitError) {
        const waitMessage = waitError instanceof Error ? waitError.message : 'Unknown error';
        throw new Error(
          `Account deployment timeout: ${waitMessage}. ` +
          `Please ensure your account is deployed and connected to broker in the MetaAPI dashboard.`
        );
      }

      console.log('Getting streaming connection...');
      this.connection = this.account.getStreamingConnection();

      if (!this.connection) {
        throw new Error('Failed to get streaming connection from MetaApi account');
      }

      console.log(`Connecting to streaming endpoint at ${this.region}.metaapi.cloud...`);
      try {
        await this.connection.connect();
        console.log('✓ Connected to streaming endpoint');
      } catch (connectError) {
        if (errorHandler.isNetworkError(connectError) || errorHandler.isMetaApiError(connectError)) {
          errorHandler.handleMetaApiError(connectError, 'Streaming Connect');
          this.isDemoMode = true;
          throw new Error('MetaAPI streaming unavailable. Using demo mode.');
        }
        const errorMessage = connectError instanceof Error ? connectError.message : 'Unknown error';
        console.error('Connection error:', errorMessage);

        if (errorMessage.includes('not connected to broker') || errorMessage.includes('region')) {
          throw new Error(
            `MetaAPI connection failed: ${errorMessage}. ` +
            `Please check: 1) Account is deployed and connected to broker in MetaAPI dashboard, ` +
            `2) Correct region is set (current: ${this.region}). ` +
            `Available regions: new-york, london, singapore.`
          );
        }

        throw new Error(`Failed to connect to MetaApi streaming endpoint: ${errorMessage}`);
      }

      console.log('Waiting for synchronization...');
      try {
        await this.connection.waitSynchronized({ timeoutInSeconds: 300 });
        console.log('✓ Synchronization completed');
      } catch (syncError) {
        const syncMessage = syncError instanceof Error ? syncError.message : 'Unknown error';

        if (syncMessage.includes('TimeoutError') || syncMessage.includes('not connected to broker')) {
          throw new Error(
            `Synchronization failed: ${syncMessage}. ` +
            `This usually means the account is not properly connected to the broker. ` +
            `Please verify in MetaAPI dashboard that your account shows 'Connected' status.`
          );
        }

        console.warn('⚠️ Synchronization timeout, attempting to continue:', syncError);
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
      if (errorMessage.includes('Region mismatch')) {
        throw error;
      } else if (errorMessage.includes('ERR_NETWORK') || errorMessage.includes('CSP') || errorMessage.includes('ERR_QUIC')) {
        throw new Error('Network connection blocked. MetaApi requires WebSocket connectivity. Please check your network and firewall settings.');
      } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('401') || errorMessage.includes('Invalid MetaApi')) {
        throw new Error('Invalid MetaApi credentials. Please check your token and account ID in environment variables.');
      } else if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('TimeoutError')) {
        throw new Error(
          `Connection timeout: ${errorMessage}. ` +
          `Please check: 1) Your account is deployed in MetaAPI dashboard, ` +
          `2) Account is connected to broker, 3) Network connectivity is stable.`
        );
      } else if (errorMessage.includes('not connected to broker') || errorMessage.includes('broker yet')) {
        throw new Error(
          `Broker connection error: ${errorMessage}. ` +
          `Your MetaAPI account needs to be connected to a broker. ` +
          `Please check MetaAPI dashboard and ensure: 1) Account is deployed, ` +
          `2) Broker credentials are correct, 3) Region matches (current: ${this.region}).`
        );
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

    if (this.isDataOnlyMode) {
      if (!this.api) {
        throw new Error('MetaApi not initialized');
      }
    } else if (!this.account) {
      throw new Error('MetaApi account not initialized');
    }

    const cacheKey = `${symbol}-${timeframe}-${limit}`;
    const cached = this.candleCache.get(cacheKey);
    const cacheTTL = this.CANDLE_CACHE_TTL[timeframe] || 60000;

    if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
      console.log(`✓ Using cached candles for ${symbol} ${timeframe} (age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.data;
    }

    return this.queueRequest(async () => {
      try {
        const endTime = new Date();
        const calculatedStartTime = startTime || this.calculateStartTime(timeframe, limit, endTime);
        const apiTimeframe = this.convertToApiTimeframe(timeframe);

        console.log(`Fetching historical candles: ${symbol} ${timeframe} (API: ${apiTimeframe})`);
        console.log(`Time range: ${calculatedStartTime.toISOString()} to ${endTime.toISOString()}`);

        let candles;
        if (this.isDataOnlyMode) {
          console.log('📊 Using direct API call (data-only mode)');
          candles = await this.api!.metatraderAccountApi.getHistoricalMarketData(
            this.accountId,
            symbol,
            apiTimeframe,
            calculatedStartTime,
            limit
          );
        } else {
          candles = await this.account!.getHistoricalCandles(
            symbol,
            apiTimeframe,
            calculatedStartTime,
            limit
          );
        }

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

        this.candleCache.set(cacheKey, {
          data: mappedCandles,
          timestamp: Date.now()
        });

        console.log(`✓ Received ${mappedCandles.length} candles for ${symbol} ${timeframe}`);
        return mappedCandles;
      } catch (error: any) {
        if (this.isRateLimitError(error)) {
          throw new Error(`RATE_LIMIT:${symbol}:${timeframe}`);
        }
        console.error(`Failed to fetch historical candles for ${symbol} ${timeframe}:`, error);
        throw error;
      }
    }, symbol, timeframe, 0);
  }

  private isRateLimitError(error: any): boolean {
    if (!error) return false;
    const errorStr = error.toString().toLowerCase();
    const message = error.message?.toLowerCase() || '';
    return errorStr.includes('429') ||
           errorStr.includes('too many requests') ||
           message.includes('429') ||
           message.includes('too many requests') ||
           error.status === 429 ||
           error.statusCode === 429;
  }

  private async queueRequest<T>(
    execute: () => Promise<T>,
    symbol: string,
    timeframe: string,
    retryCount: number
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({
        execute,
        resolve,
        reject,
        symbol,
        timeframe,
        retryCount
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0 && this.activeRequests < this.MAX_CONCURRENT_REQUESTS) {
      const timeSinceLastRateLimit = Date.now() - this.lastRateLimitTime;
      if (timeSinceLastRateLimit < this.rateLimitCooldownMs) {
        const waitTime = this.rateLimitCooldownMs - timeSinceLastRateLimit;
        console.log(`⏳ Rate limit cooldown active. Waiting ${Math.round(waitTime / 1000)}s before next request...`);
        await this.delay(waitTime);
      }

      const item = this.requestQueue.shift();
      if (!item) break;

      this.activeRequests++;

      this.executeRequest(item)
        .finally(() => {
          this.activeRequests--;
          this.processQueue();
        });

      await this.delay(this.REQUEST_DELAY_MS);
    }

    this.isProcessingQueue = false;
  }

  private async executeRequest(item: RequestQueueItem): Promise<void> {
    try {
      const result = await item.execute();
      item.resolve(result);
    } catch (error: any) {
      if (this.isRateLimitError(error) && item.retryCount < this.MAX_RETRIES) {
        this.lastRateLimitTime = Date.now();
        const backoffDelay = Math.min(30000 * Math.pow(2, item.retryCount), 120000);

        console.warn(`⚠️ Rate limit hit for ${item.symbol} ${item.timeframe}. Retry ${item.retryCount + 1}/${this.MAX_RETRIES} in ${backoffDelay / 1000}s`);

        await this.delay(backoffDelay);

        this.requestQueue.unshift({
          ...item,
          retryCount: item.retryCount + 1
        });

        this.processQueue();
      } else {
        item.reject(error);
      }
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  isInRateLimitCooldown(): boolean {
    return (Date.now() - this.lastRateLimitTime) < this.rateLimitCooldownMs;
  }

  getRateLimitCooldownRemaining(): number {
    const remaining = this.rateLimitCooldownMs - (Date.now() - this.lastRateLimitTime);
    return Math.max(0, remaining);
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
          // Cache the latest price for each symbol
          self.latestPrices.set(price.symbol, {
            bid: price.bid,
            ask: price.ask,
            timestamp: Date.now()
          });

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

    // Check if we have a recent cached price from streaming data
    const cachedPrice = this.latestPrices.get(symbol);
    if (cachedPrice && (Date.now() - cachedPrice.timestamp) < this.PRICE_CACHE_TTL) {
      console.log(`Using cached price for ${symbol}: bid=${cachedPrice.bid}, ask=${cachedPrice.ask}`);
      return {
        bid: cachedPrice.bid,
        ask: cachedPrice.ask
      };
    }

    // If no cached price, try to get from terminal state
    try {
      if (this.connection && this.connection.terminalState) {
        const price = this.connection.terminalState.price(symbol);
        if (price && price.bid && price.ask) {
          // Cache it for future use
          this.latestPrices.set(symbol, {
            bid: price.bid,
            ask: price.ask,
            timestamp: Date.now()
          });
          console.log(`Got price from terminal state for ${symbol}: bid=${price.bid}, ask=${price.ask}`);
          return {
            bid: price.bid,
            ask: price.ask
          };
        }
      }
    } catch (error) {
      console.warn(`Failed to get price from terminal state for ${symbol}:`, error);
    }

    // Last resort: subscribe to market data and wait for first price update
    console.log(`Subscribing to ${symbol} to get current price...`);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for ${symbol} price`));
      }, 10000);

      const priceListener = {
        onTick: (tick: TickData) => {
          if (tick.symbol === symbol) {
            clearTimeout(timeout);
            this.unsubscribeFromMarketData(symbol).catch(console.error);
            resolve({
              bid: tick.bid,
              ask: tick.ask
            });
          }
        }
      };

      this.subscribeToMarketData(symbol, priceListener).catch(error => {
        clearTimeout(timeout);
        reject(error);
      });
    });
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
    return this.isInitialized && (this.connection !== null || this.isDataOnlyMode);
  }

  getConnectionStatus(): {
    isConnected: boolean;
    isDemoMode: boolean;
    isDataOnlyMode: boolean;
    hasCredentials: boolean;
    initializationError: string | null;
    accountState: string | null;
    region: string;
  } {
    return {
      isConnected: this.isInitialized && (this.connection !== null || this.isDataOnlyMode),
      isDemoMode: this.isDemoMode,
      isDataOnlyMode: this.isDataOnlyMode,
      hasCredentials: !!(this.token && this.accountId),
      initializationError: this.initializationError?.message || null,
      accountState: this.account?.state || null,
      region: this.region
    };
  }

  async testConnection(): Promise<{
    success: boolean;
    stage: string;
    message: string;
    details?: any;
  }> {
    try {
      if (this.isDemoMode || errorHandler.isWebContainerEnvironment()) {
        return {
          success: false,
          stage: 'environment',
          message: 'Running in WebContainer environment - MetaAPI disabled'
        };
      }

      if (!this.token || !this.accountId) {
        return {
          success: false,
          stage: 'credentials',
          message: 'MetaAPI credentials not configured. Please set VITE_METAAPI_TOKEN and VITE_METAAPI_ACCOUNT_ID in your .env file',
          details: {
            hasToken: !!this.token,
            hasAccountId: !!this.accountId,
            region: this.region
          }
        };
      }

      if (this.isInitialized && this.connection) {
        console.log('✅ Connection already established');
        return {
          success: true,
          stage: 'complete',
          message: 'MetaAPI is already connected and ready.',
          details: {
            state: this.account?.state,
            region: this.account?.region,
            server: this.account?.server || 'Unknown'
          }
        };
      }

      console.log('🔍 Testing MetaAPI connection...');
      console.log(`   Region: ${this.region}`);
      console.log(`   Account ID: ${this.accountId}`);

      let secureToken: string;
      try {
        secureToken = await metaApiTokenManager.getToken(this.accountId, this.region);
      } catch (tokenError) {
        return {
          success: false,
          stage: 'token_fetch',
          message: `Failed to load MetaAPI token: ${tokenError instanceof Error ? tokenError.message : 'Unknown error'}`,
          details: { error: tokenError }
        };
      }

      const testApi = new MetaApi(secureToken, {
        application: 'Pipnosis',
        domain: `${this.region}.metaapi.cloud`,
        enableLatencyMonitor: false,
        requestTimeout: 30000,
        connectTimeout: 30000
      });

      let testAccount;
      try {
        testAccount = await testApi.metatraderAccountApi.getAccount(this.accountId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          stage: 'account_fetch',
          message: `Failed to fetch account: ${errorMessage}`,
          details: { error: errorMessage }
        };
      }

      const accountInfo = {
        state: testAccount.state,
        region: testAccount.region,
        server: testAccount.server || 'Unknown'
      };

      console.log('✓ Account fetched successfully:', accountInfo);

      if (testAccount.region && testAccount.region !== this.region) {
        return {
          success: false,
          stage: 'region_mismatch',
          message: `Region mismatch: Account is in '${testAccount.region}' but SDK configured for '${this.region}'. Update VITE_METAAPI_REGION=${testAccount.region}`,
          details: accountInfo
        };
      }

      const deployedStates = ['DEPLOYED', 'DEPLOYING'];
      if (!deployedStates.includes(testAccount.state)) {
        return {
          success: false,
          stage: 'account_state',
          message: `Account is not deployed. Current state: ${testAccount.state}. Please deploy your account in the MetaAPI dashboard.`,
          details: accountInfo
        };
      }

      return {
        success: true,
        stage: 'complete',
        message: 'Connection test passed. MetaAPI is ready.',
        details: accountInfo
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        stage: 'unknown',
        message: `Connection test failed: ${errorMessage}`,
        details: { error: errorMessage }
      };
    }
  }

  async forceReconnect(): Promise<void> {
    console.log('🔄 Force reconnecting to MetaAPI...');

    this.isInitialized = false;
    this.isInitializing = false;
    this.initializationError = null;
    this.isDemoMode = false;

    if (this.connection) {
      try {
        await this.connection.close();
      } catch (error) {
        console.warn('Error closing existing connection:', error);
      }
      this.connection = null;
    }

    this.api = null;
    this.account = null;

    console.log('🔄 Attempting fresh initialization...');
    await this.initialize();
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
