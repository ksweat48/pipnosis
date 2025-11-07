import { supabase } from '@/lib/supabase';

export interface CronJobStatus {
  name: string;
  schedule: string;
  active: boolean;
}

export interface CronJobExecution {
  jobname: string;
  schedule: string;
  active: boolean;
  start_time: string;
  end_time: string;
  status: string;
  return_message: string | null;
  duration_ms: number;
}

export interface PricePollingStats {
  total_polls: number;
  successful_polls: number;
  failed_polls: number;
  success_rate: number;
  avg_duration_ms: number;
  last_poll_time: string;
  seconds_since_last_poll: number;
}

export interface PriceDataFreshness {
  symbol: string;
  status: 'ACTIVE' | 'STALE' | 'INACTIVE' | 'NO_DATA';
  seconds_since_last_price: number;
}

export interface CandleGenerationMetrics {
  timeframe: string;
  symbols_tracked: number;
  active_candles: number;
  total_ticks: number;
  avg_ticks_per_candle: number;
  most_recent_update: string;
  seconds_since_update: number;
  status: 'active' | 'stale' | 'inactive';
}

export interface SystemAlert {
  alert_type: string;
  alert_time: string;
  alert_title: string;
  alert_message: string;
  severity: 'warning' | 'error';
}

export interface SystemDashboard {
  timestamp: string;
  active_cron_jobs: CronJobStatus[];
  successful_executions_last_10min: number;
  failed_executions_last_10min: number;
  price_polling_stats: PricePollingStats;
  price_data_freshness: PriceDataFreshness[];
  candle_generation_stats: CandleGenerationMetrics[];
  system_uptime_24h: number;
  overall_health: any;
  system_status: 'healthy' | 'degraded' | 'unhealthy';
}

export interface PricePollingMetric {
  poll_minute: string;
  poll_count: number;
  successful_polls: number;
  failed_polls: number;
  avg_duration_ms: number;
  avg_successful_pairs: number;
  avg_failed_pairs: number;
  latest_poll: string;
}

class SystemMonitoringService {
  private refreshInterval: NodeJS.Timeout | null = null;
  private listeners: Set<(data: SystemDashboard) => void> = new Set();

  async getDashboard(): Promise<SystemDashboard | null> {
    try {
      const { data, error } = await supabase
        .from('v_autonomous_system_dashboard')
        .select('*')
        .single();

      if (error) {
        console.error('Error fetching system dashboard:', error);
        return null;
      }

      return data as SystemDashboard;
    } catch (error) {
      console.error('Error in getDashboard:', error);
      return null;
    }
  }

  async getCronJobExecutions(limit: number = 50): Promise<CronJobExecution[]> {
    try {
      const { data, error } = await supabase
        .from('v_cron_job_execution_history')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('Error fetching cron job executions:', error);
        return [];
      }

      return data as CronJobExecution[];
    } catch (error) {
      console.error('Error in getCronJobExecutions:', error);
      return [];
    }
  }

  async getPricePollingMetrics(hours: number = 24): Promise<PricePollingMetric[]> {
    try {
      const { data, error } = await supabase
        .from('v_price_polling_metrics')
        .select('*')
        .order('poll_minute', { ascending: false })
        .limit(hours * 60);

      if (error) {
        console.error('Error fetching price polling metrics:', error);
        return [];
      }

      return data as PricePollingMetric[];
    } catch (error) {
      console.error('Error in getPricePollingMetrics:', error);
      return [];
    }
  }

  async getCandleGenerationMetrics(): Promise<CandleGenerationMetrics[]> {
    try {
      const { data, error } = await supabase
        .from('v_candle_generation_metrics')
        .select('*');

      if (error) {
        console.error('Error fetching candle generation metrics:', error);
        return [];
      }

      return data as CandleGenerationMetrics[];
    } catch (error) {
      console.error('Error in getCandleGenerationMetrics:', error);
      return [];
    }
  }

  async getSystemAlerts(): Promise<SystemAlert[]> {
    try {
      const { data, error } = await supabase
        .from('v_system_alerts')
        .select('*')
        .order('alert_time', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching system alerts:', error);
        return [];
      }

      return data as SystemAlert[];
    } catch (error) {
      console.error('Error in getSystemAlerts:', error);
      return [];
    }
  }

  async getSystemUptimePercentage(): Promise<number> {
    try {
      const { data, error } = await supabase.rpc('get_system_uptime_percentage');

      if (error) {
        console.error('Error fetching system uptime:', error);
        return 0;
      }

      return data as number;
    } catch (error) {
      console.error('Error in getSystemUptimePercentage:', error);
      return 0;
    }
  }

  subscribe(callback: (data: SystemDashboard) => void): () => void {
    this.listeners.add(callback);

    if (!this.refreshInterval) {
      this.startPolling();
    }

    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.stopPolling();
      }
    };
  }

  private async pollData() {
    const dashboard = await this.getDashboard();
    if (dashboard) {
      this.listeners.forEach(callback => callback(dashboard));
    }
  }

  private startPolling() {
    this.pollData();
    this.refreshInterval = setInterval(() => {
      this.pollData();
    }, 10000);
  }

  private stopPolling() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

export const systemMonitoringService = new SystemMonitoringService();
