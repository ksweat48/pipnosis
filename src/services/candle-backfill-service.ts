/**
 * Candle Backfill Service - WRITE AUTHORITY
 *
 * Central authority for:
 * - Inserting candles (with deduplication)
 * - Updating candle quality
 * - Cleaning duplicate candles
 * - Validating candle data
 *
 * All write operations to forex_candles MUST go through this service.
 * Read operations should use MarketDataService.
 *
 * SSOT Principle: Separate read and write authorities to prevent coupling
 */

import { supabase } from '../lib/supabase';
import { normalizeTimeframeToDb } from '../utils/timeframe-utils';
import { logger } from '../lib/logger';

export interface CandleInsert {
  symbol: string;
  timeframe: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  open_time: string;
  data_source?: string;
  quality_score?: number;
}

export interface InsertResult {
  inserted: number;
  skipped: number;
  errors: number;
}

export interface DeleteResult {
  deleted: number;
  errors: number;
}

export class CandleBackfillService {
  private static instance: CandleBackfillService;

  private constructor() {}

  static getInstance(): CandleBackfillService {
    if (!CandleBackfillService.instance) {
      CandleBackfillService.instance = new CandleBackfillService();
    }
    return CandleBackfillService.instance;
  }

  /**
   * Insert candles with optional deduplication and validation
   * @param candles - Array of candles to insert
   * @param options - Insert options
   * @returns Result summary
   */
  async insertCandles(
    candles: CandleInsert[],
    options: { deduplicate?: boolean; validate?: boolean } = {}
  ): Promise<InsertResult> {
    const result: InsertResult = {
      inserted: 0,
      skipped: 0,
      errors: 0
    };

    if (candles.length === 0) {
      return result;
    }

    try {
      // Normalize timeframes
      const normalizedCandles = candles.map(c => ({
        ...c,
        timeframe: normalizeTimeframeToDb(c.timeframe)
      }));

      // Validate if requested
      if (options.validate) {
        const validCandles = normalizedCandles.filter(c => this.validateCandle(c));
        result.errors = normalizedCandles.length - validCandles.length;

        if (validCandles.length === 0) {
          logger.warn('[BackfillService] All candles failed validation');
          return result;
        }
      }

      // Deduplicate if requested
      let candlesToInsert = normalizedCandles;
      if (options.deduplicate) {
        candlesToInsert = await this.filterExistingCandles(normalizedCandles);
        result.skipped = normalizedCandles.length - candlesToInsert.length;
      }

      if (candlesToInsert.length === 0) {
        logger.debug('[BackfillService] No new candles to insert after deduplication');
        return result;
      }

      // CCIP FIX: Use upsert instead of insert to handle duplicates gracefully
      // This prevents 409 Conflict errors when backfilling overlapping timeframes
      const batchSize = 500;
      for (let i = 0; i < candlesToInsert.length; i += batchSize) {
        const batch = candlesToInsert.slice(i, i + batchSize);

        const { data: rpcResult, error: rpcError } = await supabase.rpc('upsert_forex_candles_batch', {
          candles: batch,
        });

        if (rpcError) {
          logger.error('[BackfillService] Batch RPC error:', rpcError);
          result.errors += batch.length;
        } else {
          result.inserted += rpcResult?.inserted || batch.length;
          result.errors += rpcResult?.errors || 0;
        }
      }

      logger.info(
        `[BackfillService] Inserted ${result.inserted} candles, ` +
        `skipped ${result.skipped}, errors ${result.errors}`
      );

      return result;
    } catch (error) {
      logger.error('[BackfillService] Error inserting candles:', error);
      result.errors = candles.length;
      return result;
    }
  }

