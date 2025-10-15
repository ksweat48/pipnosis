import React from 'react';
import { Activity, CheckCircle } from 'lucide-react';

interface CandleStatusIndicatorProps {
  hasIncompleteCandle: boolean;
  className?: string;
}

export const CandleStatusIndicator: React.FC<CandleStatusIndicatorProps> = ({
  hasIncompleteCandle,
  className = ''
}) => {
  if (!hasIncompleteCandle) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 ${className}`}>
      <Activity className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
      <span className="text-xs font-medium text-amber-300">
        Live Candle Forming
      </span>
    </div>
  );
};

interface CandleCompletionStatsProps {
  totalCandles: number;
  incompleteCount: number;
  className?: string;
}

export const CandleCompletionStats: React.FC<CandleCompletionStatsProps> = ({
  totalCandles,
  incompleteCount,
  className = ''
}) => {
  const completePercentage = totalCandles > 0
    ? ((totalCandles - incompleteCount) / totalCandles * 100).toFixed(1)
    : '100.0';

  const isHealthy = incompleteCount <= 1;

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
      isHealthy
        ? 'bg-emerald-500/10 border border-emerald-500/20'
        : 'bg-amber-500/10 border border-amber-500/20'
    } ${className}`}>
      <CheckCircle className={`w-3.5 h-3.5 ${
        isHealthy ? 'text-emerald-400' : 'text-amber-400'
      }`} />
      <span className={`text-xs font-medium ${
        isHealthy ? 'text-emerald-300' : 'text-amber-300'
      }`}>
        {completePercentage}% Complete
        {incompleteCount > 1 && ` (${incompleteCount} incomplete)`}
      </span>
    </div>
  );
};
