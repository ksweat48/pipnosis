import React from 'react';
import { Activity, TrendingUp, Target, Brain, Zap, BarChart3 } from 'lucide-react';
import { BacktestProgress } from '../services/llm-evaluation-backtest';

interface EventBasedBacktestProgressProps {
  progress: BacktestProgress;
}

export const EventBasedBacktestProgress: React.FC<EventBasedBacktestProgressProps> = ({ progress }) => {
  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'loading':
        return 'text-yellow-400 border-yellow-400 bg-yellow-900/20';
      case 'processing':
        return 'text-blue-400 border-blue-400 bg-blue-900/20';
      case 'analyzing':
        return 'text-purple-400 border-purple-400 bg-purple-900/20';
      case 'complete':
        return 'text-green-400 border-green-400 bg-green-900/20';
      default:
        return 'text-gray-400 border-gray-400 bg-gray-900/20';
    }
  };

  const phaseColor = getPhaseColor(progress.phase);

  return (
    <div className={`border-l-4 rounded-lg p-6 ${phaseColor}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-current"></div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold">{progress.message}</h3>
          <p className="text-sm opacity-80 capitalize">Phase: {progress.phase}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span>Overall Progress</span>
          <span className="font-bold">{progress.percentComplete.toFixed(1)}%</span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300 ease-out"
            style={{ width: `${progress.percentComplete}%` }}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricBox
          icon={<BarChart3 className="w-4 h-4" />}
          label="Candles"
          value={`${progress.candlesProcessed} / ${progress.totalCandles}`}
          color="text-gray-300"
        />
        <MetricBox
          icon={<Target className="w-4 h-4" />}
          label="Triggers"
          value={progress.triggersDetected.toString()}
          color="text-yellow-400"
          highlight={progress.triggersDetected > 0}
        />
        <MetricBox
          icon={<Brain className="w-4 h-4" />}
          label="LLM Calls"
          value={progress.llmCallsMade.toString()}
          color="text-purple-400"
          highlight={progress.llmCallsMade > 0}
        />
        <MetricBox
          icon={<Zap className="w-4 h-4" />}
          label="Trades"
          value={progress.tradesExecuted.toString()}
          color="text-green-400"
          highlight={progress.tradesExecuted > 0}
        />
        <MetricBox
          icon={<TrendingUp className="w-4 h-4" />}
          label="Balance"
          value={`$${progress.currentBalance.toFixed(2)}`}
          color={progress.currentBalance >= 10000 ? 'text-green-400' : 'text-red-400'}
        />
        <MetricBox
          icon={<Activity className="w-4 h-4" />}
          label="Efficiency"
          value={progress.triggersDetected > 0
            ? `${((progress.tradesExecuted / progress.triggersDetected) * 100).toFixed(0)}%`
            : '0%'}
          color="text-blue-400"
        />
      </div>

      {progress.phase === 'processing' && progress.totalCandles > 0 && (
        <div className="mt-4 pt-4 border-t border-current/30">
          <div className="flex items-center justify-between text-xs opacity-70">
            <span>Processing Speed</span>
            <span>{((progress.candlesProcessed / progress.totalCandles) * 100).toFixed(1)}% complete</span>
          </div>
        </div>
      )}

      {progress.phase === 'complete' && (
        <div className="mt-4 pt-4 border-t border-current/30">
          <div className="text-center">
            <p className="text-sm font-semibold mb-1">Backtest Complete!</p>
            <p className="text-xs opacity-70">
              Processed {progress.totalCandles} candles, detected {progress.triggersDetected} triggers,
              executed {progress.tradesExecuted} trades
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

interface MetricBoxProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  color?: string;
  highlight?: boolean;
}

const MetricBox: React.FC<MetricBoxProps> = ({ icon, label, value, color = 'text-gray-300', highlight = false }) => {
  return (
    <div className={`bg-gray-800/50 rounded-lg p-3 ${highlight ? 'ring-2 ring-current' : ''}`}>
      <div className="flex items-center gap-2 mb-2 opacity-70">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
};
