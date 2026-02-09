/**
 * Price Staleness Monitor Service
 *
 * SSOT: Single source of truth for price data freshness
 * Runs periodically to update the polling_price_staleness table
 * Enables mid-trade monitor to detect stale data and warn users
 *
 * Governance:
 * - Service role only - cannot be called by authenticated users
 * - Updates polling_price_staleness table on fixed interval
 * - Tracks staleness trends for diagnostics
 * - Alerts when critical staleness detected
 */

import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';
import { TIME_CONSTANTS } from '@/config/time-constants';

// Use SSOT TIME_CONSTANTS for thresholds
const STALE_THRESHOLD_SECONDS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_CRITICAL;
const CRITICAL_THRESHOLD_SECONDS = TIME_CONSTANTS.SECONDS.PRICE_STALENESS_BLOCK_TRADING;
const CHECK_INTERVAL_MS = 30000; // Check every 30 seconds

interface PriceStatenessStatus {
  symbol: string;
  staleness_minutes: number;
  is_critical: boolean;
  last_update_age_seconds: number;
}

class PriceStalenessMonitor {
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  /**
   * Start monitoring price staleness
   */
  start(): void {
    if (this.isRunning) {
      logger.debug(LogCategory.POLLING_COORDINATOR, 'Price staleness monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info(LogCategory.POLLING_COORDINATOR, '🔍 Starting price staleness monitor');

    // Run check immediately
    this.checkPricesStaleness();

    // Then run periodically
    this.checkInterval = setInterval(() => {
      this.checkPricesStaleness();
    }, CHECK_INTERVAL_MS);
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    logger.info(LogCategory.POLLING_COORDINATOR, '⏹️ Price staleness monitor stopped');
  }

  /**
   * Check all prices and update staleness table
   * SSOT: Updates polling_price_staleness with current status
   */
  private async checkPricesStaleness(): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Fetch all realtime prices with their timestamps
      const { data: prices, error: pricesError } = await supabase
        .from('realtime_prices')
        .select('symbol, created_at')
        .order('created_at', { ascending: false });

      if (pricesError) {
        logger.error(LogCategory.POLLING_COORDINATOR, `Failed to fetch prices for staleness check: ${pricesError.message}`);
        return;
      }

      if (!prices || prices.length === 0) {
        logger.debug(LogCategory.POLLING_COORDINATOR, 'No prices found for staleness check');
        return;
      }

      // Get latest price for each symbol
      const latestPrices = new Map<string, Date>();
      for (const price of prices) {
        if (!latestPrices.has(price.symbol)) {
          latestPrices.set(price.symbol, new Date(price.created_at));
        }
      }

      // Calculate staleness and update database
      const now = new Date();
      const updates: PriceStatenessStatus[] = [];

      for (const [symbol, lastUpdate] of latestPrices.entries()) {
        const ageMs = now.getTime() - lastUpdate.getTime();
        const ageSeconds = Math.floor(ageMs / 1000);
        const ageMinutes = ageSeconds / 60;

        // Use SSOT TIME_CONSTANTS for threshold comparisons
        const isCritical = ageSeconds > CRITICAL_THRESHOLD_SECONDS;
        const isStale = ageSeconds > STALE_THRESHOLD_SECONDS;

        updates.push({
          symbol,
          staleness_minutes: ageMinutes,
          is_critical: isCritical,
          last_update_age_seconds: ageSeconds
        });

        // Log critical staleness
        if (isCritical) {
          logger.warn(
            LogCategory.POLLING_COORDINATOR,
            `CRITICAL: ${symbol} price is ${ageSeconds}s stale (threshold: ${CRITICAL_THRESHOLD_SECONDS}s)`
          );
        } else if (isStale) {
          logger.debug(
            LogCategory.POLLING_COORDINATOR,
            `${symbol} price is ${ageSeconds}s stale (threshold: ${STALE_THRESHOLD_SECONDS}s)`
          );
        }
      }

      // Update staleness records
      for (const update of updates) {
        const { error: updateError } = await supabase
          .from('polling_price_staleness')
          .upsert({
            symbol: update.symbol,
            last_update_at: new Date(now.getTime() - update.last_update_age_seconds * 1000),
            staleness_minutes: update.staleness_minutes,
            is_critical: update.is_critical,
            updated_at: now
          }, {
            onConflict: 'symbol'
          });

        if (updateError) {
          logger.error(
            LogCategory.POLLING_COORDINATOR,
            `Failed to update staleness for ${update.symbol}: ${updateError.message}`
          );
        }
      }

      // Log summary
      const criticalCount = updates.filter(u => u.is_critical).length;
      const staleCount = updates.filter(u => u.staleness_minutes > STALE_THRESHOLD_MINUTES).length;

      if (criticalCount > 0) {
        logger.warn(
          LogCategory.POLLING_COORDINATOR,
          `📊 Price staleness check: ${criticalCount} critical, ${staleCount} stale out of ${updates.length} symbols`
        );
      } else {
        logger.debug(
          LogCategory.POLLING_COORDINATOR,
          `📊 Price staleness check: ${staleCount} stale out of ${updates.length} symbols (all fresh)`
        );
      }
    } catch (error) {
      logger.error(
        LogCategory.POLLING_COORDINATOR,
        `Error checking price staleness: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Manually trigger a staleness check
   */
  async checkNow(): Promise<void> {
    await this.checkPricesStaleness();
  }

  /**
   * Get current staleness status for a symbol
   */
  async getStatus(symbol: string): Promise<PriceStatenessStatus | null> {
    try {
      const { data, error } = await supabase
        .from('polling_price_staleness')
        .select('symbol, staleness_minutes, is_critical, updated_at')
        .eq('symbol', symbol)
        .single();

      if (error || !data) {
        return null;
      }

      const updateAge = Math.floor(
        (Date.now() - new Date(data.updated_at).getTime()) / 1000
      );

      return {
        symbol: data.symbol,
        staleness_minutes: data.staleness_minutes,
        is_critical: data.is_critical,
        last_update_age_seconds: updateAge
      };
    } catch (error) {
      logger.error(
        LogCategory.POLLING_COORDINATOR,
        `Failed to get staleness status for ${symbol}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Get all symbols currently in critical staleness
   */
  async getCriticalSymbols(): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('polling_price_staleness')
        .select('symbol')
        .eq('is_critical', true);

      if (error) {
        return [];
      }

      return (data || []).map(item => item.symbol);
    } catch (error) {
      logger.error(
        LogCategory.POLLING_COORDINATOR,
        `Failed to get critical symbols: ${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  }
}

export const priceStalenessMonitor = new PriceStalenessMonitor();
