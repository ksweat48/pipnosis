import { supabase } from '@/lib/supabase';
import { pollingConfigService } from './polling-config-service';
import { smartRequestQueue } from './smart-request-queue';
import { globalPollingCoordinator } from './global-polling-coordinator';

export interface LoadSnapshot {
  cpuCreditsUsed: number;
  cpuCreditsLimit: number;
  cpuUsagePercentage: number;
  apiCallsCount: number;
  apiCallsPerSecond: number;
  activePairsCount: number;
  errorCount: number;
  errorRate: number;
  requestQueueLength: number;
  cacheHitRate: number;
  dbWritesPerMinute: number;
}

export interface LoadSummary {
  current: {
    cpu_usage_percentage: number;
    api_calls_per_second: number;
    error_rate: number;
    active_pairs: number;
    queue_length: number;
    cache_hit_rate: number;
  };
  averages: {
    cpu_usage_1h: number;
    cpu_usage_24h: number;
  };
  active_alerts: number;
  last_updated: string;
}

export interface SystemAlert {
  id: string;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  threshold_value: number;
  actual_value: number;
  message: string;
  metadata: any;
  email_sent: boolean;
  email_sent_at: string | null;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
}

class SystemLoadMonitor {
  private monitoringInterval: NodeJS.Timeout | null = null;
  private isMonitoring = false;
  private metricsHistory: LoadSnapshot[] = [];
  private readonly MAX_HISTORY_SIZE = 100;
  private totalApiCalls = 0;
  private totalErrors = 0;
  private cacheHits = 0;
  private totalCacheRequests = 0;
  private dbWrites = 0;
  private lastResetTime = Date.now();

  start(): void {
    if (this.isMonitoring) {
      console.log('[LoadMonitor] Already monitoring');
      return;
    }

    console.log('[LoadMonitor] Starting system load monitoring');
    this.isMonitoring = true;
    this.lastResetTime = Date.now();

    this.monitoringInterval = setInterval(() => {
      this.collectAndRecordMetrics();
    }, 60000);

    this.collectAndRecordMetrics();
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.isMonitoring = false;
    console.log('[LoadMonitor] Stopped system load monitoring');
  }

  private async collectAndRecordMetrics(): Promise<void> {
    try {
      const snapshot = this.collectSnapshot();

      this.metricsHistory.push(snapshot);
      if (this.metricsHistory.length > this.MAX_HISTORY_SIZE) {
        this.metricsHistory.shift();
      }

      await this.recordSnapshotToDatabase(snapshot);

      this.resetCounters();
    } catch (error) {
      console.error('[LoadMonitor] Error collecting metrics:', error);
    }
  }

  private collectSnapshot(): LoadSnapshot {
    const creditUsage = pollingConfigService.getCreditUsage();
    const queueStatus = smartRequestQueue.getQueueStatus();
    const coordinatorStatus = globalPollingCoordinator.getCoordinatorStatus();

    const timePeriodMinutes = (Date.now() - this.lastResetTime) / 60000;
    const apiCallsPerSecond = timePeriodMinutes > 0
      ? this.totalApiCalls / (timePeriodMinutes * 60)
      : 0;

    const errorRate = this.totalApiCalls > 0
      ? (this.totalErrors / this.totalApiCalls) * 100
      : 0;

    const cacheHitRate = this.totalCacheRequests > 0
      ? (this.cacheHits / this.totalCacheRequests) * 100
      : 0;

    const dbWritesPerMinute = timePeriodMinutes > 0
      ? this.dbWrites / timePeriodMinutes
      : 0;

    return {
      cpuCreditsUsed: creditUsage.used,
      cpuCreditsLimit: creditUsage.limit,
      cpuUsagePercentage: creditUsage.percentage,
      apiCallsCount: this.totalApiCalls,
      apiCallsPerSecond: parseFloat(apiCallsPerSecond.toFixed(2)),
      activePairsCount: coordinatorStatus.activePairs,
      errorCount: this.totalErrors,
      errorRate: parseFloat(errorRate.toFixed(2)),
      requestQueueLength: queueStatus.queueLength,
      cacheHitRate: parseFloat(cacheHitRate.toFixed(2)),
      dbWritesPerMinute: Math.round(dbWritesPerMinute)
    };
  }

