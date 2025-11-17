import React from 'react';
import { Brain, Target, TrendingUp, Zap, DollarSign, Clock, AlertCircle } from 'lucide-react';
import type { LLMDecisionQualityBreakdown } from '../services/llm-decision-quality-scorer';

interface LLMDecisionQualityDashboardProps {
  quality: LLMDecisionQualityBreakdown;
}

export default function LLMDecisionQualityDashboard({ quality }: LLMDecisionQualityDashboardProps) {
  return (
    <div className="space-y-6">
      {/* Overall Quality Score */}
      <div className="bg-gradient-to-br from-blue-900/30 to-purple-900/30 backdrop-blur-sm border-2 border-blue-500/30 rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
          <Brain className="w-6 h-6 text-blue-400" />
          LLM Decision Quality Score
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Overall Score */}
          <div className="text-center">
            <div className="text-6xl font-bold text-blue-400 mb-2">
              {quality.overallDecisionQuality}%
            </div>
            <div className="text-sm text-gray-400 uppercase tracking-wide">
              Overall Decision Quality
            </div>
            <div className="mt-2">
              <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                quality.qualityGrade === 'excellent' ? 'bg-green-100 text-green-800' :
                quality.qualityGrade === 'good' ? 'bg-blue-100 text-blue-800' :
                quality.qualityGrade === 'fair' ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
                {quality.qualityGrade.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Gap to Target */}
          <div className="text-center">
            <div className={`text-4xl font-bold mb-2 ${
              quality.gapToTarget <= 0 ? 'text-green-400' : 'text-orange-400'
            }`}>
              {quality.gapToTarget > 0 ? '+' : ''}{quality.gapToTarget.toFixed(1)}%
            </div>
            <div className="text-sm text-gray-400 uppercase tracking-wide">
              Gap to 75% Target
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {quality.gapToTarget <= 0 ? 'Target achieved!' : 'Improvement needed'}
            </p>
          </div>

          {/* Primary Weakness */}
          <div className="text-center">
            <div className="text-lg font-semibold text-white mb-2">
              {quality.recommendations.primaryWeakness}
            </div>
            <div className="text-sm text-gray-400 uppercase tracking-wide">
              Primary Weakness
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Focus improvement efforts here
            </p>
          </div>
        </div>

        {/* Component Scores */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
          <ScoreBar label="Decision Accuracy" score={quality.llmDecisionAccuracy} />
          <ScoreBar label="Prompt Effectiveness" score={quality.promptEffectivenessScore} />
          <ScoreBar label="Confidence Calibration" score={quality.confidenceCalibrationScore} />
          <ScoreBar label="Reasoning Quality" score={quality.reasoningQualityScore} />
          <ScoreBar label="Cost Efficiency" score={quality.costEfficiencyScore} />
        </div>
      </div>

      {/* Decision Breakdown */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Zap className="w-5 h-5 text-yellow-400" />
          LLM vs Fallback Decisions
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Total LLM Decisions"
            value={quality.decisionBreakdown.totalLLMDecisions}
            icon={<Brain className="w-5 h-5 text-blue-400" />}
          />
          <MetricCard
            label="Profitable"
            value={quality.decisionBreakdown.llmProfitableDecisions}
            icon={<TrendingUp className="w-5 h-5 text-green-400" />}
            valueColor="text-green-400"
          />
          <MetricCard
            label="Unprofitable"
            value={quality.decisionBreakdown.llmUnprofitableDecisions}
            icon={<AlertCircle className="w-5 h-5 text-red-400" />}
            valueColor="text-red-400"
          />
          <MetricCard
            label="Fallback Used"
            value={quality.decisionBreakdown.fallbackDecisionsUsed}
            icon={<Zap className="w-5 h-5 text-orange-400" />}
            valueColor="text-orange-400"
          />
        </div>
      </div>

      {/* Recommendation Quality Matrix */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-400" />
          Recommendation Quality Matrix
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <MetricCard
            label="True Positives"
            value={quality.recommendationQuality.truePositives}
            icon={<TrendingUp className="w-5 h-5 text-green-400" />}
            subtitle="Said trade, it won"
            valueColor="text-green-400"
          />
          <MetricCard
            label="False Positives"
            value={quality.recommendationQuality.falsePositives}
            icon={<AlertCircle className="w-5 h-5 text-red-400" />}
            subtitle="Said trade, it lost"
            valueColor="text-red-400"
          />
          <MetricCard
            label="True Negatives"
            value={quality.recommendationQuality.trueNegatives}
            icon={<TrendingUp className="w-5 h-5 text-blue-400" />}
            subtitle="Said no trade, correct"
            valueColor="text-blue-400"
          />
          <MetricCard
            label="False Negatives"
            value={quality.recommendationQuality.falseNegatives}
            icon={<AlertCircle className="w-5 h-5 text-orange-400" />}
            subtitle="Said no trade, missed win"
            valueColor="text-orange-400"
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">Precision</p>
            <p className="text-2xl font-bold text-white">{quality.recommendationQuality.precision}%</p>
          </div>
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">Recall</p>
            <p className="text-2xl font-bold text-white">{quality.recommendationQuality.recall}%</p>
          </div>
          <div className="p-4 bg-gray-700/50 rounded-lg">
            <p className="text-sm text-gray-400 mb-1">F1 Score</p>
            <p className="text-2xl font-bold text-white">{quality.recommendationQuality.f1Score}%</p>
          </div>
        </div>
      </div>

      {/* Cost Analysis */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-green-400" />
          Cost & Performance Analysis
        </h3>

        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard
            label="Total API Calls"
            value={quality.costAnalysis.totalAPICalls}
            icon={<Brain className="w-5 h-5 text-blue-400" />}
          />
          <MetricCard
            label="Total Cost"
            value={`$${quality.costAnalysis.totalAPICost.toFixed(2)}`}
            icon={<DollarSign className="w-5 h-5 text-green-400" />}
          />
          <MetricCard
            label="Avg Response Time"
            value={`${quality.costAnalysis.avgResponseTimeMs.toFixed(0)}ms`}
            icon={<Clock className="w-5 h-5 text-purple-400" />}
          />
          <MetricCard
            label="API Failure Rate"
            value={`${quality.costAnalysis.apiFailureRate.toFixed(1)}%`}
            icon={<AlertCircle className="w-5 h-5 text-orange-400" />}
            valueColor={quality.costAnalysis.apiFailureRate > 5 ? 'text-red-400' : 'text-green-400'}
          />
          <MetricCard
            label="Profit per $ Spent"
            value={`$${quality.costAnalysis.profitPerAPIDollar.toFixed(2)}`}
            icon={<TrendingUp className="w-5 h-5 text-green-400" />}
            valueColor={quality.costAnalysis.profitPerAPIDollar > 10 ? 'text-green-400' : 'text-orange-400'}
          />
        </div>
      </div>

      {/* Short-Term Compliance */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Pipnosis Short-Term Trading Compliance</h3>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard
            label="Avg Duration"
            value={`${quality.shortTermCompliance.avgTradeDurationMinutes} min`}
            subtitle={`Target: <120 min`}
            valueColor={quality.shortTermCompliance.avgTradeDurationMinutes <= 120 ? 'text-green-400' : 'text-orange-400'}
          />
          <MetricCard
            label="Within Preferred"
            value={`${quality.shortTermCompliance.tradesWithinPreferredDurationPercent}%`}
            subtitle="Closed within 2 hours"
            valueColor={quality.shortTermCompliance.tradesWithinPreferredDurationPercent >= 80 ? 'text-green-400' : 'text-orange-400'}
          />
          <MetricCard
            label="Overnight Violations"
            value={quality.shortTermCompliance.overnightHoldViolations}
            subtitle="Target: 0"
            valueColor={quality.shortTermCompliance.overnightHoldViolations === 0 ? 'text-green-400' : 'text-red-400'}
          />
          <MetricCard
            label="Rule Compliance"
            value={`${quality.shortTermCompliance.pipnosisRuleCompliancePercent}%`}
            subtitle="Core rules adherence"
            valueColor={quality.shortTermCompliance.pipnosisRuleCompliancePercent === 100 ? 'text-green-400' : 'text-orange-400'}
          />
        </div>
      </div>

      {/* Recommendations */}
      {Object.keys(quality.recommendations.promptAdjustments).length > 0 && (
        <div className="bg-yellow-900/20 backdrop-blur-sm rounded-lg shadow-md p-6 border-2 border-yellow-500/30">
          <h3 className="text-xl font-semibold text-white mb-4">Recommended LLM Adjustments</h3>
          <div className="space-y-3">
            {Object.entries(quality.recommendations.promptAdjustments).map(([key, adjustment]: [string, any]) => (
              <div key={key} className="bg-gray-700/50 p-4 rounded-lg">
                <h4 className="font-semibold text-white mb-2">
                  {key.replace(/([A-Z])/g, ' $1').trim()}
                </h4>
                <p className="text-sm text-gray-300 mb-2">{adjustment.reason}</p>
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-gray-300">
                    Current: <span className="font-semibold">{adjustment.current}</span>
                  </span>
                  <span className="text-yellow-400">→</span>
                  <span className="text-yellow-400">
                    Suggested: <span className="font-semibold">{adjustment.suggested}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 bg-green-900/20 rounded-lg">
            <p className="text-sm text-gray-300">
              Estimated decision quality after adjustments:{' '}
              <span className="font-bold text-green-400">
                {quality.recommendations.estimatedQualityAfterAdjustments}%
              </span>
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Recommended temperature: {quality.recommendations.recommendedTemperature}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const color = percentage >= 75 ? 'bg-green-500' : percentage >= 60 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <div>
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className="w-full bg-gray-700 rounded-full h-2 mb-1">
        <div className={`${color} h-2 rounded-full transition-all duration-500`} style={{ width: `${percentage}%` }}></div>
      </div>
      <div className="text-xs font-semibold text-gray-300">{score}%</div>
    </div>
  );
}

function MetricCard({ label, value, icon, subtitle, valueColor = 'text-white' }: any) {
  return (
    <div className="bg-gray-700/50 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-400">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}
