import React, { useState, useEffect } from 'react';
import { RefreshCw, Play, Pause } from 'lucide-react';
import { systemMonitoringService } from '@/services/system-monitoring-service';
import type { SystemDashboard, CronJobExecution, SystemAlert } from '@/services/system-monitoring-service';
import { CronJobStatusCard } from './CronJobStatusCard';
import { PricePollingHealthCard } from './PricePollingHealthCard';
import { CandleGenerationStatsCard } from './CandleGenerationStatsCard';
import { SystemHealthDashboard } from './SystemHealthDashboard';

export function SystemMonitoringPanel() {
  const [dashboard, setDashboard] = useState<SystemDashboard | null>(null);
  const [executions, setExecutions] = useState<CronJobExecution[]>([]);
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  useEffect(() => {
    loadAllData();

    if (autoRefresh) {
      const unsubscribe = systemMonitoringService.subscribe((data) => {
        setDashboard(data);
        setLastUpdate(new Date());
      });

      return unsubscribe;
    }
  }, [autoRefresh]);

  const loadAllData = async () => {
    try {
      setIsLoading(true);
      const [dashboardData, executionsData, alertsData] = await Promise.all([
        systemMonitoringService.getDashboard(),
        systemMonitoringService.getCronJobExecutions(50),
        systemMonitoringService.getSystemAlerts(),
      ]);

      setDashboard(dashboardData);
      setExecutions(executionsData);
      setAlerts(alertsData);
      setLastUpdate(new Date());
    } catch (error) {
      console.error('Error loading monitoring data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRefresh = async () => {
    await loadAllData();
  };

  const toggleAutoRefresh = () => {
    setAutoRefresh(!autoRefresh);
  };

  const formatLastUpdate = () => {
    const seconds = Math.floor((new Date().getTime() - lastUpdate.getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  };

  if (isLoading && !dashboard) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-400">
            Last updated: {formatLastUpdate()}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleAutoRefresh}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
              autoRefresh
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
            }`}
          >
            {autoRefresh ? <Pause size={18} /> : <Play size={18} />}
            <span>Auto-Refresh {autoRefresh ? 'ON' : 'OFF'}</span>
          </button>
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={isLoading ? 'animate-spin' : ''} size={18} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      <SystemHealthDashboard dashboard={dashboard} alerts={alerts} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CronJobStatusCard
          cronJobs={dashboard?.active_cron_jobs || []}
          recentExecutions={executions}
        />

        {dashboard?.price_polling_stats && dashboard?.price_data_freshness && (
          <PricePollingHealthCard
            stats={dashboard.price_polling_stats}
            freshness={dashboard.price_data_freshness}
          />
        )}
      </div>

      {dashboard?.candle_generation_stats && (
        <CandleGenerationStatsCard metrics={dashboard.candle_generation_stats} />
      )}
    </div>
  );
}
