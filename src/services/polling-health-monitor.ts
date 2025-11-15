/**
 * Polling Health Monitor with Auto-Recovery
 *
 * Continuously monitors polling health and automatically recovers from failures.
 * Implements exponential backoff and tracks recovery attempts.
 */

import { supabase } from '@/lib/supabase';
import { circuitBreakerService } from './circuit-breaker-service';

export type PollingStatus = 'active' | 'degraded' | 'critical' | 'stopped';
export type DataQuality = 'live' | 'cached' | 'stale' | 'unavailable';

interface SymbolHealth {
  symbol: string;
  status: PollingStatus;
  consecutiveErrors: number;
  totalErrors: number;
  successCount: number;
  lastSuccess: Date | null;
  lastError: Date | null;
  lastErrorMessage: string | null;
  recoveryAttempts: number;
  lastRecovery: Date | null;
  dataQuality: DataQuality;
}

interface RecoveryConfig {
  maxRecoveryAttempts: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  recoveryCheckIntervalMs: number;
  staleThresholdMs: number;
  criticalThresholdMs: number;
}

const DEFAULT_CONFIG: RecoveryConfig = {
  maxRecoveryAttempts: 30,
  baseBackoffMs: 5000, // Start with 5 second backoff
  maxBackoffMs: 300000, // Max 5 minute backoff
  recoveryCheckIntervalMs: 60000, // Check for recovery every 60 seconds
  staleThresholdMs: 30000, // 30 seconds without success = stale
  criticalThresholdMs: 120000 // 2 minutes without success = critical
};

type RecoveryCallback = (symbol: string) => Promise<void>;

class PollingHealthMonitor {
  private healthMap: Map<string, SymbolHealth> = new Map();
  private recoveryCallbacks: Map<string, RecoveryCallback> = new Map();
  private monitorInterval: NodeJS.Timeout | null = null;
  private recoveryQueue: Set<string> = new Set();
  private isProcessingRecovery = false;
  private config: RecoveryConfig = DEFAULT_CONFIG;

  async initialize(symbols: string[]): Promise<void> {
    console.log('[PollingHealthMonitor] Initializing for symbols:', symbols);

    for (const symbol of symbols) {
      await this.loadHealthFromDatabase(symbol);
    }

    this.startHealthMonitoring();
    console.log('[PollingHealthMonitor] Initialized and monitoring started');
  }

  private async loadHealthFromDatabase(symbol: string): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('polling_health')
        .select('*')
        .eq('symbol', symbol)
        .maybeSingle();

      if (error) {
        console.warn(`[PollingHealthMonitor] Could not load health for ${symbol}:`, error.message);
        this.healthMap.set(symbol, this.createDefaultHealth(symbol));
        return;
      }

