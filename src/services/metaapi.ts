import { CandleData, Timeframe, TickData } from '../types/market-data';

export type { Timeframe } from '../types/market-data';

export interface MetaApiAccountInfo {
  accountId: string;
  name: string;
  type: string;
  login: string;
  server: string;
  platform: string;
  currency: string;
  state: string;
  connectionStatus: string;
}

export interface MetaApiConnection {
  connect: () => Promise<void>;
  close: () => Promise<void>;
  getAccountInformation: () => Promise<any>;
  getPositions: () => Promise<any[]>;
  getOrders: () => Promise<any[]>;
  waitSynchronized: () => Promise<void>;
}

class MetaApiService {
  private isConnected = false;
  private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';

  async initialize(): Promise<void> {
    console.log('MetaAPI Service: Stub initialization');
    this.connectionStatus = 'connected';
    this.isConnected = true;
  }

  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    startTime: Date,
    limit?: number
  ): Promise<CandleData[]> {
    console.log(`MetaAPI Service: Stub historical data request for ${symbol} ${timeframe}`);
    return [];
  }

  async subscribeToPriceUpdates(
    symbol: string,
    callback: (tick: TickData) => void
  ): Promise<void> {
    console.log(`MetaAPI Service: Stub price subscription for ${symbol}`);
  }

  async unsubscribeFromPriceUpdates(symbol: string): Promise<void> {
    console.log(`MetaAPI Service: Stub price unsubscription for ${symbol}`);
  }

  getConnectionStatus(): 'disconnected' | 'connecting' | 'connected' | 'error' {
    return this.connectionStatus;
  }

  isConnectedToMetaApi(): boolean {
    return this.isConnected;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.connectionStatus = 'disconnected';
    console.log('MetaAPI Service: Disconnected');
  }
}

export const metaApiService = new MetaApiService();
export default metaApiService;
