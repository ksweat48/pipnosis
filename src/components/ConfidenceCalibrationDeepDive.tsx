import React, { useState, useEffect, useRef } from 'react';
import { aiConfidenceTracker, ConfidencePerformanceWindow } from '../services/ai-confidence-tracker';
import { Target, TrendingUp, TrendingDown, AlertCircle, CheckCircle2, Activity, BarChart3 } from 'lucide-react';

interface ConfidenceCalibrationDeepDiveProps {
  userId: string;
}

function ConfidenceCalibrationDeepDive({ userId }: ConfidenceCalibrationDeepDiveProps) {
  const [performance10, setPerformance10] = useState<ConfidencePerformanceWindow | null>(null);
  const [performance30, setPerformance30] = useState<ConfidencePerformanceWindow | null>(null);
  const [performance100, setPerformance100] = useState<ConfidencePerformanceWindow | null>(null);
  const [calibrationData, setCalibrationData] = useState<Array<{bucket: string, predictedWinRate: number, actualWinRate: number}>>([]);
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
        const [perf10, perf30, perf100, chartData] = await Promise.all([
          aiConfidenceTracker.getConfidencePerformance(userId, 'last_10'),
          aiConfidenceTracker.getConfidencePerformance(userId, 'last_30'),
          aiConfidenceTracker.getConfidencePerformance(userId, 'last_100'),
          aiConfidenceTracker.getCalibrationChartData(userId)
        ]);

        if (isMountedRef.current) {
          setPerformance10(perf10);
          setPerformance30(perf30);
          setPerformance100(perf100);
          setCalibrationData(chartData);
        }
      } catch (error) {
        console.error('[Confidence Deep Dive] Error loading data:', error);
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadData();

    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  const windows = [
    { label: 'Last 10 Trades', data: performance10 },
    { label: 'Last 30 Trades', data: performance30 },
    { label: 'Last 100 Trades', data: performance100 }
  ];

  return (
    <div className="space-y-6">
      {/* Overview Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {windows.map((window, index) => {
          if (!window.data) return null;

          return (
            <div
              key={index}
              className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-gray-400">{window.label}</h3>
                {window.data.trendDirection === 'improving' ? (
                  <TrendingUp className="w-5 h-5 text-green-400" />
                ) : window.data.trendDirection === 'declining' ? (
                  <TrendingDown className="w-5 h-5 text-red-400" />
                ) : (
                  <Activity className="w-5 h-5 text-gray-400" />
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500 mb-1">Accuracy</div>
                  <div className="text-2xl font-bold text-white">
                    {window.data.accuracyPercentage.toFixed(1)}%
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">Calibration Score</div>
                  <div className="text-xl font-bold text-emerald-400">
                    {window.data.overallCalibrationScore.toFixed(1)}%
                  </div>
                </div>

                <div>
                  <div className="text-xs text-gray-500 mb-1">Avg Error</div>
                  <div className="text-lg font-bold text-blue-400">
                    {window.data.averageConfidenceError.toFixed(1)}%
                  </div>
                </div>

                {window.data.isImproving && (
                  <div className="mt-3 p-2 bg-green-500/10 rounded border border-green-500/30">
                    <p className="text-xs text-green-400 font-semibold">
                      +{window.data.improvementRate.toFixed(1)}% Improvement
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Calibration Chart */}
      {calibrationData.length > 0 && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-purple-400" />
            Calibration Analysis by Confidence Level
          </h3>

          <p className="text-sm text-gray-400 mb-6">
            Perfect calibration means predicted confidence matches actual win rate (diagonal line).
            Points above the line = over-confident, below = under-confident.
          </p>

          <div className="space-y-4">
            {calibrationData.map((data) => {
              const deviation = Math.abs(data.predictedWinRate - data.actualWinRate);
              const isWellCalibrated = deviation <= 10;

              return (
                <div key={data.bucket} className="bg-gray-900/50 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-white">
                        {data.bucket}% Confidence
                      </span>
                      {isWellCalibrated ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-400" />
                      )}
                    </div>
                    <span className={`text-xs font-semibold ${isWellCalibrated ? 'text-green-400' : 'text-yellow-400'}`}>
                      {isWellCalibrated ? 'Well Calibrated' : `±${deviation.toFixed(1)}% deviation`}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-500 mb-1">Predicted Win Rate</div>
                      <div className="text-lg font-bold text-blue-400">
                        {data.predictedWinRate.toFixed(1)}%
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full"
                          style={{ width: `${data.predictedWinRate}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="text-xs text-gray-500 mb-1">Actual Win Rate</div>
                      <div className="text-lg font-bold text-emerald-400">
                        {data.actualWinRate.toFixed(1)}%
                      </div>
                      <div className="w-full bg-gray-700 rounded-full h-2 mt-2">
                        <div
                          className="bg-emerald-500 h-2 rounded-full"
                          style={{ width: `${data.actualWinRate}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Calibration Breakdown */}
      {performance10 && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
          <h3 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Target className="w-6 h-6 text-blue-400" />
            Confidence Classification (Last 10 Trades)
          </h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/30">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-400" />
                <span className="text-sm font-semibold text-green-400">Well Calibrated</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {performance10.wellCalibratedTrades}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Confidence matched outcome
              </p>
            </div>

            <div className="bg-yellow-500/10 rounded-lg p-4 border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-yellow-400" />
                <span className="text-sm font-semibold text-yellow-400">Over-Confident</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {performance10.overconfidentTrades}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                High confidence but loss
              </p>
            </div>

            <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/30">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="w-5 h-5 text-blue-400" />
                <span className="text-sm font-semibold text-blue-400">Under-Confident</span>
              </div>
              <div className="text-3xl font-bold text-white">
                {performance10.underconfidentTrades}
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Low confidence but win
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 backdrop-blur-sm border-2 border-purple-500/30 rounded-lg p-6">
        <h3 className="text-xl font-semibold text-white mb-4">Improvement Recommendations</h3>

        {performance10 && performance10.overconfidentTrades > 3 && (
          <div className="mb-4 p-4 bg-yellow-500/10 rounded border border-yellow-500/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-yellow-400" />
              <span className="font-semibold text-yellow-400">Reduce Over-Confidence</span>
            </div>
            <p className="text-sm text-gray-300">
              {performance10.overconfidentTrades} trades had high confidence but resulted in losses.
              Consider lowering confidence thresholds or adding more strict entry filters.
            </p>
          </div>
        )}

        {performance10 && performance10.underconfidentTrades > 3 && (
          <div className="mb-4 p-4 bg-blue-500/10 rounded border border-blue-500/30">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-blue-400" />
              <span className="font-semibold text-blue-400">Missed Opportunities</span>
            </div>
            <p className="text-sm text-gray-300">
              {performance10.underconfidentTrades} trades had low confidence but won.
              The AI may be missing high-quality setups. Review pattern recognition sensitivity.
            </p>
          </div>
        )}

        {performance10 && performance10.wellCalibratedTrades >= 7 && (
          <div className="p-4 bg-green-500/10 rounded border border-green-500/30">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-400" />
              <span className="font-semibold text-green-400">Excellent Calibration!</span>
            </div>
            <p className="text-sm text-gray-300">
              {performance10.wellCalibratedTrades} out of 10 trades were well-calibrated.
              The AI's confidence predictions are highly accurate. Maintain current approach.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfidenceCalibrationDeepDive;
