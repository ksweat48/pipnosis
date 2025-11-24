import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import {
  DollarSign,
  Zap,
  Clock,
  TrendingUp,
  Activity,
  AlertTriangle,
  CheckCircle,
  XCircle,
  BarChart3,
  Brain
} from 'lucide-react';

interface CostSummary {
  today_cost: number;
  this_week_cost: number;
  this_month_cost: number;
  all_time_cost: number;
  today_calls: number;
  this_week_calls: number;
  this_month_calls: number;
  all_time_calls: number;
}

interface RateLimitInfo {
  hourly_count: number;
  daily_count: number;
  hourly_limit: number;
  daily_limit: number;
  hourly_reset_at: string;
  daily_reset_at: string;
  is_blocked: boolean;
}

interface RecentLog {
  id: string;
  model: string;
  total_tokens: number;
  cost_usd: number;
  request_type: string;
  endpoint: string;
  success: boolean;
  created_at: string;
  latency_ms: number;
}

interface ModelUsage {
  model: string;
  calls: number;
  cost: number;
  tokens: number;
}

export function OpenAIUsageDashboard() {
  const { user } = useAuth();
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [rateLimits, setRateLimits] = useState<RateLimitInfo | null>(null);
  const [recentLogs, setRecentLogs] = useState<RecentLog[]>([]);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) {
      loadUsageData();
      const interval = setInterval(loadUsageData, 30000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const loadUsageData = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const { data: summary } = await supabase
        .from('openai_cost_summary')
        .select('*')
        .eq('user_id', user.id)
        .single();

      setCostSummary(summary);

      const { data: limits } = await supabase
        .from('openai_rate_limits')
        .select('*')
        .eq('user_id', user.id)
        .single();

      setRateLimits(limits);

      const { data: logs } = await supabase
        .from('openai_usage_log')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(10);

      setRecentLogs(logs || []);

      const { data: usage } = await supabase
        .from('openai_usage_log')
        .select('model, total_tokens, cost_usd')
        .eq('user_id', user.id)
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

      if (usage) {
        const grouped = usage.reduce((acc: Record<string, ModelUsage>, log) => {
          if (!acc[log.model]) {
            acc[log.model] = { model: log.model, calls: 0, cost: 0, tokens: 0 };
          }
          acc[log.model].calls++;
          acc[log.model].cost += log.cost_usd;
          acc[log.model].tokens += log.total_tokens;
          return acc;
        }, {});
        setModelUsage(Object.values(grouped));
      }

      setLoading(false);
    } catch (error) {
      console.error('Failed to load usage data:', error);
      setLoading(false);
    }
  };

  const getHourlyPercentage = () => {
    if (!rateLimits) return 0;
    return (rateLimits.hourly_count / rateLimits.hourly_limit) * 100;
  };

  const getDailyPercentage = () => {
    if (!rateLimits) return 0;
    return (rateLimits.daily_count / rateLimits.daily_limit) * 100;
  };

  const formatCost = (cost: number) => {
    return `$${cost.toFixed(4)}`;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <Brain className="w-8 h-8 text-blue-400" />
        <div>
          <h2 className="text-2xl font-bold text-white">OpenAI Usage Dashboard</h2>
          <p className="text-gray-400">Monitor API costs, rate limits, and usage patterns</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <CostMetricCard
          title="Today"
          cost={costSummary?.today_cost || 0}
          calls={costSummary?.today_calls || 0}
          icon={DollarSign}
          color="blue"
        />
        <CostMetricCard
          title="This Week"
          cost={costSummary?.this_week_cost || 0}
          calls={costSummary?.this_week_calls || 0}
          icon={TrendingUp}
          color="green"
        />
        <CostMetricCard
          title="This Month"
          cost={costSummary?.this_month_cost || 0}
          calls={costSummary?.this_month_calls || 0}
          icon={BarChart3}
          color="purple"
        />
        <CostMetricCard
          title="All Time"
          cost={costSummary?.all_time_cost || 0}
          calls={costSummary?.all_time_calls || 0}
          icon={Activity}
          color="amber"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <Zap className="w-6 h-6 text-yellow-400" />
            <h3 className="text-lg font-bold text-white">Rate Limits</h3>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Hourly Usage</span>
                <span className="text-sm font-medium text-white">
                  {rateLimits?.hourly_count || 0} / {rateLimits?.hourly_limit || 100}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    getHourlyPercentage() > 90
                      ? 'bg-red-500'
                      : getHourlyPercentage() > 70
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(getHourlyPercentage(), 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Resets in {Math.ceil((new Date(rateLimits?.hourly_reset_at || '').getTime() - Date.now()) / 60000)} minutes
              </p>
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-400">Daily Usage</span>
                <span className="text-sm font-medium text-white">
                  {rateLimits?.daily_count || 0} / {rateLimits?.daily_limit || 500}
                </span>
              </div>
              <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                <div
                  className={`h-full transition-all ${
                    getDailyPercentage() > 90
                      ? 'bg-red-500'
                      : getDailyPercentage() > 70
                      ? 'bg-yellow-500'
                      : 'bg-green-500'
                  }`}
                  style={{ width: `${Math.min(getDailyPercentage(), 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Resets at midnight
              </p>
            </div>

            {rateLimits?.is_blocked && (
              <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-red-400">Access Blocked</p>
                  <p className="text-xs text-red-300 mt-1">
                    Your API access has been temporarily blocked. Contact support if this is unexpected.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-center gap-3 mb-4">
            <BarChart3 className="w-6 h-6 text-purple-400" />
            <h3 className="text-lg font-bold text-white">Usage by Model (7 days)</h3>
          </div>

          {modelUsage.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">No usage data yet</p>
          ) : (
            <div className="space-y-3">
              {modelUsage.map((model) => (
                <div key={model.model} className="bg-gray-900/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-white">{model.model}</span>
                    <span className="text-sm text-gray-400">{formatCost(model.cost)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <span>{model.calls} calls</span>
                    <span>{model.tokens.toLocaleString()} tokens</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
        <div className="flex items-center gap-3 mb-4">
          <Clock className="w-6 h-6 text-blue-400" />
          <h3 className="text-lg font-bold text-white">Recent API Calls</h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">Time</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">Model</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-gray-400 uppercase">Type</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-400 uppercase">Tokens</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-400 uppercase">Cost</th>
                <th className="text-right py-3 px-4 text-xs font-medium text-gray-400 uppercase">Latency</th>
                <th className="text-center py-3 px-4 text-xs font-medium text-gray-400 uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-400">
                    No API calls yet
                  </td>
                </tr>
              ) : (
                recentLogs.map((log) => (
                  <tr key={log.id} className="border-b border-gray-700/50 hover:bg-gray-700/20">
                    <td className="py-3 px-4 text-sm text-gray-300">
                      {formatTime(log.created_at)}
                    </td>
                    <td className="py-3 px-4 text-sm text-white font-medium">
                      {log.model}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400">
                      {log.request_type || log.endpoint}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-300 text-right">
                      {log.total_tokens.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-300 text-right">
                      {formatCost(log.cost_usd)}
                    </td>
                    <td className="py-3 px-4 text-sm text-gray-400 text-right">
                      {log.latency_ms}ms
                    </td>
                    <td className="py-3 px-4 text-center">
                      {log.success ? (
                        <CheckCircle className="w-5 h-5 text-green-400 inline-block" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400 inline-block" />
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

interface CostMetricCardProps {
  title: string;
  cost: number;
  calls: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'purple' | 'amber';
}

function CostMetricCard({ title, cost, calls, icon: Icon, color }: CostMetricCardProps) {
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
      </div>
      <div className="text-gray-300 text-sm mb-1">{title}</div>
      <div className="text-white text-3xl font-bold mb-2">${cost.toFixed(4)}</div>
      <div className="text-gray-400 text-sm">{calls.toLocaleString()} calls</div>
    </div>
  );
}
