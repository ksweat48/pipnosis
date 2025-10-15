import { supabase } from '../lib/supabase';
import { Timeframe } from './metaapi';
import { timeframeToMinutes } from './candle-utils';

class CandleCompletionService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly CHECK_INTERVAL_MS = 60000;

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    console.log('🔄 Candle completion service started');

    this.runCompletionCheck();

    this.intervalId = setInterval(() => {
      this.runCompletionCheck();
    }, this.CHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('⏸️ Candle completion service stopped');
  }

  async runCompletionCheck(): Promise<void> {
    try {
      const { data: incompleteCandles, error } = await supabase
        .from('market_data')
        .select('id, symbol, timeframe, timestamp')
        .eq('is_complete', false)
        .order('timestamp', { ascending: true })
        .limit(1000);

      if (error) {
        console.error('Error fetching incomplete candles:', error);
        return;
      }

      if (!incompleteCandles || incompleteCandles.length === 0) {
        return;
      }

      const now = new Date();
      const candlesToComplete: string[] = [];

      for (const candle of incompleteCandles) {
        const candleTime = new Date(candle.timestamp);
        const timeframe = candle.timeframe as Timeframe;
        const timeframeMinutes = timeframeToMinutes(timeframe);
        const candleEndTime = new Date(candleTime.getTime() + timeframeMinutes * 60 * 1000);

        const gracePeriodMs = Math.min(timeframeMinutes * 60 * 1000 * 0.1, 30000);
        const completionTime = new Date(candleEndTime.getTime() + gracePeriodMs);

        if (now >= completionTime) {
          candlesToComplete.push(candle.id);
        }
      }

      if (candlesToComplete.length > 0) {
        await this.markCandlesComplete(candlesToComplete);
        console.log(`✅ Auto-completed ${candlesToComplete.length} candles based on time`);
      }
    } catch (error) {
      console.error('Error in runCompletionCheck:', error);
    }
  }

  async markCandlesComplete(candleIds: string[]): Promise<void> {
    if (candleIds.length === 0) return;

    try {
      const { error } = await supabase
        .from('market_data')
        .update({
          is_complete: true,
          completed_at: new Date().toISOString()
        })
        .in('id', candleIds);

      if (error) {
        console.error('Error marking candles complete:', error);
      }
    } catch (error) {
      console.error('Error in markCandlesComplete:', error);
    }
  }

  async markCandleComplete(
    symbol: string,
    timeframe: Timeframe,
    timestamp: Date
  ): Promise<void> {
    try {
      const { error } = await supabase
        .from('market_data')
        .update({
          is_complete: true,
          completed_at: new Date().toISOString()
        })
        .eq('symbol', symbol)
        .eq('timeframe', timeframe)
        .eq('timestamp', timestamp.toISOString());

      if (error) {
        console.error('Error marking single candle complete:', error);
      }
    } catch (error) {
      console.error('Error in markCandleComplete:', error);
    }
  }

  async getIncompleteStats(): Promise<{
    total: number;
    byTimeframe: Record<string, number>;
    oldestIncomplete: Date | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('market_data')
        .select('timeframe, timestamp')
        .eq('is_complete', false)
        .order('timestamp', { ascending: true });

      if (error || !data) {
        return { total: 0, byTimeframe: {}, oldestIncomplete: null };
      }

      const byTimeframe: Record<string, number> = {};
      data.forEach(row => {
        byTimeframe[row.timeframe] = (byTimeframe[row.timeframe] || 0) + 1;
      });

      return {
        total: data.length,
        byTimeframe,
        oldestIncomplete: data.length > 0 ? new Date(data[0].timestamp) : null
      };
    } catch (error) {
      console.error('Error in getIncompleteStats:', error);
      return { total: 0, byTimeframe: {}, oldestIncomplete: null };
    }
  }

  async cleanupStaleIncompleteCandles(ageThresholdHours: number = 24): Promise<number> {
    try {
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - ageThresholdHours);

      const { data: staleCandles, error: fetchError } = await supabase
        .from('market_data')
        .select('id, symbol, timeframe, timestamp')
        .eq('is_complete', false)
        .lt('timestamp', cutoffTime.toISOString());

      if (fetchError || !staleCandles || staleCandles.length === 0) {
        return 0;
      }

      const candleIds = staleCandles.map(c => c.id);
      await this.markCandlesComplete(candleIds);

      console.log(`🧹 Cleaned up ${candleIds.length} stale incomplete candles older than ${ageThresholdHours} hours`);
      return candleIds.length;
    } catch (error) {
      console.error('Error in cleanupStaleIncompleteCandles:', error);
      return 0;
    }
  }
}

export const candleCompletionService = new CandleCompletionService();
