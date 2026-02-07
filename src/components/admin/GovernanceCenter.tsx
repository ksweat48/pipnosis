import { useEffect, useState } from 'react';
import {
  Shield,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Bell,
  X,
  Filter,
  RefreshCw,
  Clock,
  Zap,
  Info
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  ssotAnalyticsService,
  type SSOTViolation,
  type ViolationSummary,
  type ViolationTrend,
  type ComponentHealth
} from '../../services/ssot-analytics-service';
import {
  governanceComplianceService,
  type ComplianceScore,
  type ComplianceTrendPoint,
  type ComponentHealthSummary
} from '../../services/governance-compliance-service';
import { governanceAlertService, type AlertSeverity } from '../../services/governance-alert-service';

type GovernanceSection = 'overview' | 'violations' | 'alerts' | 'components' | 'trends';

interface GovernanceAlert {
  id: string;
  alert_type: string;
  severity: AlertSeverity;
  title: string;
  message: string;
  metadata: any;
  violation_id: string | null;
  component_name: string | null;
  channels_sent: string[];
  read_by: string[];
  dismissed_by: string[];
  dismissed_at: string | null;
  action_url: string | null;
  created_at: string;
}

export function GovernanceCenter() {
  const [section, setSection] = useState<GovernanceSection>('overview');
  const [loading, setLoading] = useState(true);

  const [complianceData, setComplianceData] = useState<{
    score: number;
    totalViolations: number;
    criticalViolations: number;
    warningViolations: number;
    infoViolations: number;
    protectiveBlocks: number;
    actualBugs: number;
  }>({
    score: 100,
    totalViolations: 0,
    criticalViolations: 0,
    warningViolations: 0,
    infoViolations: 0,
    protectiveBlocks: 0,
    actualBugs: 0
  });

  const [violationSummary, setViolationSummary] = useState<ViolationSummary[]>([]);
  const [recentViolations, setRecentViolations] = useState<SSOTViolation[]>([]);
  const [componentHealth, setComponentHealth] = useState<ComponentHealth[]>([]);
  const [trends, setTrends] = useState<ViolationTrend[]>([]);

  const [alerts, setAlerts] = useState<GovernanceAlert[]>([]);
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<AlertSeverity | 'ALL'>('ALL');
  const [showDismissedAlerts, setShowDismissedAlerts] = useState(false);

  const [complianceScore, setComplianceScore] = useState<ComplianceScore | null>(null);
  const [complianceTrend, setComplianceTrend] = useState<ComplianceTrendPoint[]>([]);
  const [componentSummary, setComponentSummary] = useState<ComponentHealthSummary[]>([]);

  useEffect(() => {
    loadAllData();

    const violationUnsub = ssotAnalyticsService.subscribeToViolations(() => {
      loadViolationData();
    });

    const alertSub = supabase
      .channel('governance_alerts_unified')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'governance_alerts' }, () => {
        loadAlerts();
      })
      .subscribe();

    return () => {
      violationUnsub();
      alertSub.unsubscribe();
    };
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    await Promise.all([
      loadViolationData(),
      loadAlerts(),
      loadComplianceData()
    ]);
    setLoading(false);
  };

  const loadViolationData = async () => {
    const [score, summary, violations, health, trendData] = await Promise.all([
      ssotAnalyticsService.getPlatformComplianceScore(),
      ssotAnalyticsService.getViolationSummary(),
      ssotAnalyticsService.getRecentViolations(50),
      ssotAnalyticsService.getComponentHealth(),
      ssotAnalyticsService.getViolationTrends()
    ]);
    setComplianceData(score);
    setViolationSummary(summary);
    setRecentViolations(violations);
    setComponentHealth(health);
    setTrends(trendData);
  };

  const loadAlerts = async () => {
    try {
      const data = await governanceAlertService.getRecentAlerts(100);
      setAlerts(data);
    } catch (err) {
      console.error('Failed to load alerts:', err);
    }
  };

  const loadComplianceData = async () => {
    try {
      const [summary, compSummary] = await Promise.all([
        governanceComplianceService.getComplianceSummary(),
        governanceComplianceService.getComponentHealthSummary()
      ]);
      setComplianceScore(summary.current);
      setComplianceTrend(summary.trend);
      setComponentSummary(compSummary);
    } catch (err) {
      console.error('Failed to load compliance data:', err);
    }
  };

  const handleDismissAlert = async (alertId: string) => {
    try {
      await governanceAlertService.dismissAlert(alertId);
      await loadAlerts();
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  const handleRecalculateCompliance = async () => {
    try {
      await governanceComplianceService.calculateDailyScore();
      await loadComplianceData();
    } catch (err) {
      console.error('Failed to recalculate:', err);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 75) return 'text-lime-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getScoreBgColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 75) return 'bg-lime-500';
    if (score >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getHealthLabel = (score: number) => {
    if (score >= 90) return 'Excellent';
    if (score >= 75) return 'Good';
    if (score >= 60) return 'Fair';
    return 'Poor';
  };

  const getHealthColor = (score: number) => {
    if (score >= 90) return 'text-green-400';
    if (score >= 75) return 'text-lime-400';
    if (score >= 60) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
      case 'CRITICAL':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'warning':
      case 'HIGH':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'MEDIUM':
        return <Zap className="w-4 h-4 text-yellow-400" />;
      case 'info':
      case 'LOW':
        return <Info className="w-4 h-4 text-blue-400" />;
      default:
        return <AlertCircle className="w-4 h-4 text-gray-400" />;
    }
  };

  const getSeverityBadgeColor = (severity: string) => {
    switch (severity) {
      case 'critical':
      case 'CRITICAL':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'warning':
      case 'HIGH':
        return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'MEDIUM':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30';
      case 'info':
      case 'LOW':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  const getTimeAgo = (timestamp: string) => {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  const filteredAlerts = alerts.filter(a => {
    if (!showDismissedAlerts && a.dismissed_at) return false;
    if (alertSeverityFilter !== 'ALL' && a.severity !== alertSeverityFilter) return false;
    return true;
  });

  const unreadAlertCount = alerts.filter(a => !a.dismissed_at && (!a.read_by || a.read_by.length === 0)).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
        <span className="ml-3 text-gray-400">Loading governance data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/20 rounded-xl">
            <Shield className="w-6 h-6 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Governance Center</h2>
            <p className="text-gray-400 text-sm">SSOT compliance, violations, and alerts</p>
          </div>
        </div>
        <button
          onClick={loadAllData}
          className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors text-sm"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {renderScoreCards()}

      <div className="flex gap-1 overflow-x-auto pb-1">
        {([
          { key: 'overview', label: 'Overview', icon: Activity },
          { key: 'violations', label: 'Violations', icon: AlertTriangle },
          { key: 'alerts', label: `Alerts${unreadAlertCount > 0 ? ` (${unreadAlertCount})` : ''}`, icon: Bell },
          { key: 'components', label: 'Components', icon: TrendingUp },
          { key: 'trends', label: 'Trends', icon: Activity },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setSection(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium transition-all whitespace-nowrap text-sm ${
              section === tab.key
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {section === 'overview' && renderOverview()}
      {section === 'violations' && renderViolations()}
      {section === 'alerts' && renderAlerts()}
      {section === 'components' && renderComponents()}
      {section === 'trends' && renderTrends()}
    </div>
  );

  function renderScoreCards() {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Compliance Score</div>
          <div className={`text-3xl font-bold ${getScoreColor(complianceData.score)}`}>
            {complianceData.score}
          </div>
          <div className="text-xs text-gray-500 mt-1">{getHealthLabel(complianceData.score)} - 7d</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Critical Bugs</div>
          <div className="text-3xl font-bold text-red-400">{complianceData.actualBugs}</div>
          <div className="text-xs text-gray-500 mt-1">Needs fixing</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Protective Blocks</div>
          <div className="text-3xl font-bold text-yellow-400">{complianceData.protectiveBlocks}</div>
          <div className="text-xs text-gray-500 mt-1">System working</div>
        </div>
        <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
          <div className="text-gray-400 text-xs mb-1">Total Violations</div>
          <div className="text-3xl font-bold text-white">{complianceData.totalViolations}</div>
          <div className="text-xs text-gray-500 mt-1">
            {complianceData.criticalViolations}C / {complianceData.warningViolations}W / {complianceData.infoViolations}I
          </div>
        </div>
      </div>
    );
  }

  function renderOverview() {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" />
            Top Violations (7d)
          </h3>
          <div className="space-y-2.5">
            {violationSummary.slice(0, 6).map(s => {
              const desc = ssotAnalyticsService.getViolationDescription(s.type);
              return (
                <div key={s.type} className="flex items-center justify-between p-3 bg-gray-700/40 rounded-lg">
                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    {getSeverityIcon(s.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{desc.title}</div>
                      <div className="text-xs text-gray-400 truncate">{desc.description}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium border ${getSeverityBadgeColor(s.severity)}`}>
                      {s.severity}
                    </span>
                    <span className="text-lg font-bold text-white">{s.count}</span>
                  </div>
                </div>
              );
            })}
            {violationSummary.length === 0 && (
              <div className="text-center py-6 text-gray-500">No violations in the last 7 days</div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              Component Health (7d)
            </h3>
            <div className="space-y-2.5">
              {componentHealth.slice(0, 5).map(c => (
                <div key={c.component} className="flex items-center justify-between p-3 bg-gray-700/40 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">{c.component}</div>
                    <div className="text-xs text-gray-400">{c.violationCount} violations</div>
                  </div>
                  <div className={`text-xl font-bold ml-3 ${getHealthColor(c.healthScore)}`}>
                    {c.healthScore}
                  </div>
                </div>
              ))}
              {componentHealth.length === 0 && (
                <div className="text-center py-6 text-gray-500">No component data</div>
              )}
            </div>
          </div>

          {filteredAlerts.length > 0 && (
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
                <Bell className="w-4 h-4 text-blue-400" />
                Recent Alerts
                {unreadAlertCount > 0 && (
                  <span className="px-1.5 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
                    {unreadAlertCount}
                  </span>
                )}
              </h3>
              <div className="space-y-2">
                {filteredAlerts.slice(0, 3).map(a => (
                  <div key={a.id} className="flex items-start gap-2 p-3 bg-gray-700/40 rounded-lg">
                    {getSeverityIcon(a.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-white truncate">{a.title}</div>
                      <div className="text-xs text-gray-400">{getTimeAgo(a.created_at)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {complianceTrend.length > 1 && (
          <div className="lg:col-span-2 bg-gray-800 rounded-xl p-5 border border-gray-700">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-400" />
                Compliance Trend (30d)
              </h3>
              {complianceScore && (
                <div className="flex items-center gap-2">
                  {complianceScore.trend_direction === 'improving' && <TrendingUp className="w-4 h-4 text-green-400" />}
                  {complianceScore.trend_direction === 'declining' && <TrendingDown className="w-4 h-4 text-red-400" />}
                  {complianceScore.trend_direction === 'stable' && <Minus className="w-4 h-4 text-gray-400" />}
                  <span className="text-sm text-gray-400 capitalize">{complianceScore.trend_direction}</span>
                </div>
              )}
            </div>
            <div className="h-32 flex items-end justify-between gap-0.5">
              {complianceTrend.map((point, idx) => {
                const height = Math.max(2, (point.platform_score / 100) * 100);
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
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderViolations() {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h3 className="text-base font-semibold text-white mb-4">Recent Violations (24h)</h3>
        <div className="space-y-2.5 max-h-[600px] overflow-y-auto">
          {recentViolations.map(v => {
            const desc = ssotAnalyticsService.getViolationDescription(v.violation_type);
            return (
              <div key={v.id} className="p-3 bg-gray-700/40 rounded-lg border border-gray-700/50">
                <div className="flex items-start gap-2.5">
                  {getSeverityIcon(v.severity)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-white">{desc.title}</span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${getSeverityBadgeColor(v.severity)}`}>
                        {v.severity}
                      </span>
                      {desc.category === 'protective' && (
                        <span className="px-1.5 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          protective
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{desc.description}</div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{new Date(v.created_at).toLocaleString()}</span>
                      <span className="px-1.5 py-0.5 bg-gray-600 rounded">{v.component || 'unknown'}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          {recentViolations.length === 0 && (
            <div className="text-center py-12 text-gray-500">No violations in the last 24 hours</div>
          )}
        </div>
      </div>
    );
  }

  function renderAlerts() {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            Governance Alerts
            {unreadAlertCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs font-bold text-white bg-red-500 rounded-full">
                {unreadAlertCount}
              </span>
            )}
          </h3>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={alertSeverityFilter}
                onChange={(e) => setAlertSeverityFilter(e.target.value as AlertSeverity | 'ALL')}
                className="text-xs bg-gray-700 text-gray-300 border border-gray-600 rounded px-2 py-1"
              >
                <option value="ALL">All</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showDismissedAlerts}
                onChange={(e) => setShowDismissedAlerts(e.target.checked)}
                className="rounded border-gray-600 bg-gray-700"
              />
              Dismissed
            </label>
          </div>
        </div>

        <div className="space-y-2.5 max-h-[600px] overflow-y-auto">
          {filteredAlerts.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 text-green-500/50" />
              <p>No alerts to display</p>
            </div>
          ) : (
            filteredAlerts.map(a => {
              const isDismissed = a.dismissed_at !== null;
              const isUnread = !a.read_by || a.read_by.length === 0;
              return (
                <div
                  key={a.id}
                  className={`p-3 rounded-lg border transition-all ${
                    isDismissed
                      ? 'bg-gray-700/20 border-gray-700/30 opacity-50'
                      : isUnread
                      ? 'bg-gray-700/50 border-gray-600 shadow-sm'
                      : 'bg-gray-700/30 border-gray-700/50'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {getSeverityIcon(a.severity)}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{a.title}</span>
                        {isUnread && !isDismissed && (
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                        )}
                        {isDismissed && (
                          <span className="px-1.5 py-0.5 text-xs bg-gray-600 text-gray-400 rounded">Dismissed</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">{a.message}</div>
                      <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                        <span>{getTimeAgo(a.created_at)}</span>
                        {a.component_name && (
                          <span className="px-1.5 py-0.5 bg-gray-600 rounded">{a.component_name}</span>
                        )}
                      </div>
                    </div>
                    {!isDismissed && (
                      <button
                        onClick={() => handleDismissAlert(a.id)}
                        className="p-1 hover:bg-gray-600 rounded transition-colors flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5 text-gray-400" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  }

  function renderComponents() {
    return (
      <div className="space-y-6">
        <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-semibold text-white">Component Health Scores</h3>
            <button
              onClick={handleRecalculateCompliance}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors text-xs"
            >
              <Clock className="w-3.5 h-3.5" />
              Recalculate
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-2.5 px-3 text-xs font-semibold text-gray-400">Component</th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-400">Violations</th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-400">Health</th>
                  <th className="text-center py-2.5 px-3 text-xs font-semibold text-gray-400">Status</th>
                  <th className="text-right py-2.5 px-3 text-xs font-semibold text-gray-400">Last Violation</th>
                </tr>
              </thead>
              <tbody>
                {componentHealth.map((c, idx) => (
                  <tr key={idx} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-2.5 px-3 text-sm text-white">{c.component}</td>
                    <td className="py-2.5 px-3 text-sm text-center text-white">{c.violationCount}</td>
                    <td className={`py-2.5 px-3 text-sm text-center font-bold ${getHealthColor(c.healthScore)}`}>
                      {c.healthScore}
                    </td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                        c.healthScore >= 90 ? 'bg-green-500/20 text-green-400' :
                        c.healthScore >= 75 ? 'bg-lime-500/20 text-lime-400' :
                        c.healthScore >= 60 ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                      }`}>
                        {getHealthLabel(c.healthScore)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-right text-gray-400">
                      {c.lastViolation ? getTimeAgo(c.lastViolation) : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {componentHealth.length === 0 && (
              <div className="text-center py-12 text-gray-500">No component health data</div>
            )}
          </div>
        </div>

        {componentSummary.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
            <h3 className="text-base font-semibold text-white mb-4">Daily Compliance Component Health</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {componentSummary.map((c, idx) => {
                const statusColor = c.health_status === 'healthy' ? 'border-green-500/40 bg-green-500/5' :
                  c.health_status === 'warning' ? 'border-yellow-500/40 bg-yellow-500/5' :
                  c.health_status === 'critical' ? 'border-orange-500/40 bg-orange-500/5' :
                  'border-red-500/40 bg-red-500/5';
                return (
                  <div key={idx} className={`border rounded-lg p-3.5 ${statusColor}`}>
                    <div className="flex items-start justify-between mb-1.5">
                      <h4 className="text-sm font-semibold text-white truncate flex-1" title={c.component_name}>
                        {c.component_name}
                      </h4>
                      {c.trend_direction === 'improving' && <TrendingUp className="w-3.5 h-3.5 text-green-400" />}
                      {c.trend_direction === 'declining' && <TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                      {c.trend_direction === 'stable' && <Minus className="w-3.5 h-3.5 text-gray-400" />}
                    </div>
                    <div className="text-xl font-bold text-white">{c.current_health_score.toFixed(1)}</div>
                    <div className="text-xs text-gray-400 capitalize mt-0.5">{c.health_status}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {c.total_violations} violation{c.total_violations !== 1 ? 's' : ''}
                      {c.score_change !== null && c.score_change !== 0 && (
                        <span className={`ml-1.5 ${c.score_change > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          ({c.score_change > 0 ? '+' : ''}{c.score_change.toFixed(1)})
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderTrends() {
    return (
      <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
        <h3 className="text-base font-semibold text-white mb-4">Violation Trends (30d)</h3>
        <div className="space-y-2 max-h-[600px] overflow-y-auto">
          {trends.slice().reverse().map(t => (
            <div key={t.date} className="flex items-center gap-3 p-2.5 bg-gray-700/30 rounded-lg">
              <div className="w-24 text-xs text-gray-400 flex-shrink-0">{t.date}</div>
              <div className="flex-1 bg-gray-700 rounded-full h-5 overflow-hidden flex">
                {t.criticalCount > 0 && (
                  <div
                    className="bg-red-500 flex items-center justify-center text-[10px] text-white font-medium"
                    style={{ width: `${(t.criticalCount / t.count) * 100}%` }}
                  >
                    {t.criticalCount}
                  </div>
                )}
                {t.warningCount > 0 && (
                  <div
                    className="bg-yellow-500 flex items-center justify-center text-[10px] text-white font-medium"
                    style={{ width: `${(t.warningCount / t.count) * 100}%` }}
                  >
                    {t.warningCount}
                  </div>
                )}
                {t.infoCount > 0 && (
                  <div
                    className="bg-blue-500 flex items-center justify-center text-[10px] text-white font-medium"
                    style={{ width: `${(t.infoCount / t.count) * 100}%` }}
                  >
                    {t.infoCount}
                  </div>
                )}
              </div>
              <div className="w-12 text-right text-xs font-medium text-white flex-shrink-0">{t.count}</div>
            </div>
          ))}
          {trends.length === 0 && (
            <div className="text-center py-12 text-gray-500">No trend data available</div>
          )}
        </div>
        <div className="mt-4 flex items-center gap-6 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-red-500 rounded" />
            <span className="text-gray-400">Critical</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-yellow-500 rounded" />
            <span className="text-gray-400">Warning</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 bg-blue-500 rounded" />
            <span className="text-gray-400">Info</span>
          </div>
        </div>
      </div>
    );
  }
}
