export interface ForexPrice {
  symbol: string;
  bid: number;
  ask: number;
  spread?: number;
  timestamp: string;
}

export interface ForexCandle {
  symbol: string;
  timeframe: string;
  open_time: string;
  close_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

class ForexApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = '/.netlify/functions';
  }

  async getCurrentPrice(symbol: string): Promise<ForexPrice> {
    try {
      const response = await fetch(`${this.baseUrl}/forex-price?symbol=${symbol}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch price: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Unknown error fetching price');
      }

      const price = result.data;
      return {
        ...price,
        spread: price.ask - price.bid
      };
    } catch (error) {
      console.error(`Error fetching price for ${symbol}:`, error);
      throw error;
    }
  }

  async getCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<ForexCandle[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/forex-candles?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch candles: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Unknown error fetching candles');
      }

      return result.data.candles;
    } catch (error) {
      console.error(`Error fetching candles for ${symbol} ${timeframe}:`, error);
      throw error;
    }
  }

  startPricePolling(
    symbol: string,
    callback: (price: ForexPrice) => void,
    intervalMs: number = 2000
  ): () => void {
    let isActive = true;

    const poll = async () => {
      if (!isActive) return;

      try {
        const price = await this.getCurrentPrice(symbol);
        callback(price);
      } catch (error) {
        console.error('Price polling error:', error);
      }

      if (isActive) {
        setTimeout(poll, intervalMs);
      }
    };

    poll();

    return () => {
      isActive = false;
    };
  }
}

export const forexApi = new ForexApiService();
