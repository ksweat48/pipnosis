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

class MetaApiService {
  private api: MetaApi | null = null;
  private account: MetatraderAccount | null = null;
  private connection: any = null;
  private isInitialized = false;
  private token: string;
  private accountId: string;

  constructor() {
    this.token = import.meta.env.VITE_METAAPI_TOKEN || '';
    this.accountId = import.meta.env.VITE_METAAPI_ACCOUNT_ID || '';
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    if (!this.token || !this.accountId) {
      throw new Error('MetaApi credentials not configured. Please set VITE_METAAPI_TOKEN and VITE_METAAPI_ACCOUNT_ID in .env file');
    }

    try {
      this.api = new MetaApi(this.token);
      this.account = await this.api.metatraderAccountApi.getAccount(this.accountId);

      const deployedStates = ['DEPLOYED', 'DEPLOYING'];
      if (!deployedStates.includes(this.account.state)) {
        await this.account.deploy();
      }

      await this.account.waitDeployed();

      this.connection = this.account.getRPCConnection();
      await this.connection.connect();
      await this.connection.waitSynchronized();

      this.isInitialized = true;
      console.log('MetaApi initialized successfully');
    } catch (error) {
      console.error('Failed to initialize MetaApi:', error);
      throw new Error('Failed to connect to MetaApi. Please check your credentials and account status.');
    }
  }

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime?: Date,
    limit: number = 500
  ): Promise<CandleData[]> {
    await this.ensureInitialized();

    try {
      const endTime = new Date();
      const calculatedStartTime = startTime || this.calculateStartTime(timeframe, limit);

      const candles = await this.connection.getHistoricalCandles(
        symbol,
        timeframe,
        calculatedStartTime,
        endTime
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

    try {
      await this.connection.subscribeToMarketData(symbol);

      if (listener.onCandleUpdate) {
        this.connection.addSynchronizationListener({
          onCandlesUpdated: (instanceIndex: number, candles: any[]) => {
            candles.forEach(candle => {
              if (candle.symbol === symbol && listener.onCandleUpdate) {
                listener.onCandleUpdate({
                  symbol: candle.symbol,
                  timeframe: candle.timeframe,
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

      console.log(`Subscribed to market data for ${symbol}`);
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
