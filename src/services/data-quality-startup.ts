/**
 * Data Quality Startup Service
 *
 * STATUS: DISABLED BY DEFAULT (to prevent console spam on startup)
 *
 * Validates and repairs candle data for crypto symbols.
 * Ensures EQS calculations always have complete, high-quality data.
 *
 * WORKFLOW:
 * 1. Check data quality for crypto symbols (BTCUSD, ETHUSD)
 * 2. If DOJIs or gaps found, trigger Kraken REST backfill
 * 3. Run silently in background - doesn't block app startup
 *
 * MANUAL USAGE:
 * To run manually: dataQualityStartup.forceRerun()
 * To re-enable automatic startup: Uncomment in App.tsx (lines 118-128)
 */

import { logger, LogCategory } from '@/lib/logger';
import { krakenBackfillService } from './kraken-backfill-service';
import { candleQualityValidator } from './candle-quality-validator';

class DataQualityStartupService {
  private hasRun = false;
  private isRunning = false;
  private cspBlocked = false; // Track if Kraken API is CSP-blocked

  /**
   * Run data quality check and repair on app startup
   * Non-blocking - runs in background
   */
  async runStartupChecks(): Promise<void> {
    // Only run once per session
    if (this.hasRun || this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      logger.info('[DataQualityStartup] Running data quality checks...', LogCategory.DATA);

      // Check and repair crypto symbols
      const symbols = ['BTCUSD', 'ETHUSD'];

      for (const symbol of symbols) {
        await this.checkAndRepairSymbol(symbol);
      }

      logger.info('[DataQualityStartup] ✅ Startup checks complete', LogCategory.DATA);
      this.hasRun = true;

    } catch (error) {
      logger.error(`[DataQualityStartup] Failed: ${error}`, LogCategory.DATA);
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Check and repair a single symbol
   */
  private async checkAndRepairSymbol(symbol: string): Promise<void> {
    // Skip if we already know Kraken API is CSP-blocked
    if (this.cspBlocked) {
      return;
    }

    try {
      // Quick validation first
      const validation = await krakenBackfillService.validateSymbol(symbol, 5, 72);

      if (!validation.hasIssues) {
        logger.info(
          `[DataQualityStartup] ${symbol} data is healthy (score: ${validation.healthScore})`,
          LogCategory.DATA
        );
        return;
      }

      logger.warn(
        `[DataQualityStartup] ${symbol} needs repair: ${validation.dojiCount} DOJIs, ${validation.gapCount} gaps`,
        LogCategory.DATA
      );

      // Trigger repair
      const result = await krakenBackfillService.backfillSymbol(symbol, 5, 72);

      if (result.success) {
        logger.info(
          `[DataQualityStartup] ✅ ${symbol} repaired: ${result.dojisRepaired} DOJIs, ${result.gapsFilled} gaps`,
          LogCategory.DATA
        );
      } else {
        logger.error(
          `[DataQualityStartup] ❌ ${symbol} repair failed: ${result.error}`,
          LogCategory.DATA
        );
      }

    } catch (error) {
      // Detect CSP violation errors and stop trying
      const errorStr = String(error);
      if (
        errorStr.includes('Failed to fetch') ||
        errorStr.includes('CSP') ||
        errorStr.includes('Content Security Policy')
      ) {
        this.cspBlocked = true;
        logger.warn(
          `[DataQualityStartup] Kraken API blocked by CSP - disabling backfill (one-time warning)`,
          LogCategory.DATA
        );
        return;
      }

      logger.error(`[DataQualityStartup] Error checking ${symbol}: ${error}`, LogCategory.DATA);
    }
  }

  /**
   * Force re-run of checks (for manual trigger or testing)
   */
  async forceRerun(): Promise<void> {
    this.hasRun = false;
    await this.runStartupChecks();
  }

  /**
   * Get status of startup checks
   */
  getStatus(): { hasRun: boolean; isRunning: boolean } {
    return {
      hasRun: this.hasRun,
      isRunning: this.isRunning
    };
  }
}

export const dataQualityStartup = new DataQualityStartupService();