  private async recordSnapshotToDatabase(snapshot: LoadSnapshot): Promise<void> {
    try {
      const { error } = await supabase
        .from('system_load_metrics')
        .insert({
          cpu_credits_used: snapshot.cpuCreditsUsed,
          cpu_credits_limit: snapshot.cpuCreditsLimit,
          cpu_usage_percentage: snapshot.cpuUsagePercentage,
          api_calls_count: snapshot.apiCallsCount,
          api_calls_per_second: snapshot.apiCallsPerSecond,
          active_pairs_count: snapshot.activePairsCount,
          error_count: snapshot.errorCount,
          error_rate: snapshot.errorRate,
          request_queue_length: snapshot.requestQueueLength,
          cache_hit_rate: snapshot.cacheHitRate,
          db_writes_per_minute: snapshot.dbWritesPerMinute
        });

      if (error) {
        console.warn('[LoadMonitor] Could not save metrics to database:', error.message);
      }
    } catch (error) {
      console.warn('[LoadMonitor] Error recording metrics:', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  private resetCounters(): void {
    this.totalApiCalls = 0;
    this.totalErrors = 0;
    this.cacheHits = 0;
    this.totalCacheRequests = 0;
    this.dbWrites = 0;
    this.lastResetTime = Date.now();
  }

  recordApiCall(success: boolean): void {
    this.totalApiCalls++;
    if (!success) {
      this.totalErrors++;
    }
  }

  recordCacheAccess(hit: boolean): void {
    this.totalCacheRequests++;
    if (hit) {
      this.cacheHits++;
    }
  }

  recordDatabaseWrite(): void {
    this.dbWrites++;
  }

  async getLoadSummary(): Promise<LoadSummary | null> {
    try {
      const { data, error } = await supabase.rpc('get_system_load_summary');

      if (error) {
        console.error('[LoadMonitor] Error getting load summary:', error);
        return null;
      }

      return data as LoadSummary;
    } catch (error) {
      console.error('[LoadMonitor] Error fetching load summary:', error);
      return null;
    }
  }

  async getRecentMetrics(minutes: number = 60): Promise<LoadSnapshot[]> {
    const cutoffTime = new Date(Date.now() - minutes * 60000).toISOString();

    try {
      const { data, error } = await supabase
        .from('system_load_metrics')
        .select('*')
        .gte('timestamp', cutoffTime)
        .order('timestamp', { ascending: true });

      if (error) {
        console.error('[LoadMonitor] Error fetching recent metrics:', error);
        return [];
      }

      return (data || []).map(row => ({
        cpuCreditsUsed: row.cpu_credits_used,
        cpuCreditsLimit: row.cpu_credits_limit,
        cpuUsagePercentage: parseFloat(row.cpu_usage_percentage),
        apiCallsCount: row.api_calls_count,
        apiCallsPerSecond: parseFloat(row.api_calls_per_second),
        activePairsCount: row.active_pairs_count,
        errorCount: row.error_count,
        errorRate: parseFloat(row.error_rate),
        requestQueueLength: row.request_queue_length,
        cacheHitRate: parseFloat(row.cache_hit_rate),
        dbWritesPerMinute: row.db_writes_per_minute
      }));
    } catch (error) {
      console.error('[LoadMonitor] Error querying metrics:', error);
      return [];
    }
  }

  async getActiveAlerts(): Promise<SystemAlert[]> {
    try {
      const { data, error } = await supabase
        .from('system_load_alerts')
        .select('*')
        .eq('resolved', false)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[LoadMonitor] Error fetching alerts:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[LoadMonitor] Error querying alerts:', error);
      return [];
    }
  }

  async getAlertHistory(limit: number = 50): Promise<SystemAlert[]> {
    try {
      const { data, error } = await supabase
        .from('system_load_alerts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.error('[LoadMonitor] Error fetching alert history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[LoadMonitor] Error querying alert history:', error);
      return [];
    }
  }

  async resolveAlert(alertId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('system_load_alerts')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString()
        })
        .eq('id', alertId);

      if (error) {
        console.error('[LoadMonitor] Error resolving alert:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[LoadMonitor] Error resolving alert:', error);
      return false;
    }
  }

  getCurrentSnapshot(): LoadSnapshot | null {
    if (this.metricsHistory.length === 0) {
      return null;
    }
    return this.metricsHistory[this.metricsHistory.length - 1];
  }

  getMetricsHistory(): LoadSnapshot[] {
    return [...this.metricsHistory];
  }

  getLoadStatus(): 'healthy' | 'warning' | 'critical' {
    const snapshot = this.getCurrentSnapshot();
    if (!snapshot) return 'healthy';

    if (snapshot.cpuUsagePercentage >= 95 || snapshot.errorRate >= 25) {
      return 'critical';
    }

    if (snapshot.cpuUsagePercentage >= 70 || snapshot.errorRate >= 10) {
      return 'warning';
    }

    return 'healthy';
  }

  calculateLoadReduction(): {
    before: { pairs: number; estimatedLoad: number };
    after: { pairs: number; estimatedLoad: number };
    reduction: { pairs: number; percentage: number };
    headroom: number;
  } {
    const beforePairs = 12;
    const afterPairs = 5;

    const estimatedLoadBefore = 85;
    const estimatedLoadAfter = 35;

    const pairReduction = beforePairs - afterPairs;
    const loadReductionPercent = ((estimatedLoadBefore - estimatedLoadAfter) / estimatedLoadBefore) * 100;
    const headroom = 100 - estimatedLoadAfter;

    return {
      before: {
        pairs: beforePairs,
        estimatedLoad: estimatedLoadBefore
      },
      after: {
        pairs: afterPairs,
        estimatedLoad: estimatedLoadAfter
      },
      reduction: {
        pairs: pairReduction,
        percentage: Math.round(loadReductionPercent)
      },
      headroom
    };
  }
}

export const systemLoadMonitor = new SystemLoadMonitor();
