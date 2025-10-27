import { supabase } from '@/lib/supabase';
import type { RealtimeChannel } from '@supabase/supabase-js';

export type PriceTick = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: string;
  source: string;
  cached?: boolean;
  timestamp: string;
};

type PriceListener = (tick: PriceTick) => void;
type StatusListener = (status: ConnectionStatus) => void;

export type ConnectionStatus = {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';
  lastUpdate: Date;
  source: 'stream' | 'supabase' | 'fallback';
  messageCount: number;
  reconnectCount: number;
  error?: string;
};

type StreamMessage = {
  type: 'connected' | 'price' | 'heartbeat' | 'error' | 'closed';
  symbol?: string;
  bid?: number;
  ask?: number;
  mid?: number;
  spread?: number;
  time?: string;
  source?: string;
  timestamp?: string;
  error?: string;
  messageCount?: number;
  isHealthy?: boolean;
};

export class RealtimePriceStream {
  private symbols: string[];
  private priceListeners: Map<string, Set<PriceListener>> = new Map();
  private statusListeners: Set<StatusListener> = new Set();
  private eventSource: EventSource | null = null;
  private supabaseChannel: RealtimeChannel | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private isActive = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000;
  private lastPrices: Map<string, PriceTick> = new Map();
  private messageCount = 0;

  private status: ConnectionStatus = {
    state: 'disconnected',
    lastUpdate: new Date(),
    source: 'stream',
    messageCount: 0,
    reconnectCount: 0
  };

  constructor(symbols: string | string[]) {
    this.symbols = Array.isArray(symbols)
      ? symbols.map(s => s.toUpperCase())
      : [symbols.toUpperCase()];

    this.symbols.forEach(symbol => {
      this.priceListeners.set(symbol, new Set());
    });
  }

  addSymbol(symbol: string): void {
    const upperSymbol = symbol.toUpperCase();
    if (!this.symbols.includes(upperSymbol)) {
      this.symbols.push(upperSymbol);
      this.priceListeners.set(upperSymbol, new Set());

      if (this.isActive) {
        this.restart();
      }
    }
  }

  removeSymbol(symbol: string): void {
    const upperSymbol = symbol.toUpperCase();
    const index = this.symbols.indexOf(upperSymbol);
    if (index > -1) {
      this.symbols.splice(index, 1);
      this.priceListeners.delete(upperSymbol);

      if (this.isActive) {
        this.restart();
      }
    }
  }

  onPrice(symbol: string, listener: PriceListener): () => void {
    const upperSymbol = symbol.toUpperCase();
    if (!this.priceListeners.has(upperSymbol)) {
      this.priceListeners.set(upperSymbol, new Set());
    }

    this.priceListeners.get(upperSymbol)!.add(listener);

    const lastPrice = this.lastPrices.get(upperSymbol);
    if (lastPrice) {
      listener(lastPrice);
    }

    return () => {
      this.priceListeners.get(upperSymbol)?.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private updateStatus(updates: Partial<ConnectionStatus>): void {
    this.status = {
      ...this.status,
      ...updates,
      lastUpdate: new Date()
    };

    this.statusListeners.forEach(listener => listener(this.status));
  }

  private notifyPriceListeners(tick: PriceTick): void {
    const listeners = this.priceListeners.get(tick.symbol);
    if (listeners) {
      listeners.forEach(listener => listener(tick));
    }

    this.lastPrices.set(tick.symbol, tick);
  }

  private connectToServerStream(): void {
    if (this.eventSource) {
      this.eventSource.close();
    }

    const symbolsParam = this.symbols.join(',');
    const url = `/.netlify/functions/stream-prices?symbols=${encodeURIComponent(symbolsParam)}`;

    console.log('[RealtimePriceStream] Connecting to', url);
    this.updateStatus({ state: 'connecting', source: 'stream' });

    this.eventSource = new EventSource(url);

    this.eventSource.onopen = () => {
      console.log('[RealtimePriceStream] Stream connected');
      this.reconnectAttempts = 0;
      this.updateStatus({
        state: 'connected',
        source: 'stream',
        reconnectCount: this.status.reconnectCount
      });
    };

    this.eventSource.onmessage = (event) => {
      try {
        const message: StreamMessage = JSON.parse(event.data);

        switch (message.type) {
          case 'connected':
            console.log('[RealtimePriceStream] Stream ready for symbols:', message.timestamp);
            break;

          case 'price':
            if (message.symbol && message.bid && message.ask) {
              this.messageCount++;
              const tick: PriceTick = {
                symbol: message.symbol,
                bid: message.bid,
                ask: message.ask,
                mid: message.mid || (message.bid + message.ask) / 2,
                spread: message.spread || (message.ask - message.bid),
                time: message.time || message.timestamp || new Date().toISOString(),
                source: message.source || 'metaapi-ws',
                timestamp: message.timestamp || new Date().toISOString()
              };

              this.notifyPriceListeners(tick);
              this.updateStatus({
                messageCount: this.messageCount,
                state: 'connected'
              });
            }
            break;

          case 'heartbeat':
            this.updateStatus({
              state: 'connected',
              messageCount: message.messageCount || this.messageCount
            });
            break;

          case 'error':
            console.error('[RealtimePriceStream] Stream error:', message.error);
            this.updateStatus({
              state: 'error',
              error: message.error
            });
            break;

          case 'closed':
            console.log('[RealtimePriceStream] Stream closed gracefully');
            this.reconnect();
            break;
        }
      } catch (err) {
        console.error('[RealtimePriceStream] Failed to parse message:', err);
      }
    };

    this.eventSource.onerror = (error) => {
      console.error('[RealtimePriceStream] Stream error:', error);

      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.reconnect();
      } else if (this.eventSource?.readyState === EventSource.CONNECTING) {
        this.updateStatus({ state: 'reconnecting' });
      }
    };

    this.startHeartbeatMonitor();
  }

  private startHeartbeatMonitor(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = window.setInterval(() => {
      const timeSinceLastUpdate = Date.now() - this.status.lastUpdate.getTime();

      if (timeSinceLastUpdate > 30000 && this.status.state === 'connected') {
        console.warn('[RealtimePriceStream] No updates for 30s, reconnecting...');
        this.reconnect();
      }
    }, 10000);
  }

  private reconnect(): void {
    if (this.reconnectTimer || !this.isActive) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RealtimePriceStream] Max reconnect attempts reached, falling back to Supabase');
      this.fallbackToSupabase();
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(30000, this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts - 1));

