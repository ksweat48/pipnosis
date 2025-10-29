interface TickData {
  price: number;
  time: Date;
  bid?: number;
  ask?: number;
  spread?: number;
}

type TickCallback = (tick: TickData) => void;

export class LivePricePolling {
  private intervalId: NodeJS.Timeout | null = null;
  private symbol: string;
  private intervalMs: number;
  private isActive: boolean = false;
  private tickCallbacks: Set<TickCallback> = new Set();
  private consecutiveErrors: number = 0;
  private readonly MAX_ERRORS = 5;

  constructor(symbol: string, intervalMs: number = 2000) {
    this.symbol = symbol;
    this.intervalMs = intervalMs;
  }

  onTick(callback: TickCallback): void {
    this.tickCallbacks.add(callback);
  }

  offTick(callback: TickCallback): void {
    this.tickCallbacks.delete(callback);
  }

  start(): void {
    if (this.isActive) {
      console.warn(`[LivePricePolling] Already polling for ${this.symbol}`);
      return;
    }

    this.isActive = true;
    this.consecutiveErrors = 0;
    console.log(`[LivePricePolling] Starting polling for ${this.symbol} (${this.intervalMs}ms interval)`);

    this.fetchPrice();

    this.intervalId = setInterval(() => {
      this.fetchPrice();
    }, this.intervalMs);
  }

  stop(): void {
    if (!this.isActive) {
      return;
    }

    this.isActive = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log(`[LivePricePolling] Stopped polling for ${this.symbol}`);
  }

  private async fetchPrice(): Promise<void> {
    if (!this.isActive) return;

    const fetchStart = Date.now();

    try {
      const functionUrl = `/.netlify/functions/forex-price`;

      const response = await fetch(`${functionUrl}?symbol=${this.symbol}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();

      if (!result.success || result.error) {
        throw new Error(result.error || 'Failed to fetch price');
      }

      const data = result.data;

      if (data && data.bid && data.ask) {
        const mid = (data.bid + data.ask) / 2;

        // Use server timestamp if available, otherwise use current time
        const tickTime = data.timestamp ? new Date(data.timestamp) : new Date();

        // Validate timestamp is reasonable (not in future, not older than 1 hour)
        const now = Date.now();
        const tickTimestamp = tickTime.getTime();
        const age = now - tickTimestamp;

        if (tickTimestamp > now + 60000) {
          console.warn(`[LivePricePolling] Rejecting tick with future timestamp: ${tickTime.toISOString()}`);
          return;
        }

        if (age > 3600000) {
          console.warn(`[LivePricePolling] Rejecting tick older than 1 hour: ${tickTime.toISOString()} (age: ${(age/1000).toFixed(0)}s)`);
          return;
        }

        const tick: TickData = {
          price: mid,
          time: tickTime,
          bid: data.bid,
          ask: data.ask,
          spread: data.ask - data.bid,
        };

        this.consecutiveErrors = 0;

        const latency = Date.now() - fetchStart;
        if (latency > 1000) {
          console.warn(`[LivePricePolling] High latency: ${latency}ms for ${this.symbol}`);
        }

        this.tickCallbacks.forEach(callback => {
          try {
            callback(tick);
          } catch (err) {
            console.error('[LivePricePolling] Error in tick callback:', err);
          }
        });
      } else {
        console.warn(`[LivePricePolling] Invalid price data received:`, data);
      }

    } catch (error) {
      this.consecutiveErrors++;

      if (this.consecutiveErrors <= 3) {
        console.warn(`[LivePricePolling] Failed to fetch price for ${this.symbol} (attempt ${this.consecutiveErrors}):`, error);
      }

      if (this.consecutiveErrors >= this.MAX_ERRORS) {
        console.error(`[LivePricePolling] Max errors reached for ${this.symbol}, stopping polling`);
        this.stop();
      }
    }
  }

  changeSymbol(newSymbol: string): void {
    const wasActive = this.isActive;

    if (wasActive) {
      this.stop();
    }

    this.symbol = newSymbol;
    this.consecutiveErrors = 0;

    if (wasActive) {
      this.start();
    }
  }

  isPolling(): boolean {
    return this.isActive;
  }

  getSymbol(): string {
    return this.symbol;
  }
}

export default LivePricePolling;
