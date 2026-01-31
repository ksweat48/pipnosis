/**
 * Price Staleness Monitor - Observability & CCIP Governance Tracking
 *
 * Monitors price freshness across all symbols and logs governance events.
 * Provides real-time dashboard data for price staleness visualization.
 * Tracks all freshness-related events for CCIP compliance audit trail.
 */

import { logger, LogCategory } from '@/lib/logger';
import { supabase } from '@/lib/supabase';

interface PriceFreshnessEvent {
  symbol: string;
  ageMs: number;
  timestamp: Date;
  severity: 'info' | 'warning' | 'critical';
  message: string;
}

interface SymbolFreshnessState {
  symbol: string;
  currentAgeMs: number;
  lastUpdateAt: Date;
  warningCount: number;
  criticalCount: number;
  lastWarningAt: Date | null;
  lastCriticalAt: Date | null;
}

class PriceStalnessMonitor {
  private freshnessStates: Map<string, SymbolFreshnessState> = new Map();
  private recentEvents: PriceFreshnessEvent[] = [];
  private readonly MAX_EVENT_HISTORY = 200;

  // Alert thresholds (milliseconds)
  private readonly WARNING_THRESHOLD_MS = 20000;   // 20 seconds
  private readonly CRITICAL_THRESHOLD_MS = 30000;  // 30 seconds

  private readonly MIN_LOG_INTERVAL_MS = 5000;     // Don't spam logs
  private lastLogTime: Map<string, Date> = new Map();

  /**
   * Initialize monitor for a set of symbols
   */
  initializeSymbols(symbols: string[]): void {
    symbols.forEach(symbol => {
      this.freshnessStates.set(symbol, {
        symbol,
        currentAgeMs: 0,
        lastUpdateAt: new Date(),
        warningCount: 0,
        criticalCount: 0,
        lastWarningAt: null,
        lastCriticalAt: null
      });
    });
    logger.debug(LogCategory.POLLING_COORDINATOR, `Price staleness monitor initialized for ${symbols.length} symbols`);
  }

  /**
   * Update price age for a symbol
   */
  updatePriceAge(symbol: string, ageMs: number): void {
    const state = this.freshnessStates.get(symbol);
    if (!state) {
      return;
    }

    state.currentAgeMs = ageMs;
    state.lastUpdateAt = new Date();

    // Evaluate and record if necessary
    this.evaluateFreshness(symbol, ageMs);
  }

  /**
   * Evaluate if price freshness warrants logging
   */
  private evaluateFreshness(symbol: string, ageMs: number): void {
    const state = this.freshnessStates.get(symbol);
    if (!state) {
      return;
    }

    // Check if we should log this event
    const shouldLog = this.shouldLogEvent(symbol);

    if (ageMs >= this.CRITICAL_THRESHOLD_MS) {
      state.criticalCount++;
      state.lastCriticalAt = new Date();

      if (shouldLog) {
        const event: PriceFreshnessEvent = {
          symbol,
          ageMs,
          timestamp: new Date(),
          severity: 'critical',
          message: `CRITICAL: Price ${ageMs}ms old exceeds hard limit ${this.CRITICAL_THRESHOLD_MS}ms`
        };
        this.recordEvent(event);
        this.logToGovernance(symbol, 'PRICE_CRITICAL_STALE', ageMs);
      }
    } else if (ageMs >= this.WARNING_THRESHOLD_MS) {
      state.warningCount++;
      state.lastWarningAt = new Date();

      if (shouldLog) {
        const event: PriceFreshnessEvent = {
          symbol,
          ageMs,
          timestamp: new Date(),
          severity: 'warning',
          message: `WARNING: Price ${ageMs}ms old, approaching hard limit`
        };
        this.recordEvent(event);
        this.logToGovernance(symbol, 'PRICE_WARNING_STALE', ageMs);
      }
    }
  }

