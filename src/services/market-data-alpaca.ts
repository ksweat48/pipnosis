import { alpacaAPI, AlpacaBar } from './alpaca-api';
import { alpacaStream, AlpacaQuote } from './alpaca-stream';
import { supabase } from '../lib/supabase';
import { TickData, CandleData, MarketDataListener, Timeframe } from '../types/market-data';

export type { TickData, CandleData, MarketDataListener, Timeframe };

const timeframeMap: Record<string, string> = {
  'M1': '1Min',
  'M5': '5Min',
  'M15': '15Min',
  'M30': '30Min',
  'H1': '1Hour',
  'H4': '4Hour',
  'D1': '1Day'
};

class MarketDataServiceAlpaca {
  private listeners: Map<string, MarketDataListener> = new Map();
  private currentSymbol: string = 'AAPL';

  async connect(symbol: string): Promise<void> {
    this.currentSymbol = symbol;
    console.log('[MarketDataAlpaca] Connecting to:', symbol);

    alpacaStream.subscribeToQuotes([symbol], (quote: AlpacaQuote) => {
      const tick: TickData = {
        symbol: quote.symbol,
        bid: quote.bid,
        ask: quote.ask,
        time: new Date(quote.timestamp),
        brokerTime: quote.timestamp
      };

      this.notifyListeners('tick', tick);
    });

    try {
      await alpacaStream.startStream([symbol]);
    } catch (error) {
      console.error('[MarketDataAlpaca] Failed to start stream:', error);
    }
  }

  async disconnect(): Promise<void> {
    console.log('[MarketDataAlpaca] Disconnecting');
    alpacaStream.disconnect();
  }

  async getHistoricalData(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100,
    skipCache: boolean = false,
    skipBackfill: boolean = false
  ): Promise<CandleData[]> {
    console.log(`[MarketDataAlpaca] Fetching historical data: ${symbol} ${timeframe}`);

    const alpacaTimeframe = timeframeMap[timeframe] || '5Min';

    try {
      const bars = await alpacaAPI.getHistoricalBars(symbol, alpacaTimeframe, limit);

      return bars.map((bar: AlpacaBar) => ({
        time: new Date(bar.timestamp),
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume
      }));
    } catch (error) {
      console.error('[MarketDataAlpaca] Error fetching historical data:', error);
      return [];
    }
  }

  async getLatestCandle(symbol: string, timeframe: Timeframe): Promise<CandleData | null> {
    try {
      const candles = await this.getHistoricalData(symbol, timeframe, 1);
      return candles[0] || null;
    } catch (error) {
      console.error('[MarketDataAlpaca] Error fetching latest candle:', error);
      return null;
    }
  }

  async getLatestPrice(symbol: string): Promise<{ bid: number; ask: number; mid: number } | null> {
    try {
      const quote = await alpacaStream.getLatestQuote(symbol);
      if (!quote) return null;

      return {
        bid: quote.bid,
        ask: quote.ask,
        mid: (quote.bid + quote.ask) / 2
      };
    } catch (error) {
      console.error('[MarketDataAlpaca] Error fetching latest price:', error);
      return null;
    }
  }

  addListener(listener: MarketDataListener): void {
    this.listeners.set(listener.id, listener);
    console.log('[MarketDataAlpaca] Listener added:', listener.id);
  }

  removeListener(listenerId: string): void {
    this.listeners.delete(listenerId);
    console.log('[MarketDataAlpaca] Listener removed:', listenerId);
  }

  private notifyListeners(type: 'tick' | 'candle', data: TickData | CandleData): void {
    this.listeners.forEach(listener => {
      try {
        if (type === 'tick' && listener.onTick) {
          listener.onTick(data as TickData);
        } else if (type === 'candle' && listener.onCandle) {
          listener.onCandle(data as CandleData);
        }
      } catch (error) {
        console.error('[MarketDataAlpaca] Error in listener:', error);
      }
    });
  }

  getConnectionStatus(): { connected: boolean; source: string } {
    const status = alpacaStream.getConnectionStatus();
    return {
      connected: status.connected,
      source: 'alpaca'
    };
  }

  stopLiveFeed(symbol: string, timeframe: Timeframe): void {
    console.log(`[MarketDataAlpaca] Stopping live feed for ${symbol} ${timeframe}`);
  }
}

export const marketDataServiceAlpaca = new MarketDataServiceAlpaca();
