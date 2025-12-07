import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { DataManagementPanel } from '@/components/DataManagementPanel';
import { CandleAggregatorStatus } from '@/components/CandleAggregatorStatus';
import APIUsageMonitor from '@/components/APIUsageMonitor';
import { GlobalPollingStatus } from '@/components/GlobalPollingStatus';
import { PollingPreferences } from '@/components/PollingPreferences';
import { PipnosisMasteryCurve } from '@/components/PipnosisMasteryCurve';
import { OpenAIUsageDashboard } from '@/components/OpenAIUsageDashboard';
import { ServerSidePollingMonitor } from '@/components/ServerSidePollingMonitor';
import { LLMTokenUsageDashboard } from '@/components/LLMTokenUsageDashboard';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
import { simpleAutoBacktestService } from '@/services/simple-auto-backtest-service';
import {
  Database,
  BarChart3,
  Settings,
  Activity,
  Brain,
  Zap,
  Target,
  Sparkles,
  ArrowRight,
  Play,
  Pause,
  CheckCircle,
  AlertCircle,
  Clock
} from 'lucide-react';

type AdminTab = 'overview' | 'data' | 'api-usage' | 'settings';

interface AIMetrics {
  skillLevel: number;
  totalBacktests: number;
  autoBacktests: number;
  learningInsights: number;
  patternDiscoveries: number;
  avgWinRate: number;
  isAutoRunning: boolean;
  currentBacktestNumber: number;
  skillLevelChange: number;
  recentSessionsCount: number;
}