      if (data) {
        this.healthMap.set(symbol, {
          symbol,
          status: data.status as PollingStatus,
          consecutiveErrors: data.consecutive_errors,
          totalErrors: data.total_errors,
          successCount: data.success_count,
          lastSuccess: data.last_success_at ? new Date(data.last_success_at) : null,
          lastError: data.last_error_at ? new Date(data.last_error_at) : null,
          lastErrorMessage: data.last_error_message,
          recoveryAttempts: data.recovery_attempts,
          lastRecovery: data.last_recovery_at ? new Date(data.last_recovery_at) : null,
          dataQuality: data.data_quality as DataQuality
        });

        console.log(`[PollingHealthMonitor] Loaded health for ${symbol}: ${data.status}, errors: ${data.consecutive_errors}`);
      } else {
        this.healthMap.set(symbol, this.createDefaultHealth(symbol));
      }
    } catch (error) {
      console.error(`[PollingHealthMonitor] Error loading health for ${symbol}:`, error);
      this.healthMap.set(symbol, this.createDefaultHealth(symbol));
    }
  }

  private createDefaultHealth(symbol: string): SymbolHealth {
    return {
      symbol,
      status: 'active',
      consecutiveErrors: 0,
      totalErrors: 0,
      successCount: 0,
      lastSuccess: null,
      lastError: null,
      lastErrorMessage: null,
      recoveryAttempts: 0,
      lastRecovery: null,
      dataQuality: 'unavailable'
    };
  }

  private startHealthMonitoring(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    this.monitorInterval = setInterval(() => {
      this.checkAllSymbolsHealth();
      this.processRecoveryQueue();
    }, this.config.recoveryCheckIntervalMs);

    console.log(`[PollingHealthMonitor] Health monitoring started (checking every ${this.config.recoveryCheckIntervalMs / 1000}s)`);
  }

  private checkAllSymbolsHealth(): void {
    const now = Date.now();

    this.healthMap.forEach((health, symbol) => {
      if (!health.lastSuccess) {
        return;
      }

      const timeSinceSuccess = now - health.lastSuccess.getTime();

      let newStatus: PollingStatus = 'active';
      if (timeSinceSuccess > this.config.criticalThresholdMs) {
        newStatus = 'critical';
      } else if (timeSinceSuccess > this.config.staleThresholdMs) {
        newStatus = 'degraded';
      }

      if (newStatus !== health.status) {
        console.log(`[PollingHealthMonitor] ${symbol} status changed: ${health.status} -> ${newStatus}`);
        health.status = newStatus;
        this.persistHealth(symbol);

        if (newStatus === 'critical' || newStatus === 'degraded') {
          this.queueRecovery(symbol, newStatus === 'critical' ? 'critical_timeout' : 'stale_data');
        }
      }
    });
  }

  registerRecoveryCallback(symbol: string, callback: RecoveryCallback): void {
    this.recoveryCallbacks.set(symbol, callback);
    console.log(`[PollingHealthMonitor] Recovery callback registered for ${symbol}`);
  }

  async recordSuccess(symbol: string, dataQuality: DataQuality = 'live'): Promise<void> {
    const health = this.healthMap.get(symbol) || this.createDefaultHealth(symbol);

    health.consecutiveErrors = 0;
    health.successCount++;
    health.lastSuccess = new Date();
    health.status = 'active';
    health.dataQuality = dataQuality;

    this.healthMap.set(symbol, health);
    await this.persistHealth(symbol);

    // Remove from recovery queue if present
    this.recoveryQueue.delete(symbol);
  }

  async recordError(symbol: string, errorMessage: string): Promise<void> {
    const health = this.healthMap.get(symbol) || this.createDefaultHealth(symbol);

    health.consecutiveErrors++;
    health.totalErrors++;
    health.lastError = new Date();
    health.lastErrorMessage = errorMessage;

    // Update status based on error count
    if (health.consecutiveErrors >= 50) {
      health.status = 'stopped';
      console.error(`[PollingHealthMonitor] ${symbol} STOPPED after ${health.consecutiveErrors} consecutive errors`);
    } else if (health.consecutiveErrors >= 20) {
      health.status = 'critical';
    } else if (health.consecutiveErrors >= 10) {
      health.status = 'degraded';
    }

    this.healthMap.set(symbol, health);
    await this.persistHealth(symbol);

    // Queue recovery if not stopped
    if (health.status !== 'stopped') {
      this.queueRecovery(symbol, 'consecutive_errors');
    }
  }

  private queueRecovery(symbol: string, reason: string): void {
    const health = this.healthMap.get(symbol);
    if (!health) return;

    if (health.status === 'stopped') {
      console.log(`[PollingHealthMonitor] ${symbol} is stopped, skipping recovery`);
      return;
    }

    if (health.recoveryAttempts >= this.config.maxRecoveryAttempts) {
      console.error(`[PollingHealthMonitor] ${symbol} exceeded max recovery attempts (${this.config.maxRecoveryAttempts}), marking as stopped`);
      health.status = 'stopped';
      this.persistHealth(symbol);
      return;
    }

    if (this.recoveryQueue.has(symbol)) {
      return;
    }

    console.log(`[PollingHealthMonitor] Queuing recovery for ${symbol} (reason: ${reason})`);
    this.recoveryQueue.add(symbol);
  }

  private async processRecoveryQueue(): Promise<void> {
    if (this.isProcessingRecovery || this.recoveryQueue.size === 0) {
      return;
    }

    this.isProcessingRecovery = true;

    try {
      const symbolsToRecover = Array.from(this.recoveryQueue);

      for (const symbol of symbolsToRecover) {
        const health = this.healthMap.get(symbol);
        if (!health) continue;

        if (health.status === 'stopped') {
          this.recoveryQueue.delete(symbol);
          continue;
        }

        const backoffTime = this.calculateBackoff(health.recoveryAttempts);
        const timeSinceLastRecovery = health.lastRecovery
          ? Date.now() - health.lastRecovery.getTime()
          : Infinity;

        if (timeSinceLastRecovery < backoffTime) {
          const waitTime = Math.round((backoffTime - timeSinceLastRecovery) / 1000);
          console.log(`[PollingHealthMonitor] ${symbol} recovery on cooldown (${waitTime}s remaining)`);
          continue;
        }

        await this.attemptRecovery(symbol);
        this.recoveryQueue.delete(symbol);
      }
    } finally {
      this.isProcessingRecovery = false;
    }
  }

  private calculateBackoff(attemptCount: number): number {
    const backoff = Math.min(
      this.config.baseBackoffMs * Math.pow(2, attemptCount),
      this.config.maxBackoffMs
    );
    return backoff;
  }

  private async attemptRecovery(symbol: string): Promise<void> {
    const health = this.healthMap.get(symbol);
    if (!health) return;

    health.recoveryAttempts++;
    health.lastRecovery = new Date();
    this.healthMap.set(symbol, health);

    const backoffTime = this.calculateBackoff(health.recoveryAttempts);
    console.log(
      `[PollingHealthMonitor] 🔄 Attempting recovery for ${symbol} ` +
      `(attempt ${health.recoveryAttempts}/${this.config.maxRecoveryAttempts}, ` +
      `next backoff: ${Math.round(backoffTime / 1000)}s)`
    );

    const callback = this.recoveryCallbacks.get(symbol);
    if (!callback) {
      console.warn(`[PollingHealthMonitor] No recovery callback for ${symbol}`);
      await this.logRecovery(symbol, 'no_callback', false, 'No recovery callback registered');
      return;
    }

    try {
      await callback(symbol);
      console.log(`[PollingHealthMonitor] ✅ Recovery callback executed for ${symbol}`);
      await this.logRecovery(symbol, 'callback_executed', true);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[PollingHealthMonitor] ❌ Recovery failed for ${symbol}:`, errorMsg);
      await this.logRecovery(symbol, 'callback_failed', false, errorMsg);
    }

    await this.persistHealth(symbol);
  }

  private async persistHealth(symbol: string): Promise<void> {
    const health = this.healthMap.get(symbol);
    if (!health) return;

    try {
      await supabase
        .from('polling_health')
        .upsert({
          symbol,
          status: health.status,
          consecutive_errors: health.consecutiveErrors,
          total_errors: health.totalErrors,
          success_count: health.successCount,
          last_success_at: health.lastSuccess?.toISOString(),
          last_error_at: health.lastError?.toISOString(),
          last_error_message: health.lastErrorMessage,
          recovery_attempts: health.recoveryAttempts,
          last_recovery_at: health.lastRecovery?.toISOString(),
          data_quality: health.dataQuality,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'symbol'
        });
    } catch (error) {
      console.error(`[PollingHealthMonitor] Failed to persist health for ${symbol}:`, error);
    }
  }

  private async logRecovery(symbol: string, action: string, success: boolean, errorMessage?: string): Promise<void> {
    const health = this.healthMap.get(symbol);

    try {
      await supabase.from('polling_recovery_log').insert({
        symbol,
        trigger_reason: 'auto_recovery',
        recovery_action: action,
        success,
        error_message: errorMessage,
        metrics: {
          recovery_attempt: health?.recoveryAttempts,
          consecutive_errors: health?.consecutiveErrors,
          status: health?.status
        }
      });
    } catch (error) {
      console.error('[PollingHealthMonitor] Failed to log recovery:', error);
    }
  }

  getHealth(symbol: string): SymbolHealth | undefined {
    return this.healthMap.get(symbol);
  }

  getAllHealth(): Map<string, SymbolHealth> {
    return new Map(this.healthMap);
  }

  async resetHealth(symbol: string): Promise<void> {
    console.log(`[PollingHealthMonitor] Resetting health for ${symbol}`);
    const health = this.createDefaultHealth(symbol);
    this.healthMap.set(symbol, health);
    this.recoveryQueue.delete(symbol);
    await this.persistHealth(symbol);
  }

  shutdown(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    console.log('[PollingHealthMonitor] Shutdown complete');
  }
}

export const pollingHealthMonitor = new PollingHealthMonitor();
