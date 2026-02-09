/**
 * Price Refresh Trigger - Emergency Price Data Injection
 *
 * Detects when price data is approaching staleness and triggers emergency
 * refresh mechanisms to ensure execution always has fresh prices.
 *
 * Philosophy:
 * - Price freshness is critical for execution, more important than reducing API calls
 * - When prices get old, trigger IMMEDIATE action, not degraded polling
 * - Multiple fallback mechanisms ensure we always have fresh data
 * - This is separate from circuit breaker (which handles ALERTS/FALLBACKS)
 */

import { logger, LogCategory } from '@/lib/logger';
import { tickBufferService } from './tick-buffer-service';
import { TIME_CONSTANTS } from '@/config/time-constants';
import { priceFreshnessGate } from '@/governance/price-freshness-gate';

interface PriceAge {
  symbol: string;
  ageMs: number;
  timestampUtc: Date;
  isFresh: boolean;
  needsRefresh: boolean;
}

interface RefreshAction {
  symbol: string;
  action: 'force_browser_poll' | 'edge_function_call';
  reason: string;
  triggeredAt: Date;
}

class PriceRefreshTrigger {
  // Use SSOT TIME_CONSTANTS for thresholds (converted to milliseconds)
  private readonly FRESHNESS_TARGET_MS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING * 1000;
  private readonly WARNING_THRESHOLD_MS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_WARNING * 1000;
  private readonly HARD_LIMIT_MS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL * 1000;

  private lastRefreshAttempt: Map<string, Date> = new Map();
  private readonly MIN_REFRESH_INTERVAL_MS = 5000;   // Don't spam refresh calls

  private recentActions: RefreshAction[] = [];
  private readonly MAX_ACTION_HISTORY = 100;

