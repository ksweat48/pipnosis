/**
 * Circuit Breaker Service for MetaAPI Connection Management
 *
 * Implements circuit breaker pattern to protect against cascading failures.
 * Automatically opens circuit after threshold failures and attempts recovery.
 *
 * States:
 * - CLOSED: Normal operation, all requests allowed
 * - HALF_OPEN: Testing recovery, limited requests allowed
 * - OPEN: Circuit tripped, no requests allowed (using fallback)
 */

import { supabase } from '@/lib/supabase';
import { shouldDisableMetaAPI } from '@/lib/environment';

export type CircuitState = 'closed' | 'half_open' | 'open';

interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // milliseconds to wait before trying half_open
  halfOpenMaxAttempts: number;
}

interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  nextAttemptTime: Date | null;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5, // Open circuit after 5 consecutive failures
  successThreshold: 3, // Close circuit after 3 consecutive successes in half_open
  timeout: 30000, // Wait 30 seconds before trying half_open
  halfOpenMaxAttempts: 3
};

class CircuitBreakerService {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private nextAttemptTime: Date | null = null;
  private halfOpenAttempts = 0;
  private config: CircuitBreakerConfig = DEFAULT_CONFIG;
  private stateListeners: Set<(status: CircuitBreakerStatus) => void> = new Set();

  async initialize(): Promise<void> {
    console.log('[CircuitBreaker] Initializing...');

    // CRITICAL: In development mode, keep circuit permanently closed
    // This prevents the circuit breaker from opening due to missing Netlify Functions
    if (shouldDisableMetaAPI()) {
      console.log('[CircuitBreaker] Development mode detected - circuit breaker disabled');
      console.log('[CircuitBreaker] Circuit will remain CLOSED to allow database-only operations');
      this.state = 'closed';
      this.failureCount = 0;
      return;
    }

    await this.loadStateFromDatabase();
    this.startStateMonitoring();
    console.log(`[CircuitBreaker] Initialized in ${this.state} state`);
  }

  private async loadStateFromDatabase(): Promise<void> {
    try {
      const { data, error } = await supabase
        .from('polling_health')
        .select('circuit_breaker_state, circuit_opened_at, consecutive_errors')
        .eq('symbol', 'METAAPI_GLOBAL')
        .maybeSingle();

      if (error) {
        console.warn('[CircuitBreaker] Could not load state from DB:', error.message);
        return;
      }

      if (data) {
        this.state = data.circuit_breaker_state as CircuitState;
        this.failureCount = data.consecutive_errors || 0;

        if (data.circuit_opened_at) {
          this.lastFailureTime = new Date(data.circuit_opened_at);
          this.nextAttemptTime = new Date(
            this.lastFailureTime.getTime() + this.config.timeout
          );
        }

        console.log(`[CircuitBreaker] Restored state: ${this.state}, failures: ${this.failureCount}`);
      }
    } catch (error) {
      console.error('[CircuitBreaker] Error loading state:', error);
    }
  }

  private async persistState(): Promise<void> {
    try {
      await supabase
        .from('polling_health')
        .upsert({
          symbol: 'METAAPI_GLOBAL',
          circuit_breaker_state: this.state,
          consecutive_errors: this.failureCount,
          circuit_opened_at: this.lastFailureTime?.toISOString(),
          status: this.state === 'open' ? 'critical' : this.state === 'half_open' ? 'degraded' : 'active',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'symbol'
        });
    } catch (error) {
      console.error('[CircuitBreaker] Failed to persist state:', error);
    }
  }

  private startStateMonitoring(): void {
    setInterval(() => {
      if (this.state === 'open' && this.nextAttemptTime && Date.now() >= this.nextAttemptTime.getTime()) {
        console.log('[CircuitBreaker] Timeout expired, transitioning to HALF_OPEN');
        this.transitionToHalfOpen();
      }
    }, 5000); // Check every 5 seconds
  }

  canAttemptRequest(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'half_open') {
      if (this.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
        this.halfOpenAttempts++;
        return true;
      }
      return false;
    }

