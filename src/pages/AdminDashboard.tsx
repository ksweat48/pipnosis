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
import { CacheMetricsDashboard } from '@/components/CacheMetricsDashboard';
import { FreshnessGateAnalytics } from '@/components/FreshnessGateAnalytics';
import { AlphaIntelligenceTelemetry } from '@/components/AlphaIntelligenceTelemetry';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/lib/supabase';
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
  Clock,
  Users,
  MessageSquare,
  Bell,
  Layers
} from 'lucide-react';
import { UserManagementPanel } from '@/components/admin/UserManagementPanel';
import { UserFeedbackPanel } from '@/components/admin/UserFeedbackPanel';
import { PushNotificationTester } from '@/components/admin/PushNotificationTester';
import { WebSocketStatusPanel } from '@/components/admin/WebSocketStatusPanel';
import { userFeedbackService } from '@/services/user-feedback-service';

type AdminTab = 'overview' | 'data' | 'cache' | 'api-usage' | 'settings' | 'users' | 'feedback' | 'push-notifications';

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

interface CacheMetrics {
  totalHitRate: number;
  totalCallsSaved: number;
  estimatedSavings: number;
  cacheHealth: 'healthy' | 'degraded' | 'stale';
}

export function AdminDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Initialize active tab from URL hash or default to 'overview'
  const getInitialTab = (): AdminTab => {
    const hash = window.location.hash.slice(1); // Remove '#'
    const validTabs: AdminTab[] = ['overview', 'data', 'cache', 'api-usage', 'settings', 'users', 'feedback', 'push-notifications'];
    return validTabs.includes(hash as AdminTab) ? (hash as AdminTab) : 'overview';
  };

  const [activeTab, setActiveTab] = useState<AdminTab>(getInitialTab());
  const [aiMetrics, setAIMetrics] = useState<AIMetrics | null>(null);
  const [cacheMetrics, setCacheMetrics] = useState<CacheMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [newFeedbackCount, setNewFeedbackCount] = useState(0);
  const [tradingEnabled, setTradingEnabled] = useState(true);
  const [toggleLoading, setToggleLoading] = useState(false);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

  // Update URL hash when tab changes
  const handleTabChange = (tab: AdminTab) => {
    setActiveTab(tab);
    window.location.hash = tab;
  };

  useEffect(() => {
    if (user) {
      loadAIMetrics();
      loadCacheMetrics();

      // Refresh metrics every 30 seconds
      const interval = setInterval(() => {
        loadAIMetrics();
        loadCacheMetrics();
      }, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      loadNewFeedbackCount();

      const unsubscribe = userFeedbackService.subscribeToNewFeedback(() => {
        loadNewFeedbackCount();
      });

      return () => {
        unsubscribe();
      };
    }
  }, [user]);

  const loadNewFeedbackCount = async () => {
    const count = await userFeedbackService.getNewFeedbackCount();
    setNewFeedbackCount(count);
  };

  const loadTradingStatus = async () => {
    try {
      const { data } = await supabase
        .from('platform_settings')
        .select('setting_value')
        .eq('setting_key', 'trading_enabled')
        .single();

      if (data) {
        setTradingEnabled(data.setting_value as boolean);
      }
    } catch (error) {
      console.error('Error loading trading status:', error);
    }
  };

  const toggleTrading = async () => {
    try {
      setToggleLoading(true);
      const { data, error } = await supabase.rpc('toggle_platform_trading', {
        enabled: !tradingEnabled
      });

      if (error) throw error;

      setTradingEnabled(!tradingEnabled);
    } catch (error) {
      console.error('Error toggling trading:', error);
      alert('Failed to toggle trading. Please try again.');
    } finally {
      setToggleLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      loadTradingStatus();
    }
  }, [user]);

  const loadAIMetrics = async () => {
    if (!user) return;

    try {
      setLoading(true);

      // Platform-wide metrics - aggregate ALL users

      // Get platform-wide skill tracking
      const { data: skillData } = await supabase
        .from('ai_skill_tracking')
        .select('skill_level, updated_at')
        .order('updated_at', { ascending: false });

      // Calculate average skill level across all users (latest entry per user)
      const userSkillMap = new Map();
      skillData?.forEach(skill => {
        if (!userSkillMap.has(skill.updated_at)) {
          userSkillMap.set(skill.updated_at, skill.skill_level);
        }
      });

      const skillLevels = Array.from(userSkillMap.values());
      const currentSkillLevel = skillLevels.length > 0
        ? skillLevels.reduce((sum, level) => sum + level, 0) / skillLevels.length
        : 0;

      const previousSkillLevels = skillLevels.slice(0, Math.min(skillLevels.length, 10));
      const previousSkillLevel = previousSkillLevels.length > 0
        ? previousSkillLevels.reduce((sum, level) => sum + level, 0) / previousSkillLevels.length
        : 0;

      // Get total goal sessions across all users
      const { count: goalSessionsCount } = await supabase
        .from('goal_sessions')
        .select('id', { count: 'exact', head: true });

      // Get total goal session trades
      const { count: goalTradesCount } = await supabase
        .from('goal_session_trades')
        .select('id', { count: 'exact', head: true });

      // Get learning insights from all users
      const { count: insightsCount } = await supabase
        .from('ai_learning_insights')
        .select('id', { count: 'exact', head: true });

      // Get pattern discoveries from all users
      const { count: patternsCount } = await supabase
        .from('ai_pattern_discoveries')
        .select('id', { count: 'exact', head: true });

      // Get recent goal trades (last 24 hours) for win rate calculation
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentTrades } = await supabase
        .from('goal_session_trades')
        .select('profit_loss, status')
        .gte('created_at', oneDayAgo)
        .eq('status', 'closed');

      const winningTrades = recentTrades?.filter(t => (t.profit_loss || 0) > 0).length || 0;
      const totalTrades = recentTrades?.length || 0;
      const avgWinRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

      setAIMetrics({
        skillLevel: currentSkillLevel,
        totalBacktests: goalSessionsCount || 0,
        autoBacktests: goalTradesCount || 0,
        learningInsights: insightsCount || 0,
        patternDiscoveries: patternsCount || 0,
        avgWinRate,
        isAutoRunning: false,
        currentBacktestNumber: 0,
        skillLevelChange: currentSkillLevel - previousSkillLevel,
        recentSessionsCount: totalTrades
      });
    } catch (error) {
      console.error('[Admin Dashboard] Error loading AI metrics:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCacheMetrics = async () => {
    if (!user) return;

    try {
      const { data: stats, error } = await supabase.rpc('get_cache_stats', { p_hours: 24 });

      if (error) {
        console.error('[Admin Dashboard] Error loading cache stats:', error);
        return;
      }

      if (!stats || stats.length === 0) {
        setCacheMetrics({
          totalHitRate: 0,
          totalCallsSaved: 0,
          estimatedSavings: 0,
          cacheHealth: 'stale'
        });
        return;
      }

      const totalLookups = stats.reduce((sum: number, s: any) => sum + (s.total_lookups || 0), 0);
      const totalHits = stats.reduce((sum: number, s: any) => sum + (s.cache_hits || 0), 0);
      const totalSaved = stats.reduce((sum: number, s: any) => sum + (s.total_llm_calls_saved || 0), 0);
      const hitRate = totalLookups > 0 ? (totalHits / totalLookups) * 100 : 0;
      const estimatedSavings = totalSaved * 0.002;

      let health: 'healthy' | 'degraded' | 'stale' = 'healthy';
      if (hitRate < 50) health = 'degraded';
      if (hitRate < 20) health = 'stale';

      setCacheMetrics({
        totalHitRate: hitRate,
        totalCallsSaved: totalSaved,
        estimatedSavings: estimatedSavings,
        cacheHealth: health
      });
    } catch (error) {
      console.error('[Admin Dashboard] Error loading cache metrics:', error);
    }
  };

  const handleToggleAutoBacktest = async () => {
    // Backtest system removed - using goal sessions only
    console.log('[Admin Dashboard] Auto-backtest system removed');
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
      <main className="w-full max-w-7xl mx-auto px-3 sm:px-4 md:px-6 py-4 md:py-8">
        <div className="flex items-center justify-between mb-4 md:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-white">Admin Dashboard</h1>
        </div>

        <div className="flex gap-1.5 sm:gap-2 mb-4 md:mb-6 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-700 scrollbar-track-gray-900">
          <button
            onClick={() => handleTabChange('overview')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'overview'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Brain size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden xs:inline">AI Overview</span>
            <span className="xs:hidden">AI</span>
          </button>
          <button
            onClick={() => handleTabChange('users')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'users'
                ? 'bg-amber-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Users size={16} className="sm:w-[18px] sm:h-[18px]" />
            Users
          </button>
          <button
            onClick={() => handleTabChange('data')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'data'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Database size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden xs:inline">Data Management</span>
            <span className="xs:hidden">Data</span>
          </button>
          <button
            onClick={() => handleTabChange('api-usage')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'api-usage'
                ? 'bg-emerald-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Activity size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden xs:inline">API Usage</span>
            <span className="xs:hidden">API</span>
          </button>
          <button
            onClick={() => handleTabChange('cache')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'cache'
                ? 'bg-cyan-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Layers size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden sm:inline">Cache Intelligence</span>
            <span className="sm:hidden">Cache</span>
          </button>
          <button
            onClick={() => handleTabChange('feedback')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 relative text-xs sm:text-sm ${
              activeTab === 'feedback'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <MessageSquare size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden xs:inline">Feedback</span>
            {newFeedbackCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                {newFeedbackCount}
              </span>
            )}
          </button>
          <button
            onClick={() => handleTabChange('push-notifications')}
            className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap flex-shrink-0 text-xs sm:text-sm ${
              activeTab === 'push-notifications'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            <Bell size={16} className="sm:w-[18px] sm:h-[18px]" />
            <span className="hidden sm:inline">Push Notifications</span>
            <span className="sm:hidden">Push</span>
          </button>
        </div>

        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Platform Trading Control - ADMIN ONLY */}
            <div className={`border-2 rounded-xl p-6 ${
              tradingEnabled
                ? 'bg-gradient-to-r from-green-900/30 to-emerald-900/30 border-green-500/30'
                : 'bg-gradient-to-r from-red-900/30 to-orange-900/30 border-red-500/30'
            }`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-lg ${tradingEnabled ? 'bg-green-600/20' : 'bg-red-600/20'}`}>
                    {tradingEnabled ? (
                      <Play className="w-8 h-8 text-green-400" />
                    ) : (
                      <Pause className="w-8 h-8 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-white mb-1">
                      Platform Trading: {tradingEnabled ? 'ENABLED' : 'DISABLED'}
                    </h3>
                    <p className={tradingEnabled ? 'text-green-200' : 'text-red-200'}>
                      {tradingEnabled
                        ? 'Users can start goal sessions and trade normally'
                        : 'All users blocked from starting sessions - Maintenance mode active'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleTrading}
                  disabled={toggleLoading}
                  className={`px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2 ${
                    tradingEnabled
                      ? 'bg-red-600 hover:bg-red-700 text-white'
                      : 'bg-green-600 hover:bg-green-700 text-white'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {toggleLoading ? (
                    <>
                      <Clock className="w-5 h-5 animate-spin" />
                      Processing...
                    </>
                  ) : tradingEnabled ? (
                    <>
                      <Pause size={18} />
                      Disable Trading
                    </>
                  ) : (
                    <>
                      <Play size={18} />
                      Enable Trading
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Pipnosis Mastery Curve - TOP PRIORITY */}
            <PipnosisMasteryCurve userId={null} />

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
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
                  <MetricCard
                    title="Platform Skill Level"
                    value={`${aiMetrics.skillLevel.toFixed(1)}%`}
                    icon={Brain}
                    color="blue"
                    trend={aiMetrics.skillLevelChange > 0 ? 'up' : aiMetrics.skillLevelChange < 0 ? 'down' : 'neutral'}
                    subtitle={`${aiMetrics.skillLevelChange >= 0 ? '+' : ''}${aiMetrics.skillLevelChange.toFixed(1)}% change`}
                  />
                  <MetricCard
                    title="Total Goal Sessions"
                    value={aiMetrics.totalBacktests.toString()}
                    icon={Activity}
                    color="green"
                    subtitle={`${aiMetrics.autoBacktests} total trades`}
                  />
                  <MetricCard
                    title="Learning Insights"
                    value={aiMetrics.learningInsights.toString()}
                    icon={Sparkles}
                    color="purple"
                    subtitle={`${aiMetrics.patternDiscoveries} patterns found`}
                  />
                  <MetricCard
                    title="24h Win Rate (All Users)"
                    value={`${aiMetrics.avgWinRate.toFixed(1)}%`}
                    icon={Target}
                    color={aiMetrics.avgWinRate >= 55 ? 'green' : 'amber'}
                    subtitle={`${aiMetrics.recentSessionsCount} trades`}
                  />
                </div>

                {/* Cache Intelligence Overview */}
                {cacheMetrics && (
                  <div className="bg-gradient-to-br from-cyan-600/20 to-cyan-800/20 backdrop-blur-sm border-2 border-cyan-500/30 rounded-xl p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="p-3 bg-gray-900/50 rounded-lg">
                          <Layers className="text-cyan-400" size={28} />
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-white">Intelligence Cache Performance</h3>
                          <p className="text-cyan-200 text-sm">Regime-based Alpha caching + three-tier Omega system</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleTabChange('cache')}
                        className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-all flex items-center gap-2"
                      >
                        View Details
                        <ArrowRight size={16} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-gray-900/30 rounded-lg p-4">
                        <div className="text-cyan-300 text-sm mb-1">Cache Hit Rate</div>
                        <div className="text-white text-2xl font-bold">{cacheMetrics.totalHitRate.toFixed(1)}%</div>
                        <div className={`text-xs mt-1 ${
                          cacheMetrics.cacheHealth === 'healthy' ? 'text-emerald-400' :
                          cacheMetrics.cacheHealth === 'degraded' ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {cacheMetrics.cacheHealth === 'healthy' ? 'Healthy' :
                           cacheMetrics.cacheHealth === 'degraded' ? 'Degraded' : 'Needs Warming'}
                        </div>
                      </div>
                      <div className="bg-gray-900/30 rounded-lg p-4">
                        <div className="text-cyan-300 text-sm mb-1">LLM Calls Saved</div>
                        <div className="text-white text-2xl font-bold">{cacheMetrics.totalCallsSaved.toLocaleString()}</div>
                        <div className="text-emerald-400 text-xs mt-1">Last 24 hours</div>
                      </div>
                      <div className="bg-gray-900/30 rounded-lg p-4">
                        <div className="text-cyan-300 text-sm mb-1">Estimated Savings</div>
                        <div className="text-white text-2xl font-bold">${cacheMetrics.estimatedSavings.toFixed(2)}</div>
                        <div className="text-emerald-400 text-xs mt-1">Cost reduction</div>
                      </div>
                      <div className="bg-gray-900/30 rounded-lg p-4">
                        <div className="text-cyan-300 text-sm mb-1">Cache Systems</div>
                        <div className="text-white text-2xl font-bold">2</div>
                        <div className="text-cyan-400 text-xs mt-1">Regime + Three-Tier</div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Quick Actions */}
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Zap className="text-yellow-400" size={24} />
                Quick Actions
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                <QuickActionCard
                  title="Cache Intelligence"
                  description="Monitor three-tier LLM cache performance and savings"
                  icon={Layers}
                  color="cyan"
                  onClick={() => handleTabChange('cache')}
                />
                <QuickActionCard
                  title="API Usage & KPIs"
                  description="Monitor API usage and performance metrics"
                  icon={BarChart3}
                  color="emerald"
                  onClick={() => handleTabChange('api-usage')}
                />
                <QuickActionCard
                  title="Data Management"
                  description="Manage historical data and backfills"
                  icon={Database}
                  color="blue"
                  onClick={() => handleTabChange('data')}
                />
                <QuickActionCard
                  title="Backtest Lab"
                  description="Run backtests and generate learning insights"
                  icon={Brain}
                  color="purple"
                  onClick={() => navigate('/admin/ai-training')}
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ServerSidePollingMonitor />
              <WebSocketStatusPanel />
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

        {activeTab === 'cache' && (
          <div className="space-y-6">
            {/* Regime-Based Alpha Thesis Cache */}
            <div className="bg-gradient-to-br from-blue-600/20 to-blue-800/20 backdrop-blur-sm border-2 border-blue-500/30 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Activity size={24} className="text-blue-400" />
                <div>
                  <h2 className="text-2xl font-semibold text-white">Alpha Thesis Cache (Regime-Based)</h2>
                  <p className="text-gray-400 text-sm mt-1">
                    Intelligent thesis caching using market regime fingerprints (HTF bias, micro regime, volatility, structure)
                  </p>
                </div>
              </div>
              <AlphaIntelligenceTelemetry />
            </div>

            {/* Three-Tier Omega Cache */}
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Layers size={24} className="text-cyan-400" />
                <div>
                  <h2 className="text-2xl font-semibold text-white">Three-Tier Intelligence Cache (Legacy)</h2>
                  <p className="text-gray-400 text-sm mt-1">Platform-wide LLM response caching for Omega council and scout operations</p>
                </div>
              </div>
              <CacheMetricsDashboard />
            </div>

            {/* Freshness Gate */}
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <Layers size={24} className="text-emerald-400" />
                <div>
                  <h2 className="text-2xl font-semibold text-white">Freshness Gate Analytics</h2>
                  <p className="text-gray-400 text-sm mt-1">Real-time monitoring of cache freshness validation and auto-refresh performance</p>
                </div>
              </div>
              <FreshnessGateAnalytics hours={24} />
            </div>
          </div>
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <UserManagementPanel />
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="space-y-6">
            <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-6">
                <MessageSquare size={24} className="text-purple-400" />
                <h2 className="text-2xl font-semibold text-white">User Feedback</h2>
              </div>
              <UserFeedbackPanel />
            </div>
          </div>
        )}

        {activeTab === 'push-notifications' && (
          <div className="space-y-6">
            <PushNotificationTester />
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
    <div className={`bg-gradient-to-br ${colorClasses[color]} backdrop-blur-sm border-2 rounded-xl p-4 sm:p-5 md:p-6 hover:scale-105 transition-transform`}>
      <div className="flex items-start justify-between mb-2 sm:mb-3">
        <div className="p-2 sm:p-3 bg-gray-900/50 rounded-lg">
          <Icon className={iconColorClasses[color]} size={20} />
        </div>
        {trend && (
          <div className={`text-xs font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${
            trend === 'up' ? 'bg-green-500/20 text-green-400' :
            trend === 'down' ? 'bg-red-500/20 text-red-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'}
          </div>
        )}
      </div>
      <div className="text-gray-300 text-xs sm:text-sm mb-1">{title}</div>
      <div className="text-white text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">{value}</div>
      {subtitle && <div className="text-gray-400 text-[10px] sm:text-xs">{subtitle}</div>}
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
