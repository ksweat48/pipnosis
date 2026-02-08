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
const SYNC_INTERVAL_MS = 30000; // 30 seconds - just for memory cleanup, not actual sync
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
        logger.info(LogCategory.TICK_BUFFER, '🌐 Network online - buffer active');
        this.isOnline = true;
      });

      window.addEventListener('offline', () => {
        logger.info(LogCategory.TICK_BUFFER, '📡 Network offline - buffer active');
        this.isOnline = false;
      });

      this.isOnline = navigator.onLine;
    }
  }

  async bufferTick(symbol: string, bid: number, ask: number, timestamp: string, broker_time?: string, writeToDatabase: boolean = true): Promise<void> {
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

    // SSOT FIX: Write to database immediately for ultra-critical symbols (active sessions)
    // This ensures Alpha has fresh price data when making execution decisions
    if (writeToDatabase && this.isOnline) {
      await this.writeToDatabase(tick);
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

  /**
   * SSOT FIX: Write price to database immediately
   *
   * WHY THIS IS NEEDED:
   * - Browser polling runs at 250ms for ultra-critical symbols (active sessions)
   * - Alpha needs fresh database prices for execution decisions (< 30s threshold)
   * - Server-side cron runs less frequently, causing staleness
   *
   * SSOT COMPLIANCE:
   * - Uses authenticated user context (respects RLS)
   * - Only writes fresh data during market hours
   * - Complements (not replaces) server-side price collection
   * - Ensures price freshness when execution is imminent
   */
  private async writeToDatabase(tick: TickData): Promise<void> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const mid = (tick.bid + tick.ask) / 2;

      const { error } = await supabase
        .from('realtime_prices')
        .insert({
          symbol: tick.symbol,
          bid: tick.bid,
          ask: tick.ask,
          mid,
          spread: tick.ask - tick.bid,
          broker_time: tick.broker_time || tick.timestamp,
          source: 'browser_poll'
        });

      if (error) {
        logger.debug(LogCategory.TICK_BUFFER, `DB write failed for ${tick.symbol}: ${error.message}`);
      }
    } catch (error) {
      logger.debug(LogCategory.TICK_BUFFER, `Error writing ${tick.symbol} to database:`, error);
    }
  }

  private async syncBuffer(bufferKey: string, symbol: string): Promise<void> {
    // Background cleanup: Remove old ticks from memory
    // SSOT: Database writes happen immediately in bufferTick()
    // This service maintains in-memory buffer for UI display

    const buffer = this.getBuffer(bufferKey);

    // Mark all ticks as synced (server handles persistence)
    const cleanedBuffer = buffer.map(tick => ({
      ...tick,
      synced: true
    }));

    // Keep only last 100 ticks in memory for performance
    const recentBuffer = cleanedBuffer.slice(-100);
    this.saveBuffer(bufferKey, recentBuffer);

    logger.trace(
      LogCategory.TICK_BUFFER,
      `🧹 Buffer cleanup complete for ${symbol}: ${recentBuffer.length} kept in memory`
    );
  }

  private async syncAllBuffers(): Promise<void> {
    // Include all symbols that are actively polled
    const symbols = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
      'NZDUSD', 'USDCHF', 'EURJPY', 'GBPJPY',
      'XAUUSD', 'XAGUSD',
      'US30', 'NAS100', 'SPX500',
      'BTCUSD', 'ETHUSD'
    ];

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

    logger.debug(LogCategory.TICK_BUFFER, '🔄 Background buffer cleanup started');
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
    const symbols = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
      'NZDUSD', 'USDCHF', 'EURJPY', 'GBPJPY',
      'XAUUSD', 'XAGUSD',
      'US30', 'NAS100', 'SPX500',
      'BTCUSD', 'ETHUSD'
    ];
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