    // state === 'open'
    if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime.getTime()) {
      this.transitionToHalfOpen();
      return true;
    }

    return false;
  }

  async recordSuccess(): Promise<void> {
    this.lastSuccessTime = new Date();

    if (this.state === 'closed') {
      this.failureCount = 0;
      return;
    }

    if (this.state === 'half_open') {
      this.successCount++;
      console.log(`[CircuitBreaker] Success in HALF_OPEN (${this.successCount}/${this.config.successThreshold})`);

      if (this.successCount >= this.config.successThreshold) {
        await this.transitionToClosed();
      }
    }

    if (this.state === 'open') {
      // Unexpected success while open - immediately try half_open
      console.log('[CircuitBreaker] Unexpected success while OPEN, transitioning to HALF_OPEN');
      this.transitionToHalfOpen();
    }
  }

  async recordFailure(error: Error): Promise<void> {
    // CRITICAL: Skip circuit breaker logic in development mode
    // This prevents the circuit from opening due to missing Netlify Functions
    if (shouldDisableMetaAPI()) {
      return;
    }

    this.lastFailureTime = new Date();

    if (this.state === 'half_open') {
      console.log('[CircuitBreaker] Failure in HALF_OPEN, reopening circuit');
      await this.transitionToOpen();
      return;
    }

    this.failureCount++;
    this.successCount = 0;

    console.log(`[CircuitBreaker] Failure recorded (${this.failureCount}/${this.config.failureThreshold})`);

    if (this.failureCount >= this.config.failureThreshold) {
      console.error('[CircuitBreaker] Failure threshold reached, opening circuit');
      await this.transitionToOpen();
    }

    await this.logFailure(error);
  }

  private async transitionToOpen(): Promise<void> {
    this.state = 'open';
    this.nextAttemptTime = new Date(Date.now() + this.config.timeout);
    this.halfOpenAttempts = 0;

    console.error(
      `[CircuitBreaker] ❌ Circuit OPENED - MetaAPI requests blocked until ${this.nextAttemptTime.toLocaleTimeString()}`
    );

    await this.persistState();
    await this.logStateChange('open', 'failure_threshold_reached');
    this.notifyListeners();
  }

  private transitionToHalfOpen(): void {
    this.state = 'half_open';
    this.successCount = 0;
    this.halfOpenAttempts = 0;

    console.log('[CircuitBreaker] ⚠️ Circuit HALF_OPEN - Testing connection recovery...');

    this.persistState();
    this.logStateChange('half_open', 'timeout_expired');
    this.notifyListeners();
  }

  private async transitionToClosed(): Promise<void> {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.halfOpenAttempts = 0;

    console.log('[CircuitBreaker] ✅ Circuit CLOSED - Normal operation restored');

    await this.persistState();
    await this.logStateChange('closed', 'recovery_successful');
    this.notifyListeners();
  }

  private async logStateChange(newState: CircuitState, reason: string): Promise<void> {
    try {
      await supabase.from('polling_recovery_log').insert({
        symbol: 'METAAPI_GLOBAL',
        trigger_reason: reason,
        recovery_action: `circuit_${newState}`,
        success: newState === 'closed',
        metrics: {
          failure_count: this.failureCount,
          success_count: this.successCount,
          state_transition: `${this.state} -> ${newState}`
        }
      });
    } catch (error) {
      console.error('[CircuitBreaker] Failed to log state change:', error);
    }
  }

  private async logFailure(error: Error): Promise<void> {
    try {
      await supabase.from('polling_recovery_log').insert({
        symbol: 'METAAPI_GLOBAL',
        trigger_reason: 'metaapi_request_failure',
        recovery_action: 'record_failure',
        success: false,
        error_message: error.message,
        metrics: {
          failure_count: this.failureCount,
          circuit_state: this.state
        }
      });
    } catch (err) {
      console.error('[CircuitBreaker] Failed to log failure:', err);
    }
  }

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      nextAttemptTime: this.nextAttemptTime
    };
  }

  onStateChange(callback: (status: CircuitBreakerStatus) => void): () => void {
    this.stateListeners.add(callback);
    callback(this.getStatus());
    return () => this.stateListeners.delete(callback);
  }

  private notifyListeners(): void {
    const status = this.getStatus();
    this.stateListeners.forEach(listener => listener(status));
  }

  async reset(): Promise<void> {
    console.log('[CircuitBreaker] Manual reset requested');
    await this.transitionToClosed();
  }

  /**
   * Check if the circuit is open (blocking requests)
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Get current circuit state
   */
  getState(): CircuitState {
    return this.state;
  }
}

export const circuitBreakerService = new CircuitBreakerService();
