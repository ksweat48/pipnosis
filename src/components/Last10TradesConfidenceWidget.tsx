import React, { useState, useEffect, useRef } from 'react';
import { aiConfidenceTracker, Last10TradesData } from '../services/ai-confidence-tracker';
import { CheckCircle, X, Target, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';

interface Last10TradesConfidenceWidgetProps {
  userId: string;
  className?: string;
}

function Last10TradesConfidenceWidget({ userId, className = '' }: Last10TradesConfidenceWidgetProps) {
  const [data, setData] = useState<Last10TradesData | null>(null);
  const [loading, setLoading] = useState(true);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;

    const loadData = async () => {
      try {
        const confidenceData = await aiConfidenceTracker.getLast10TradesConfidence(userId);
        if (isMountedRef.current) {
          setData(confidenceData);
        }
      } catch (error) {
        console.error('[Last 10 Trades Widget] Error loading data:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadData();

    // Refresh every 15 seconds
    const interval = setInterval(loadData, 15000);

    return () => {
      clearInterval(interval);
    };
  }, [userId]);

  if (loading) {
    return (
      <div className={`bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 ${className}`}>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-400" />
          Last 10 Trades Confidence Performance
        </h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (!data || data.trades.length === 0) {
    return (
      <div className={`bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 ${className}`}>
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-400" />
          Last 10 Trades Confidence Performance
        </h3>
        <div className="text-center py-8 text-gray-500">
          <AlertCircle className="w-12 h-12 text-gray-600 mx-auto mb-3" />
          <p className="text-sm">No confidence data yet. Complete trades to see confidence accuracy tracking.</p>
        </div>
      </div>
    );
  }

  const getTrendIcon = () => {
    if (data.trend === 'improving') {
      return <TrendingUp className="w-5 h-5 text-green-400" />;
    } else if (data.trend === 'declining') {
      return <TrendingDown className="w-5 h-5 text-red-400" />;
    }
    return <Minus className="w-5 h-5 text-gray-400" />;
  };

  const getTrendColor = () => {
    if (data.trend === 'improving') return 'text-green-400';
    if (data.trend === 'declining') return 'text-red-400';
    return 'text-gray-400';
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 80) return 'text-green-400';
    if (accuracy >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className={`bg-gradient-to-br from-blue-900/20 to-purple-900/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-6 ${className}`}>
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-400" />
            Latest Session Confidence Performance
          </h3>
          {getTrendIcon()}
        </div>
        {data.mostRecentSessionName && (
          <div className="text-xs text-gray-400">
            Session: <span className="text-blue-400 font-semibold">{data.mostRecentSessionName}</span>
            {data.totalTradesInRecentSession && (
              <span className="ml-2">({data.totalTradesInRecentSession} trades total, showing {data.trades.length})</span>
            )}
          </div>
        )}
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Accuracy</div>
          <div className={`text-2xl font-bold ${getAccuracyColor(data.accuracyPercentage)}`}>
            {data.accuracyPercentage.toFixed(1)}%
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">vs Previous Session</div>
          <div className={`text-2xl font-bold ${getTrendColor()}`}>
            {data.improvementVsPrevious10 >= 0 ? '+' : ''}
            {data.improvementVsPrevious10.toFixed(1)}%
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Trades</div>
          <div className="text-2xl font-bold text-white">
            {data.trades.length}
          </div>
        </div>
      </div>

      {/* Trade List */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-gray-400 px-2">
          <span>Symbol</span>
          <span>Confidence</span>
          <span>Outcome</span>
          <span>Accuracy</span>
        </div>

        {data.trades.map((trade, index) => (
          <div
            key={trade.tradeId}
            className="bg-gray-900/30 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="flex items-center justify-between">
              {/* Symbol and Entry Time */}
              <div className="flex-1">
                <div className="font-semibold text-white text-sm">{trade.symbol}</div>
                <div className="text-xs text-gray-500">
                  {new Date(trade.entryTime).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>

              {/* Confidence Badge */}
              <div className="flex-1 flex justify-center">
                <span
                  className={`px-3 py-1 rounded-full text-sm font-bold ${
                    trade.confidence >= 80
                      ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                      : trade.confidence >= 60
                      ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50'
                      : 'bg-gray-500/20 text-gray-400 border border-gray-500/50'
                  }`}
                >
                  {trade.confidence}%
                </span>
              </div>

              {/* Outcome */}
              <div className="flex-1 flex justify-center">
                <span
                  className={`px-2 py-1 rounded text-xs font-semibold ${
                    trade.outcome === 'win'
                      ? 'bg-green-900/30 text-green-400'
                      : trade.outcome === 'loss'
                      ? 'bg-red-900/30 text-red-400'
                      : 'bg-gray-900/30 text-gray-400'
                  }`}
                >
                  {trade.outcome.toUpperCase()}
                </span>
              </div>

              {/* Accuracy Indicator */}
              <div className="flex-1 flex justify-end">
                {trade.outcome === 'breakeven' ? (
                  <div className="flex items-center gap-1 text-gray-400">
                    <Minus className="w-5 h-5" />
                    <span className="text-xs font-semibold">Neutral</span>
                  </div>
                ) : trade.wasAccurate ? (
                  <div className="flex items-center gap-1 text-green-400">
                    <CheckCircle className="w-5 h-5" />
                    <span className="text-xs font-semibold">Accurate</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 text-red-400">
                    <X className="w-5 h-5" />
                    <span className="text-xs font-semibold">Off</span>
                  </div>
                )}
              </div>
            </div>

            {/* P&L */}
            <div className="mt-2 text-xs text-gray-400 flex items-center justify-between">
              <span>P&L:</span>
              <span className={trade.pnl >= 0 ? 'text-green-400 font-semibold' : 'text-red-400 font-semibold'}>
                {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Footer Info */}
      <div className="mt-4 p-3 bg-blue-500/10 rounded border border-blue-500/30">
        <p className="text-xs text-blue-300">
          <strong>Accuracy Tracking:</strong> Measures if AI's confidence prediction matched the trade outcome.
          High confidence (≥70%) should result in wins. Breakeven trades are excluded from accuracy calculations.
          System is {data.trend} based on recent performance.
        </p>
      </div>
    </div>
  );
}

export default Last10TradesConfidenceWidget;
