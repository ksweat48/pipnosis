import React, { useState } from 'react';
import { ComprehensiveAnalytics } from '../services/synthetic-backtest-analytics';
import { SyntheticBacktestTrade } from '../services/synthetic-backtesting-engine';
import {
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Target,
  BarChart3,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Download
} from 'lucide-react';

interface SyntheticBacktestResultsProps {
  analytics: ComprehensiveAnalytics;
  trades: SyntheticBacktestTrade[];
  totalPnL: number;
  finalBalance: number;
  initialBalance: number;
}

export default function SyntheticBacktestResults({
  analytics,
  trades,
  totalPnL,
  finalBalance,
  initialBalance
}: SyntheticBacktestResultsProps) {
  const [expandedSections, setExpandedSections] = useState<{
    [key: string]: boolean;
  }>({
    overview: true,
    tradeStats: true,
    lossAnalysis: true,
    winAnalysis: true,
    recommendations: true,
    timeDistribution: false,
    tradeList: false
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const handleExportCSV = () => {
    const headers = ['Trade #', 'Symbol', 'Direction', 'Entry Time', 'Entry Price', 'Exit Price', 'P&L', 'Outcome', 'Duration (min)'];
    const rows = trades.map(t => [
      t.tradeNumber,
      t.symbol,
      t.direction,
      t.entryTime.toISOString(),
      t.entryPrice,
      t.exitPrice || 'N/A',
      t.pnl.toFixed(2),
      t.outcome,
      t.holdingDurationMinutes || 0
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backtest-results-${Date.now()}.csv`;
    a.click();
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-green-600';
      case 'B':
        return 'text-blue-600';
      case 'C':
        return 'text-yellow-600';
      case 'D':
        return 'text-orange-600';
      default:
        return 'text-red-600';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Overall Grade Card */}
      <CollapsibleSection
        title="Performance Overview"
        icon={<Award className="w-5 h-5" />}
        isExpanded={expandedSections.overview}
        onToggle={() => toggleSection('overview')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {/* Overall Grade */}
          <div className="text-center p-6 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg">
            <div className={`text-6xl font-bold mb-2 ${getGradeColor(analytics.overallGrade)}`}>
              {analytics.overallGrade}
            </div>
            <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide">
              Overall Grade
            </div>
          </div>

          {/* Grade Breakdown */}
          <div className="col-span-1 md:col-span-1 lg:col-span-3 space-y-3">
            <GradeBar label="Profitability" score={analytics.gradeBreakdown.profitability} />
            <GradeBar label="Consistency" score={analytics.gradeBreakdown.consistency} />
            <GradeBar label="Risk Management" score={analytics.gradeBreakdown.riskManagement} />
            <GradeBar label="Execution" score={analytics.gradeBreakdown.execution} />
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <MetricCard
            label="Total P&L"
            value={`$${totalPnL.toFixed(2)}`}
            icon={<TrendingUp className="w-5 h-5" />}
            valueColor={totalPnL >= 0 ? 'text-green-600' : 'text-red-600'}
          />
          <MetricCard
            label="Final Balance"
            value={`$${finalBalance.toFixed(2)}`}
            icon={<BarChart3 className="w-5 h-5 text-blue-600" />}
          />
          <MetricCard
            label="ROI"
            value={`${(((finalBalance - initialBalance) / initialBalance) * 100).toFixed(2)}%`}
            icon={<Target className="w-5 h-5 text-purple-600" />}
            valueColor={finalBalance >= initialBalance ? 'text-green-600' : 'text-red-600'}
          />
          <MetricCard
            label="Expectancy"
            value={`$${analytics.tradeAnalytics.expectancy.toFixed(2)}`}
            icon={<TrendingUp className="w-5 h-5 text-indigo-600" />}
            valueColor={analytics.tradeAnalytics.expectancy >= 0 ? 'text-green-600' : 'text-red-600'}
          />
        </div>
      </CollapsibleSection>

      {/* Detailed Trade Statistics */}
      <CollapsibleSection
        title="Detailed Trade Statistics"
        icon={<BarChart3 className="w-5 h-5" />}
        isExpanded={expandedSections.tradeStats}
        onToggle={() => toggleSection('tradeStats')}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <StatCard label="Total Trades" value={analytics.tradeAnalytics.totalTrades} />
          <StatCard
            label="Win Rate"
            value={`${analytics.tradeAnalytics.winRate.toFixed(1)}%`}
            valueColor={analytics.tradeAnalytics.winRate >= 50 ? 'text-green-600' : 'text-red-600'}
          />
          <StatCard
            label="Profit Factor"
            value={analytics.tradeAnalytics.profitFactor.toFixed(2)}
            valueColor={analytics.tradeAnalytics.profitFactor >= 1.5 ? 'text-green-600' : 'text-red-600'}
          />
          <StatCard
            label="Avg Win"
            value={`$${analytics.tradeAnalytics.avgWinAmount.toFixed(2)}`}
            valueColor="text-green-600"
          />
          <StatCard
            label="Avg Loss"
            value={`$${analytics.tradeAnalytics.avgLossAmount.toFixed(2)}`}
            valueColor="text-red-600"
          />
          <StatCard
            label="Avg Trade Size"
            value={`$${analytics.tradeAnalytics.avgTradeSpend.toFixed(2)}`}
          />
          <StatCard
            label="Best Trade"
            value={`$${analytics.tradeAnalytics.bestTrade?.pnl.toFixed(2) || '0'}`}
            valueColor="text-green-600"
          />
          <StatCard
            label="Worst Trade"
            value={`$${analytics.tradeAnalytics.worstTrade?.pnl.toFixed(2) || '0'}`}
            valueColor="text-red-600"
          />
          <StatCard
            label="Avg Win Duration"
            value={`${analytics.tradeAnalytics.avgWinDuration.toFixed(0)} min`}
          />
          <StatCard
            label="Avg Loss Duration"
            value={`${analytics.tradeAnalytics.avgLossDuration.toFixed(0)} min`}
          />
          <StatCard
            label="Avg R:R Ratio"
            value={analytics.tradeAnalytics.avgRiskRewardActual.toFixed(2)}
            valueColor={analytics.tradeAnalytics.avgRiskRewardActual >= 2 ? 'text-green-600' : 'text-orange-600'}
          />
        </div>
      </CollapsibleSection>

      {/* Loss Analysis */}
      <CollapsibleSection
        title={`Loss Analysis (${analytics.lossAnalysis.totalLosses} losses)`}
        icon={<XCircle className="w-5 h-5 text-red-600" />}
        isExpanded={expandedSections.lossAnalysis}
        onToggle={() => toggleSection('lossAnalysis')}
        badgeColor="bg-red-100 text-red-800"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Loss Categories */}
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-800 mb-3">Loss Breakdown by Category</h4>
            <LossCategoryCard
              label="Stopped Out Early"
              count={analytics.lossAnalysis.lossCategories.stoppedOutEarly.count}
              percentage={analytics.lossAnalysis.lossCategories.stoppedOutEarly.percentage}
              avgLoss={analytics.lossAnalysis.lossCategories.stoppedOutEarly.avgLoss}
            />
            <LossCategoryCard
              label="Wrong Direction"
              count={analytics.lossAnalysis.lossCategories.wrongDirection.count}
              percentage={analytics.lossAnalysis.lossCategories.wrongDirection.percentage}
              avgLoss={analytics.lossAnalysis.lossCategories.wrongDirection.avgLoss}
            />
            <LossCategoryCard
              label="Poor Timing"
              count={analytics.lossAnalysis.lossCategories.poorTiming.count}
              percentage={analytics.lossAnalysis.lossCategories.poorTiming.percentage}
              avgLoss={analytics.lossAnalysis.lossCategories.poorTiming.avgLoss}
            />
            <LossCategoryCard
              label="Market Reversal"
              count={analytics.lossAnalysis.lossCategories.marketReversal.count}
              percentage={analytics.lossAnalysis.lossCategories.marketReversal.percentage}
              avgLoss={analytics.lossAnalysis.lossCategories.marketReversal.avgLoss}
            />
          </div>

          {/* Patterns & Opportunities */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-600" />
                Common Loss Patterns
              </h4>
              {analytics.lossAnalysis.commonPatterns.length > 0 ? (
                <ul className="space-y-2">
                  {analytics.lossAnalysis.commonPatterns.map((pattern, idx) => (
                    <li key={idx} className="text-sm text-gray-700 pl-4 border-l-2 border-orange-300 py-1">
                      {pattern}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">No significant patterns detected</p>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-blue-600" />
                Improvement Opportunities
              </h4>
              {analytics.lossAnalysis.improvementOpportunities.length > 0 ? (
                <ul className="space-y-2">
                  {analytics.lossAnalysis.improvementOpportunities.map((opp, idx) => (
                    <li key={idx} className="text-sm text-blue-700 pl-4 border-l-2 border-blue-300 py-1 bg-blue-50 rounded">
                      {opp}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">Loss management looks good</p>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* Win Analysis */}
      <CollapsibleSection
        title={`Win Analysis (${analytics.winAnalysis.totalWins} wins)`}
        icon={<CheckCircle className="w-5 h-5 text-green-600" />}
        isExpanded={expandedSections.winAnalysis}
        onToggle={() => toggleSection('winAnalysis')}
        badgeColor="bg-green-100 text-green-800"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Win Categories */}
          <div className="space-y-3">
            <h4 className="font-semibold text-gray-800 mb-3">Win Breakdown by Category</h4>
            <WinCategoryCard
              label="Quick Wins (< 1hr)"
              count={analytics.winAnalysis.winCategories.quickWins.count}
              percentage={analytics.winAnalysis.winCategories.quickWins.percentage}
              avgWin={analytics.winAnalysis.winCategories.quickWins.avgWin}
            />
            <WinCategoryCard
              label="Patient Wins (≥ 1hr)"
              count={analytics.winAnalysis.winCategories.patientWins.count}
              percentage={analytics.winAnalysis.winCategories.patientWins.percentage}
              avgWin={analytics.winAnalysis.winCategories.patientWins.avgWin}
            />
            <WinCategoryCard
              label="High Confidence (80%+)"
              count={analytics.winAnalysis.winCategories.perfectExecution.count}
              percentage={analytics.winAnalysis.winCategories.perfectExecution.percentage}
              avgWin={analytics.winAnalysis.winCategories.perfectExecution.avgWin}
            />
            <WinCategoryCard
              label="Moderate Confidence"
              count={analytics.winAnalysis.winCategories.partialProfit.count}
              percentage={analytics.winAnalysis.winCategories.partialProfit.percentage}
              avgWin={analytics.winAnalysis.winCategories.partialProfit.avgWin}
            />
          </div>

          {/* Success Patterns & Strengths */}
          <div className="space-y-4">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-600" />
                Success Patterns
              </h4>
              {analytics.winAnalysis.successPatterns.length > 0 ? (
                <ul className="space-y-2">
                  {analytics.winAnalysis.successPatterns.map((pattern, idx) => (
                    <li key={idx} className="text-sm text-gray-700 pl-4 border-l-2 border-green-300 py-1">
                      {pattern}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-500">Building success pattern data...</p>
              )}
            </div>

            <div>
              <h4 className="font-semibold text-gray-800 mb-2 flex items-center gap-2">
                <Award className="w-4 h-4 text-blue-600" />
                Strength Areas
              </h4>
              {analytics.winAnalysis.strengthAreas.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {analytics.winAnalysis.strengthAreas.map((strength, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-green-100 text-green-800 text-xs font-semibold rounded-full"
                    >
                      {strength}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Identifying strengths...</p>
              )}
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* AI Recommendations */}
      <CollapsibleSection
        title={`AI Improvement Recommendations (${analytics.recommendations.length})`}
        icon={<Lightbulb className="w-5 h-5 text-yellow-600" />}
        isExpanded={expandedSections.recommendations}
        onToggle={() => toggleSection('recommendations')}
        badgeColor="bg-yellow-100 text-yellow-800"
      >
        {analytics.recommendations.length > 0 ? (
          <div className="space-y-4">
            {analytics.recommendations.map((rec, idx) => (
              <div
                key={idx}
                className={`p-4 rounded-lg border-2 ${getPriorityColor(rec.priority)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold uppercase px-2 py-1 rounded bg-white bg-opacity-50">
                        {rec.priority} Priority
                      </span>
                      <span className="text-sm font-semibold">{rec.category}</span>
                    </div>
                    <h5 className="font-bold text-gray-900 mb-1">{rec.issue}</h5>
                    <p className="text-sm text-gray-800 mb-2">{rec.recommendation}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                  <div>
                    <span className="text-gray-600">Current:</span>
                    <span className="ml-1 font-semibold">{rec.currentMetric}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Target:</span>
                    <span className="ml-1 font-semibold text-blue-700">{rec.targetMetric}</span>
                  </div>
                  <div>
                    <span className="text-gray-600">Expected Impact:</span>
                    <span className="ml-1 font-semibold text-green-700">{rec.expectedImpact}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle className="w-12 h-12 mx-auto mb-2 text-green-500" />
            <p className="font-semibold">Excellent Performance!</p>
            <p className="text-sm">No critical recommendations at this time.</p>
          </div>
        )}
      </CollapsibleSection>

      {/* Export Button */}
      <div className="flex justify-end">
        <button
          onClick={handleExportCSV}
          className="px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 flex items-center gap-2"
        >
          <Download className="w-5 h-5" />
          Export Full Results (CSV)
        </button>
      </div>
    </div>
  );
}

function CollapsibleSection({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
  badgeColor = 'bg-blue-100 text-blue-800'
}: any) {
  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${badgeColor}`}>{icon}</div>
          <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-gray-600" />
        ) : (
          <ChevronDown className="w-5 h-5 text-gray-600" />
        )}
      </button>

      {isExpanded && <div className="px-6 py-4 border-t border-gray-200">{children}</div>}
    </div>
  );
}

function MetricCard({ label, value, icon, valueColor = 'text-gray-900' }: any) {
  return (
    <div className="bg-gray-50 p-4 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm text-gray-600">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function StatCard({ label, value, valueColor = 'text-gray-900' }: any) {
  return (
    <div className="bg-gray-50 p-3 rounded-lg">
      <div className="text-xs text-gray-600 mb-1">{label}</div>
      <div className={`text-lg font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

function GradeBar({ label, score }: { label: string; score: number }) {
  const percentage = Math.min(100, Math.max(0, score));
  const color =
    percentage >= 90
      ? 'bg-green-500'
      : percentage >= 80
      ? 'bg-blue-500'
      : percentage >= 70
      ? 'bg-yellow-500'
      : percentage >= 60
      ? 'bg-orange-500'
      : 'bg-red-500';

  return (
    <div>
      <div className="flex justify-between items-center mb-1">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <span className="text-sm font-bold text-gray-900">{score}%</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-3">
        <div
          className={`${color} h-3 rounded-full transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        ></div>
      </div>
    </div>
  );
}

function LossCategoryCard({ label, count, percentage, avgLoss }: any) {
  return (
    <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="text-xs bg-red-200 text-red-800 px-2 py-1 rounded-full font-bold">
          {count} trades
        </span>
      </div>
      <div className="flex justify-between items-center text-xs text-gray-600">
        <span>{percentage.toFixed(1)}% of losses</span>
        <span className="font-semibold text-red-700">Avg: ${avgLoss.toFixed(2)}</span>
      </div>
    </div>
  );
}

function WinCategoryCard({ label, count, percentage, avgWin }: any) {
  return (
    <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
      <div className="flex justify-between items-start mb-2">
        <span className="text-sm font-semibold text-gray-800">{label}</span>
        <span className="text-xs bg-green-200 text-green-800 px-2 py-1 rounded-full font-bold">
          {count} trades
        </span>
      </div>
      <div className="flex justify-between items-center text-xs text-gray-600">
        <span>{percentage.toFixed(1)}% of wins</span>
        <span className="font-semibold text-green-700">Avg: ${avgWin.toFixed(2)}</span>
      </div>
    </div>
  );
}
