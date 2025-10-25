import { supabase } from '../lib/supabase';
import { CandleData, Timeframe } from './metaapi';
import { dataValidator } from './data-validator';
import { dbHealthMonitor } from './db-health-monitor';
import { getCandleOpenTime } from './candle-utils';

interface MarketDataRow {
  id?: string;
  symbol: string;
  timeframe: string;
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tick_volume: number;
  spread: number;
  broker_time: string | null;
  data_source: string;
  is_complete?: boolean;
  completed_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface SubscriptionRow {
  id?: string;
  symbol: string;
  timeframe: string;
  last_update: string;
  status: string;
  metadata: any;
}

class MarketDataCache {
  async getCachedCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500,
    includeIncomplete: boolean = false
  ): Promise<CandleData[]> {
    try {
      let query = supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe);

      if (!includeIncomplete) {
        query = query.eq('is_complete', true);
      }

      const { data, error } = await query
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching cached candles:', error);
        return [];
      }

      const candles = (data || []).map(row => this.rowToCandleData(row));
      return candles.reverse();
    } catch (error) {
      console.error('Error in getCachedCandles:', error);
      return [];
    }
  }

  async getCachedCandlesWithCurrent(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500
  ): Promise<CandleData[]> {
    try {
      const completeCandles = await this.getCompleteCandles(symbol, timeframe, limit);

      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('is_complete', false)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return completeCandles;
      }

      const currentCandle = this.rowToCandleData(data);

      if (completeCandles.length === 0) {
        return [currentCandle];
      }

      const lastCompleteTime = completeCandles[completeCandles.length - 1].time.getTime();
      if (currentCandle.time.getTime() >= lastCompleteTime) {
        return [...completeCandles, currentCandle];
      }

      return completeCandles;
    } catch (error) {
      console.error('Error in getCachedCandlesWithCurrent:', error);
      return [];
    }
  }

  async getRecentLiveCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 100
  ): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .in('data_source', ['live_tick', 'live_tick_complete'])
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching recent live candles:', error);
        return [];
      }

      const candles = (data || []).map(row => this.rowToCandleData(row));
      console.log(`📊 Retrieved ${candles.length} recent live candles for ${symbol} ${timeframe}`);
      return candles.reverse();
    } catch (error) {
      console.error('Error in getRecentLiveCandles:', error);
      return [];
    }
  }

  async getCompleteCandles(
    symbol: string,
    timeframe: Timeframe,
    limit: number = 500
  ): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('is_complete', true)
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching complete candles:', error);
        return [];
      }

      const candles = (data || []).map(row => this.rowToCandleData(row));
      return candles.reverse();
    } catch (error) {
      console.error('Error in getCompleteCandles:', error);
      return [];
    }
  }

  async updateLiveCandle(
    symbol: string,
    timeframe: Timeframe,
    price: number,
    timestamp: Date = new Date()
  ): Promise<CandleData | null> {
    try {
      const candleOpenTime = getCandleOpenTime(timestamp, timeframe);
      const candleOpenTimeISO = candleOpenTime.toISOString();

      const { data: existing, error: fetchError } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('timestamp', candleOpenTimeISO)
        .eq('is_complete', false)
        .maybeSingle();

      if (fetchError) {
        console.error('Error fetching incomplete candle:', fetchError);
        return null;
      }

      let row: MarketDataRow;

      if (existing) {
        row = {
          symbol,
          timeframe,
          timestamp: candleOpenTimeISO,
          open: parseFloat(existing.open),
          high: Math.max(parseFloat(existing.high), price),
          low: Math.min(parseFloat(existing.low), price),
          close: price,
          volume: existing.volume || 0,
          tick_volume: (existing.tick_volume || 0) + 1,
          spread: existing.spread || 0,
          broker_time: existing.broker_time,
          data_source: 'live_tick',
          is_complete: false,
          completed_at: null
        };
      } else {
        row = {
          symbol,
          timeframe,
          timestamp: candleOpenTimeISO,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: 0,
          tick_volume: 1,
          spread: 0,
          broker_time: timestamp.toISOString(),
          data_source: 'live_tick',
          is_complete: false,
          completed_at: null
        };
      }

      const { error: upsertError } = await supabase
        .from('market_data')
        .upsert(row, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error('Error upserting live candle:', upsertError);
        dbHealthMonitor.recordExternalWriteFailure(upsertError.message);
        return null;
      }

      dbHealthMonitor.recordExternalWriteSuccess();

      return {
        symbol,
        timeframe,
        time: candleOpenTime,
        brokerTime: row.broker_time || '',
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        tickVolume: row.tick_volume,
        spread: row.spread,
        volume: row.volume
      };
    } catch (error) {
      console.error('Exception in updateLiveCandle:', error);
      return null;
    }
  }

  async saveCandles(candles: CandleData[], isComplete: boolean = true, retryCount: number = 0): Promise<void> {
    if (candles.length === 0) return;

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 1000;

    const repairedCandles = dataValidator.validateAndRepairCandleSequence(candles, candles[0].timeframe as Timeframe, true);

    try {
      const rows: MarketDataRow[] = repairedCandles.map(candle => ({
        symbol: candle.symbol,
        timeframe: candle.timeframe,
        timestamp: candle.time.toISOString(),
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume || 0,
        tick_volume: candle.tickVolume || 0,
        spread: candle.spread || 0,
        broker_time: candle.brokerTime || null,
        data_source: 'metaapi',
        is_complete: isComplete,
        completed_at: isComplete ? new Date().toISOString() : null
      }));

      const { error, status, statusText } = await supabase
        .from('market_data')
        .upsert(rows, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        const errorMessage = error?.message || error?.toString() || 'Unknown database error';
        dbHealthMonitor.recordExternalWriteFailure(errorMessage);

        console.error(`❌ Error saving candles to cache (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, {
          error: error.message,
          code: error.code,
          details: error.details,
          hint: error.hint,
          status,
          statusText,
          symbol: candles[0]?.symbol,
          timeframe: candles[0]?.timeframe,
          count: candles.length
        });

        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
          console.log(`⏳ Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.saveCandles(candles, isComplete, retryCount + 1);
        } else {
          console.error(`❌ Failed to save candles after ${MAX_RETRIES + 1} attempts. Data persistence failed.`);
          if (typeof window !== 'undefined' && window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
              detail: {
                type: 'market_data_save_failed',
                error: error.message,
                symbol: candles[0]?.symbol,
                timeframe: candles[0]?.timeframe,
                attempts: MAX_RETRIES + 1
              }
            }));
          }
        }
      } else {
        dbHealthMonitor.recordExternalWriteSuccess();

        if (retryCount > 0) {
          console.log(`✅ Saved ${candles.length} candles after ${retryCount + 1} attempts for ${candles[0].symbol} ${candles[0].timeframe}`);
        } else {
          console.log(`💾 Saved ${candles.length} candles to cache for ${candles[0].symbol} ${candles[0].timeframe}`);
        }

        this.cleanupOldCandles(candles[0].symbol, candles[0].timeframe as Timeframe).catch(err => {
          console.warn('Background cleanup warning:', err);
        });
      }
    } catch (error) {
      console.error(`❌ Exception in saveCandles (attempt ${retryCount + 1}/${MAX_RETRIES + 1}):`, error);

      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount);
        console.log(`⏳ Retrying after exception in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.saveCandles(candles, isComplete, retryCount + 1);
      } else {
        console.error(`❌ Failed to save candles after ${MAX_RETRIES + 1} attempts due to exception.`);
        if (typeof window !== 'undefined' && window.dispatchEvent) {
          window.dispatchEvent(new CustomEvent('pipnosis:data-persistence-error', {
            detail: {
              type: 'market_data_save_exception',
              error: error instanceof Error ? error.message : 'Unknown error',
              symbol: candles[0]?.symbol,
              timeframe: candles[0]?.timeframe,
              attempts: MAX_RETRIES + 1
            }
          }));
        }
      }
    }
  }

  async getLatestCachedCandle(
    symbol: string,
    timeframe: Timeframe
  ): Promise<CandleData | null> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return this.rowToCandleData(data);
    } catch (error) {
      console.error('Error in getLatestCachedCandle:', error);
      return null;
    }
  }

  async updateSubscription(
    symbol: string,
    timeframe: Timeframe,
    status: string = 'active'
  ): Promise<void> {
    try {
      const row: SubscriptionRow = {
        symbol,
        timeframe,
        last_update: new Date().toISOString(),
        status,
        metadata: {}
      };

      const { error } = await supabase
        .from('market_data_subscriptions')
        .upsert(row, {
          onConflict: 'symbol,timeframe'
        });

      if (error) {
        console.error('Error updating subscription:', error);
      }
    } catch (error) {
      console.error('Error in updateSubscription:', error);
    }
  }

  async getActiveSubscriptions(): Promise<Array<{ symbol: string; timeframe: Timeframe }>> {
    try {
      const { data, error } = await supabase
        .from('market_data_subscriptions')
        .select('symbol, timeframe')
        .eq('status', 'active');

      if (error) {
        console.error('Error fetching subscriptions:', error);
        return [];
      }

      return (data || []).map(row => ({
        symbol: row.symbol,
        timeframe: row.timeframe as Timeframe
      }));
    } catch (error) {
      console.error('Error in getActiveSubscriptions:', error);
      return [];
    }
  }

  async cleanupOldData(): Promise<void> {
    try {
      const retentionPolicies = [
        { timeframe: 'M1', days: 30 },
        { timeframe: 'M5', days: 90 },
        { timeframe: 'M15', days: 90 },
        { timeframe: 'M30', days: 180 },
        { timeframe: 'H1', days: 365 },
        { timeframe: 'H4', days: 365 }
      ];

      for (const policy of retentionPolicies) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.days);

        const { error } = await supabase
          .from('market_data')
          .delete()
          .eq('timeframe', policy.timeframe)
          .lt('timestamp', cutoffDate.toISOString());

        if (error) {
          console.error(`Error cleaning up ${policy.timeframe} data:`, error);
        } else {
          console.log(`Cleaned up ${policy.timeframe} data older than ${policy.days} days`);
        }
      }
    } catch (error) {
      console.error('Error in cleanupOldData:', error);
    }
  }

  async getCacheStats(symbol: string, timeframe: Timeframe): Promise<{
    count: number;
    oldestCandle: Date | null;
    newestCandle: Date | null;
  }> {
    try {
      const { data, error, count } = await supabase
        .from('market_data')
        .select('timestamp', { count: 'exact' })
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .order('timestamp', { ascending: true });

      if (error || !data || data.length === 0) {
        return { count: 0, oldestCandle: null, newestCandle: null };
      }

      return {
        count: count || data.length,
        oldestCandle: new Date(data[0].timestamp),
        newestCandle: new Date(data[data.length - 1].timestamp)
      };
    } catch (error) {
      console.error('Error in getCacheStats:', error);
      return { count: 0, oldestCandle: null, newestCandle: null };
    }
  }

  async updateDataCompletenessStats(
    symbol: string,
    timeframe: Timeframe,
    stats: {
      totalCandles: number;
      dateRangeStart?: Date;
      dateRangeEnd?: Date;
      gapsDetected: number;
      lastValidated: Date;
    }
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('market_data_completeness')
        .upsert({
          symbol,
          timeframe,
          total_candles: stats.totalCandles,
          date_range_start: stats.dateRangeStart?.toISOString(),
          date_range_end: stats.dateRangeEnd?.toISOString(),
          gaps_detected: stats.gapsDetected,
          last_validated: stats.lastValidated.toISOString(),
          backfill_status: stats.gapsDetected > 0 ? 'pending' : 'complete'
        }, {
          onConflict: 'symbol,timeframe'
        });

      if (error) {
        console.error('Error updating completeness stats:', error);
      } else {
        console.log(`📊 Updated completeness stats for ${symbol} ${timeframe}: ${stats.totalCandles} candles, ${stats.gapsDetected} gaps`);
      }
    } catch (error) {
      console.error('Error in updateDataCompletenessStats:', error);
    }
  }

  async getDataCompletenessStats(
    symbol: string,
    timeframe: Timeframe
  ): Promise<{
    totalCandles: number;
    completenessPercentage: number;
    gapsDetected: number;
    lastValidated: Date | null;
    backfillStatus: string;
  } | null> {
    try {
      const { data, error } = await supabase
        .from('market_data_completeness')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .maybeSingle();

      if (error || !data) {
        return null;
      }

      return {
        totalCandles: data.total_candles || 0,
        completenessPercentage: parseFloat(data.completeness_percentage) || 0,
        gapsDetected: data.gaps_detected || 0,
        lastValidated: data.last_validated ? new Date(data.last_validated) : null,
        backfillStatus: data.backfill_status || 'unknown'
      };
    } catch (error) {
      console.error('Error in getDataCompletenessStats:', error);
      return null;
    }
  }

  async cleanupOldCandles(symbol: string, timeframe: Timeframe, keepCount: number = 500): Promise<void> {
    try {
      const { data, error } = await supabase.rpc('cleanup_old_candles', {
        p_symbol: symbol,
        p_timeframe: timeframe,
        p_keep_count: keepCount
      });

      if (error) {
        console.error('Error cleaning up old candles:', error);
      } else if (data && data > 0) {
        console.log(`🧹 Cleaned up ${data} old candles for ${symbol} ${timeframe}, keeping most recent ${keepCount}`);
      }
    } catch (error) {
      console.error('Error in cleanupOldCandles:', error);
    }
  }

  async clearSymbolTimeframe(symbol: string, timeframe: Timeframe): Promise<void> {
    try {
      console.log(`🗑️ Clearing stale cache for ${symbol} ${timeframe}...`);

      const { error } = await supabase
        .from('market_data')
        .delete()
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .neq('data_source', 'live_tick');

      if (error) {
        console.error('Error clearing symbol timeframe cache:', error);
        throw error;
      }

      console.log(`✅ Cache cleared for ${symbol} ${timeframe}`);
    } catch (error) {
      console.error('Error in clearSymbolTimeframe:', error);
      throw error;
    }
  }

  async updateCandleCountStats(symbol: string, timeframe: Timeframe): Promise<void> {
    try {
      const { error } = await supabase.rpc('update_candle_count_stats', {
        p_symbol: symbol,
        p_timeframe: timeframe
      });

      if (error) {
        console.error('Error updating candle count stats:', error);
      }
    } catch (error) {
      console.error('Error in updateCandleCountStats:', error);
    }
  }

  private rowToCandleData(row: any): CandleData {
    return {
      symbol: row.symbol,
      timeframe: row.timeframe,
      time: new Date(row.timestamp),
      brokerTime: row.broker_time || row.timestamp,
      open: parseFloat(row.open),
      high: parseFloat(row.high),
      low: parseFloat(row.low),
      close: parseFloat(row.close),
      tickVolume: row.tick_volume || 0,
      spread: row.spread || 0,
      volume: parseFloat(row.volume) || 0
    };
  }
}

export const marketDataCache = new MarketDataCache();
