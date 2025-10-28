import { supabase } from '../lib/supabase';
import { AlpacaBar } from './alpaca-stream';

export interface AlpacaSymbol {
  symbol: string;
  name: string;
  exchange: string;
  tradable: boolean;
}

class AlpacaAPIService {
  async getSymbols(): Promise<AlpacaSymbol[]> {
    try {
      const response = await fetch('/.netlify/functions/alpaca-symbols');
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch symbols');
      }

      return result.symbols;
    } catch (error) {
      console.error('[AlpacaAPI] Error fetching symbols:', error);
      return this.getDefaultSymbols();
    }
  }

  private getDefaultSymbols(): AlpacaSymbol[] {
    return [
      { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NASDAQ', tradable: true },
      { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'AMZN', name: 'Amazon.com Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'TSLA', name: 'Tesla Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'META', name: 'Meta Platforms Inc.', exchange: 'NASDAQ', tradable: true },
      { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NASDAQ', tradable: true },
      { symbol: 'JPM', name: 'JPMorgan Chase & Co.', exchange: 'NYSE', tradable: true }
    ];
  }

  async getHistoricalBars(
    symbol: string,
    timeframe: string = '5Min',
    limit: number = 100
  ): Promise<AlpacaBar[]> {
    try {
      console.log(`[AlpacaAPI] Fetching historical bars for ${symbol}`);

      const response = await fetch(
        `/.netlify/functions/alpaca-historical?symbol=${symbol}&timeframe=${timeframe}&limit=${limit}`
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to fetch historical data');
      }

      console.log(`[AlpacaAPI] Received ${result.count} bars for ${symbol}`);
      return result.candles;
    } catch (error) {
      console.error('[AlpacaAPI] Error fetching historical bars:', error);
      return await this.getHistoricalBarsFromDatabase(symbol, timeframe, limit);
    }
  }

  private async getHistoricalBarsFromDatabase(
    symbol: string,
    timeframe: string,
    limit: number
  ): Promise<AlpacaBar[]> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe.toLowerCase())
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).reverse() as AlpacaBar[];
    } catch (error) {
      console.error('[AlpacaAPI] Error fetching from database:', error);
      return [];
    }
  }

  async refreshHistoricalData(
    symbol: string,
    timeframe: string = '5Min'
  ): Promise<void> {
    try {
      await this.getHistoricalBars(symbol, timeframe, 500);
      console.log(`[AlpacaAPI] Refreshed historical data for ${symbol}`);
    } catch (error) {
      console.error('[AlpacaAPI] Error refreshing historical data:', error);
      throw error;
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const symbols = await this.getSymbols();
      return symbols.length > 0;
    } catch (error) {
      console.error('[AlpacaAPI] Connection test failed:', error);
      return false;
    }
  }
}

export const alpacaAPI = new AlpacaAPIService();
