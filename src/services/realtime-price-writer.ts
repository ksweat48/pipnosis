import { supabase } from '@/lib/supabase';

interface PriceTick {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  time: Date;
  source: 'websocket' | 'polling';
}

interface WriteMetrics {
  totalWrites: number;
  successfulWrites: number;
  failedWrites: number;
  lastWriteTime: Date | null;
  lastError: string | null;
}

class RealtimePriceWriter {
  private lastWriteTimes: Map<string, number> = new Map();
  private readonly WRITE_INTERVAL_MS = 1000;
  private metrics: Map<string, WriteMetrics> = new Map();
  private pendingWrites: Map<string, PriceTick> = new Map();
  private writeTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_WRITE_INTERVAL = 500;

  constructor() {
    this.startBatchWriter();
  }

  async writeTick(tick: PriceTick): Promise<boolean> {
    const symbol = tick.symbol.toUpperCase();
    const now = Date.now();

    const lastWriteTime = this.lastWriteTimes.get(symbol) || 0;
    const timeSinceLastWrite = now - lastWriteTime;

    if (timeSinceLastWrite < this.WRITE_INTERVAL_MS) {
      this.pendingWrites.set(symbol, tick);
      return false;
    }

    return this.executeWrite(tick);
  }

  private startBatchWriter(): void {
    this.writeTimer = setInterval(() => {
      this.flushPendingWrites();
    }, this.BATCH_WRITE_INTERVAL);
  }

  private async flushPendingWrites(): Promise<void> {
    if (this.pendingWrites.size === 0) {
      return;
    }

    const writes = Array.from(this.pendingWrites.values());
    this.pendingWrites.clear();

    for (const tick of writes) {
      const symbol = tick.symbol.toUpperCase();
      const lastWriteTime = this.lastWriteTimes.get(symbol) || 0;
      const timeSinceLastWrite = Date.now() - lastWriteTime;

      if (timeSinceLastWrite >= this.WRITE_INTERVAL_MS) {
        await this.executeWrite(tick);
      }
    }
  }

  private async executeWrite(tick: PriceTick): Promise<boolean> {
    const symbol = tick.symbol.toUpperCase();

    try {
      console.log(`[RealtimePriceWriter] Writing tick to database: ${symbol} bid=${tick.bid.toFixed(5)} ask=${tick.ask.toFixed(5)}`);

      const { error } = await supabase
        .from('realtime_prices')
        .insert({
          symbol,
          bid: tick.bid.toString(),
          ask: tick.ask.toString(),
          mid: tick.mid.toString(),
          spread: tick.spread.toString(),
          broker_time: tick.time.toISOString(),
          source: tick.source
        });

      if (error) {
        console.error(`[RealtimePriceWriter] Database write failed for ${symbol}:`, error);
        this.updateMetrics(symbol, false, error.message);
        return false;
      }

      this.lastWriteTimes.set(symbol, Date.now());
      this.updateMetrics(symbol, true);
      console.log(`[RealtimePriceWriter] ✅ Successfully wrote ${symbol} tick to database`);
      return true;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[RealtimePriceWriter] Exception writing ${symbol} to database:`, errorMessage);
      this.updateMetrics(symbol, false, errorMessage);
      return false;
    }
  }

  private updateMetrics(symbol: string, success: boolean, errorMessage?: string): void {
    let metrics = this.metrics.get(symbol);

    if (!metrics) {
      metrics = {
        totalWrites: 0,
        successfulWrites: 0,
        failedWrites: 0,
        lastWriteTime: null,
        lastError: null
      };
      this.metrics.set(symbol, metrics);
    }

    metrics.totalWrites++;

    if (success) {
      metrics.successfulWrites++;
      metrics.lastWriteTime = new Date();
      metrics.lastError = null;
    } else {
      metrics.failedWrites++;
      metrics.lastError = errorMessage || 'Unknown error';
    }
  }

  getMetrics(symbol: string): WriteMetrics | null {
    return this.metrics.get(symbol.toUpperCase()) || null;
  }

  getAllMetrics(): Map<string, WriteMetrics> {
    return new Map(this.metrics);
  }

  getWriteRate(symbol: string): number {
    const metrics = this.metrics.get(symbol.toUpperCase());
    if (!metrics || !metrics.lastWriteTime) {
      return 0;
    }

    const successRate = metrics.successfulWrites / metrics.totalWrites;
    return successRate;
  }

  stop(): void {
    if (this.writeTimer) {
      clearInterval(this.writeTimer);
      this.writeTimer = null;
    }

    this.flushPendingWrites();
  }
}

export const realtimePriceWriter = new RealtimePriceWriter();