  /**
   * Update quality score for a specific candle
   * @param symbol - Trading symbol
   * @param timeframe - Timeframe
   * @param openTime - Candle open time
   * @param qualityScore - New quality score
   * @returns Success status
   */
  async updateCandleQuality(
    symbol: string,
    timeframe: string,
    openTime: string,
    qualityScore: number
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('forex_candles')
        .update({ quality_score: qualityScore })
        .eq('symbol', symbol)
        .eq('timeframe', normalizeTimeframeToDb(timeframe))
        .eq('open_time', openTime);

      if (error) {
        logger.error('[BackfillService] Error updating quality:', error);
        return false;
      }

      return true;
    } catch (error) {
      logger.error('[BackfillService] Error updating quality:', error);
      return false;
    }
  }

  /**
   * Delete duplicate candles (keeping the highest quality)
   * @param symbol - Optional symbol filter
   * @param timeframe - Optional timeframe filter
   * @returns Number of duplicates deleted
   */
  async deleteDuplicates(
    symbol?: string,
    timeframe?: string
  ): Promise<number> {
    try {
      // Find duplicates using raw SQL for efficiency
      const query = `
        WITH duplicates AS (
          SELECT
            id,
            ROW_NUMBER() OVER (
              PARTITION BY symbol, timeframe, open_time
              ORDER BY quality_score DESC NULLS LAST, created_at DESC
            ) as rn
          FROM forex_candles
          ${symbol ? `WHERE symbol = '${symbol}'` : ''}
          ${timeframe ? `AND timeframe = '${normalizeTimeframeToDb(timeframe)}'` : ''}
        )
        SELECT id FROM duplicates WHERE rn > 1
      `;

      const { data: duplicateIds, error: selectError } = await supabase
        .rpc('execute_sql', { query });

      if (selectError || !duplicateIds || duplicateIds.length === 0) {
        logger.debug('[BackfillService] No duplicates found');
        return 0;
      }

      // Delete duplicates
      const ids = duplicateIds.map((row: any) => row.id);
      const { error: deleteError } = await supabase
        .from('forex_candles')
        .delete()
        .in('id', ids);

      if (deleteError) {
        logger.error('[BackfillService] Error deleting duplicates:', deleteError);
        return 0;
      }

      logger.info(`[BackfillService] Deleted ${ids.length} duplicate candles`);
      return ids.length;
    } catch (error) {
      logger.error('[BackfillService] Error deleting duplicates:', error);
      return 0;
    }
  }

  /**
   * Validate candle data structure
   * @param candle - Candle to validate
   * @returns True if valid
   */
  private validateCandle(candle: CandleInsert): boolean {
    // Check required fields
    if (!candle.symbol || !candle.timeframe || !candle.open_time) {
      return false;
    }

    // Check price values
    if (
      typeof candle.open !== 'number' ||
      typeof candle.high !== 'number' ||
      typeof candle.low !== 'number' ||
      typeof candle.close !== 'number' ||
      candle.open <= 0 ||
      candle.high <= 0 ||
      candle.low <= 0 ||
      candle.close <= 0
    ) {
      return false;
    }

    // Check OHLC logic
    if (
      candle.high < candle.low ||
      candle.high < candle.open ||
      candle.high < candle.close ||
      candle.low > candle.open ||
      candle.low > candle.close
    ) {
      logger.warn(`[BackfillService] Invalid OHLC for ${candle.symbol} at ${candle.open_time}`);
      return false;
    }

    // Check volume
    if (typeof candle.volume !== 'number' || candle.volume < 0) {
      return false;
    }

    return true;
  }

  /**
   * Filter out candles that already exist in the database
   * @param candles - Candles to check
   * @returns Candles that don't exist
   */
  private async filterExistingCandles(candles: CandleInsert[]): Promise<CandleInsert[]> {
    if (candles.length === 0) {
      return [];
    }

    try {
      // Group by symbol/timeframe for efficient querying
      const groups = new Map<string, CandleInsert[]>();
      for (const candle of candles) {
        const key = `${candle.symbol}:${candle.timeframe}`;
        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key)!.push(candle);
      }

      const newCandles: CandleInsert[] = [];

      // Check each group
      for (const [key, groupCandles] of groups) {
        const [symbol, timeframe] = key.split(':');
        const openTimes = groupCandles.map(c => c.open_time);

        const { data: existing, error } = await supabase
          .from('forex_candles')
          .select('open_time')
          .eq('symbol', symbol)
          .eq('timeframe', timeframe)
          .in('open_time', openTimes);

        if (error) {
          logger.error('[BackfillService] Error checking existing candles:', error);
          // On error, include all candles (better to have duplicates than miss data)
          newCandles.push(...groupCandles);
          continue;
        }

        const existingTimes = new Set(existing?.map(c => c.open_time) || []);
        const filtered = groupCandles.filter(c => !existingTimes.has(c.open_time));
        newCandles.push(...filtered);
      }

      return newCandles;
    } catch (error) {
      logger.error('[BackfillService] Error filtering existing candles:', error);
      // On error, return all candles
      return candles;
    }
  }
}

export const candleBackfillService = CandleBackfillService.getInstance();
