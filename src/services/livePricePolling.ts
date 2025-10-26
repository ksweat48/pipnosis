export type Tick = {
  symbol: string;
  bid: number;
  ask: number;
  mid?: number;
  spread?: number;
  time: string;
  connectionState?: string;
  source?: string;
};

type Listener = (t: Tick) => void;

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

        const data = (await res.json()) as Tick;

        if (data.mid === undefined && data.bid !== undefined && data.ask !== undefined) {
          data.mid = (data.bid + data.ask) / 2;
        }

        this.listeners.forEach((l) => l(data));
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
