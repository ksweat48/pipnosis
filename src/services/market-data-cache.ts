import { supabase } from '../lib/supabase';
import { CandleData, Timeframe } from './metaapi';

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
    startTime: Date,
    endTime: Date
  ): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error fetching cached candles:', error);
        return [];
      }

      return (data || []).map(row => this.rowToCandleData(row));
    } catch (error) {
      console.error('Error in getCachedCandles:', error);
      return [];
    }
  }

  async getRecentLiveCandles(
    symbol: string,
    timeframe: Timeframe,
    hoursBack: number = 24
  ): Promise<CandleData[]> {
    try {
      const startTime = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
      const endTime = new Date();

      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .in('data_source', ['live_tick', 'live_tick_complete'])
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error fetching recent live candles:', error);
        return [];
      }

      const candles = (data || []).map(row => this.rowToCandleData(row));
      console.log(`📊 Retrieved ${candles.length} recent live candles for ${symbol} ${timeframe}`);
      return candles;
    } catch (error) {
      console.error('Error in getRecentLiveCandles:', error);
      return [];
    }
  }

  async getCompleteCandles(
    symbol: string,
    timeframe: Timeframe,
    startTime: Date,
    endTime: Date
  ): Promise<CandleData[]> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('*')
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('is_complete', true)
        .gte('timestamp', startTime.toISOString())
        .lte('timestamp', endTime.toISOString())
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('Error fetching complete candles:', error);
        return [];
      }

      return (data || []).map(row => this.rowToCandleData(row));
    } catch (error) {
      console.error('Error in getCompleteCandles:', error);
      return [];
    }
  }

  async saveCandles(candles: CandleData[], isComplete: boolean = true): Promise<void> {
    if (candles.length === 0) return;

    try {
      const rows: MarketDataRow[] = candles.map(candle => ({
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

      const { error } = await supabase
        .from('market_data')
        .upsert(rows, {
          onConflict: 'symbol,timeframe,timestamp',
          ignoreDuplicates: false
        });

      if (error) {
        console.error('Error saving candles to cache:', error);
      } else {
        console.log(`💾 Saved ${candles.length} candles to cache for ${candles[0].symbol} ${candles[0].timeframe}`);
      }
    } catch (error) {
      console.error('Error in saveCandles:', error);
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
