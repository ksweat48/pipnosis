import React from 'react';
import { Activity, Clock, TrendingUp, Cpu, HardDrive, Zap, CheckCircle, AlertTriangle } from 'lucide-react';
import { BacktestProgress } from '../services/auto-backtest-api';

interface ActiveBacktestCardProps {
  progress: BacktestProgress;
  onViewDetails?: (backtestId: string) => void;
}

export default function ActiveBacktestCard({ progress, onViewDetails }: ActiveBacktestCardProps) {
  const getPhaseIcon = (phase: string) => {
    switch (phase) {
      case 'loading':
        return <Clock className="w-4 h-4 text-blue-400 animate-pulse" />;
      case 'processing':
        return <Activity className="w-4 h-4 text-green-400 animate-pulse" />;
      case 'analyzing':
        return <TrendingUp className="w-4 h-4 text-purple-400 animate-pulse" />;
      case 'completing':
        return <CheckCircle className="w-4 h-4 text-emerald-400" />;
      default:
        return <Activity className="w-4 h-4 text-gray-400" />;
    }
  };

  const getPhaseColor = (phase: string): string => {
    switch (phase) {
      case 'loading':
        return 'text-blue-400';
      case 'processing':
        return 'text-green-400';
      case 'analyzing':
        return 'text-purple-400';
      case 'completing':
        return 'text-emerald-400';
      default:
        return 'text-gray-400';
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  const getEstimatedRemaining = (): string => {
    if (!progress.estimatedCompletionTime) return 'Calculating...';

    const now = new Date();
    const completion = new Date(progress.estimatedCompletionTime);
    const diffMs = completion.getTime() - now.getTime();

    if (diffMs <= 0) return 'Almost done...';

    const diffSecs = Math.floor(diffMs / 1000);
    return formatTime(diffSecs);
  };

  const getWinRateColor = (winRate: number): string => {
    if (winRate >= 60) return 'text-green-400';
    if (winRate >= 50) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getMemoryColor = (mb: number): string => {
    if (mb > 500) return 'text-red-400';
    if (mb > 300) return 'text-yellow-400';
    return 'text-green-400';
  };

  const getCpuColor = (percent: number): string => {
    if (percent > 80) return 'text-red-400';
    if (percent > 60) return 'text-yellow-400';
    return 'text-green-400';
  };

  return (
    <div className="bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-sm border border-gray-700 rounded-lg p-4 hover:border-purple-500/50 transition-all">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {getPhaseIcon(progress.phase)}
          <span className={`text-sm font-semibold ${getPhaseColor(progress.phase)} uppercase`}>
            {progress.phase}
          </span>
        </div>
        <div className="text-xs text-gray-400">
          {formatTime(progress.timeElapsedSeconds)} elapsed
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-3">
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-gray-400">{progress.currentStep}</span>
          <span className="text-xs font-bold text-white">{progress.progressPercentage}%</span>
        </div>
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-gradient-to-r from-purple-500 to-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progress.progressPercentage}%` }}
          />
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* Candles Processed */}
        <div className="bg-gray-900/50 p-2 rounded">
          <div className="flex items-center gap-1 mb-1">
            <Zap className="w-3 h-3 text-yellow-400" />
            <span className="text-xs text-gray-400">Candles</span>
          </div>
          <div className="text-sm font-bold text-white">
            {progress.currentCandle.toLocaleString()} / {progress.totalCandles.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">
            {progress.candlesPerSecond.toFixed(1)}/s
          </div>
        </div>

        {/* Trades Executed */}
        <div className="bg-gray-900/50 p-2 rounded">
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="w-3 h-3 text-blue-400" />
            <span className="text-xs text-gray-400">Trades</span>
          </div>
          <div className="text-sm font-bold text-white">
            {progress.tradesExecuted}
          </div>
          <div className={`text-xs font-semibold ${getWinRateColor(progress.currentWinRate)}`}>
            {progress.currentWinRate > 0 ? `${progress.currentWinRate.toFixed(1)}% WR` : 'No trades yet'}
          </div>
        </div>

        {/* Memory Usage */}
        <div className="bg-gray-900/50 p-2 rounded">
          <div className="flex items-center gap-1 mb-1">
            <HardDrive className="w-3 h-3 text-purple-400" />
            <span className="text-xs text-gray-400">Memory</span>
          </div>
          <div className={`text-sm font-bold ${getMemoryColor(progress.memoryUsageMb)}`}>
            {progress.memoryUsageMb} MB
          </div>
        </div>

        {/* CPU Usage */}
        <div className="bg-gray-900/50 p-2 rounded">
          <div className="flex items-center gap-1 mb-1">
            <Cpu className="w-3 h-3 text-green-400" />
            <span className="text-xs text-gray-400">CPU</span>
          </div>
          <div className={`text-sm font-bold ${getCpuColor(progress.cpuUsagePercent)}`}>
            {progress.cpuUsagePercent.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Estimated Completion */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-700">
        <div className="flex items-center gap-1 text-xs text-gray-400">
          <Clock className="w-3 h-3" />
          <span>ETA: {getEstimatedRemaining()}</span>
        </div>
        {onViewDetails && (
          <button
            onClick={() => onViewDetails(progress.backtestId)}
            className="text-xs text-purple-400 hover:text-purple-300 font-semibold"
          >
            View Details →
          </button>
        )}
      </div>

      {/* Warning for stuck backtests */}
      {progress.status === 'stuck' && (
        <div className="mt-2 p-2 bg-red-900/20 border border-red-500/30 rounded flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400" />
          <span className="text-xs text-red-300">Backtest appears stuck. No updates in 90s.</span>
        </div>
      )}
    </div>
  );
}
