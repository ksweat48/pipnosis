import { supabase } from '../lib/supabase';
import { logger, LogCategory } from '../lib/logger';
import { FreshnessBlockCategory, BlockMetadata } from '../types/freshness-block';

interface BlockLogEntry {
  symbol: string;
  timeframe: string;
  blockCategory: FreshnessBlockCategory;
  blockMetadata: BlockMetadata;
  cacheTier: 'omega' | 'alpha' | 'scout';
}

class FreshnessBlockLogger {
  private logQueue: BlockLogEntry[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL_MS = 5000;
  private readonly MAX_QUEUE_SIZE = 20;

  constructor() {
    this.startFlushInterval();
  }

  private startFlushInterval() {
    if (this.flushInterval) return;

    this.flushInterval = setInterval(() => {
      this.flush();
    }, this.FLUSH_INTERVAL_MS);
  }

  async logBlock(entry: BlockLogEntry): Promise<void> {
    this.logQueue.push(entry);

    logger.info(
      LogCategory.AI_TRADING,
      `[BlockLogger] 📊 Queued block event: ${entry.blockCategory} for ${entry.symbol}@${entry.timeframe}`,
      {
        category: entry.blockCategory,
        refreshAttempted: entry.blockMetadata.refreshAttempted || false,
        refreshSucceeded: entry.blockMetadata.wasAutoRefreshed || false
      }
    );

    if (this.logQueue.length >= this.MAX_QUEUE_SIZE) {
      await this.flush();
    }
  }

  async logOmegaBlock(
    symbol: string,
    timeframe: string,
    blockCategory: FreshnessBlockCategory,
    metadata: BlockMetadata
  ): Promise<void> {
    await this.logBlock({
      symbol,
      timeframe,
      blockCategory,
      blockMetadata: metadata,
      cacheTier: 'omega'
    });
  }

  async logAlphaBlock(
    symbol: string,
    timeframe: string,
    blockCategory: FreshnessBlockCategory,
    metadata: BlockMetadata
  ): Promise<void> {
    await this.logBlock({
      symbol,
      timeframe,
      blockCategory,
      blockMetadata: metadata,
      cacheTier: 'alpha'
    });
  }

  async logScoutBlock(
    symbol: string,
    timeframe: string,
    blockCategory: FreshnessBlockCategory,
    metadata: BlockMetadata
  ): Promise<void> {
    await this.logBlock({
      symbol,
      timeframe,
      blockCategory,
      blockMetadata: metadata,
      cacheTier: 'scout'
    });
  }

  async logMultipleBlocks(
    symbol: string,
    timeframe: string,
    blockCategories: FreshnessBlockCategory[],
    blockMetadata: BlockMetadata[],
    cacheTier: 'omega' | 'alpha' | 'scout' = 'omega'
  ): Promise<void> {
    for (let i = 0; i < blockCategories.length; i++) {
      await this.logBlock({
        symbol,
        timeframe,
        blockCategory: blockCategories[i],
        blockMetadata: blockMetadata[i] || {},
        cacheTier
      });
    }
  }

  private async flush(): Promise<void> {
    if (this.logQueue.length === 0) return;

    const batch = [...this.logQueue];
    this.logQueue = [];

    try {
      const cacheStatsInserts = batch.map(entry => ({
        cache_tier: entry.cacheTier,
        event_type: 'block',
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        block_metadata: {
          category: entry.blockCategory,
          ...entry.blockMetadata
        }
      }));

      const freshnessBlockInserts = batch.map(entry => ({
        category: entry.blockCategory,
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        metadata: entry.blockMetadata,
        auto_refresh_attempted: entry.blockMetadata.refreshAttempted || false,
        auto_refresh_success: entry.blockMetadata.wasAutoRefreshed || false
      }));

      const results = await Promise.allSettled([
        supabase.from('cache_stats_log').insert(cacheStatsInserts),
        supabase.from('freshness_block_logs').insert(freshnessBlockInserts)
      ]);

      const cacheStatsResult = results[0];
      const freshnessBlockResult = results[1];

      const cacheStatsError = cacheStatsResult.status === 'rejected' ? cacheStatsResult.reason : (cacheStatsResult.value as any).error;
      const freshnessBlockError = freshnessBlockResult.status === 'rejected' ? freshnessBlockResult.reason : (freshnessBlockResult.value as any).error;

      const cacheStatsSuccess = cacheStatsResult.status === 'fulfilled' && !cacheStatsError;
      const freshnessBlockSuccess = freshnessBlockResult.status === 'fulfilled' && !freshnessBlockError;

      if (!cacheStatsSuccess || !freshnessBlockSuccess) {
        logger.warn(
          LogCategory.AI_TRADING,
          `[BlockLogger] ⚠️ Partial flush of ${batch.length} block events`,
          {
            cacheStats: cacheStatsSuccess ? 'OK' : cacheStatsError?.message || 'Failed',
            freshnessBlocks: freshnessBlockSuccess ? 'OK' : freshnessBlockError?.message || 'Failed'
          }
        );

        if (!cacheStatsSuccess && !freshnessBlockSuccess) {
          this.logQueue.push(...batch);
        }
      } else {
        logger.info(
          LogCategory.AI_TRADING,
          `[BlockLogger] ✅ Flushed ${batch.length} block events to both analytics tiers (SSOT-compliant)`
        );
      }
    } catch (err) {
      logger.error(
        LogCategory.AI_TRADING,
        `[BlockLogger] ❌ Exception during flush`,
        { error: err }
      );
      this.logQueue.push(...batch);
    }
  }

  async forceFlush(): Promise<void> {
    await this.flush();
  }

  stopFlushInterval(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  destroy(): void {
    this.stopFlushInterval();
    this.flush();
  }
}

export const freshnessBlockLogger = new FreshnessBlockLogger();
