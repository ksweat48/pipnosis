import { marketDataServiceAlpaca } from './market-data-alpaca';
import { CandleData, Timeframe } from '../types/market-data';

class MetaApiStub {
  async initialize() {
    console.log('[MetaAPI Stub] Initialized (using Alpaca backend)');
  }

  async subscribeToMarketData(symbol: string, handlers: any) {
    console.log('[MetaAPI Stub] Subscription requested for:', symbol);
    await marketDataServiceAlpaca.connect(symbol);
  }

  async unsubscribeFromMarketData(symbol: string) {
    console.log('[MetaAPI Stub] Unsubscribe requested for:', symbol);
    await marketDataServiceAlpaca.disconnect();
  }

  async getSymbolPrice(symbol: string) {
    return await marketDataServiceAlpaca.getLatestPrice(symbol);
  }

  async getHistoricalCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime: Date,
    limit: number = 100
  ): Promise<CandleData[]> {
    return await marketDataServiceAlpaca.getHistoricalData(
      symbol,
      timeframe,
      limit
    );
  }

  isConnected(): boolean {
    return marketDataServiceAlpaca.getConnectionStatus().connected;
  }

  async disconnect() {
    await marketDataServiceAlpaca.disconnect();
  }
}

export const metaApiService = new MetaApiStub();
