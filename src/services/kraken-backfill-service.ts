/**
 * Kraken Backfill Service
 *
 * Orchestrates data quality checks and repairs using Kraken REST API.
 *
 * WORKFLOW:
 * 1. Validate database candles (detect DOJIs and gaps)
 * 2. Fetch complete OHLC data from Kraken REST API
 * 3. Replace bad candles in database
 * 4. Verify repair was successful
 *
 * This ensures EQS calculations have complete, high-quality data.
 */

import { logger, LogCategory } from '@/lib/logger';
import { supabase } from '@/lib/supabase';
import { krakenRestClient, type KrakenCandle } from './kraken-rest-client';
import { candleQualityValidator } from './candle-quality-validator';
import { normalizeTimeframe } from '@/utils/timeframeNormalizer';

export interface BackfillResult {
  symbol: string;
  interval: number;
  dojisRepaired: number;
  gapsFilled: number;
  totalCandlesWritten: number;
  success: boolean;
  error?: string;
}

class KrakenBackfillService {
  private isRunning = false;
  private lastRunTime = new Map<string, number>();

  /**
   * Run full backfill for a symbol
   * Detects and repairs DOJIs and gaps using Kraken REST API
   */
  async backfillSymbol(
    symbol: string,
    interval: number = 5,
    lookbackHours: number = 72
  ): Promise<BackfillResult> {
    // Prevent concurrent backfills for the same symbol
    const runKey = `${symbol}-${interval}`;
    const lastRun = this.lastRunTime.get(runKey) || 0;
    const now = Date.now();

    if (now - lastRun < 60000) {
      logger.warn(`[KrakenBackfill] Skipping ${symbol} - ran ${Math.floor((now - lastRun) / 1000)}s ago`, LogCategory.DATA);
      return {
        symbol,
        interval,
        dojisRepaired: 0,
        gapsFilled: 0,
        totalCandlesWritten: 0,
        success: false,
        error: 'Backfill throttled - run too recently'
      };
    }

    this.lastRunTime.set(runKey, now);

    // Check if symbol is supported by Kraken
    if (!krakenRestClient.isSymbolSupported(symbol)) {
      logger.warn(`[KrakenBackfill] Symbol ${symbol} not supported by Kraken`, LogCategory.DATA);
      return {
        symbol,
        interval,
        dojisRepaired: 0,
        gapsFilled: 0,
        totalCandlesWritten: 0,
        success: false,
        error: 'Symbol not supported by Kraken REST API'
      };
    }

    logger.info(`[KrakenBackfill] Starting backfill for ${symbol} ${interval}m`, LogCategory.DATA);

    try {
      // Step 1: Validate current data quality
      const timeframe = `M${interval}`;
      const dojiTimestamps = await candleQualityValidator.getDojiTimestamps(symbol, timeframe, lookbackHours);
      const gapTimestamps = await candleQualityValidator.getGapTimestamps(symbol, timeframe, lookbackHours);

      if (dojiTimestamps.length === 0 && gapTimestamps.length === 0) {
        logger.info(`[KrakenBackfill] No DOJIs or gaps found for ${symbol} - data is healthy`, LogCategory.DATA);
        return {
          symbol,
          interval,
          dojisRepaired: 0,
          gapsFilled: 0,
          totalCandlesWritten: 0,
          success: true
        };
      }

      logger.info(
        `[KrakenBackfill] Found ${dojiTimestamps.length} DOJIs and ${gapTimestamps.length} gaps`,
        LogCategory.DATA
      );

      // Step 2: Fetch complete OHLC data from Kraken
      const candles = await krakenRestClient.fetchRecentCandles(symbol, interval, 720);

      if (candles.length === 0) {
        logger.error(`[KrakenBackfill] No candles returned from Kraken for ${symbol}`, LogCategory.DATA);
        return {
          symbol,
          interval,
          dojisRepaired: 0,
          gapsFilled: 0,
          totalCandlesWritten: 0,
          success: false,
          error: 'No candles returned from Kraken API'
        };
      }

      logger.info(`[KrakenBackfill] Fetched ${candles.length} candles from Kraken`, LogCategory.DATA);

      // Step 3: Repair DOJIs and gaps in database
      let dojisRepaired = 0;
      let gapsFilled = 0;
      let totalWritten = 0;

      const dbTimeframe = normalizeTimeframe(timeframe, 'metatrader');
      const allRepairTimestamps = [...dojiTimestamps, ...gapTimestamps];

      for (const timestamp of allRepairTimestamps) {
        const krakenCandle = candles.find(c => c.time === timestamp);

        if (!krakenCandle) {
          logger.warn(`[KrakenBackfill] No Kraken candle found for timestamp ${timestamp}`, LogCategory.DATA);
          continue;
        }

        // Validate candle is not a DOJI
        if (
          krakenCandle.open === krakenCandle.high &&
          krakenCandle.high === krakenCandle.low &&
          krakenCandle.low === krakenCandle.close
        ) {
          logger.warn(`[KrakenBackfill] Kraken candle is also a DOJI at ${timestamp} - skipping`, LogCategory.DATA);
          continue;
        }

        // Upsert candle to database
        const writeSuccess = await this.writeCandle(symbol, dbTimeframe, krakenCandle);

        if (writeSuccess) {
          totalWritten++;
          if (dojiTimestamps.includes(timestamp)) {
            dojisRepaired++;
          } else {
            gapsFilled++;
          }
        }
      }

      logger.info(
        `[KrakenBackfill] ✅ Repair complete: ${dojisRepaired} DOJIs, ${gapsFilled} gaps, ${totalWritten} total`,
        LogCategory.DATA
      );

      return {
        symbol,
        interval,
        dojisRepaired,
        gapsFilled,
        totalCandlesWritten: totalWritten,
        success: true
      };

    } catch (error) {
      logger.error(`[KrakenBackfill] Failed to backfill ${symbol}: ${error}`, LogCategory.DATA);
      return {
        symbol,
        interval,
        dojisRepaired: 0,
        gapsFilled: 0,
        totalCandlesWritten: 0,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Write a single candle to database (upsert)
   */
  private async writeCandle(
    symbol: string,
    dbTimeframe: string,
    candle: KrakenCandle
  ): Promise<boolean> {
    try {
      const candleData = {
        symbol,
        timeframe: dbTimeframe,
        open_time: new Date(candle.time * 1000).toISOString(),
        open: candle.open.toString(),
        high: candle.high.toString(),
        low: candle.low.toString(),
        close: candle.close.toString(),
        volume: candle.volume.toString(),
        timestamp: new Date(candle.time * 1000).toISOString(),
        source: 'kraken-rest'
      };

      const { error } = await supabase
        .from('forex_candles')
        .upsert(candleData, {
          onConflict: 'symbol,timeframe,open_time'
        });

      if (error) {
        logger.error(`[KrakenBackfill] Failed to write candle: ${error.message}`, LogCategory.DATA);
        return false;
      }

      return true;
    } catch (error) {
      logger.error(`[KrakenBackfill] Exception writing candle: ${error}`, LogCategory.DATA);
      return false;
    }
  }

  /**
   * Backfill all crypto symbols (BTCUSD, ETHUSD)
   */
  async backfillAllCrypto(): Promise<BackfillResult[]> {
    const symbols = krakenRestClient.getSupportedSymbols();
    const results: BackfillResult[] = [];

    for (const symbol of symbols) {
      const result = await this.backfillSymbol(symbol, 5, 72);
      results.push(result);
    }

    return results;
  }

  /**
   * Run validation and report (doesn't repair)
   */
  async validateSymbol(
    symbol: string,
    interval: number = 5,
    lookbackHours: number = 72
  ): Promise<{
    hasIssues: boolean;
    dojiCount: number;
    gapCount: number;
    healthScore: number;
  }> {
    const timeframe = `M${interval}`;

    const qualityCheck = await candleQualityValidator.validateCandleQuality(
      symbol,
      timeframe,
      Math.floor(lookbackHours * 60 / interval)
    );

    const dojiTimestamps = await candleQualityValidator.getDojiTimestamps(symbol, timeframe, lookbackHours);
    const gapTimestamps = await candleQualityValidator.getGapTimestamps(symbol, timeframe, lookbackHours);

    return {
      hasIssues: dojiTimestamps.length > 0 || gapTimestamps.length > 0,
      dojiCount: dojiTimestamps.length,
      gapCount: gapTimestamps.length,
      healthScore: qualityCheck.metrics.qualityScore
    };
  }
}

export const krakenBackfillService = new KrakenBackfillService();
