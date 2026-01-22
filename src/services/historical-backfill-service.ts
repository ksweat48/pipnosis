/**
 * Historical Backfill Service
 *
 * Orchestrates complete historical data backfill operations using Dukascopy API.
 * Provides progress tracking, error handling, and batch management.
 */

import { supabase } from '@/lib/supabase';
import { marketDataService } from './market-data-service';

export type Timeframe = 'M1' | 'M5' | 'M15' | 'M30' | 'H1' | 'H4' | 'D1';

export interface BackfillOptions {
  symbol?: string; // If not specified, backfills all symbols
  timeframe?: Timeframe; // If not specified, backfills all timeframes
  daysBack?: number; // Number of days to backfill (default: 30)
  overwrite?: boolean; // If true, deletes existing candles before backfill (default: true)
}

export interface BackfillProgress {
  symbol: string;
  timeframe: Timeframe;
  status: 'pending' | 'fetching' | 'saving' | 'completed' | 'error';
  candlesFetched: number;
  candlesSaved: number;
  candlesDeleted: number;
  error?: string;
}

export interface BackfillResult {
  success: boolean;
  message: string;
  batchId: string;
  daysBackfilled: number;
  overwriteMode: boolean;
  symbolsProcessed: number;
  timeframesProcessed: number;
  totalCandlesFetched: number;
  totalCandlesSaved: number;
  totalCandlesDeleted: number;
  durationMs: number;
  durationMinutes: string;
  results: BackfillProgress[];
  error?: string;
}

