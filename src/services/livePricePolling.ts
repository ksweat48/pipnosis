export type Tick = {
  symbol: string;
  bid: number;
  ask: number;
  mid?: number;
  spread?: number;
  time: string;
  connectionState?: string;
  source?: string;
  cached?: boolean;
};

type Listener = (t: Tick) => void;

type NestedPriceResponse = {
  ok: boolean;
  data: {
    [symbol: string]: {
      bid?: number;
      ask?: number;
      mid?: number;
      time?: string;
      error?: string;
      source?: string;
      cached?: boolean;
    };
  };
  timestamp: string;
};

type FlatPriceResponse = {
  symbol: string;
  bid?: number;
  ask?: number;
  mid?: number;
  time?: string;
  source?: string;
  cached?: boolean;
  error?: string;
  timestamp?: string;
};

export class LivePricePolling {
  private symbol: string;
  private intervalMs: number;
  private timer: number | null = null;
  private listeners: Set<Listener> = new Set();
  private isRunning = false;
  private failCount = 0;

  constructor(symbol: string, intervalMs = 2000) {
    this.symbol = symbol.toUpperCase();
    this.intervalMs = intervalMs;
  }

  onTick(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start(): void {
    if (this.timer || this.isRunning) return;

    this.isRunning = true;
    this.failCount = 0;
    const tick = async () => {
      if (!this.isRunning) return;

      try {
        const url = `/.netlify/functions/get-latest-price?symbol=${encodeURIComponent(this.symbol)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const rawData = await res.json();

        const parsedTick = this.parseResponse(rawData);

        if (!parsedTick) {
          console.warn('[LivePricePolling] Could not parse response:', rawData);
          throw new Error('Invalid response format');
        }

        if (parsedTick.cached) {
          console.log(`[LivePricePolling] Using cached price for ${this.symbol} from ${parsedTick.time}`);
        }

        this.listeners.forEach((l) => l(parsedTick));
        this.failCount = 0;
      } catch (e) {
        this.failCount++;
        console.warn('[LivePricePolling] fetch failed:', (e as Error)?.message);
      } finally {
        if (this.isRunning) {
          const backoff = Math.min(15000, this.failCount * 1000);
          const jitter = Math.floor(Math.random() * 300);
          const delay = this.intervalMs + backoff + jitter;
          this.timer = window.setTimeout(tick, delay);
        }
      }
    };
    tick();
  }

  private parseResponse(data: any): Tick | null {
    if (data.error && typeof data.error === 'string') {
      console.error('[LivePricePolling] Server returned error:', data.error);
      return null;
    }

    if (this.isFlatResponse(data)) {
      return this.parseFlatResponse(data);
    }

    if (this.isNestedResponse(data)) {
      return this.parseNestedResponse(data);
    }

    if (typeof data.bid === 'number' && typeof data.ask === 'number') {
      const mid = data.mid ?? (data.bid + data.ask) / 2;
      return {
        symbol: data.symbol || this.symbol,
        bid: data.bid,
        ask: data.ask,
        mid,
        time: data.time || new Date().toISOString(),
        source: data.source || 'unknown',
        cached: data.cached || false,
      };
    }

    return null;
  }

  private isFlatResponse(data: any): data is FlatPriceResponse {
    return (
      typeof data === 'object' &&
      data !== null &&
      'symbol' in data &&
      (typeof data.bid === 'number' || typeof data.ask === 'number')
    );
  }

  private isNestedResponse(data: any): data is NestedPriceResponse {
    return (
      typeof data === 'object' &&
      data !== null &&
      'data' in data &&
      typeof data.data === 'object' &&
      data.data !== null
    );
  }

  private parseFlatResponse(data: FlatPriceResponse): Tick | null {
    if (!data.bid || !data.ask) {
      console.error('[LivePricePolling] Flat response missing bid/ask:', data);
      return null;
    }

    const mid = data.mid ?? (data.bid + data.ask) / 2;

    return {
      symbol: data.symbol || this.symbol,
      bid: data.bid,
      ask: data.ask,
      mid,
      time: data.time || new Date().toISOString(),
      source: data.source || 'metaapi',
      cached: data.cached || false,
    };
  }

  private parseNestedResponse(data: NestedPriceResponse): Tick | null {
    const symbolData = data.data[this.symbol];

    if (!symbolData) {
      console.error(`[LivePricePolling] No data for symbol ${this.symbol} in nested response`);
      return null;
    }

    if (symbolData.error) {
      console.error(`[LivePricePolling] Symbol ${this.symbol} has error:`, symbolData.error);
      return null;
    }

    if (!symbolData.bid || !symbolData.ask) {
      console.error(`[LivePricePolling] Symbol ${this.symbol} missing bid/ask:`, symbolData);
      return null;
    }

    const mid = symbolData.mid ?? (symbolData.bid + symbolData.ask) / 2;

    return {
      symbol: this.symbol,
      bid: symbolData.bid,
      ask: symbolData.ask,
      mid,
      time: symbolData.time || data.timestamp || new Date().toISOString(),
      source: symbolData.source || 'metaapi',
      cached: symbolData.cached || false,
    };
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.failCount = 0;
  }

  updateSymbol(symbol: string): void {
    this.symbol = symbol.toUpperCase();
    if (this.isRunning) {
      this.stop();
      this.start();
    }
  }

  getSymbol(): string {
    return this.symbol;
  }

  isActive(): boolean {
    return this.isRunning;
  }
}
