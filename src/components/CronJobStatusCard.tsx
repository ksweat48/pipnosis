import React from 'react';
import { CheckCircle, XCircle, Clock, Activity } from 'lucide-react';
import type { CronJobStatus, CronJobExecution } from '@/services/system-monitoring-service';

interface CronJobStatusCardProps {
  cronJobs: CronJobStatus[];
  recentExecutions: CronJobExecution[];
}

export function CronJobStatusCard({ cronJobs, recentExecutions }: CronJobStatusCardProps) {
  const getStatusIcon = (active: boolean, hasRecentFailure: boolean) => {
    if (!active) {
      return <XCircle className="text-gray-500" size={16} />;
    }
    if (hasRecentFailure) {
      return <Clock className="text-yellow-500" size={16} />;
    }
    return <CheckCircle className="text-green-500" size={16} />;
  };

  const getStatusBadge = (active: boolean, hasRecentFailure: boolean) => {
    if (!active) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-gray-500/20 text-gray-400 rounded">
          Inactive
        </span>
      );
    }
    if (hasRecentFailure) {
      return (
        <span className="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">
          Issues
        </span>
      );
    }
    return (
      <span className="px-2 py-1 text-xs font-medium bg-green-500/20 text-green-400 rounded flex items-center gap-1">
        <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
        Active
      </span>
    );
  };

  const formatSchedule = (schedule: string) => {
    if (schedule === '* * * * *') return 'Every minute';
    if (schedule === '*/5 * * * *') return 'Every 5 minutes';
    if (schedule === '*/15 * * * *') return 'Every 15 minutes';
    if (schedule === '0 * * * *') return 'Every hour';
    return schedule;
  };

  const getRecentExecutionStats = (jobName: string) => {
    const jobExecutions = recentExecutions
      .filter(exec => exec.jobname === jobName)
      .slice(0, 10);

    if (jobExecutions.length === 0) {
      return { hasRecentFailure: false, lastRun: null, avgDuration: null };
    }

    const hasRecentFailure = jobExecutions.some(exec => exec.status === 'failed');
    const lastRun = jobExecutions[0];
    const avgDuration = jobExecutions.reduce((sum, exec) => sum + exec.duration_ms, 0) / jobExecutions.length;

    return { hasRecentFailure, lastRun, avgDuration };
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
      <div className="flex items-center gap-3 mb-4">
        <Activity className="text-blue-500" size={24} />
        <h3 className="text-lg font-bold text-white">Cron Job Status</h3>
      </div>

      <div className="space-y-3">
        {cronJobs.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No cron jobs found
          </div>
        ) : (
          cronJobs.map(job => {
            const stats = getRecentExecutionStats(job.name);
            const hasRecentFailure = stats.hasRecentFailure;
            const lastRun = stats.lastRun;
            const avgDuration = stats.avgDuration;

            return (
              <div
                key={job.name}
                className="bg-gray-900 rounded-lg p-4 border border-gray-700/50"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(job.active, hasRecentFailure)}
                    <div>
                      <div className="text-sm font-medium text-white">
                        {job.name}
                      </div>
                      <div className="text-xs text-gray-400">
                        {formatSchedule(job.schedule)}
                      </div>
                    </div>
                  </div>
                  {getStatusBadge(job.active, hasRecentFailure)}
                </div>

                {lastRun && (
                  <div className="mt-3 pt-3 border-t border-gray-700/50 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-400">Last run</span>
                      <span className="text-gray-300">
                        {new Date(lastRun.start_time).toLocaleTimeString()}
                      </span>
                    </div>
                    {avgDuration && (
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-gray-400">Avg duration</span>
                        <span className="text-gray-300">
                          {avgDuration.toFixed(0)}ms
                        </span>
                      </div>
                    )}
                    {lastRun.status === 'failed' && (
                      <div className="mt-2 p-2 bg-red-500/10 rounded text-xs text-red-400">
                        Error: {lastRun.return_message || 'Unknown error'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
