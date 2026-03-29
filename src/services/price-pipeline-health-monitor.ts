/**
 * PRICE PIPELINE HEALTH MONITOR
 *
 * Polls the server-side price write pipeline health every 30 seconds.
 * Surfaces degradation BEFORE the 90-second freshness hard block fires,
 * giving users visibility into write-side failures that would otherwise
 * only become visible as a BLOCK during a live session scan.
 *
 * Architecture:
 * - Calls get_price_pipeline_health() RPC (read-only, no mutations)
 * - Emits status to registered listeners
 * - Singleton: one instance shared across all consumers
 *
 * Status levels (matching DB function thresholds):
 *   ok       — all symbols <60s old
 *   warning  — at least one symbol 60-120s old (pre-block zone)
 *   critical — at least one symbol >120s old (pipeline missed 2+ cron runs)
 *   unknown  — could not reach DB
 */

import { supabase } from '../lib/supabase';

export type PipelineStatus = 'ok' | 'warning' | 'critical' | 'unknown';

export interface SymbolHealth {
  symbol: string;
  last_price_at: string;
  age_seconds: number;
  status: 'ok' | 'warning' | 'critical';
}

export interface PipelineHealth {
  status: PipelineStatus;
  symbols: SymbolHealth[];
  worstAgeSeconds: number;
  stalestSymbol: string | null;
  checkedAt: Date;
  error?: string;
}

type HealthListener = (health: PipelineHealth) => void;

const POLL_INTERVAL_MS = 30_000;

class PricePipelineHealthMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<HealthListener> = new Set();
  private latestHealth: PipelineHealth | null = null;

  start(): void {
    if (this.intervalId !== null) return;

    this.poll();
    this.intervalId = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  subscribe(listener: HealthListener): () => void {
    this.listeners.add(listener);

    if (this.latestHealth) {
      listener(this.latestHealth);
    }

    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatest(): PipelineHealth | null {
    return this.latestHealth;
  }

  private async poll(): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('get_price_pipeline_health');

      if (error) {
        const health: PipelineHealth = {
          status: 'unknown',
          symbols: [],
          worstAgeSeconds: 0,
          stalestSymbol: null,
          checkedAt: new Date(),
          error: error.message
        };
        this.emit(health);
        return;
      }

      const symbols: SymbolHealth[] = (data ?? []) as SymbolHealth[];

      const worstAgeSeconds = symbols.reduce(
        (max, s) => Math.max(max, s.age_seconds),
        0
      );

      const stalest = symbols.length > 0
        ? symbols.reduce((a, b) => (a.age_seconds > b.age_seconds ? a : b))
        : null;

      let status: PipelineStatus = 'ok';
      if (symbols.some(s => s.status === 'critical')) {
        status = 'critical';
      } else if (symbols.some(s => s.status === 'warning')) {
        status = 'warning';
      }

      const health: PipelineHealth = {
        status,
        symbols,
        worstAgeSeconds,
        stalestSymbol: stalest?.symbol ?? null,
        checkedAt: new Date()
      };

      this.emit(health);
    } catch (err) {
      const health: PipelineHealth = {
        status: 'unknown',
        symbols: [],
        worstAgeSeconds: 0,
        stalestSymbol: null,
        checkedAt: new Date(),
        error: err instanceof Error ? err.message : 'Unknown error'
      };
      this.emit(health);
    }
  }

  private emit(health: PipelineHealth): void {
    this.latestHealth = health;
    this.listeners.forEach(l => l(health));
  }
}

export const pricePipelineHealthMonitor = new PricePipelineHealthMonitor();
