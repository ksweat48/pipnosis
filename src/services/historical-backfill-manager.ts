import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';

interface BackfillStatus {
  symbol: string;
  timeframe: string;
  lastBackfillDate: Date | null;
  needsBackfill: boolean;
  daysAvailable: number;
}

interface BackfillResult {
  success: boolean;
  candlesFilled: number;
  error?: string;
}

const ACTIVE_SYMBOLS = ['XAUUSD', 'US30', 'EURUSD', 'GBPUSD', 'USDJPY'];
const TIMEFRAMES = ['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'];
const TARGET_DAYS = 30;
const BACKFILL_CHECK_KEY = 'last_historical_backfill_check';

class HistoricalBackfillManager {
  private isBackfilling = false;
  private backfillProgress: Map<string, number> = new Map();

  async shouldRunBackfill(): Promise<boolean> {
    try {
      const lastCheck = localStorage.getItem(BACKFILL_CHECK_KEY);

      if (!lastCheck) {
        return true;
      }

      const lastCheckDate = new Date(lastCheck);
      const hoursSinceLastCheck = (Date.now() - lastCheckDate.getTime()) / (1000 * 60 * 60);

      if (hoursSinceLastCheck >= 24) {
        logger.info('[HistoricalBackfill] 24 hours since last check, backfill needed');
        return true;
      }

      return false;
    } catch (error) {
      logger.error('[HistoricalBackfill] Error checking backfill schedule:', error);
      return false;
    }
  }

  async checkBackfillStatus(symbol: string, timeframe: string): Promise<BackfillStatus> {
    try {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - TARGET_DAYS);

      const { data: oldestCandle, error } = await supabase
        .from('forex_candles')
        .select('open_time')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('open_time', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (error) {
        logger.error(`[HistoricalBackfill] Error checking ${symbol} ${timeframe}:`, error);
        return {
          symbol,
          timeframe,
          lastBackfillDate: null,
          needsBackfill: true,
          daysAvailable: 0
        };
      }

      if (!oldestCandle) {
        return {
          symbol,
          timeframe,
          lastBackfillDate: null,
          needsBackfill: true,
          daysAvailable: 0
        };
      }

      const oldestDate = new Date(oldestCandle.open_time);
      const daysAvailable = Math.floor((Date.now() - oldestDate.getTime()) / (1000 * 60 * 60 * 24));
      const needsBackfill = oldestDate > thirtyDaysAgo;

      return {
        symbol,
        timeframe,
        lastBackfillDate: oldestDate,
        needsBackfill,
        daysAvailable
      };

    } catch (error) {
      logger.error(`[HistoricalBackfill] Error checking backfill status:`, error);
      return {
        symbol,
        timeframe,
        lastBackfillDate: null,
        needsBackfill: true,
        daysAvailable: 0
      };
    }
  }

  async triggerBackfillForSymbol(symbol: string, timeframe: string, daysToFetch: number): Promise<BackfillResult> {
    const key = `${symbol}_${timeframe}`;

    try {
      logger.info(`[HistoricalBackfill] Triggering backfill for ${symbol} ${timeframe} (${daysToFetch} days)`);

      this.backfillProgress.set(key, 0);

      const response = await fetch('/.netlify/functions/historical-backfill', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol,
          timeframe,
          daysBack: daysToFetch
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backfill request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();

      this.backfillProgress.set(key, 100);

      logger.info(`[HistoricalBackfill] Backfill complete for ${symbol} ${timeframe}: ${result.candlesSaved || 0} candles`);

      return {
        success: result.success,
        candlesFilled: result.candlesSaved || 0
      };

    } catch (error) {
      logger.error(`[HistoricalBackfill] Backfill failed for ${symbol} ${timeframe}:`, error);
      this.backfillProgress.delete(key);

      return {
        success: false,
        candlesFilled: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  async runFullBackfill(onProgress?: (current: number, total: number, currentSymbol: string) => void): Promise<void> {
    if (this.isBackfilling) {
      logger.warn('[HistoricalBackfill] Backfill already in progress');
      return;
    }

    this.isBackfilling = true;
    logger.info('[HistoricalBackfill] Starting full historical backfill (30 days)');

    try {
      const combinations = ACTIVE_SYMBOLS.flatMap(symbol =>
        TIMEFRAMES.map(timeframe => ({ symbol, timeframe }))
      );

      const total = combinations.length;
      let current = 0;
      let totalCandlesFilled = 0;

      for (const { symbol, timeframe } of combinations) {
        current++;

        if (onProgress) {
          onProgress(current, total, `${symbol} ${timeframe}`);
        }

        const status = await this.checkBackfillStatus(symbol, timeframe);

        if (status.needsBackfill) {
          const daysToFetch = Math.max(TARGET_DAYS - status.daysAvailable, 7);
          logger.info(`[HistoricalBackfill] ${symbol} ${timeframe} needs ${daysToFetch} days of data`);

          const result = await this.triggerBackfillForSymbol(symbol, timeframe, daysToFetch);

          if (result.success) {
            totalCandlesFilled += result.candlesFilled;
          }

          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          logger.debug(LogCategory.CHART, `[HistoricalBackfill] ${symbol} ${timeframe} has ${status.daysAvailable} days - no backfill needed`);
        }
      }

      localStorage.setItem(BACKFILL_CHECK_KEY, new Date().toISOString());

      logger.info(`[HistoricalBackfill] Full backfill complete: ${totalCandlesFilled} candles filled`);

    } catch (error) {
      logger.error('[HistoricalBackfill] Full backfill failed:', error);
    } finally {
      this.isBackfilling = false;
    }
  }

  async runBackfillInBackground(): Promise<void> {
    const shouldRun = await this.shouldRunBackfill();

    if (!shouldRun) {
      logger.debug(LogCategory.CHART, '[HistoricalBackfill] Backfill not needed, last check was recent');
      return;
    }

    setTimeout(() => {
      this.runFullBackfill((current, total, currentSymbol) => {
        logger.debug(LogCategory.CHART, `[HistoricalBackfill] Progress: ${current}/${total} - ${currentSymbol}`);
      });
    }, 5000);
  }

  getBackfillProgress(symbol: string, timeframe: string): number {
    const key = `${symbol}_${timeframe}`;
    return this.backfillProgress.get(key) || 0;
  }

  isBackfillInProgress(): boolean {
    return this.isBackfilling;
  }
}

export const historicalBackfillManager = new HistoricalBackfillManager();
