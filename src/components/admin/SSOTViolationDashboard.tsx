/**
 * SSOT Violation Dashboard
 *
 * Real-time dashboard for monitoring architectural violations.
 * Part of Phase 3: Governance Enforcement
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, TrendingUp, Activity, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { ssotAnalyticsService, type SSOTViolation, type ViolationSummary, type ViolationTrend, type ComponentHealth } from '../../services/ssot-analytics-service';

export function SSOTViolationDashboard() {
  const [recentViolations, setRecentViolations] = useState<SSOTViolation[]>([]);
  const [violationSummary, setViolationSummary] = useState<ViolationSummary[]>([]);
  const [trends, setTrends] = useState<ViolationTrend[]>([]);
  const [componentHealth, setComponentHealth] = useState<ComponentHealth[]>([]);
  const [complianceScore, setComplianceScore] = useState<{
    score: number;
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    infoViolations: number;
  }>({
    score: 100,
    totalViolations: 0,
    criticalViolations: 0,
    warningViolations: 0,
    infoViolations: 0
  });
  const [loading, setLoading] = useState(true);
  const [selectedTab, setSelectedTab] = useState<'overview' | 'violations' | 'components' | 'trends'>('overview');

  useEffect(() => {
    loadData();

    // Subscribe to real-time updates
    const unsubscribe = ssotAnalyticsService.subscribeToViolations((violation) => {
      setRecentViolations(prev => [violation, ...prev].slice(0, 50));
      // Reload summary to reflect new violation
      loadSummary();
      loadComplianceScore();
    });

    return () => unsubscribe();
  }, []);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([
      loadRecentViolations(),
      loadSummary(),
      loadTrends(),
      loadComponentHealth(),
      loadComplianceScore()
    ]);
    setLoading(false);
  };

  const loadRecentViolations = async () => {
    const violations = await ssotAnalyticsService.getRecentViolations(50);
    setRecentViolations(violations);
  };

  const loadSummary = async () => {
    const summary = await ssotAnalyticsService.getViolationSummary();
    setViolationSummary(summary);
  };

  const loadTrends = async () => {
    const trendsData = await ssotAnalyticsService.getViolationTrends();
    setTrends(trendsData);
  };

  const loadComponentHealth = async () => {
    const health = await ssotAnalyticsService.getComponentHealth();
    setComponentHealth(health);
  };

  const loadComplianceScore = async () => {
    const score = await ssotAnalyticsService.getPlatformComplianceScore();
    setComplianceScore(score);
  };

  const getSeverityIcon = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'info':
        return <AlertTriangle className="w-5 h-5 text-blue-500" />;
    }
  };

  const getSeverityColor = (severity: 'critical' | 'warning' | 'info') => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'warning':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'info':
        return 'bg-blue-100 text-blue-800 border-blue-300';
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-green-600';
    if (score >= 75) return 'text-lime-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getHealthLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Fair';
    return 'Poor';
  };

  const getComplianceColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 75) return 'bg-lime-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-400">Loading violation data...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">SSOT Compliance Dashboard</h2>
          <p className="text-gray-400 mt-1">Real-time architectural violation monitoring</p>
        </div>
        <button
          onClick={loadData}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          Refresh Data
        </button>
      </div>

      {/* Compliance Score Card */}
      <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <h3 className="text-lg font-semibold text-white">Platform Compliance Score</h3>
                <p className="text-sm text-gray-400">Last 7 days</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-4">
              <div className="text-5xl font-bold text-white">{complianceScore.score}</div>
              <div className="flex-1">
                <div className="w-full bg-gray-700 rounded-full h-4 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${getComplianceColor(complianceScore.score)}`}
                    style={{ width: `${complianceScore.score}%` }}
                  />
                </div>
                <div className="mt-2 text-sm text-gray-400">
                  {getHealthLabel(complianceScore.score)} - {complianceScore.totalViolations} total violations
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="text-2xl font-bold text-red-400">{complianceScore.criticalViolations}</div>
                <div className="text-sm text-gray-400">Critical</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-yellow-400">{complianceScore.warningViolations}</div>
                <div className="text-sm text-gray-400">Warning</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-400">{complianceScore.infoViolations}</div>
                <div className="text-sm text-gray-400">Info</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 border-b border-gray-700">
        {(['overview', 'violations', 'components', 'trends'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setSelectedTab(tab)}
            className={`px-4 py-2 font-medium capitalize transition-colors ${
              selectedTab === tab
                ? 'text-white border-b-2 border-blue-500'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {selectedTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Violation Summary */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <Activity className="w-5 h-5" />
              Violation Summary (7 days)
            </h3>
            <div className="space-y-3">
              {violationSummary.slice(0, 5).map(summary => (
                <div key={summary.type} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3 flex-1">
                    {getSeverityIcon(summary.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{summary.type}</div>
                      <div className="text-xs text-gray-400">
                        Last seen: {new Date(summary.lastSeen).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-white ml-4">{summary.count}</div>
                </div>
              ))}
              {violationSummary.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No violations in the last 7 days
                </div>
              )}
            </div>
          </div>

          {/* Component Health */}
          <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Component Health (7 days)
            </h3>
            <div className="space-y-3">
              {componentHealth.slice(0, 5).map(component => (
                <div key={component.component} className="flex items-center justify-between p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{component.component}</div>
                    <div className="text-xs text-gray-400">{component.violationCount} violations</div>
                  </div>
                  <div className={`text-2xl font-bold ml-4 ${getHealthColor(component.healthScore)}`}>
                    {component.healthScore}
                  </div>
                </div>
              ))}
              {componentHealth.length === 0 && (
                <div className="text-center py-8 text-gray-400">
                  No component violations tracked
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Violations Tab */}
      {selectedTab === 'violations' && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Recent Violations (24 hours)</h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {recentViolations.map(violation => (
              <div
                key={violation.id}
                className={`p-4 rounded-lg border ${getSeverityColor(violation.severity)}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {getSeverityIcon(violation.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{violation.violation_type}</div>
                      <div className="text-sm opacity-75 mt-1">
                        Component: {violation.component || 'unknown'}
                      </div>
                      {violation.details && Object.keys(violation.details).length > 0 && (
                        <div className="text-xs mt-2 p-2 bg-black/20 rounded">
                          <pre className="whitespace-pre-wrap break-words">
                            {JSON.stringify(violation.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-xs opacity-75 whitespace-nowrap">
                    {new Date(violation.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
            {recentViolations.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                No violations in the last 24 hours
              </div>
            )}
          </div>
        </div>
      )}

      {/* Components Tab */}
      {selectedTab === 'components' && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Component Health Scores</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-gray-400">Component</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Violations</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Health Score</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-gray-400">Status</th>
                  <th className="text-right py-3 px-4 text-sm font-semibold text-gray-400">Last Violation</th>
                </tr>
              </thead>
              <tbody>
                {componentHealth.map((component, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-4 text-sm text-white">{component.component}</td>
                    <td className="py-3 px-4 text-sm text-center text-white">{component.violationCount}</td>
                    <td className={`py-3 px-4 text-sm text-center font-bold ${getHealthColor(component.healthScore)}`}>
                      {component.healthScore}
                    </td>
                    <td className="py-3 px-4 text-sm text-center">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        component.healthScore >= 90 ? 'bg-green-500/20 text-green-400' :
                        component.healthScore >= 75 ? 'bg-lime-500/20 text-lime-400' :
                        component.healthScore >= 60 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {getHealthLabel(component.healthScore)}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-sm text-right text-gray-400">
                      {component.lastViolation ? new Date(component.lastViolation).toLocaleString() : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {componentHealth.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                No component health data available
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trends Tab */}
      {selectedTab === 'trends' && (
        <div className="bg-gray-800 rounded-lg p-6 border border-gray-700">
          <h3 className="text-lg font-semibold text-white mb-4">Violation Trends (30 days)</h3>
          <div className="space-y-3 max-h-[600px] overflow-y-auto">
            {trends.slice().reverse().map(trend => (
              <div key={trend.date} className="flex items-center gap-4 p-3 bg-gray-700/50 rounded-lg">
                <div className="w-28 text-sm text-gray-400">{trend.date}</div>
                <div className="flex-1 flex items-center gap-2">
                  <div className="flex-1 bg-gray-700 rounded-full h-6 overflow-hidden flex">
                    {trend.criticalCount > 0 && (
                      <div
                        className="bg-red-500 flex items-center justify-center text-xs text-white font-medium"
                        style={{ width: `${(trend.criticalCount / trend.count) * 100}%` }}
                      >
                        {trend.criticalCount}
                      </div>
                    )}
                    {trend.warningCount > 0 && (
                      <div
                        className="bg-yellow-500 flex items-center justify-center text-xs text-white font-medium"
                        style={{ width: `${(trend.warningCount / trend.count) * 100}%` }}
                      >
                        {trend.warningCount}
                      </div>
                    )}
                    {trend.infoCount > 0 && (
                      <div
                        className="bg-blue-500 flex items-center justify-center text-xs text-white font-medium"
                        style={{ width: `${(trend.infoCount / trend.count) * 100}%` }}
                      >
                        {trend.infoCount}
                      </div>
                    )}
                  </div>
                </div>
                <div className="w-16 text-right text-sm font-medium text-white">{trend.count}</div>
              </div>
            ))}
            {trends.length === 0 && (
              <div className="text-center py-12 text-gray-400">
                No trend data available
              </div>
            )}
          </div>
          <div className="mt-6 flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-red-500 rounded"></div>
              <span className="text-gray-400">Critical</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-500 rounded"></div>
              <span className="text-gray-400">Warning</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-500 rounded"></div>
              <span className="text-gray-400">Info</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
