import React, { useEffect, useState } from 'react';
import { Brain, TrendingUp, TrendingDown, Minus, Target, Zap, AlertTriangle, CheckCircle, Activity, Award } from 'lucide-react';
import { alphaMetaLearning, MetaLearningReport } from '../services/alpha-meta-learning';
import { alphaExecutionAnalyzer, ExecutionQualityReport } from '../services/alpha-execution-analyzer';
import { logger } from '../lib/logger';

interface AlphaBrainDashboardProps {
  userId: string;
}

export function AlphaBrainDashboard({ userId }: AlphaBrainDashboardProps) {
  const [loading, setLoading] = useState(true);
  const [metaReport, setMetaReport] = useState<MetaLearningReport | null>(null);
  const [executionReport, setExecutionReport] = useState<ExecutionQualityReport | null>(null);

  useEffect(() => {
    loadAlphaIntelligence();
  }, [userId]);

  const loadAlphaIntelligence = async () => {
    try {
      setLoading(true);
      const [meta, exec] = await Promise.all([
        alphaMetaLearning.generateMetaLearningReport(userId),
        alphaExecutionAnalyzer.getExecutionQualityReport(userId, 'EURUSD')
      ]);
      setMetaReport(meta);
      setExecutionReport(exec);
    } catch (error) {
      logger.error('[Alpha Brain] Failed to load intelligence:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Brain className="w-12 h-12 text-blue-400 animate-pulse mx-auto mb-4" />
          <p className="text-gray-400">Alpha is analyzing performance patterns...</p>
        </div>
      </div>
    );
  }

  if (!metaReport) {
    return (
      <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-8 text-center">
        <Brain className="w-12 h-12 text-gray-600 mx-auto mb-4" />
        <p className="text-gray-400">Unable to load Alpha intelligence data</p>
      </div>
    );
  }

  type Trend = 'improving' | 'declining' | 'stable';
  const TREND_CONFIG: Record<Trend, { icon: React.ReactNode; color: string; bg: string }> = {
    improving: { icon: <TrendingUp className="w-5 h-5 text-emerald-400" />, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/30' },
    declining: { icon: <TrendingDown className="w-5 h-5 text-red-400" />,  color: 'text-red-400',     bg: 'bg-red-500/10 border-red-500/30' },
    stable:    { icon: <Minus className="w-5 h-5 text-gray-400" />,        color: 'text-gray-400',    bg: 'bg-gray-500/10 border-gray-500/30' },
  };
  const getTrendIcon  = (t: Trend) => TREND_CONFIG[t].icon;
  const getTrendColor = (t: Trend) => TREND_CONFIG[t].color;
  const getTrendBg    = (t: Trend) => TREND_CONFIG[t].bg;

  const getBrokerBadgeColor = (classification: string) => {
    switch (classification) {
      case 'excellent': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
      case 'good': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      case 'fair': return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      case 'poor': return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      case 'hostile': return 'bg-red-500/20 text-red-300 border-red-500/30';
      default: return 'bg-gray-500/20 text-gray-300 border-gray-500/30';
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-br from-blue-900/40 to-indigo-900/40 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <Brain className="w-8 h-8 text-blue-400" />
          <h2 className="text-2xl font-bold text-white">Alpha's Self-Assessment</h2>
        </div>
        <p className="text-gray-300 text-sm">
          Deep analysis of Alpha's decision-making patterns, strengths, weaknesses, and learning progress.
        </p>
      </div>

      {metaReport.insights.length > 0 && (
        <div className="bg-gradient-to-br from-indigo-900/30 to-blue-900/30 backdrop-blur-sm border border-blue-500/30 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-6 h-6 text-yellow-400" />
            <h3 className="text-xl font-bold text-white">Key Insights</h3>
          </div>
          <div className="grid gap-3">
            {metaReport.insights.map((insight, idx) => (
              <div
                key={idx}
                className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 text-gray-200"
              >
                {insight}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`bg-gray-900/50 backdrop-blur-sm border-2 rounded-lg p-6 ${getTrendBg(metaReport.performanceTrends.winRateTrend)}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="w-5 h-5 text-gray-400" />
              <h4 className="font-semibold text-white">Win Rate</h4>
            </div>
            {getTrendIcon(metaReport.performanceTrends.winRateTrend)}
          </div>
          <div className={`text-2xl font-bold ${getTrendColor(metaReport.performanceTrends.winRateTrend)}`}>
            {metaReport.performanceTrends.winRateTrend.toUpperCase()}
          </div>
          <p className="text-sm text-gray-400 mt-2">
            Recent: {metaReport.learningVelocity.recentWinRate.toFixed(1)}% vs Historical: {metaReport.learningVelocity.historicalWinRate.toFixed(1)}%
          </p>
        </div>

        <div className={`bg-gray-900/50 backdrop-blur-sm border-2 rounded-lg p-6 ${getTrendBg(metaReport.performanceTrends.confidenceTrend)}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-gray-400" />
              <h4 className="font-semibold text-white">Confidence</h4>
            </div>
            {getTrendIcon(metaReport.performanceTrends.confidenceTrend)}
          </div>
          <div className={`text-2xl font-bold ${getTrendColor(metaReport.performanceTrends.confidenceTrend)}`}>
            {metaReport.performanceTrends.confidenceTrend.toUpperCase()}
          </div>
          <p className="text-sm text-gray-400 mt-2">
            Calibration Error: {metaReport.calibrationQuality.overallError.toFixed(1)}%
          </p>
        </div>

        <div className={`bg-gray-900/50 backdrop-blur-sm border-2 rounded-lg p-6 ${getTrendBg(metaReport.performanceTrends.profitFactorTrend)}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Award className="w-5 h-5 text-gray-400" />
              <h4 className="font-semibold text-white">Profit Factor</h4>
            </div>
            {getTrendIcon(metaReport.performanceTrends.profitFactorTrend)}
          </div>
          <div className={`text-2xl font-bold ${getTrendColor(metaReport.performanceTrends.profitFactorTrend)}`}>
            {metaReport.performanceTrends.profitFactorTrend.toUpperCase()}
          </div>
          <p className="text-sm text-gray-400 mt-2">
            Based on {metaReport.learningVelocity.tradesAnalyzed} trades
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-emerald-900/20 to-green-900/20 backdrop-blur-sm border border-emerald-500/30 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-6 h-6 text-emerald-400" />
            <h3 className="text-xl font-bold text-white">Strength Areas</h3>
          </div>
          {metaReport.strengthAreas.length === 0 ? (
            <p className="text-gray-400 text-sm">Building strength profile as Alpha learns...</p>
          ) : (
            <div className="space-y-3">
              {metaReport.strengthAreas.map((strength, idx) => (
                <div key={idx} className="bg-gray-900/50 border border-emerald-500/20 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-gray-200 font-medium flex-1">{strength.area}</p>
                    <span className="text-emerald-400 font-bold ml-2">{strength.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{strength.sampleSize} trades</span>
                    <span className="text-emerald-400">{strength.confidence.toFixed(0)}% confidence</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-gradient-to-br from-orange-900/20 to-red-900/20 backdrop-blur-sm border border-orange-500/30 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
            <h3 className="text-xl font-bold text-white">Weakness Areas</h3>
          </div>
          {metaReport.weaknessAreas.length === 0 ? (
            <p className="text-gray-400 text-sm">No significant weaknesses identified yet...</p>
          ) : (
            <div className="space-y-3">
              {metaReport.weaknessAreas.map((weakness, idx) => (
                <div key={idx} className="bg-gray-900/50 border border-orange-500/20 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <p className="text-gray-200 font-medium flex-1">{weakness.area}</p>
                    <span className="text-orange-400 font-bold ml-2">{weakness.winRate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-400">
                    <span>{weakness.sampleSize} trades</span>
                    <span className="text-orange-400">{weakness.confidence.toFixed(0)}% confidence</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gradient-to-br from-purple-900/20 to-indigo-900/20 backdrop-blur-sm border border-purple-500/30 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Target className="w-6 h-6 text-purple-400" />
          <h3 className="text-xl font-bold text-white">Calibration Quality</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-2">Overconfident Buckets</p>
            <p className="text-2xl font-bold text-red-400">
              {metaReport.calibrationQuality.overconfidentBuckets.length}
            </p>
            {metaReport.calibrationQuality.overconfidentBuckets.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {metaReport.calibrationQuality.overconfidentBuckets.join('%, ')}%
              </p>
            )}
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-2">Well-Calibrated</p>
            <p className="text-2xl font-bold text-emerald-400">
              {metaReport.calibrationQuality.wellCalibratedBuckets.length}
            </p>
            {metaReport.calibrationQuality.wellCalibratedBuckets.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {metaReport.calibrationQuality.wellCalibratedBuckets.join('%, ')}%
              </p>
            )}
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <p className="text-sm text-gray-400 mb-2">Underconfident Buckets</p>
            <p className="text-2xl font-bold text-yellow-400">
              {metaReport.calibrationQuality.underconfidentBuckets.length}
            </p>
            {metaReport.calibrationQuality.underconfidentBuckets.length > 0 && (
              <p className="text-xs text-gray-400 mt-2">
                {metaReport.calibrationQuality.underconfidentBuckets.join('%, ')}%
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-900/20 to-cyan-900/20 backdrop-blur-sm border border-blue-500/30 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-6 h-6 text-cyan-400" />
          <h3 className="text-xl font-bold text-white">Learning Velocity</h3>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4 mb-3">
              <p className="text-sm text-gray-400 mb-1">Recent Performance (Last 20)</p>
              <p className="text-3xl font-bold text-cyan-400">
                {metaReport.learningVelocity.recentWinRate.toFixed(1)}%
              </p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-1">Historical Average</p>
              <p className="text-3xl font-bold text-gray-400">
                {metaReport.learningVelocity.historicalWinRate.toFixed(1)}%
              </p>
            </div>
          </div>
          <div className="flex flex-col justify-center">
            <div className={`bg-gray-900/50 border-2 rounded-lg p-6 ${
              metaReport.learningVelocity.improvement > 0
                ? 'border-emerald-500/50'
                : metaReport.learningVelocity.improvement < 0
                ? 'border-red-500/50'
                : 'border-gray-500/50'
            }`}>
              <p className="text-sm text-gray-400 mb-2">Improvement Rate</p>
              <div className="flex items-center gap-3">
                {metaReport.learningVelocity.improvement > 0 ? (
                  <TrendingUp className="w-10 h-10 text-emerald-400" />
                ) : metaReport.learningVelocity.improvement < 0 ? (
                  <TrendingDown className="w-10 h-10 text-red-400" />
                ) : (
                  <Minus className="w-10 h-10 text-gray-400" />
                )}
                <div>
                  <p className={`text-4xl font-bold ${
                    metaReport.learningVelocity.improvement > 0
                      ? 'text-emerald-400'
                      : metaReport.learningVelocity.improvement < 0
                      ? 'text-red-400'
                      : 'text-gray-400'
                  }`}>
                    {metaReport.learningVelocity.improvement > 0 ? '+' : ''}{metaReport.learningVelocity.improvement.toFixed(1)}
                  </p>
                  <p className="text-sm text-gray-400">percentage points</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {executionReport && (
        <div className="bg-gradient-to-br from-slate-900/20 to-gray-900/20 backdrop-blur-sm border border-slate-500/30 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-6 h-6 text-slate-400" />
            <h3 className="text-xl font-bold text-white">Execution Intelligence</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-2">Quality Score</p>
              <p className={`text-3xl font-bold ${
                executionReport.qualityScore >= 80 ? 'text-emerald-400' :
                executionReport.qualityScore >= 60 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {executionReport.qualityScore}
              </p>
              <div className={`inline-block mt-2 px-2 py-1 rounded text-xs border ${getBrokerBadgeColor(executionReport.brokerBehaviorClassification)}`}>
                {executionReport.brokerBehaviorClassification.toUpperCase()}
              </div>
            </div>
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-2">Avg Slippage</p>
              <p className={`text-3xl font-bold ${
                executionReport.avgSlippagePips < 1 ? 'text-emerald-400' :
                executionReport.avgSlippagePips < 2 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {executionReport.avgSlippagePips.toFixed(1)}
              </p>
              <p className="text-xs text-gray-400 mt-2">pips</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-2">SL Hunting Rate</p>
              <p className={`text-3xl font-bold ${
                executionReport.slHuntingRate < 10 ? 'text-emerald-400' :
                executionReport.slHuntingRate < 20 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {executionReport.slHuntingRate.toFixed(0)}%
              </p>
              <p className="text-xs text-gray-400 mt-2">of trades</p>
            </div>
            <div className="bg-gray-900/50 border border-gray-700 rounded-lg p-4">
              <p className="text-sm text-gray-400 mb-2">Rejection Rate</p>
              <p className={`text-3xl font-bold ${
                executionReport.rejectionRate < 5 ? 'text-emerald-400' :
                executionReport.rejectionRate < 10 ? 'text-yellow-400' :
                'text-red-400'
              }`}>
                {executionReport.rejectionRate.toFixed(0)}%
              </p>
              <p className="text-xs text-gray-400 mt-2">of orders</p>
            </div>
          </div>
          {executionReport.recommendations.length > 0 && (
            <div className="mt-4 bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-sm font-semibold text-blue-300 mb-2">Execution Recommendations:</p>
              <ul className="space-y-1">
                {executionReport.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm text-gray-300">• {rec}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