class HistoricalBackfillService {
  private readonly FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dukascopy-backfill`;

  /**
   * Start a complete historical backfill operation
   */
  async startBackfill(options: BackfillOptions = {}): Promise<BackfillResult> {
    const {
      symbol,
      timeframe,
      daysBack = 30,
      overwrite = true
    } = options;

    console.log('[Backfill] Starting historical backfill...', options);

    try {
      const params = new URLSearchParams();

      if (symbol) params.append('symbol', symbol);
      if (timeframe) params.append('timeframe', timeframe);
      params.append('days', daysBack.toString());
      params.append('overwrite', overwrite.toString());

      const url = `${this.FUNCTION_URL}?${params.toString()}`;

      console.log('[Backfill] Calling Dukascopy backfill function...');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Backfill failed: ${response.status} - ${errorText}`);
      }

      const result: BackfillResult = await response.json();

      if (result.success) {
        console.log('[Backfill] ✅ Backfill completed successfully');
        console.log(`  📊 Candles fetched: ${result.totalCandlesFetched}`);
        console.log(`  💾 Candles saved: ${result.totalCandlesSaved}`);
        console.log(`  🗑️ Candles deleted: ${result.totalCandlesDeleted}`);
        console.log(`  ⏱️ Duration: ${result.durationMinutes} minutes`);
      } else {
        console.error('[Backfill] ❌ Backfill failed:', result.error);
      }

      return result;

    } catch (error) {
      console.error('[Backfill] Error:', error);

      return {
        success: false,
        message: 'Backfill operation failed',
        batchId: '',
        daysBackfilled: daysBack,
        overwriteMode: overwrite,
        symbolsProcessed: 0,
        timeframesProcessed: 0,
        totalCandlesFetched: 0,
        totalCandlesSaved: 0,
        totalCandlesDeleted: 0,
        durationMs: 0,
        durationMinutes: '0',
        results: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Backfill a single symbol/timeframe pair
   */
  async backfillSingle(
    symbol: string,
    timeframe: Timeframe,
    daysBack: number = 30
  ): Promise<BackfillResult> {
    return this.startBackfill({ symbol, timeframe, daysBack, overwrite: true });
  }

  /**
   * Backfill all symbols and timeframes (complete overwrite)
   */
  async backfillAll(daysBack: number = 30): Promise<BackfillResult> {
    console.log('[Backfill] Starting COMPLETE backfill for all symbols and timeframes...');
    console.log(`[Backfill] ⚠️ This will OVERWRITE all existing candle data!`);
    console.log(`[Backfill] Days back: ${daysBack}`);

    return this.startBackfill({ daysBack, overwrite: true });
  }

  /**
   * Get data quality statistics
   */
  async getDataQualityStats(): Promise<{
    totalCandles: number;
    bySource: Record<string, number>;
    byQuality: Record<string, number>;
    duplicates: number;
  }> {
    try {
      // Get total candles
      const { count: totalCount } = await supabase
        .from('forex_candles')
        .select('*', { count: 'exact', head: true });

      // Get candles by source
      const { data: bySourceData } = await supabase
        .from('forex_candles')
        .select('data_source')
        .order('data_source');

      const bySource: Record<string, number> = {};
      bySourceData?.forEach(row => {
        const source = row.data_source || 'unknown';
        bySource[source] = (bySource[source] || 0) + 1;
      });

      // Get candles by quality score
      const { data: byQualityData } = await supabase
        .from('forex_candles')
        .select('quality_score')
        .order('quality_score');

      const byQuality: Record<string, number> = {};
      byQualityData?.forEach(row => {
        const quality = row.quality_score?.toString() || 'unknown';
        byQuality[quality] = (byQuality[quality] || 0) + 1;
      });

      // Get duplicates
      const { count: duplicateCount } = await supabase
        .from('forex_candles_duplicates')
        .select('*', { count: 'exact', head: true });

      return {
        totalCandles: totalCount || 0,
        bySource,
        byQuality,
        duplicates: duplicateCount || 0,
      };

    } catch (error) {
      console.error('[Backfill] Error fetching data quality stats:', error);
      return {
        totalCandles: 0,
        bySource: {},
        byQuality: {},
        duplicates: 0,
      };
    }
  }

  /**
   * Clean up duplicate candles (keeps highest quality)
   */
  async cleanupDuplicates(
    symbol?: string,
    timeframe?: string,
    dryRun: boolean = true
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .rpc('remove_duplicate_candles', {
          p_symbol: symbol || null,
          p_timeframe: timeframe || null,
          p_dry_run: dryRun
        });

      if (error) {
        console.error('[Backfill] Error cleaning duplicates:', error);
        throw error;
      }

      console.log(`[Backfill] Duplicate cleanup ${dryRun ? '(DRY RUN)' : '(EXECUTED)'}:`);
      console.log(`  Found ${data?.length || 0} duplicate groups`);

      return data || [];

    } catch (error) {
      console.error('[Backfill] Error in cleanup:', error);
      throw error;
    }
  }

  /**
   * Get candle continuity report (identifies gaps)
   * ✅ SSOT: Uses MarketDataService for candle queries and gap detection
   */
  async getCandleContinuityReport(
    symbol: string,
    timeframe: Timeframe
  ): Promise<{
    totalCandles: number;
    oldestCandle: string | null;
    newestCandle: string | null;
    gaps: Array<{ startTime: string; endTime: string; missingCandles: number }>;
  }> {
    try {
      // Get candle statistics
      const stats = await marketDataService.getCandleStatistics(symbol, timeframe);

      if (stats.totalCandles === 0 || !stats.oldestCandle || !stats.newestCandle) {
        return {
          totalCandles: 0,
          oldestCandle: null,
          newestCandle: null,
          gaps: [],
        };
      }

      // Detect gaps using MarketDataService
      const timeframeMinutes = this.getTimeframeMinutes(timeframe);
      const gapsDetected = await marketDataService.detectGaps(
        symbol,
        timeframe,
        stats.oldestCandle,
        stats.newestCandle,
        timeframeMinutes
      );

      // Convert gap format
      const gaps = gapsDetected.map(gap => {
        const expectedDiff = timeframeMinutes * 60 * 1000;
        const missingCandles = Math.floor(gap.gapDurationMs / expectedDiff);
        return {
          startTime: gap.expectedTime.toISOString(),
          endTime: gap.actualNextTime.toISOString(),
          missingCandles,
        };
      });

      return {
        totalCandles: stats.totalCandles,
        oldestCandle: stats.oldestCandle.toISOString(),
        newestCandle: stats.newestCandle.toISOString(),
        gaps,
      };

    } catch (error) {
      console.error('[Backfill] Error generating continuity report:', error);
      throw error;
    }
  }

  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
    };
    return map[timeframe];
  }
}

export const historicalBackfillService = new HistoricalBackfillService();
