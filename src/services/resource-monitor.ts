import { supabase } from '../lib/supabase';

export interface ResourceMetrics {
  dbLatency: number;
  timestamp: Date;
  operationType: string;
  status: 'normal' | 'warning' | 'elevated' | 'critical';
  shouldThrottle: boolean;
  throttleMultiplier: number;
}

export interface ResourceLimits {
  maxDbLatency: number;
  criticalDbLatency: number;
  maxConcurrentOperations: number;
  maxOperationsPerMinute: number;
}

class ResourceMonitor {
  private metrics: ResourceMetrics[] = [];
  private activeOperations = 0;
  private operationTimestamps: Date[] = [];
  private readonly MAX_METRICS_HISTORY = 100;

  private readonly limits: ResourceLimits = {
    maxDbLatency: 1000,
    criticalDbLatency: 5000,
    maxConcurrentOperations: 5,
    maxOperationsPerMinute: 30
  };

  async measureDatabaseLatency(operationType: string = 'test'): Promise<ResourceMetrics> {
    const startTime = Date.now();

    try {
      await supabase
        .from('auto_backtest_global_state')
        .select('id')
        .limit(1)
        .single();
    } catch (error) {
      console.warn('[Resource Monitor] Test query failed, but continuing:', error);
    }

    const dbLatency = Date.now() - startTime;

    let status: ResourceMetrics['status'] = 'normal';
    let shouldThrottle = false;
    let throttleMultiplier = 1.0;

    if (dbLatency >= this.limits.criticalDbLatency) {
      status = 'critical';
      shouldThrottle = true;
      throttleMultiplier = 3.0;
    } else if (dbLatency >= this.limits.maxDbLatency * 2) {
      status = 'elevated';
      shouldThrottle = true;
      throttleMultiplier = 2.0;
    } else if (dbLatency >= this.limits.maxDbLatency) {
      status = 'warning';
      shouldThrottle = true;
      throttleMultiplier = 1.5;
    }

    const metrics: ResourceMetrics = {
      dbLatency,
      timestamp: new Date(),
      operationType,
      status,
      shouldThrottle,
      throttleMultiplier
    };

    this.recordMetrics(metrics);

    return metrics;
  }

  canStartOperation(operationType: string = 'general'): boolean {
    if (this.activeOperations >= this.limits.maxConcurrentOperations) {
      console.warn(`[Resource Monitor] Too many concurrent operations (${this.activeOperations}/${this.limits.maxConcurrentOperations})`);
      return false;
    }

    const oneMinuteAgo = new Date(Date.now() - 60000);
    const recentOps = this.operationTimestamps.filter(ts => ts > oneMinuteAgo);

    if (recentOps.length >= this.limits.maxOperationsPerMinute) {
      console.warn(`[Resource Monitor] Rate limit reached (${recentOps.length}/${this.limits.maxOperationsPerMinute} ops/min)`);
      return false;
    }

    const recentMetrics = this.getRecentMetrics(5);
    const avgLatency = recentMetrics.length > 0
      ? recentMetrics.reduce((sum, m) => sum + m.dbLatency, 0) / recentMetrics.length
      : 0;

    if (avgLatency >= this.limits.criticalDbLatency) {
      console.warn(`[Resource Monitor] Database overloaded (avg latency: ${avgLatency.toFixed(0)}ms)`);
      return false;
    }

    return true;
  }

  startOperation(operationType: string = 'general'): void {
    this.activeOperations++;
    this.operationTimestamps.push(new Date());

    this.operationTimestamps = this.operationTimestamps.filter(
      ts => ts > new Date(Date.now() - 60000)
    );
  }

  endOperation(): void {
    this.activeOperations = Math.max(0, this.activeOperations - 1);
  }

  getRecentMetrics(count: number = 10): ResourceMetrics[] {
    return this.metrics.slice(-count);
  }

  getAverageLatency(seconds: number = 60): number {
    const cutoff = new Date(Date.now() - seconds * 1000);
    const recent = this.metrics.filter(m => m.timestamp > cutoff);

    if (recent.length === 0) return 0;

    return recent.reduce((sum, m) => sum + m.dbLatency, 0) / recent.length;
  }

  getCurrentStatus(): ResourceMetrics['status'] {
    const recent = this.getRecentMetrics(5);
    if (recent.length === 0) return 'normal';

    const criticalCount = recent.filter(m => m.status === 'critical').length;
    const elevatedCount = recent.filter(m => m.status === 'elevated').length;
    const warningCount = recent.filter(m => m.status === 'warning').length;

    if (criticalCount >= 2) return 'critical';
    if (elevatedCount >= 3) return 'elevated';
    if (warningCount >= 3) return 'warning';

    return 'normal';
  }

  getRecommendedDelay(): number {
    const status = this.getCurrentStatus();
    const avgLatency = this.getAverageLatency(30);

    switch (status) {
      case 'critical':
        return 300000; // 5 minutes
      case 'elevated':
        return 120000; // 2 minutes
      case 'warning':
        return 60000; // 1 minute
      default:
        return avgLatency > 500 ? 30000 : 10000; // 30s or 10s
    }
  }

  shouldPauseOperations(): boolean {
    const status = this.getCurrentStatus();
    return status === 'critical';
  }

  private recordMetrics(metrics: ResourceMetrics): void {
    this.metrics.push(metrics);

    if (this.metrics.length > this.MAX_METRICS_HISTORY) {
      this.metrics = this.metrics.slice(-this.MAX_METRICS_HISTORY);
    }

    if (metrics.status !== 'normal') {
      console.warn(`[Resource Monitor] ${metrics.status.toUpperCase()}: DB latency ${metrics.dbLatency}ms for ${metrics.operationType}`);
    }
  }

  getMetricsSummary(): {
    activeOperations: number;
    opsPerMinute: number;
    avgLatency: number;
    currentStatus: ResourceMetrics['status'];
    recommendedDelay: number;
  } {
    const oneMinuteAgo = new Date(Date.now() - 60000);
    const opsPerMinute = this.operationTimestamps.filter(ts => ts > oneMinuteAgo).length;

    return {
      activeOperations: this.activeOperations,
      opsPerMinute,
      avgLatency: this.getAverageLatency(60),
      currentStatus: this.getCurrentStatus(),
      recommendedDelay: this.getRecommendedDelay()
    };
  }

  reset(): void {
    this.metrics = [];
    this.activeOperations = 0;
    this.operationTimestamps = [];
    console.log('[Resource Monitor] Reset complete');
  }
}

export const resourceMonitor = new ResourceMonitor();
