/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ⚡ CHART CIRCUIT BREAKER - CONTAMINATION PROTECTION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This service monitors chart data integrity and automatically stops chart updates
 * if cross-contamination is detected, preventing bad data from reaching users.
 *
 * CRITICAL RULES:
 * 1. Circuit OPENS on contamination detection (stops all updates)
 * 2. Circuit CLOSES only after manual verification
 * 3. ALL contamination events are logged and alerted
 * 4. Fallback to cached clean data during outage
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ValidatedSymbol } from '@/types/symbol';
import { logger, LogCategory } from '@/lib/logger';

// Circuit states
export type CircuitState = 'closed' | 'open' | 'half-open';

// Contamination event
export interface ContaminationEvent {
  timestamp: number;
  symbol: ValidatedSymbol;
  expectedSymbol: ValidatedSymbol;
  source: string;
  data: any;
  stackTrace: string;
}

// Circuit breaker configuration
export interface CircuitBreakerConfig {
  // How many contamination events before opening circuit
  threshold: number;
  // Time window for counting events (ms)
  windowMs: number;
  // Cooldown period before attempting half-open (ms)
  cooldownMs: number;
  // Auto-recovery enabled
  autoRecovery: boolean;
}

// Default configuration
const DEFAULT_CONFIG: CircuitBreakerConfig = {
  threshold: 3, // Open circuit after 3 contamination events
  windowMs: 60000, // Within 1 minute
  cooldownMs: 300000, // 5 minute cooldown
  autoRecovery: false, // Require manual recovery
};

// Alert callback type
export type AlertCallback = (event: ContaminationEvent) => void;

class ChartCircuitBreaker {
  private state: CircuitState = 'closed';
  private config: CircuitBreakerConfig = DEFAULT_CONFIG;
  private events: ContaminationEvent[] = [];
  private lastStateChange: number = Date.now();
  private alertCallbacks: Set<AlertCallback> = new Set();
  private recoveryAttempts: number = 0;
  private readonly MAX_RECOVERY_ATTEMPTS = 3;

  // Symbol-specific circuit breakers
  private symbolCircuits: Map<ValidatedSymbol, CircuitState> = new Map();
  private symbolEvents: Map<ValidatedSymbol, ContaminationEvent[]> = new Map();

  constructor(config?: Partial<CircuitBreakerConfig>) {
    if (config) {
      this.config = { ...DEFAULT_CONFIG, ...config };
    }
  }

  /**
   * Record a contamination event
   */
  recordContamination(
    symbol: ValidatedSymbol,
    expectedSymbol: ValidatedSymbol,
    source: string,
    data: any
  ): void {
    const event: ContaminationEvent = {
      timestamp: Date.now(),
      symbol,
      expectedSymbol,
      source,
      data,
      stackTrace: new Error().stack || '',
    };

    // Add to global events
    this.events.push(event);

    // Add to symbol-specific events
    if (!this.symbolEvents.has(expectedSymbol)) {
      this.symbolEvents.set(expectedSymbol, []);
    }
    this.symbolEvents.get(expectedSymbol)!.push(event);

    // Log critical error
    logger.error(
      LogCategory.CHART,
      `🚨 CONTAMINATION DETECTED: ${expectedSymbol} received ${symbol} data from ${source}`,
      { event }
    );

    // Alert all listeners
    this.alertCallbacks.forEach(callback => {
      try {
        callback(event);
      } catch (error) {
        console.error('[CircuitBreaker] Alert callback error:', error);
      }
    });

    // Check if circuit should open
    this.evaluateCircuitState(expectedSymbol);
  }

  /**
   * Evaluate if circuit should change state
   */
  private evaluateCircuitState(symbol: ValidatedSymbol): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get recent events for this symbol
    const recentEvents = (this.symbolEvents.get(symbol) || [])
      .filter(e => e.timestamp >= windowStart);

    // Check global events too
    const globalRecentEvents = this.events.filter(e => e.timestamp >= windowStart);

