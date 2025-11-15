import { supabase } from '@/lib/supabase';
import { logger, LogCategory } from '@/lib/logger';

interface TickData {
  symbol: string;
  bid: number;
  ask: number;
  timestamp: string;
  broker_time?: string;
  synced: boolean;
  retry_count: number;
}

const BUFFER_KEY_PREFIX = 'tick_buffer_';
const MAX_BUFFER_SIZE = 1000;
const SYNC_INTERVAL_MS = 5000;
const MAX_RETRY_ATTEMPTS = 3;

class TickBufferService {
  private syncInterval: NodeJS.Timeout | null = null;
  private isOnline: boolean = true;

  constructor() {
    this.initOnlineDetection();
    this.startBackgroundSync();
  }

  private initOnlineDetection() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        logger.info(LogCategory.TICK_BUFFER, '🌐 Network online - resuming sync');
        this.isOnline = true;
        this.syncAllBuffers();
      });

      window.addEventListener('offline', () => {
        logger.info(LogCategory.TICK_BUFFER, '📡 Network offline - buffering to localStorage');
        this.isOnline = false;
      });

      this.isOnline = navigator.onLine;
    }
  }

  async bufferTick(symbol: string, bid: number, ask: number, timestamp: string, broker_time?: string): Promise<void> {
    const tick: TickData = {
      symbol,
      bid,
      ask,
      timestamp,
      broker_time,
      synced: false,
      retry_count: 0
    };

    const bufferKey = `${BUFFER_KEY_PREFIX}${symbol}`;
    const buffer = this.getBuffer(bufferKey);

    buffer.push(tick);

    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.shift();
    }

    this.saveBuffer(bufferKey, buffer);

    if (this.isOnline && buffer.length > 0) {
      this.syncBuffer(bufferKey, symbol);
    }
  }

  private getBuffer(key: string): TickData[] {
    try {
      const stored = localStorage.getItem(key);
      return stored ? JSON.parse(stored) : [];
    } catch (error) {
      logger.error(LogCategory.TICK_BUFFER, 'Error reading buffer:', error);
      return [];
    }
  }

  private saveBuffer(key: string, buffer: TickData[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(buffer));
    } catch (error) {
      logger.error(LogCategory.TICK_BUFFER, 'Error saving buffer:', error);

      if (error instanceof Error && error.name === 'QuotaExceededError') {
        logger.warn(LogCategory.TICK_BUFFER, 'LocalStorage quota exceeded, clearing old entries');
        const halfSize = Math.floor(buffer.length / 2);
        localStorage.setItem(key, JSON.stringify(buffer.slice(halfSize)));
      }
    }
  }

  private async syncBuffer(bufferKey: string, symbol: string): Promise<void> {
    const buffer = this.getBuffer(bufferKey);
    const unsyncedTicks = buffer.filter(t => !t.synced && t.retry_count < MAX_RETRY_ATTEMPTS);

    if (unsyncedTicks.length === 0) return;

    logger.debug(LogCategory.TICK_BUFFER, `📤 Syncing ${unsyncedTicks.length} ticks for ${symbol}`);

    const ticksToSync = unsyncedTicks.map(t => {
      const bid = parseFloat(t.bid.toString());
      const ask = parseFloat(t.ask.toString());
      const mid = (bid + ask) / 2;
      const spread = ask - bid;

      return {
        symbol: t.symbol,
        bid: bid.toString(),
        ask: ask.toString(),
        mid: mid.toString(),
        spread: spread.toString(),
        broker_time: t.broker_time || t.timestamp,
        created_at: t.timestamp
      };
    });

    try {
      const { error } = await supabase
        .from('realtime_prices')
        .insert(ticksToSync);

      if (error) {
        logger.error(LogCategory.TICK_BUFFER, `❌ Sync failed for ${symbol}:`, error);

        unsyncedTicks.forEach(tick => {
          tick.retry_count++;
        });
        this.saveBuffer(bufferKey, buffer);
      } else {
        logger.trace(LogCategory.TICK_BUFFER, `✅ Successfully synced ${ticksToSync.length} ticks for ${symbol}`);

        const syncedBuffer = buffer.map(tick => {
          if (unsyncedTicks.includes(tick)) {
            return { ...tick, synced: true };
          }
          return tick;
        });

        const cleanedBuffer = syncedBuffer.filter(t => !t.synced || t.retry_count < MAX_RETRY_ATTEMPTS);
        this.saveBuffer(bufferKey, cleanedBuffer);
      }

    } catch (error) {
      logger.error(LogCategory.TICK_BUFFER, `❌ Sync error for ${symbol}:`, error);

      unsyncedTicks.forEach(tick => {
        tick.retry_count++;
      });
      this.saveBuffer(bufferKey, buffer);
    }
  }

  private async syncAllBuffers(): Promise<void> {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];

    for (const symbol of symbols) {
      const bufferKey = `${BUFFER_KEY_PREFIX}${symbol}`;
      await this.syncBuffer(bufferKey, symbol);
    }
  }

  private startBackgroundSync(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      if (this.isOnline) {
        this.syncAllBuffers();
      }
    }, SYNC_INTERVAL_MS);

    logger.debug(LogCategory.TICK_BUFFER, '🔄 Background sync started');
  }

  getBufferStats(symbol: string): {
    total: number;
    synced: number;
    unsynced: number;
    failed: number;
  } {
    const bufferKey = `${BUFFER_KEY_PREFIX}${symbol}`;
    const buffer = this.getBuffer(bufferKey);

    return {
      total: buffer.length,
      synced: buffer.filter(t => t.synced).length,
      unsynced: buffer.filter(t => !t.synced && t.retry_count < MAX_RETRY_ATTEMPTS).length,
      failed: buffer.filter(t => t.retry_count >= MAX_RETRY_ATTEMPTS).length
    };
  }

  clearBuffer(symbol: string): void {
    const bufferKey = `${BUFFER_KEY_PREFIX}${symbol}`;
    localStorage.removeItem(bufferKey);
    logger.info(LogCategory.TICK_BUFFER, `🗑️ Buffer cleared for ${symbol}`);
  }

  clearAllBuffers(): void {
    const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'US30'];
    symbols.forEach(symbol => this.clearBuffer(symbol));
    logger.info(LogCategory.TICK_BUFFER, '🗑️ All buffers cleared');
  }

  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }
    logger.info(LogCategory.TICK_BUFFER, '🛑 Service destroyed');
  }
}

export const tickBufferService = new TickBufferService();
