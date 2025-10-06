import MetaApi, { MetatraderAccount } from 'metaapi.cloud-sdk';

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

class MetaApiService {
  private api: MetaApi | null = null;
  private account: MetatraderAccount | null = null;
  private connection: any = null;
  private isInitialized = false;
  private isInitializing = false;
  private initializationError: Error | null = null;
  private token: string;
  private accountId: string;

  constructor() {
    this.token = import.meta.env.VITE_METAAPI_TOKEN || '';
    this.accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID || '';
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
      const error = new Error('MetaApi credentials not configured. Please set VITE_METAAPI_TOKEN and VITE_METAAPI_ACCOUNT_ID in .env file');
      this.initializationError = error;
      throw error;
    }

    this.isInitializing = true;

    try {
      console.log('Initializing MetaApi connection...');
      this.api = new MetaApi(this.token);
      this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);

      console.log(`Account state: ${this.account.state}`);
      const deployedStates = ['DEPLOYED', 'DEPLOYING'];
      if (!deployedStates.includes(this.account.state)) {
        console.log('Deploying account...');
        await this.account.deploy();
      }

      console.log('Waiting for account deployment...');
      await this.account.waitDeployed();

      console.log('Getting streaming connection...');
      this.connection = this.account.getStreamingConnection();
      await this.connection.connect();
      await this.connection.waitSynchronized();

      this.isInitialized = true;
      this.isInitializing = false;
      this.initializationError = null;
      console.log('MetaApi initialized successfully with streaming connection');
    } catch (error) {
      this.isInitializing = false;
      this.initializationError = error as Error;
      console.error('Failed to initialize MetaApi:', error);

      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (errorMessage.includes('ERR_NETWORK') || errorMessage.includes('CSP')) {
        throw new Error('Network connection blocked. Please check Content Security Policy settings.');
      } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
        throw new Error('Invalid MetaApi credentials. Please check your token and account ID.');
      } else {
        throw new Error('Failed to connect to MetaApi. Please check your credentials and account status.');
      }
    }
  }

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime?: Date,
    limit: number = 500
  ): Promise<CandleData[]> {
    await this.ensureInitialized();

    if (!this.account) {
      throw new Error('MetaApi account not initialized');
    }

    try {
      const calculatedStartTime = startTime || this.calculateStartTime(timeframe, limit);
      const apiTimeframe = this.convertToApiTimeframe(timeframe);

      console.log(`Fetching historical candles: ${symbol} ${timeframe} (API: ${apiTimeframe})`);

      const candles = await this.account.getHistoricalCandles(
        symbol,
        apiTimeframe,
        calculatedStartTime,
        limit
      );

      return candles.map((candle: any) => ({
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
    } catch (error) {
      console.error(`Failed to fetch historical candles for ${symbol} ${timeframe}:`, error);
      throw error;
    }
  }

  async subscribeToMarketData(
    symbol: string,
    listener: {
      onCandleUpdate?: (candle: CandleData) => void;
      onTick?: (tick: TickData) => void;
    }
  ): Promise<void> {
    await this.ensureInitialized();

    if (!this.connection) {
      throw new Error('Connection not established');
    }

    try {
      if (typeof this.connection.subscribeToMarketData !== 'function') {
        console.error('Connection object:', this.connection);
        throw new Error('Invalid connection type: subscribeToMarketData method not available. Ensure streaming connection is used.');
      }

      console.log(`Subscribing to market data for ${symbol}...`);
      await this.connection.subscribeToMarketData(symbol);

      if (listener.onCandleUpdate) {
        this.connection.addSynchronizationListener({
          onCandlesUpdated: (instanceIndex: number, candles: any[]) => {
            candles.forEach(candle => {
              if (candle.symbol === symbol && listener.onCandleUpdate) {
                const internalTimeframe = candle.timeframe ?
                  this.convertFromApiTimeframe(candle.timeframe) :
                  'M15';

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
          }
        });
      }

      if (listener.onTick) {
        this.connection.addSynchronizationListener({
          onSymbolPricesUpdated: (instanceIndex: number, prices: any[]) => {
            prices.forEach(price => {
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
          }
        });
      }

      console.log(`Successfully subscribed to market data for ${symbol}`);
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
      await this.connection.unsubscribeFromMarketData(symbol);
      console.log(`Unsubscribed from market data for ${symbol}`);
    } catch (error) {
      console.error(`Failed to unsubscribe from market data for ${symbol}:`, error);
    }
  }

  async getSymbolPrice(symbol: string): Promise<{ bid: number; ask: number }> {
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

  private calculateStartTime(timeframe: Timeframe, limit: number): Date {
    const now = new Date();
    const minutes = this.timeframeToMinutes(timeframe);
    const totalMinutes = minutes * limit;
    return new Date(now.getTime() - totalMinutes * 60 * 1000);
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
