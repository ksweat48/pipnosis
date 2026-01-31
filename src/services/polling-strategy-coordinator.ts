/**
 * Polling Strategy Coordinator - SSOT for Polling Configuration
 *
 * Single source of truth for polling interval decisions.
 * Base strategy on SESSION STATE, not error counts.
 *
 * Philosophy:
 * - Circuit breaker handles ALERTING and FALLBACK, not polling intervals
 * - Polling intervals are controlled by session state (active vs monitoring)
 * - Polling intervals are symbol-aware (crypto 24/7 vs forex session hours)
 * - Minimum interval is 5 seconds (never degrade below this)
 * - Price staleness is handled by PriceRefreshTrigger (emergency injection)
 */

import { logger, LogCategory } from '@/lib/logger';

type SessionState = 'active_trading' | 'monitoring' | 'inactive';
type SymbolClass = 'crypto' | 'forex' | 'index';

interface PollingStrategy {
  sessionState: SessionState;
  symbolClass: SymbolClass;
  intervalMs: number;
  reason: string;
}

interface SymbolPollingState {
  symbol: string;
  symbolClass: SymbolClass;
  lastPolledAt: Date | null;
  currentInterval: number;
  marketOpen: boolean;
}

class PollingStrategyCoordinator {
  private sessionState: SessionState = 'inactive';
  private activeSymbols: Map<string, SymbolPollingState> = new Map();

  // Polling intervals by session state
  private readonly INTERVALS = {
    // Active trading (executing trades right now)
    ACTIVE_TRADING: {
      crypto: 1000,      // 1 second for crypto (no latency concerns)
      forex: 3000,       // 3 seconds for forex
      index: 3000        // 3 seconds for indices
    },
    // Monitoring mode (trades open, not actively entering)
    MONITORING: {
      crypto: 3000,      // 3 seconds for crypto
      forex: 5000,       // 5 seconds for forex
      index: 5000        // 5 seconds for indices
    },
    // Inactive (no active trades)
    INACTIVE: {
      crypto: 30000,     // 30 seconds (can be slow, no active trades)
      forex: 30000,      // 30 seconds
      index: 30000       // 30 seconds
    }
  };

  private readonly MIN_POLLING_INTERVAL_MS = 5000; // Never go slower than 5 seconds
  private readonly MAX_POLLING_INTERVAL_MS = 30000; // Never go faster than 1 second (1000ms)

  /**
   * Initialize the coordinator with known symbols
   */
  initializeSymbols(symbols: string[]): void {
    symbols.forEach(symbol => {
      const symbolClass = this.classifySymbol(symbol);
      this.activeSymbols.set(symbol, {
        symbol,
        symbolClass,
        lastPolledAt: null,
        currentInterval: this.getInterval('inactive', symbolClass),
        marketOpen: false
      });
    });
    logger.debug(LogCategory.POLLING_COORDINATOR, `Initialized polling strategy for ${symbols.length} symbols`);
  }

  /**
   * Update session state (e.g., when trade is opened/closed)
   */
  setSessionState(newState: SessionState): void {
    if (newState === this.sessionState) {
      return;
    }

    const oldState = this.sessionState;
    this.sessionState = newState;

    logger.info(
      LogCategory.POLLING_COORDINATOR,
      `Session state: ${oldState} -> ${newState}`
    );

    // Update all symbol intervals based on new state
    this.updateAllSymbolIntervals();
  }

  /**
   * Get the appropriate polling interval for a symbol
   */
  getPollingInterval(symbol: string): number {
    const state = this.activeSymbols.get(symbol);
    if (!state) {
      return this.MIN_POLLING_INTERVAL_MS;
    }

    // Don't poll if market is closed
    if (!state.marketOpen) {
      return 30000; // Check every 30 seconds if market is closed
    }

    return state.currentInterval;
  }

  /**
   * Notify that a market is open/closed
   */
  updateMarketStatus(symbol: string, isOpen: boolean): void {
    const state = this.activeSymbols.get(symbol);
    if (state) {
      state.marketOpen = isOpen;
    }
  }

  /**
   * Record a successful poll (for tracking)
   */
  recordPoll(symbol: string): void {
    const state = this.activeSymbols.get(symbol);
    if (state) {
      state.lastPolledAt = new Date();
    }
  }

  /**
   * Get current strategy for monitoring/debugging
   */
  getStrategy(symbol: string): PollingStrategy {
    const state = this.activeSymbols.get(symbol);
    if (!state) {
      return {
        sessionState: this.sessionState,
        symbolClass: 'forex',
        intervalMs: this.MIN_POLLING_INTERVAL_MS,
        reason: 'Symbol not found'
      };
    }

    const interval = state.currentInterval;
    const reason = `Session: ${this.sessionState}, Symbol: ${symbol} (${state.symbolClass})`;

    return {
      sessionState: this.sessionState,
      symbolClass: state.symbolClass,
      intervalMs: interval,
      reason
    };
  }

  /**
   * Get all active symbol strategies
   */
  getAllStrategies(): Map<string, PollingStrategy> {
    const strategies = new Map<string, PollingStrategy>();

    this.activeSymbols.forEach((state, symbol) => {
      strategies.set(symbol, {
        sessionState: this.sessionState,
        symbolClass: state.symbolClass,
        intervalMs: state.currentInterval,
        reason: `${this.sessionState}/${state.symbolClass}`
      });
    });

    return strategies;
  }

  /**
   * Classify a symbol by type
   */
  private classifySymbol(symbol: string): SymbolClass {
    const cryptoSymbols = ['BTCUSD', 'ETHUSD'];
    if (cryptoSymbols.includes(symbol.toUpperCase())) {
      return 'crypto';
    }

    const indexSymbols = ['US30'];
    if (indexSymbols.includes(symbol.toUpperCase())) {
      return 'index';
    }

    return 'forex'; // Default to forex
  }

  /**
   * Get interval for a specific session state and symbol class
   */
  private getInterval(sessionState: SessionState, symbolClass: SymbolClass): number {
    const intervals = this.INTERVALS[sessionState];
    const interval = intervals[symbolClass];

    // Enforce minimum interval
    return Math.max(interval, this.MIN_POLLING_INTERVAL_MS);
  }

  /**
   * Update all symbol intervals when session state changes
   */
  private updateAllSymbolIntervals(): void {
    this.activeSymbols.forEach((state) => {
      state.currentInterval = this.getInterval(this.sessionState, state.symbolClass);
    });

    logger.debug(
      LogCategory.POLLING_COORDINATOR,
      `Updated all symbol intervals for session state: ${this.sessionState}`
    );
  }

  /**
   * Get status for monitoring
   */
  getStatus() {
    return {
      sessionState: this.sessionState,
      symbolCount: this.activeSymbols.size,
      strategies: Array.from(this.activeSymbols.entries()).map(([symbol, state]) => ({
        symbol,
        intervalMs: state.currentInterval,
        symbolClass: state.symbolClass,
        marketOpen: state.marketOpen,
        lastPolledAt: state.lastPolledAt
      }))
    };
  }
}

// Export singleton instance
export const pollingStrategyCoordinator = new PollingStrategyCoordinator();