    console.log(`[RealtimePriceStream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.updateStatus({
      state: 'reconnecting',
      reconnectCount: this.status.reconnectCount + 1
    });

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.isActive) {
        this.connectToServerStream();
      }
    }, delay);
  }

  private fallbackToSupabase(): void {
    console.log('[RealtimePriceStream] Activating Supabase fallback');
    this.updateStatus({
      state: 'connected',
      source: 'supabase'
    });

    if (this.supabaseChannel) {
      supabase.removeChannel(this.supabaseChannel);
    }

    this.supabaseChannel = supabase
      .channel('realtime-prices')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'realtime_prices',
          filter: `symbol=in.(${this.symbols.join(',')})`
        },
        (payload) => {
          const data = payload.new;
          const tick: PriceTick = {
            symbol: data.symbol,
            bid: parseFloat(data.bid),
            ask: parseFloat(data.ask),
            mid: parseFloat(data.mid),
            spread: parseFloat(data.spread),
            time: data.broker_time,
            source: data.source || 'supabase-realtime',
            timestamp: data.created_at
          };

          this.messageCount++;
          this.notifyPriceListeners(tick);
          this.updateStatus({ messageCount: this.messageCount });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[RealtimePriceStream] Supabase subscription active');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('[RealtimePriceStream] Supabase subscription error');
        }
      });
  }

  start(): void {
    if (this.isActive) {
      console.warn('[RealtimePriceStream] Already active');
      return;
    }

    this.isActive = true;
    this.messageCount = 0;
    this.reconnectAttempts = 0;

    console.log('[RealtimePriceStream] Starting stream for symbols:', this.symbols);
    this.connectToServerStream();
  }

  stop(): void {
    console.log('[RealtimePriceStream] Stopping stream');
    this.isActive = false;

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    if (this.supabaseChannel) {
      supabase.removeChannel(this.supabaseChannel);
      this.supabaseChannel = null;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.updateStatus({ state: 'disconnected' });
  }

  restart(): void {
    this.stop();
    setTimeout(() => this.start(), 1000);
  }

  getStatus(): ConnectionStatus {
    return { ...this.status };
  }

  getLastPrice(symbol: string): PriceTick | undefined {
    return this.lastPrices.get(symbol.toUpperCase());
  }
}

let globalStreamInstance: RealtimePriceStream | null = null;

export function getGlobalPriceStream(symbols: string | string[]): RealtimePriceStream {
  if (!globalStreamInstance) {
    globalStreamInstance = new RealtimePriceStream(symbols);
  } else {
    const symbolArray = Array.isArray(symbols) ? symbols : [symbols];
    symbolArray.forEach(symbol => {
      if (!globalStreamInstance!.getLastPrice(symbol)) {
        globalStreamInstance!.addSymbol(symbol);
      }
    });
  }

  return globalStreamInstance;
}

export function stopGlobalPriceStream(): void {
  if (globalStreamInstance) {
    globalStreamInstance.stop();
    globalStreamInstance = null;
  }
}