    // Open circuit if threshold exceeded
    if (
      recentEvents.length >= this.config.threshold ||
      globalRecentEvents.length >= this.config.threshold * 2
    ) {
      this.openCircuit(symbol);
    }
  }

  /**
   * Open the circuit breaker (stop all updates)
   */
  private openCircuit(symbol: ValidatedSymbol): void {
    if (this.symbolCircuits.get(symbol) === 'open') {
      return; // Already open
    }

    this.symbolCircuits.set(symbol, 'open');
    this.state = 'open'; // Also open global circuit
    this.lastStateChange = Date.now();

    logger.error(
      LogCategory.CHART,
      `🔴 CIRCUIT BREAKER OPENED for ${symbol} - Chart updates STOPPED`,
      {
        reason: 'Contamination threshold exceeded',
        events: this.symbolEvents.get(symbol)?.length || 0,
        threshold: this.config.threshold,
      }
    );

    // Trigger emergency alert
    this.triggerEmergencyAlert(symbol);

    // Schedule auto-recovery attempt if enabled
    if (this.config.autoRecovery) {
      setTimeout(() => this.attemptRecovery(symbol), this.config.cooldownMs);
    }
  }

  /**
   * Close the circuit breaker (resume updates)
   */
  closeCircuit(symbol?: ValidatedSymbol): void {
    if (symbol) {
      this.symbolCircuits.set(symbol, 'closed');
      this.symbolEvents.delete(symbol); // Clear events
      logger.info(
        LogCategory.CHART,
        `🟢 CIRCUIT BREAKER CLOSED for ${symbol} - Updates resumed`
      );
    } else {
      // Close all circuits
      this.state = 'closed';
      this.symbolCircuits.clear();
      this.events = [];
      this.symbolEvents.clear();
      this.recoveryAttempts = 0;
      logger.info(LogCategory.CHART, '🟢 ALL CIRCUIT BREAKERS CLOSED');
    }

    this.lastStateChange = Date.now();
  }

  /**
   * Attempt automatic recovery
   */
  private attemptRecovery(symbol: ValidatedSymbol): void {
    if (this.recoveryAttempts >= this.MAX_RECOVERY_ATTEMPTS) {
      logger.error(
        LogCategory.CHART,
        `❌ Max recovery attempts reached for ${symbol} - Manual intervention required`
      );
      return;
    }

    this.recoveryAttempts++;
    this.symbolCircuits.set(symbol, 'half-open');

    logger.info(
      LogCategory.CHART,
      `🟡 CIRCUIT HALF-OPEN for ${symbol} - Testing recovery (attempt ${this.recoveryAttempts}/${this.MAX_RECOVERY_ATTEMPTS})`
    );

    // Test period - if no contamination in next minute, close circuit
    setTimeout(() => {
      const recentEvents = (this.symbolEvents.get(symbol) || [])
        .filter(e => e.timestamp >= Date.now() - 60000);

      if (recentEvents.length === 0) {
        this.closeCircuit(symbol);
      } else {
        this.openCircuit(symbol);
      }
    }, 60000);
  }

  /**
   * Check if updates are allowed for a symbol
   */
  isUpdateAllowed(symbol: ValidatedSymbol): boolean {
    const symbolState = this.symbolCircuits.get(symbol) || 'closed';
    return symbolState === 'closed' || symbolState === 'half-open';
  }

  /**
   * Get current state
   */
  getState(symbol?: ValidatedSymbol): CircuitState {
    if (symbol) {
      return this.symbolCircuits.get(symbol) || 'closed';
    }
    return this.state;
  }

  /**
   * Get contamination events
   */
  getEvents(symbol?: ValidatedSymbol): ContaminationEvent[] {
    if (symbol) {
      return this.symbolEvents.get(symbol) || [];
    }
    return this.events;
  }

  /**
   * Register alert callback
   */
  onContamination(callback: AlertCallback): () => void {
    this.alertCallbacks.add(callback);
    return () => this.alertCallbacks.delete(callback);
  }

  /**
   * Trigger emergency alert
   */
  private triggerEmergencyAlert(symbol: ValidatedSymbol): void {
    // Log to console with high visibility
    console.error('═══════════════════════════════════════════════════════════════');
    console.error('🚨 CRITICAL: CHART CONTAMINATION DETECTED');
    console.error('═══════════════════════════════════════════════════════════════');
    console.error(`Symbol: ${symbol}`);
    console.error(`Events: ${this.symbolEvents.get(symbol)?.length || 0}`);
    console.error(`State: CIRCUIT BREAKER OPEN`);
    console.error('Action: Chart updates STOPPED');
    console.error('Recovery: Manual intervention required');
    console.error('═══════════════════════════════════════════════════════════════');

    // Trigger browser notification if supported
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Pipnosis Chart Alert', {
        body: `Critical: Chart contamination detected for ${symbol}`,
        icon: '/Pipnosis icon.png',
        tag: 'chart-contamination',
        requireInteraction: true,
      });
    }
  }

  /**
   * Get circuit breaker status
   */
  getStatus(): {
    state: CircuitState;
    events: number;
    symbolStates: Record<string, CircuitState>;
    uptime: number;
    recoveryAttempts: number;
  } {
    const symbolStates: Record<string, CircuitState> = {};
    this.symbolCircuits.forEach((state, symbol) => {
      symbolStates[symbol] = state;
    });

    return {
      state: this.state,
      events: this.events.length,
      symbolStates,
      uptime: Date.now() - this.lastStateChange,
      recoveryAttempts: this.recoveryAttempts,
    };
  }

  /**
   * Reset circuit breaker (emergency use only)
   */
  reset(): void {
    this.closeCircuit();
    logger.warn(LogCategory.CHART, '⚠️ CIRCUIT BREAKER MANUALLY RESET');
  }
}

// Global singleton instance
export const chartCircuitBreaker = new ChartCircuitBreaker();

// Export for testing
export { ChartCircuitBreaker };
