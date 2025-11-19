import React, { useState, useEffect, useRef } from 'react';
import { aiConfidenceTracker, ConfidencePerformanceWindow } from '../services/ai-confidence-tracker';
import { Target, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle2, Activity } from 'lucide-react';

interface ConfidenceOverviewCardProps {
  userId: string;
  className?: string;
}

function ConfidenceOverviewCard({ userId, className = '' }: ConfidenceOverviewCardProps) {
  const [performance, setPerformance] = useState<ConfidencePerformanceWindow | null>(null);
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
        const perfData = await aiConfidenceTracker.getConfidencePerformance(userId, 'last_10');
        if (isMountedRef.current) {
          setPerformance(perfData);
        }
      } catch (error) {
        console.error('[Confidence Overview] Error loading data:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadData();

    // Refresh every 20 seconds
    const interval = setInterval(loadData, 20000);

    return () => {
      clearInterval(interval);
    };
  }, [userId]);

  if (loading) {
    return (
      <div className={`bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 ${className}`}>
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-6 h-6 text-purple-400" />
          AI Confidence Accuracy
        </h3>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
        </div>
      </div>
    );
  }

  if (!performance || performance.totalTrades === 0) {
    return (
      <div className={`bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6 ${className}`}>
        <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-6 h-6 text-purple-400" />
          AI Confidence Accuracy
        </h3>
        <div className="text-center py-8 text-gray-500">
          <Activity className="w-12 h-12 text-gray-600 mx-auto mb-3 opacity-50" />
          <p className="text-sm mb-2">No confidence data yet</p>
          <p className="text-xs text-gray-600">
            Complete trades to start tracking AI confidence prediction accuracy
          </p>
        </div>
      </div>
    );
  }

  const getCalibrationStatus = (score: number) => {
    if (score >= 85) return { label: 'Excellent', color: 'text-green-400', bg: 'bg-green-500/20', border: 'border-green-500/50' };
    if (score >= 70) return { label: 'Good', color: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/50' };
    if (score >= 55) return { label: 'Fair', color: 'text-yellow-400', bg: 'bg-yellow-500/20', border: 'border-yellow-500/50' };
    return { label: 'Needs Improvement', color: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/50' };
  };

  const getTrendIcon = () => {
    if (performance.trendDirection === 'improving') {
      return <TrendingUp className="w-5 h-5 text-green-400" />;
    } else if (performance.trendDirection === 'declining') {
      return <TrendingDown className="w-5 h-5 text-red-400" />;
    }
    return <Minus className="w-5 h-5 text-gray-400" />;
  };

  const calibrationStatus = getCalibrationStatus(performance.overallCalibrationScore);

  return (
    <div className={`bg-gradient-to-br from-purple-900/20 to-pink-900/20 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg p-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-semibold text-white flex items-center gap-2">
          <Target className="w-6 h-6 text-purple-400" />
          AI Confidence Accuracy
        </h3>
        {getTrendIcon()}
      </div>

      {/* Main Calibration Score */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Overall Calibration Score</span>
          <span className={`text-sm font-semibold ${calibrationStatus.color}`}>
            {calibrationStatus.label}
          </span>
        </div>

        <div className="relative">
          <div className="w-full bg-gray-700 rounded-full h-6 overflow-hidden">
            <div
              className={`h-6 ${calibrationStatus.bg} transition-all duration-500 rounded-full flex items-center justify-end pr-3`}
              style={{ width: `${performance.overallCalibrationScore}%` }}
            >
              <span className="text-white font-bold text-sm">
                {performance.overallCalibrationScore.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Prediction Accuracy</div>
          <div className="text-2xl font-bold text-white">
            {performance.accuracyPercentage.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {performance.accuratePredictions}/{performance.totalTrades} trades
          </div>
        </div>

        <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-700">
          <div className="text-xs text-gray-400 mb-1">Avg Confidence Error</div>
          <div className="text-2xl font-bold text-white">
            {performance.averageConfidenceError.toFixed(1)}%
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Lower is better
          </div>
        </div>
      </div>

      {/* Confidence Analysis */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-400" />
            <span className="text-gray-300">Well Calibrated</span>
          </div>
          <span className="font-bold text-green-400">{performance.wellCalibratedTrades}</span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-gray-300">Over-Confident</span>
          </div>
          <span className="font-bold text-yellow-400">{performance.overconfidentTrades}</span>
        </div>

        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-blue-400" />
            <span className="text-gray-300">Under-Confident</span>
          </div>
          <span className="font-bold text-blue-400">{performance.underconfidentTrades}</span>
        </div>
      </div>

      {/* Improvement Indicator */}
      {performance.isImproving && performance.improvementRate > 0 && (
        <div className="p-3 bg-green-500/10 rounded border border-green-500/30">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-green-400" />
            <span className="text-sm font-semibold text-green-400">Confidence Improving!</span>
          </div>
          <p className="text-xs text-green-300">
            Accuracy increased by {performance.improvementRate.toFixed(1)}% in last window.
            AI is getting better at predicting its own success.
          </p>
        </div>
      )}

      {performance.trendDirection === 'declining' && (
        <div className="p-3 bg-yellow-500/10 rounded border border-yellow-500/30">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            <span className="text-sm font-semibold text-yellow-400">Confidence Needs Attention</span>
          </div>
          <p className="text-xs text-yellow-300">
            Prediction accuracy has declined. Consider reviewing recent trade setups and market conditions.
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="mt-4 p-3 bg-purple-500/10 rounded border border-purple-500/30">
        <p className="text-xs text-purple-300">
          <strong>Calibration:</strong> Measures how well AI's confidence predictions match reality.
          Perfect calibration means 80% confident trades win 80% of the time.
        </p>
      </div>
    </div>
  );
}

export default ConfidenceOverviewCard;
