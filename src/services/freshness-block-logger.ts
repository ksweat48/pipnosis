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
      const inserts = batch.map(entry => ({
        cache_tier: entry.cacheTier,
        event_type: 'block',
        symbol: entry.symbol,
        timeframe: entry.timeframe,
        block_metadata: {
          category: entry.blockCategory,
          ...entry.blockMetadata
        }
      }));

      const { error } = await supabase
        .from('cache_stats_log')
        .insert(inserts);

      if (error) {
        logger.error(
          LogCategory.AI_TRADING,
          `[BlockLogger] ❌ Failed to flush ${batch.length} block events`,
          { error: error.message }
        );
        this.logQueue.push(...batch);
      } else {
        logger.info(
          LogCategory.AI_TRADING,
          `[BlockLogger] ✅ Flushed ${batch.length} block events to database`
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
