import { supabase } from '@/lib/supabase';

export interface PriceDataStatus {
  symbol: string;
  last_price_time: string | null;
  seconds_since_last_price: number | null;
  status: 'NO_DATA' | 'ACTIVE' | 'STALE' | 'INACTIVE';
}

export interface CandleCompletionStatus {
  timeframe: string;
  incomplete_candles: number;
  oldest_incomplete: string | null;
  newest_incomplete: string | null;
  total_ticks: number;
}

export interface CandleSystemHealth {
  timestamp: string;
  price_data: {
    recent_ticks: number;
    last_tick_time: string | null;
    seconds_since_last_tick: number;
  };
  candle_data: {
    recent_candles: number;
    last_candle_time: string | null;
    seconds_since_last_candle: number;
  };
  system_status: 'healthy' | 'degraded' | 'unhealthy';
}

class CandleSystemMonitor {
  async getPriceDataStatus(): Promise<PriceDataStatus[]> {
    try {
      const { data, error } = await supabase
        .from('v_price_data_status')
        .select('*');

      if (error) {
        console.error('[CandleSystemMonitor] Error fetching price data status:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[CandleSystemMonitor] Exception fetching price data status:', error);
      return [];
    }
  }

  async getCandleCompletionStatus(): Promise<CandleCompletionStatus[]> {
    try {
      const { data, error } = await supabase
        .from('v_candle_completion_status')
        .select('*');

      if (error) {
        console.error('[CandleSystemMonitor] Error fetching candle completion status:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[CandleSystemMonitor] Exception fetching candle completion status:', error);
      return [];
    }
  }

  async getSystemHealth(): Promise<CandleSystemHealth | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_candle_system_health');

      if (error) {
        console.error('[CandleSystemMonitor] Error fetching system health:', error);
        return null;
      }

      return data as CandleSystemHealth;
    } catch (error) {
      console.error('[CandleSystemMonitor] Exception fetching system health:', error);
      return null;
    }
  }

  async checkServerSideAggregation(): Promise<{
    isActive: boolean;
    lastUpdate: Date | null;
    ageSeconds: number | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('candle_state')
        .select('last_updated')
        .order('last_updated', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        return {
          isActive: false,
          lastUpdate: null,
          ageSeconds: null
        };
      }

      const lastUpdate = new Date(data.last_updated);
      const ageSeconds = (Date.now() - lastUpdate.getTime()) / 1000;

      return {
        isActive: ageSeconds < 60,
        lastUpdate,
        ageSeconds
      };
    } catch (error) {
      console.error('[CandleSystemMonitor] Error checking server-side aggregation:', error);
      return {
        isActive: false,
        lastUpdate: null,
        ageSeconds: null
      };
    }
  }

  async getRecentAggregationLogs(limit: number = 20): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('candle_aggregation_log')
        .select('*')
        .order('executed_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[CandleSystemMonitor] Error fetching aggregation logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[CandleSystemMonitor] Exception fetching aggregation logs:', error);
      return [];
    }
  }
}

export const candleSystemMonitor = new CandleSystemMonitor();
