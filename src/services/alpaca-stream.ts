import { supabase } from '../lib/supabase';

export interface AlpacaQuote {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
  data_source: string;
}

export interface AlpacaBar {
  symbol: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: string;
}

class AlpacaStreamService {
  private symbols: string[] = [];
  private priceCallbacks: Map<string, Array<(quote: AlpacaQuote) => void>> = new Map();
  private barCallbacks: Map<string, Array<(bar: AlpacaBar) => void>> = new Map();
  private realtimeSubscription: any = null;
  private isConnected: boolean = false;

  constructor() {
    this.setupRealtimeSubscription();
  }

  private setupRealtimeSubscription() {
    this.realtimeSubscription = supabase
      .channel('realtime_prices_channel')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices'
        },
        (payload) => {
          const quote = payload.new as AlpacaQuote;
          this.handleQuoteUpdate(quote);
        }
      )
      .subscribe((status) => {
        this.isConnected = status === 'SUBSCRIBED';
        console.log('[AlpacaStream] Supabase realtime status:', status);
      });
  }

  private handleQuoteUpdate(quote: AlpacaQuote) {
    const callbacks = this.priceCallbacks.get(quote.symbol) || [];
    callbacks.forEach(callback => callback(quote));
  }

  subscribeToQuotes(symbols: string[], callback: (quote: AlpacaQuote) => void) {
    symbols.forEach(symbol => {
      if (!this.priceCallbacks.has(symbol)) {
        this.priceCallbacks.set(symbol, []);
      }
      this.priceCallbacks.get(symbol)?.push(callback);
    });

    this.symbols = Array.from(new Set([...this.symbols, ...symbols]));

    console.log('[AlpacaStream] Subscribed to quotes:', symbols);
  }

  subscribeToBars(symbols: string[], callback: (bar: AlpacaBar) => void) {
    symbols.forEach(symbol => {
      if (!this.barCallbacks.has(symbol)) {
        this.barCallbacks.set(symbol, []);
      }
      this.barCallbacks.get(symbol)?.push(callback);
    });

    console.log('[AlpacaStream] Subscribed to bars:', symbols);
  }

  unsubscribe(symbol: string) {
    this.priceCallbacks.delete(symbol);
    this.barCallbacks.delete(symbol);
    this.symbols = this.symbols.filter(s => s !== symbol);

    console.log('[AlpacaStream] Unsubscribed from:', symbol);
  }

  async getLatestQuote(symbol: string): Promise<AlpacaQuote | null> {
    const { data, error } = await supabase
      .from('realtime_prices')
      .select('*')
      .eq('symbol', symbol)
      .order('timestamp', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[AlpacaStream] Error fetching latest quote:', error);
      return null;
    }

    return data as AlpacaQuote;
  }

  async startStream(symbols: string[]) {
    try {
      console.log('[AlpacaStream] Starting stream for:', symbols);

      const response = await fetch('/.netlify/functions/alpaca-websocket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols })
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to start Alpaca stream');
      }

      console.log('[AlpacaStream] Stream started:', result);
      return result;
    } catch (error) {
      console.error('[AlpacaStream] Failed to start stream:', error);
      throw error;
    }
  }

  disconnect() {
    if (this.realtimeSubscription) {
      supabase.removeChannel(this.realtimeSubscription);
      this.realtimeSubscription = null;
    }
    this.priceCallbacks.clear();
    this.barCallbacks.clear();
    this.symbols = [];
    this.isConnected = false;

    console.log('[AlpacaStream] Disconnected');
  }

  getConnectionStatus() {
    return {
      connected: this.isConnected,
      symbols: this.symbols
    };
  }
}

export const alpacaStream = new AlpacaStreamService();
