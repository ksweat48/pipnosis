/**
 * Gap Backfill Coordinator
 *
 * Orchestrates intelligent backfilling of historical gaps using MetaAPI.
 * Provides safe, idempotent gap filling without breaking existing data.
 */

import { supabase } from '@/lib/supabase';
import { Timeframe, appTimeframeToDb } from '@/services/chart-preferences';

export interface GapAnalysis {
  symbol: string;
  timeframe: Timeframe;
  totalCandles: number;
  gapsDetected: number;
  totalMissingCandles: number;
  dateRangeCovered: {
    earliest: string;
    latest: string;
    daysSpan: number;
  };
  gaps: Gap[];
}

export interface Gap {
  startTime: string;
  endTime: string;
  durationMinutes: number;
  missingCandles: number;
  isWeekend: boolean;
  isMarketClosure: boolean;
}

export interface BackfillProgress {
  status: 'analyzing' | 'backfilling' | 'completed' | 'error';
  currentSymbol?: string;
  currentTimeframe?: Timeframe;
  gapsAnalyzed: number;
  gapsToFill: number;
  gapsFilled: number;
  candlesInserted: number;
  errors: string[];
  startTime: Date;
  endTime?: Date;
}

export interface BackfillOptions {
  symbol?: string;
  timeframe?: Timeframe;
  daysBack?: number;
  dryRun?: boolean;
  skipWeekends?: boolean;
}