  /**
   * Check if a price needs emergency refresh based on age
   */
  shouldRefresh(symbol: string, priceAgeMs: number): boolean {
    // Hard limit: ALWAYS refresh if exceeds 30 seconds
    if (priceAgeMs > this.HARD_LIMIT_MS) {
      return true;
    }

    // Warning threshold: refresh if hitting 20+ seconds
    if (priceAgeMs > this.WARNING_THRESHOLD_MS) {
      // But don't spam refresh attempts - minimum 5 second interval
      const lastAttempt = this.lastRefreshAttempt.get(symbol);
      if (lastAttempt) {
        const timeSinceLastAttempt = Date.now() - lastAttempt.getTime();
        if (timeSinceLastAttempt < this.MIN_REFRESH_INTERVAL_MS) {
          return false; // Already attempted recently
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Execute emergency refresh for a symbol
   */
  async executeRefresh(symbol: string, priceAgeMs: number): Promise<void> {
    const freshness = this.getPriceAge(symbol, priceAgeMs);

    if (!freshness.needsRefresh) {
      return; // Price is still acceptable
    }

    logger.warn(
      LogCategory.POLLING_COORDINATOR,
      `Price staleness warning: ${symbol} is ${priceAgeMs}ms old (threshold: ${this.WARNING_THRESHOLD_MS}ms)`
    );

    // Determine which refresh action to take
    const action = this.selectRefreshAction(symbol, priceAgeMs);

    this.lastRefreshAttempt.set(symbol, new Date());
    this.recordAction(action);

    try {
      switch (action.action) {
        case 'force_browser_poll':
          await this.forceBrowserPoll(symbol);
          break;
        case 'edge_function_call':
          await this.callEdgeFunction(symbol);
          break;
      }
    } catch (error) {
      logger.error(
        LogCategory.POLLING_COORDINATOR,
        `Price refresh failed for ${symbol}:`,
        error
      );
    }
  }

  /**
   * Analyze price age and freshness
   */
  getPriceAge(symbol: string, ageMs: number): PriceAge {
    return {
      symbol,
      ageMs,
      timestampUtc: new Date(Date.now() - ageMs),
      isFresh: ageMs < this.FRESHNESS_TARGET_MS,
      needsRefresh: ageMs > this.WARNING_THRESHOLD_MS
    };
  }

  /**
   * Select the best refresh action based on age severity
   */
  private selectRefreshAction(symbol: string, priceAgeMs: number): RefreshAction {
    // Hard limit: use all mechanisms
    if (priceAgeMs > this.HARD_LIMIT_MS) {
      const action: RefreshAction = {
        symbol,
        action: 'force_browser_poll',
        reason: `CRITICAL: Price ${priceAgeMs}ms old exceeds hard limit ${this.HARD_LIMIT_MS}ms`,
        triggeredAt: new Date()
      };
      logger.error(
        LogCategory.POLLING_COORDINATOR,
        `${action.reason} - executing immediate browser poll`
      );
      return action;
    }

    // Warning threshold: prioritize browser poll
    if (priceAgeMs > this.WARNING_THRESHOLD_MS) {
      return {
        symbol,
        action: 'force_browser_poll',
        reason: `WARNING: Price ${priceAgeMs}ms old, triggering emergency refresh`,
        triggeredAt: new Date()
      };
    }

    // Fallback
    return {
      symbol,
      action: 'force_browser_poll',
      reason: 'Price refresh requested',
      triggeredAt: new Date()
    };
  }

  /**
   * Force an immediate browser poll bypass circuit breaker
   */
  private async forceBrowserPoll(symbol: string): Promise<void> {
    try {
      logger.info(
        LogCategory.POLLING_COORDINATOR,
        `Forcing browser poll for ${symbol} (bypassing circuit breaker)...`
      );

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);

      const response = await fetch(`/.netlify/functions/get-live-price?symbol=${symbol}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.bid && data.ask) {
          logger.info(LogCategory.POLLING_COORDINATOR, `✅ Emergency refresh succeeded: ${symbol} ${data.bid}/${data.ask}`);
          await tickBufferService.bufferTick(
            symbol,
            parseFloat(data.bid),
            parseFloat(data.ask),
            new Date().toISOString(),
            data.broker_time
          );
        }
      }
    } catch (error) {
      logger.error(LogCategory.POLLING_COORDINATOR, `Browser poll failed for ${symbol}:`, error);
    }
  }

  /**
   * Call edge function for emergency price fetch
   */
  private async callEdgeFunction(symbol: string): Promise<void> {
    try {
      logger.info(LogCategory.POLLING_COORDINATOR, `Calling edge function for emergency price: ${symbol}`);
      // This would be implemented when edge functions are ready
      // For now, browser poll is sufficient
    } catch (error) {
      logger.error(LogCategory.POLLING_COORDINATOR, `Edge function call failed for ${symbol}:`, error);
    }
  }

  /**
   * Record a refresh action for monitoring
   */
  private recordAction(action: RefreshAction): void {
    this.recentActions.push(action);
    if (this.recentActions.length > this.MAX_ACTION_HISTORY) {
      this.recentActions = this.recentActions.slice(-this.MAX_ACTION_HISTORY);
    }
  }

  /**
   * Get recent refresh actions
   */
  getRecentActions(limit: number = 20): RefreshAction[] {
    return this.recentActions.slice(-limit);
  }

  /**
   * Get monitoring status
   */
  getStatus() {
    return {
      thresholds: {
        freshness_target_ms: this.FRESHNESS_TARGET_MS,
        warning_threshold_ms: this.WARNING_THRESHOLD_MS,
        hard_limit_ms: this.HARD_LIMIT_MS
      },
      recentActions: this.getRecentActions(10),
      lastAttempts: Array.from(this.lastRefreshAttempt.entries()).map(([symbol, time]) => ({
        symbol,
        lastAttemptAt: time
      }))
    };
  }
}

// Export singleton instance
export const priceRefreshTrigger = new PriceRefreshTrigger();
