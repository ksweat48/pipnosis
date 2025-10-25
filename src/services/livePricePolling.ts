export type Tick = {
  symbol: string;
  bid: number;
  ask: number;
  time: string;
  source: 'sdk:getSymbolPrice' | 'sdk:getTick' | 'rest' | string;
};

type Listener = (t: Tick) => void;

export class LivePricePolling {
  private symbol: string;
  private intervalMs: number;
  private timer: number | null = null;
  private listeners: Set<Listener> = new Set();
  private isRunning = false;

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
    const tick = async () => {
      if (!this.isRunning) return;

      try {
        const url = `/.netlify/functions/get-latest-price?symbol=${encodeURIComponent(this.symbol)}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Tick;
        this.listeners.forEach((l) => l(data));
      } catch (e) {
        console.warn('[LivePricePolling] fetch failed:', (e as Error)?.message);
      } finally {
        if (this.isRunning) {
          this.timer = window.setTimeout(tick, this.intervalMs);
        }
      }
    };
    tick();
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
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
