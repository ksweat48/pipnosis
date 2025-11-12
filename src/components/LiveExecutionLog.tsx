import React, { useEffect, useRef } from 'react';
import { CheckCircle, XCircle, AlertTriangle, Info, Clock } from 'lucide-react';
import { ExecutionLog } from '../services/auto-backtest-api';

interface LiveExecutionLogProps {
  logs: ExecutionLog[];
  maxHeight?: string;
}

export default function LiveExecutionLog({ logs, maxHeight = '300px' }: LiveExecutionLogProps) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new logs arrive
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-400 flex-shrink-0" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />;
      case 'started':
        return <Clock className="w-4 h-4 text-blue-400 flex-shrink-0 animate-pulse" />;
      default:
        return <Info className="w-4 h-4 text-gray-400 flex-shrink-0" />;
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'completed':
        return 'text-green-400';
      case 'failed':
        return 'text-red-400';
      case 'warning':
        return 'text-yellow-400';
      case 'started':
        return 'text-blue-400';
      default:
        return 'text-gray-400';
    }
  };

  const getStepTypeColor = (stepType: string): string => {
    switch (stepType) {
      case 'phase_start':
        return 'bg-blue-600/20 text-blue-300';
      case 'phase_end':
        return 'bg-green-600/20 text-green-300';
      case 'trade':
        return 'bg-purple-600/20 text-purple-300';
      case 'error':
        return 'bg-red-600/20 text-red-300';
      case 'warning':
        return 'bg-yellow-600/20 text-yellow-300';
      default:
        return 'bg-gray-600/20 text-gray-300';
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const formatDuration = (durationMs?: number): string => {
    if (!durationMs) return '';
    if (durationMs < 1000) return `${durationMs}ms`;
    return `${(durationMs / 1000).toFixed(2)}s`;
  };

  if (logs.length === 0) {
    return (
      <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Execution Log</h3>
        <div className="text-center py-8 text-gray-500">
          <Info className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No execution logs available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 p-4 rounded-lg border border-gray-700">
      <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center justify-between">
        <span>Execution Log</span>
        <span className="text-xs text-gray-500 font-normal">{logs.length} events</span>
      </h3>

      <div
        className="space-y-2 overflow-y-auto pr-2 custom-scrollbar"
        style={{ maxHeight }}
      >
        {logs.map((log, index) => (
          <div
            key={log.id}
            className="bg-gray-900/50 p-2 rounded border border-gray-700/50 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-start gap-2">
              {/* Icon */}
              <div className="mt-0.5">
                {getStatusIcon(log.status)}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-semibold ${getStatusColor(log.status)}`}>
                    {log.stepName}
                  </span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${getStepTypeColor(log.stepType)}`}>
                    {log.stepType}
                  </span>
                </div>

                {log.message && (
                  <p className="text-xs text-gray-400 mb-1">{log.message}</p>
                )}

                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{formatTimestamp(log.timestamp)}</span>
                  {log.durationMs !== undefined && (
                    <span>⏱ {formatDuration(log.durationMs)}</span>
                  )}
                  {log.memorySnapshotMb !== undefined && log.memorySnapshotMb > 0 && (
                    <span>💾 {log.memorySnapshotMb}MB</span>
                  )}
                  {log.cpuSnapshotPercent !== undefined && log.cpuSnapshotPercent > 0 && (
                    <span>⚡ {log.cpuSnapshotPercent.toFixed(1)}%</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>

      <style>
        {`
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: rgba(55, 65, 81, 0.3);
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(107, 114, 128, 0.5);
            border-radius: 3px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(107, 114, 128, 0.7);
          }
        `}
      </style>
    </div>
  );
}