export function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');
  const [aiMetrics, setAIMetrics] = useState<AIMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  useEffect(() => {
    if (user) {
      loadAIMetrics();

      // Refresh metrics every 30 seconds
      const interval = setInterval(loadAIMetrics, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadAIMetrics = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Get auto-backtest status
      const autoState = await simpleAutoBacktestService.getState();

      // Get skill tracking
      const { data: skillData } = await supabase
        .from('ai_skill_tracking')
        .select('skill_level')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })
        .limit(2);

      const currentSkillLevel = skillData?.[0]?.skill_level || 0;
      const previousSkillLevel = skillData?.[1]?.skill_level || 0;

      // Get backtest counts
      const { count: realCount } = await supabase
        .from('backtest_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      const { count: syntheticCount } = await supabase
        .from('synthetic_backtest_sessions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get auto-backtest count
      const { data: autoSessions } = await supabase
        .from('backtest_sessions')
        .select('session_name')
        .eq('user_id', user.id)
        .like('session_name', 'Auto-BT-%');

      const { data: autoSynthetic } = await supabase
        .from('synthetic_backtest_sessions')
        .select('session_name')
        .eq('user_id', user.id)
        .like('session_name', 'Auto-BT-%');

      // Get learning insights
      const { count: insightsCount } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get pattern discoveries
      const { count: patternsCount } = await supabase
        .from('ai_pattern_discoveries')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);

      // Get recent sessions (last 24 hours)
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentSessions } = await supabase
        .from('backtest_sessions')
        .select('win_rate')
        .eq('user_id', user.id)
        .gte('created_at', oneDayAgo);

      const avgWinRate = recentSessions && recentSessions.length > 0
        ? recentSessions.reduce((sum, s) => sum + s.win_rate, 0) / recentSessions.length
        : 0;

      setAIMetrics({
        skillLevel: currentSkillLevel,
        totalBacktests: (realCount || 0) + (syntheticCount || 0),
        autoBacktests: (autoSessions?.length || 0) + (autoSynthetic?.length || 0),
        learningInsights: insightsCount || 0,
        patternDiscoveries: patternsCount || 0,
        avgWinRate,
        isAutoRunning: autoState.isRunning,
        currentBacktestNumber: autoState.currentBacktestNumber,
        skillLevelChange: currentSkillLevel - previousSkillLevel,
        recentSessionsCount: recentSessions?.length || 0
      });
    } catch (error) {
      console.error('[Admin Dashboard] Error loading AI metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleAutoBacktest = async () => {
    if (!aiMetrics) return;

    try {
      if (aiMetrics.isAutoRunning) {
        await simpleAutoBacktestService.stop();
      } else {
        await simpleAutoBacktestService.start();
      }
      await loadAIMetrics();
    } catch (error) {
      console.error('[Admin Dashboard] Error toggling auto-backtest:', error);
    }
  };

  return (
    <div className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950" ref={pullToRefresh.containerRef}>
      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          {activeTab === 'overview' && aiMetrics && (
            <button
              onClick={handleToggleAutoBacktest}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${
                aiMetrics.isAutoRunning
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : 'bg-green-600 hover:bg-green-700 text-white'
              }`}
            >
              {aiMetrics.isAutoRunning ? (
                <>
                  <Pause size={18} />
                  Stop Auto-Training
                </>
              ) : (
                <>
                  <Play size={18} />
                  Start Auto-Training
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex gap-2 mb-6 overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Brain size={18} />
            AI Overview
          </button>
          <button
            onClick={() => setActiveTab('data')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'data'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Database size={18} />
            Data Management
          </button>
          <button
            onClick={() => setActiveTab('api-usage')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'api-usage'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Activity size={18} />
            API Usage
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Settings size={18} />
            Settings
          </button>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Pipnosis Mastery Curve - TOP PRIORITY */}
            <PipnosisMasteryCurve userId={user?.id || null} />

            {/* AI Training Status Banner */}
            {aiMetrics?.isAutoRunning && (
              <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border-2 border-green-500/30 rounded-xl p-6">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-600/20 rounded-lg">
                    <Zap className="w-8 h-8 text-green-400 animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-1">Auto-Training Active</h3>
                    <p className="text-green-200">
                      Currently running backtest #{aiMetrics.currentBacktestNumber} • AI is learning in real-time
                    </p>
                  </div>
                  <button
                    onClick={handleToggleAutoBacktest}
                    className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-all flex items-center gap-2"
                  >
                    <Pause size={18} />
                    Stop Training
                  </button>
                </div>
              </div>
            )}

            {/* AI Metrics Grid */}
            {!loading && aiMetrics && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <MetricCard
                  title="AI Skill Level"
                  value={`${aiMetrics.skillLevel}%`}
                  icon={Brain}
                  color="blue"
                  trend={aiMetrics.skillLevelChange > 0 ? 'up' : aiMetrics.skillLevelChange < 0 ? 'down' : 'neutral'}
                  subtitle={`${aiMetrics.skillLevelChange >= 0 ? '+' : ''}${aiMetrics.skillLevelChange.toFixed(1)}% change`}
                />
                <MetricCard
                  title="Training Sessions"
                  value={aiMetrics.totalBacktests.toString()}
                  icon={Activity}
                  color="green"
                  subtitle={`${aiMetrics.autoBacktests} automated`}
                />
                <MetricCard
                  title="Learning Insights"
                  value={aiMetrics.learningInsights.toString()}
                  icon={Sparkles}
                  color="purple"
                  subtitle={`${aiMetrics.patternDiscoveries} patterns found`}
                />
                <MetricCard
                  title="24h Win Rate"
                  value={`${aiMetrics.avgWinRate.toFixed(1)}%`}
                  icon={Target}
                  color={aiMetrics.avgWinRate >= 55 ? 'green' : 'amber'}
                  subtitle={`${aiMetrics.recentSessionsCount} sessions`}
                />
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Zap className="text-yellow-400" size={24} />
                Quick Actions
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <QuickActionCard
                  title="Backtest Lab"
                  description="Run backtests and generate learning insights"
                  icon={Brain}
                  color="blue"
                  onClick={() => navigate('/admin/ai-training')}
                />
                <QuickActionCard
                  title="API Usage & KPIs"
                  description="Monitor API usage and performance metrics"
                  icon={BarChart3}
                  color="emerald"
                  onClick={() => setActiveTab('api-usage')}
                />
                <QuickActionCard
                  title="Data Management"
                  description="Manage historical data and backfills"
                  icon={Database}
                  color="cyan"
                  onClick={() => setActiveTab('data')}
                />
              </div>
            </div>


            {/* System Health Overview */}
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Activity className="text-emerald-400" size={24} />
                System Health
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <HealthStatusCard
                  label="Auto-Training"
                  status={aiMetrics?.isAutoRunning ? 'active' : 'idle'}
                  details={aiMetrics?.isAutoRunning ? `Run #${aiMetrics.currentBacktestNumber}` : 'Ready to start'}
                />
                <HealthStatusCard
                  label="Learning Pipeline"
                  status={aiMetrics && aiMetrics.learningInsights > 0 ? 'active' : 'idle'}
                  details={`${aiMetrics?.learningInsights || 0} insights generated`}
                />
                <HealthStatusCard
                  label="Pattern Detection"
                  status={aiMetrics && aiMetrics.patternDiscoveries > 0 ? 'active' : 'idle'}
                  details={`${aiMetrics?.patternDiscoveries || 0} patterns tracked`}
                />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-6">
              <ServerSidePollingMonitor />
            </div>
            <div className="grid grid-cols-1 gap-6">
              <CandleAggregatorStatus />
            </div>
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Activity size={20} className="text-emerald-400" />
                <h2 className="text-xl font-semibold text-white">System Monitoring</h2>
              </div>
              <GlobalPollingStatus />
            </div>
            <DataManagementPanel />
          </div>
        )}

        {activeTab === 'api-usage' && (
          <div className="space-y-6">
            <LLMTokenUsageDashboard />
            <OpenAIUsageDashboard />
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-12 text-center">
            <Settings className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">Settings</h3>
            <p className="text-gray-400">
              Advanced system settings and configuration options coming soon
            </p>
          </div>
        )}
      </main>
      <BottomNavigation />
    </div>
  );
}

interface MetricCardProps {
  title: string;
  value: string;
  icon: React.ElementType;
  color: string;
  trend?: 'up' | 'down' | 'neutral';
  subtitle?: string;
}

function MetricCard({ title, value, icon: Icon, color, trend, subtitle }: MetricCardProps) {
  const colorClasses: Record<string, string> = {
    blue: 'from-blue-600/20 to-blue-800/20 border-blue-500/30',
    green: 'from-green-600/20 to-green-800/20 border-green-500/30',
    purple: 'from-purple-600/20 to-purple-800/20 border-purple-500/30',
    amber: 'from-amber-600/20 to-amber-800/20 border-amber-500/30',
  };

  const iconColorClasses: Record<string, string> = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    purple: 'text-purple-400',
    amber: 'text-amber-400',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} backdrop-blur-sm border-2 rounded-xl p-6 hover:scale-105 transition-transform`}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-3 bg-gray-900/50 rounded-lg">
          <Icon className={iconColorClasses[color]} size={24} />
        </div>
        {trend && (
          <div className={`text-xs font-semibold px-2 py-1 rounded ${
            trend === 'up' ? 'bg-green-500/20 text-green-400' :
            trend === 'down' ? 'bg-red-500/20 text-red-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </div>
        )}
      </div>
      <div className="text-gray-300 text-sm mb-1">{title}</div>
      <div className="text-white text-3xl font-bold mb-2">{value}</div>
      {subtitle && <div className="text-gray-400 text-xs">{subtitle}</div>}
    </div>
  );
}