class GapBackfillCoordinator {
  private readonly NETLIFY_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL?.replace('/supabase', '')}/.netlify/functions/historical-backfill`;

  /**
   * Analyze gaps in forex_candles table
   */
  async analyzeGaps(
    symbol: string,
    timeframe: Timeframe,
    daysBack: number = 30
  ): Promise<GapAnalysis> {
    console.log(`[GapBackfill] Analyzing gaps for ${symbol} ${timeframe} (last ${daysBack} days)...`);

    const dbTimeframe = appTimeframeToDb(timeframe);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    // Fetch all candles in the time range
    const { data: candles, error } = await supabase
      .from('forex_candles')
      .select('open_time, symbol, timeframe')
      .eq('symbol', symbol)
      .eq('timeframe', dbTimeframe)
      .gte('open_time', startDate.toISOString())
      .order('open_time', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch candles: ${error.message}`);
    }

    if (!candles || candles.length === 0) {
      return {
        symbol,
        timeframe,
        totalCandles: 0,
        gapsDetected: 0,
        totalMissingCandles: 0,
        dateRangeCovered: {
          earliest: startDate.toISOString(),
          latest: new Date().toISOString(),
          daysSpan: daysBack
        },
        gaps: []
      };
    }

    // Calculate expected interval based on timeframe
    const intervalMinutes = this.getTimeframeMinutes(timeframe);
    const intervalMs = intervalMinutes * 60 * 1000;

    // Detect gaps
    const gaps: Gap[] = [];
    let totalMissingCandles = 0;

    for (let i = 1; i < candles.length; i++) {
      const prevTime = new Date(candles[i - 1].open_time);
      const currTime = new Date(candles[i].open_time);
      const timeDiff = currTime.getTime() - prevTime.getTime();
      const expectedInterval = intervalMs;

      // Gap detected if time difference > 1.5x expected interval
      if (timeDiff > expectedInterval * 1.5) {
        const durationMinutes = timeDiff / (1000 * 60);
        const missingCandles = Math.floor(durationMinutes / intervalMinutes) - 1;

        if (missingCandles > 0) {
          const isWeekend = this.isWeekendPeriod(prevTime, currTime);
          const isMarketClosure = isWeekend || this.isHolidayPeriod(prevTime, currTime);

          gaps.push({
            startTime: prevTime.toISOString(),
            endTime: currTime.toISOString(),
            durationMinutes,
            missingCandles,
            isWeekend,
            isMarketClosure
          });

          if (!isMarketClosure) {
            totalMissingCandles += missingCandles;
          }
        }
      }
    }

    const earliest = candles[0].open_time;
    const latest = candles[candles.length - 1].open_time;
    const daysSpan = Math.ceil(
      (new Date(latest).getTime() - new Date(earliest).getTime()) / (1000 * 60 * 60 * 24)
    );

    console.log(`[GapBackfill] Analysis complete:`);
    console.log(`  Total candles: ${candles.length}`);
    console.log(`  Gaps detected: ${gaps.length}`);
    console.log(`  Missing candles (excluding weekends): ${totalMissingCandles}`);
    console.log(`  Date range: ${new Date(earliest).toLocaleDateString()} to ${new Date(latest).toLocaleDateString()}`);

    return {
      symbol,
      timeframe,
      totalCandles: candles.length,
      gapsDetected: gaps.length,
      totalMissingCandles,
      dateRangeCovered: {
        earliest,
        latest,
        daysSpan
      },
      gaps
    };
  }

  /**
   * Execute backfill for detected gaps using MetaAPI
   */
  async backfillGaps(
    analysis: GapAnalysis,
    options: BackfillOptions = {}
  ): Promise<BackfillProgress> {
    const progress: BackfillProgress = {
      status: 'analyzing',
      gapsAnalyzed: analysis.gapsDetected,
      gapsToFill: 0,
      gapsFilled: 0,
      candlesInserted: 0,
      errors: [],
      startTime: new Date()
    };

    try {
      // Filter gaps to backfill
      const gapsToFill = analysis.gaps.filter(gap => {
        if (options.skipWeekends !== false && gap.isWeekend) {
          return false; // Skip weekend gaps
        }
        if (gap.isMarketClosure) {
          return false; // Skip known market closures
        }
        return gap.missingCandles > 0;
      });

      progress.gapsToFill = gapsToFill.length;
      progress.status = 'backfilling';

      console.log(`[GapBackfill] Backfilling ${gapsToFill.length} gaps for ${analysis.symbol} ${analysis.timeframe}...`);

      if (gapsToFill.length === 0) {
        console.log('[GapBackfill] No actionable gaps to fill');
        progress.status = 'completed';
        progress.endTime = new Date();
        return progress;
      }

      // Call historical backfill function for the full date range
      // This is safer than filling individual gaps - let MetaAPI provide continuous data
      const oldestGap = gapsToFill[0];
      const newestGap = gapsToFill[gapsToFill.length - 1];

      const startDate = new Date(oldestGap.startTime);
      const endDate = new Date(newestGap.endTime);
      const daysToBackfill = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

      console.log(`[GapBackfill] Requesting backfill from ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()} (${daysToBackfill} days)`);

      if (options.dryRun) {
        console.log('[GapBackfill] DRY RUN - Would backfill:', {
          symbol: analysis.symbol,
          timeframe: analysis.timeframe,
          daysBack: daysToBackfill,
          gapsToFill: gapsToFill.length,
          estimatedCandles: analysis.totalMissingCandles
        });
        progress.status = 'completed';
        progress.endTime = new Date();
        return progress;
      }

      // Call the Netlify function
      const result = await this.callBackfillFunction({
        symbol: analysis.symbol,
        timeframe: analysis.timeframe,
        daysBack: daysToBackfill,
        dryRun: false
      });

      progress.candlesInserted = result.candlesInserted || 0;
      progress.gapsFilled = gapsToFill.length;
      progress.status = 'completed';
      progress.endTime = new Date();

      console.log(`[GapBackfill] ✅ Backfill completed successfully`);
      console.log(`  Candles inserted: ${progress.candlesInserted}`);
      console.log(`  Duration: ${(progress.endTime.getTime() - progress.startTime.getTime()) / 1000}s`);

      return progress;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[GapBackfill] ❌ Backfill failed:', errorMessage);
      progress.status = 'error';
      progress.errors.push(errorMessage);
      progress.endTime = new Date();
      return progress;
    }
  }

  /**
   * Call the historical backfill Netlify function
   */
  private async callBackfillFunction(params: {
    symbol: string;
    timeframe: Timeframe;
    daysBack: number;
    dryRun: boolean;
  }): Promise<any> {
    const response = await fetch(this.NETLIFY_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Backfill function failed: ${response.status} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * One-click smart backfill: analyze + fill in one operation
   */
  async smartBackfill(
    symbol: string,
    timeframe: Timeframe,
    daysBack: number = 30,
    options: BackfillOptions = {}
  ): Promise<{ analysis: GapAnalysis; progress: BackfillProgress }> {
    console.log(`[GapBackfill] Starting smart backfill for ${symbol} ${timeframe}...`);

    const analysis = await this.analyzeGaps(symbol, timeframe, daysBack);

    if (analysis.totalMissingCandles === 0) {
      console.log('[GapBackfill] ✅ No gaps detected - data is complete!');
      return {
        analysis,
        progress: {
          status: 'completed',
          gapsAnalyzed: analysis.gapsDetected,
          gapsToFill: 0,
          gapsFilled: 0,
          candlesInserted: 0,
          errors: [],
          startTime: new Date(),
          endTime: new Date()
        }
      };
    }

    const progress = await this.backfillGaps(analysis, options);

    return { analysis, progress };
  }

  // Helper methods

  private getTimeframeMinutes(timeframe: Timeframe): number {
    const map: Record<Timeframe, number> = {
      M1: 1,
      M5: 5,
      M15: 15,
      M30: 30,
      H1: 60,
      H4: 240,
      D1: 1440,
      W1: 10080
    };
    return map[timeframe] || 5;
  }

  private isWeekendPeriod(start: Date, end: Date): boolean {
    const startDay = start.getUTCDay();
    const endDay = end.getUTCDay();

    // Saturday (6) or Sunday (0)
    return startDay === 6 || startDay === 0 || endDay === 6 || endDay === 0;
  }

  private isHolidayPeriod(start: Date, end: Date): boolean {
    // TODO: Add major forex holidays (Christmas, New Year, etc.)
    const month = start.getUTCMonth();
    const day = start.getUTCDate();

    // Christmas and New Year periods
    if (month === 11 && day >= 24) return true; // Dec 24-31
    if (month === 0 && day === 1) return true; // Jan 1

    return false;
  }
}

export const gapBackfillCoordinator = new GapBackfillCoordinator();
