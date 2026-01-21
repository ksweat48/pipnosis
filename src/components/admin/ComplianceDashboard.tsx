/**
 * Compliance Dashboard Component
 *
 * Displays comprehensive compliance metrics and scoring.
 *
 * Features:
 * - Current compliance score and grade
 * - 30-day trend visualization
 * - Component health grid
 * - AI-powered insights and recommendations
 * - Historical reports
 *
 * Part of Phase 3.4: Daily Compliance Scoring
 */

import { useEffect, useState } from 'react';
import { governanceComplianceService, type ComplianceScore, type ComponentHealthSummary, type ComplianceTrendPoint } from '../../services/governance-compliance-service';
import { TrendingUp, TrendingDown, Minus, AlertCircle, CheckCircle, Clock, Award, Activity } from 'lucide-react';

export function ComplianceDashboard() {
  const [currentScore, setCurrentScore] = useState<ComplianceScore | null>(null);
  const [trend, setTrend] = useState<ComplianceTrendPoint[]>([]);
  const [components, setComponents] = useState<ComponentHealthSummary[]>([]);
  const [insights, setInsights] = useState<{ strengths: string[]; concerns: string[]; recommendations: string[] }>({
    strengths: [],
    concerns: [],
    recommendations: []
  });
  const [loading, setLoading] = useState(true);
  const [calculating, setCalculating] = useState(false);

  useEffect(() => {
    loadData();

    // Subscribe to real-time updates
    const scoreSubscription = governanceComplianceService.subscribeToScores(() => {
      loadData();
    });

    return () => {
      scoreSubscription.unsubscribe();
    };
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [summary, insightsData] = await Promise.all([
        governanceComplianceService.getComplianceSummary(),
        governanceComplianceService.getComplianceInsights()
      ]);

      setCurrentScore(summary.current);
      setTrend(summary.trend);
      setComponents(summary.components);
      setInsights(insightsData);
    } catch (error) {
      console.error('Failed to load compliance data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleRecalculate = async () => {
    setCalculating(true);
    try {
      await governanceComplianceService.calculateDailyScore();
      await loadData();
    } catch (error) {
      console.error('Failed to recalculate score:', error);
    } finally {
      setCalculating(false);
    }
  };

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'improving':
        return <TrendingUp className="w-5 h-5 text-green-500" />;
      case 'declining':
        return <TrendingDown className="w-5 h-5 text-red-500" />;
      default:
        return <Minus className="w-5 h-5 text-gray-500" />;
    }
  };

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A+':
      case 'A':
        return 'text-green-600 bg-green-100 border-green-300';
      case 'B':
        return 'text-blue-600 bg-blue-100 border-blue-300';
      case 'C':
        return 'text-yellow-600 bg-yellow-100 border-yellow-300';
      case 'D':
        return 'text-orange-600 bg-orange-100 border-orange-300';
      case 'F':
        return 'text-red-600 bg-red-100 border-red-300';
      default:
        return 'text-gray-600 bg-gray-100 border-gray-300';
    }
  };

  const getHealthStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'critical':
        return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'failing':
        return 'bg-red-100 text-red-800 border-red-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!currentScore) {
    return (
      <div className="text-center p-12">
        <Activity className="w-16 h-16 mx-auto mb-4 text-gray-400" />
        <h3 className="text-lg font-semibold text-gray-900 mb-2">No Compliance Data</h3>
        <p className="text-gray-600 mb-4">Click below to calculate the first compliance score.</p>
        <button
          onClick={handleRecalculate}
          disabled={calculating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {calculating ? 'Calculating...' : 'Calculate Now'}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Actions */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Compliance Dashboard</h2>
          <p className="text-gray-600">Platform governance health and trends</p>
        </div>
        <button
          onClick={handleRecalculate}
          disabled={calculating}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          <Clock className="w-4 h-4" />
          {calculating ? 'Calculating...' : 'Recalculate Score'}
        </button>
      </div>

      {/* Current Score Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Main Score */}
        <div className="md:col-span-1 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-700">Platform Score</h3>
            {getTrendIcon(currentScore.trend_direction)}
          </div>
          <div className="text-center">
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {currentScore.platform_score.toFixed(1)}
            </div>
            <div className={`inline-flex items-center px-4 py-2 rounded-full border-2 text-lg font-bold ${getGradeColor(currentScore.platform_grade)}`}>
              Grade: {currentScore.platform_grade}
            </div>
            <div className="mt-4 text-sm text-gray-600">
              {currentScore.days_at_current_grade} {currentScore.days_at_current_grade === 1 ? 'day' : 'days'} at this grade
            </div>
          </div>
        </div>

        {/* Violations Summary */}
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Violations Breakdown</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Critical</span>
              <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                {currentScore.critical_violations}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">High</span>
              <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-semibold">
                {currentScore.high_violations}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Medium</span>
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-semibold">
                {currentScore.medium_violations}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Low</span>
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm font-semibold">
                {currentScore.low_violations}
              </span>
            </div>
            <div className="pt-3 border-t flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Total</span>
              <span className="px-3 py-1 bg-gray-200 text-gray-900 rounded-full text-sm font-bold">
                {currentScore.total_violations}
              </span>
            </div>
          </div>
        </div>

        {/* Components Summary */}
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-sm font-medium text-gray-700 mb-4">Component Health</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                Healthy
              </span>
              <span className="px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
                {currentScore.healthy_components}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-500" />
                Warning
              </span>
              <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-semibold">
                {currentScore.warning_components}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-orange-500" />
                Critical
              </span>
              <span className="px-3 py-1 bg-orange-100 text-orange-800 rounded-full text-sm font-semibold">
                {currentScore.critical_components}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500" />
                Failing
              </span>
              <span className="px-3 py-1 bg-red-100 text-red-800 rounded-full text-sm font-semibold">
                {currentScore.failing_components}
              </span>
            </div>
            <div className="pt-3 border-t flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Total</span>
              <span className="px-3 py-1 bg-gray-200 text-gray-900 rounded-full text-sm font-bold">
                {currentScore.total_components}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Insights Section */}
      {(insights.strengths.length > 0 || insights.concerns.length > 0 || insights.recommendations.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Strengths */}
          {insights.strengths.length > 0 && (
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Award className="w-5 h-5 text-green-600" />
                <h3 className="font-semibold text-green-900">Strengths</h3>
              </div>
              <ul className="space-y-2">
                {insights.strengths.map((strength, idx) => (
                  <li key={idx} className="text-sm text-green-800 flex items-start gap-2">
                    <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Concerns */}
          {insights.concerns.length > 0 && (
            <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                <h3 className="font-semibold text-orange-900">Concerns</h3>
              </div>
              <ul className="space-y-2">
                {insights.concerns.map((concern, idx) => (
                  <li key={idx} className="text-sm text-orange-800 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <span>{concern}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {insights.recommendations.length > 0 && (
            <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold text-blue-900">Recommendations</h3>
              </div>
              <ul className="space-y-2">
                {insights.recommendations.map((rec, idx) => (
                  <li key={idx} className="text-sm text-blue-800 flex items-start gap-2">
                    <span className="text-blue-600 font-bold mt-0.5">→</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* 30-Day Trend Chart */}
      {trend.length > 0 && (
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">30-Day Compliance Trend</h3>
          <div className="h-64 flex items-end justify-between gap-1">
            {trend.map((point, idx) => {
              const height = (point.platform_score / 100) * 100;
              const color = point.platform_score >= 90 ? 'bg-green-500' :
                           point.platform_score >= 80 ? 'bg-blue-500' :
                           point.platform_score >= 70 ? 'bg-yellow-500' :
                           point.platform_score >= 60 ? 'bg-orange-500' : 'bg-red-500';

              return (
                <div
                  key={idx}
                  className="flex-1 group relative"
                  title={`${point.score_date}: ${point.platform_score.toFixed(1)}`}
                >
                  <div
                    className={`${color} rounded-t transition-all hover:opacity-80`}
                    style={{ height: `${height}%` }}
                  ></div>
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    {new Date(point.score_date).toLocaleDateString()}<br />
                    Score: {point.platform_score.toFixed(1)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-4 text-xs text-gray-600">
            <span>{trend[0]?.score_date && new Date(trend[0].score_date).toLocaleDateString()}</span>
            <span className="font-semibold">Compliance Score Over Time</span>
            <span>{trend[trend.length - 1]?.score_date && new Date(trend[trend.length - 1].score_date).toLocaleDateString()}</span>
          </div>
        </div>
      )}

      {/* Component Health Grid */}
      {components.length > 0 && (
        <div className="bg-white border rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Component Health Scores</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {components.map((component, idx) => (
              <div
                key={idx}
                className={`border-2 rounded-lg p-4 ${getHealthStatusColor(component.health_status)}`}
              >
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-sm truncate flex-1" title={component.component_name}>
                    {component.component_name}
                  </h4>
                  {component.trend_direction && getTrendIcon(component.trend_direction)}
                </div>
                <div className="text-2xl font-bold mb-1">
                  {component.current_health_score.toFixed(1)}
                </div>
                <div className="text-xs opacity-75 capitalize mb-2">
                  {component.health_status}
                </div>
                <div className="text-xs">
                  {component.total_violations} violation{component.total_violations !== 1 ? 's' : ''}
                  {component.score_change !== null && component.score_change !== 0 && (
                    <span className="ml-2">
                      ({component.score_change > 0 ? '+' : ''}{component.score_change.toFixed(1)})
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