  /**
   * Check if we should log an event (rate limiting)
   */
  private shouldLogEvent(symbol: string): boolean {
    const lastLog = this.lastLogTime.get(symbol);
    if (!lastLog) {
      this.lastLogTime.set(symbol, new Date());
      return true;
    }

    const timeSinceLastLog = Date.now() - lastLog.getTime();
    if (timeSinceLastLog >= this.MIN_LOG_INTERVAL_MS) {
      this.lastLogTime.set(symbol, new Date());
      return true;
    }

    return false;
  }

  /**
   * Record an event in local history
   */
  private recordEvent(event: PriceFreshnessEvent): void {
    this.recentEvents.push(event);
    if (this.recentEvents.length > this.MAX_EVENT_HISTORY) {
      this.recentEvents = this.recentEvents.slice(-this.MAX_EVENT_HISTORY);
    }

    if (event.severity === 'critical') {
      logger.error(LogCategory.POLLING_COORDINATOR, `${event.message}`);
    } else if (event.severity === 'warning') {
      logger.warn(LogCategory.POLLING_COORDINATOR, `${event.message}`);
    } else {
      logger.debug(LogCategory.POLLING_COORDINATOR, `${event.message}`);
    }
  }

  /**
   * Log to governance system (CCIP tracking)
   */
  private async logToGovernance(
    symbol: string,
    operationType: string,
    ageMs: number
  ): Promise<void> {
    try {
      // Only log if authenticated (client-side may not have user)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return; // No user session, skip governance logging
      }

      // Record in governance tracking table
      const { error } = await supabase
        .from('ccip_change_tracking')
        .insert({
          user_id: user.id,
          operation_type: operationType,
          table_name: 'realtime_prices',
          record_id: crypto.randomUUID(),
          change_details: {
            symbol,
            price_age_ms: ageMs,
            threshold_ms: operationType === 'PRICE_CRITICAL_STALE'
              ? this.CRITICAL_THRESHOLD_MS
              : this.WARNING_THRESHOLD_MS,
            timestamp: new Date().toISOString()
          }
        });

      if (error) {
        logger.error(LogCategory.POLLING_COORDINATOR, `Failed to log governance event:`, error);
      }
    } catch (error) {
      logger.error(LogCategory.POLLING_COORDINATOR, `Governance logging error:`, error);
    }
  }

  /**
   * Get current freshness state for a symbol
   */
  getFreshnessState(symbol: string): SymbolFreshnessState | undefined {
    return this.freshnessStates.get(symbol);
  }

  /**
   * Get all freshness states
   */
  getAllFreshnessStates(): Map<string, SymbolFreshnessState> {
    return new Map(this.freshnessStates);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50): PriceFreshnessEvent[] {
    return this.recentEvents.slice(-limit);
  }

  /**
   * Get monitoring summary
   */
  getSummary() {
    let warningCount = 0;
    let criticalCount = 0;
    const symbols = [];

    this.freshnessStates.forEach(state => {
      warningCount += state.warningCount;
      criticalCount += state.criticalCount;

      symbols.push({
        symbol: state.symbol,
        currentAgeMs: state.currentAgeMs,
        lastUpdateAt: state.lastUpdateAt,
        warningCount: state.warningCount,
        criticalCount: state.criticalCount,
        status: state.currentAgeMs >= this.CRITICAL_THRESHOLD_MS
          ? 'critical'
          : state.currentAgeMs >= this.WARNING_THRESHOLD_MS
          ? 'warning'
          : 'healthy'
      });
    });

    return {
      totalSymbols: this.freshnessStates.size,
      warningCount,
      criticalCount,
      recentEvents: this.getRecentEvents(10),
      symbols,
      thresholds: {
        warning_ms: this.WARNING_THRESHOLD_MS,
        critical_ms: this.CRITICAL_THRESHOLD_MS
      }
    };
  }
}

// Export singleton instance
export const priceStalnessMonitor = new PriceStalnessMonitor();