interface QuickActionCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  color: string;
  onClick: () => void;
}

function QuickActionCard({ title, description, icon: Icon, color, onClick }: QuickActionCardProps) {
  const colorClasses: Record<string, string> = {
    blue: 'bg-blue-600/10 border-blue-500/30 hover:bg-blue-600/20',
    purple: 'bg-purple-600/10 border-purple-500/30 hover:bg-purple-600/20',
    cyan: 'bg-cyan-600/10 border-cyan-500/30 hover:bg-cyan-600/20',
    emerald: 'bg-emerald-600/10 border-emerald-500/30 hover:bg-emerald-600/20',
  };

  const iconColorClasses: Record<string, string> = {
    blue: 'text-blue-400',
    purple: 'text-purple-400',
    cyan: 'text-cyan-400',
    emerald: 'text-emerald-400',
  };

  return (
    <button
      onClick={onClick}
      className={`${colorClasses[color]} border-2 rounded-xl p-4 transition-all text-left group`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-gray-900/50 rounded-lg">
          <Icon className={iconColorClasses[color]} size={20} />
        </div>
        <ArrowRight className="text-gray-400 group-hover:text-white group-hover:translate-x-1 transition-all" size={20} />
      </div>
      <h3 className="text-white font-semibold mb-1">{title}</h3>
      <p className="text-gray-400 text-sm">{description}</p>
    </button>
  );
}

interface HealthStatusCardProps {
  label: string;
  status: 'active' | 'idle' | 'error';
  details: string;
}

function HealthStatusCard({ label, status, details }: HealthStatusCardProps) {
  const statusConfig = {
    active: {
      icon: CheckCircle,
      color: 'text-green-400',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30'
    },
    idle: {
      icon: Clock,
      color: 'text-gray-400',
      bgColor: 'bg-gray-500/10',
      borderColor: 'border-gray-500/30'
    },
    error: {
      icon: AlertCircle,
      color: 'text-red-400',
      bgColor: 'bg-red-500/10',
      borderColor: 'border-red-500/30'
    }
  };

  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={`${config.bgColor} border-2 ${config.borderColor} rounded-lg p-4`}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className={config.color} size={20} />
        <span className="text-white font-semibold">{label}</span>
      </div>
      <p className="text-gray-400 text-sm">{details}</p>
    </div>
  );
}
