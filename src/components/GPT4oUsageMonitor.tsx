import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Activity, DollarSign, Zap, AlertTriangle, CheckCircle, XCircle } from 'lucide-react';

interface UsageStats {
  todayTokens: number;
  todayCost: number;
  weeklyTokens: number;
  weeklyCost: number;
  serviceStatus: {
    patternInterpreter: boolean;
    metaLearningStrategist: boolean;
    autonomousReasoning: boolean;
  };
  recentCalls: {
    service: string;
    timestamp: string;
    tokens: number;
    success: boolean;
    error?: string;
  }[];
}

export default function GPT4oUsageMonitor() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCount, setErrorCount] = useState(0);
  const [isDisabled, setIsDisabled] = useState(false);

  useEffect(() => {
    loadUsageStats();
    const interval = setInterval(loadUsageStats, 60000); // Refresh every 60 seconds (reduced from 30)
    return () => clearInterval(interval);
  }, []);

  const loadUsageStats = async () => {
    // Circuit breaker: stop polling after 5 consecutive errors
    if (isDisabled) {
      console.log('[GPT4o Monitor] Disabled due to repeated errors');
      return;
    }

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      // Get usage statistics - note: using called_at not created_at
      const { data: usage, error } = await supabase
        .from('gpt4o_usage_tracking')
        .select('*')
        .eq('user_id', user.id)
        .gte('called_at', weekAgo.toISOString())
        .order('called_at', { ascending: false });

      if (error) {
        console.warn('[GPT4o Monitor] Error loading usage stats:', error.message);
        setErrorCount(prev => prev + 1);

        // Disable after 5 errors
        if (errorCount >= 4) {
          console.error('[GPT4o Monitor] Too many errors, disabling monitor');
          setIsDisabled(true);
        }
        return;
      }

      // Reset error count on success
      setErrorCount(0);

      // Calculate statistics
      const todayUsage = usage?.filter(u => new Date(u.called_at) >= today) || [];
      const todayTokens = todayUsage.reduce((sum, u) => sum + (u.total_tokens || 0), 0);
      const todayCost = todayUsage.reduce((sum, u) => sum + (u.estimated_cost_usd || 0), 0);

      const weeklyTokens = usage?.reduce((sum, u) => sum + (u.total_tokens || 0), 0) || 0;
      const weeklyCost = usage?.reduce((sum, u) => sum + (u.estimated_cost_usd || 0), 0) || 0;

      // Check service status
      const recentFailures = todayUsage.filter(u => !u.success && u.error_message?.includes('QUOTA'));
      const serviceStatus = {
        patternInterpreter: !recentFailures.some(f => f.service_type === 'pattern_interpreter'),
        metaLearningStrategist: !recentFailures.some(f => f.service_type === 'meta_learning_strategist'),
        autonomousReasoning: !recentFailures.some(f => f.service_type === 'autonomous_reasoning')
      };

      // Get recent calls
      const recentCalls = (usage?.slice(0, 10) || []).map(u => ({
        service: u.service_type,
        timestamp: u.called_at,
        tokens: u.total_tokens || 0,
        success: u.success,
        error: u.error_message
      }));

      setStats({
        todayTokens,
        todayCost,
        weeklyTokens,
        weeklyCost,
        serviceStatus,
        recentCalls
      });
    } catch (error) {
      console.warn('[GPT4o Monitor] Exception in loadUsageStats:', error);
      setErrorCount(prev => prev + 1);

      // Disable after 5 errors
      if (errorCount >= 4) {
        console.error('[GPT4o Monitor] Too many errors, disabling monitor');
        setIsDisabled(true);
      }
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-blue-400" />
          <h3 className="text-lg font-semibold">GPT-4o Usage Monitor</h3>
        </div>
        <p className="text-slate-400">Loading usage statistics...</p>
      </div>
    );
  }

  if (isDisabled) {
    return (
      <div className="bg-slate-800 rounded-lg p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-5 h-5 text-slate-400" />
          <h3 className="text-lg font-semibold text-slate-300">GPT-4o Usage Monitor</h3>
        </div>
        <p className="text-slate-400">Monitor temporarily disabled due to connection issues.</p>
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  const dailyLimit = 50000;
  const dailyUsagePercent = (stats.todayTokens / dailyLimit) * 100;

  return (
    <div className="bg-slate-800 rounded-lg p-6 space-y-6">
      <div className="flex items-center gap-2">
        <Activity className="w-5 h-5 text-blue-400" />
        <h3 className="text-lg font-semibold">GPT-4o Usage Monitor</h3>
      </div>

      {/* Token Usage Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="w-4 h-4 text-yellow-400" />
            <span className="text-sm text-slate-400">Today</span>
          </div>
          <div className="text-2xl font-bold">
            {stats.todayTokens.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            tokens ({dailyUsagePercent.toFixed(1)}% of daily limit)
          </div>
          <div className="mt-2 h-2 bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full ${
                dailyUsagePercent > 90
                  ? 'bg-red-500'
                  : dailyUsagePercent > 70
                  ? 'bg-yellow-500'
                  : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(dailyUsagePercent, 100)}%` }}
            />
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span className="text-sm text-slate-400">Cost Today</span>
          </div>
          <div className="text-2xl font-bold">
            ${stats.todayCost.toFixed(3)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            Weekly: ${stats.weeklyCost.toFixed(3)}
          </div>
        </div>
      </div>

      {/* Service Status */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Service Status</h4>
        <div className="space-y-2">
          <ServiceStatusRow
            name="Pattern Interpreter"
            active={stats.serviceStatus.patternInterpreter}
          />
          <ServiceStatusRow
            name="Meta-Learning Strategist"
            active={stats.serviceStatus.metaLearningStrategist}
          />
          <ServiceStatusRow
            name="Autonomous Reasoning"
            active={stats.serviceStatus.autonomousReasoning}
          />
        </div>
      </div>

      {/* Usage Warnings */}
      {dailyUsagePercent > 80 && (
        <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-yellow-200">
                Approaching Daily Token Limit
              </div>
              <div className="text-sm text-yellow-300/80 mt-1">
                {dailyUsagePercent > 90
                  ? 'Critical: Very close to daily limit. Some AI services may be disabled.'
                  : 'Warning: Approaching daily token budget. AI services will use fallback logic when limit is reached.'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Recent API Calls */}
      <div>
        <h4 className="text-sm font-medium text-slate-300 mb-3">Recent API Calls</h4>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {stats.recentCalls.length === 0 ? (
            <p className="text-sm text-slate-500">No recent API calls</p>
          ) : (
            stats.recentCalls.map((call, idx) => (
              <div
                key={idx}
                className="bg-slate-900/30 rounded p-3 text-sm flex items-center justify-between"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {call.success ? (
                      <CheckCircle className="w-4 h-4 text-green-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                    <span className="text-slate-300">
                      {call.service.replace(/_/g, ' ')}
                    </span>
                  </div>
                  {call.error && (
                    <div className="text-xs text-red-400 mt-1 ml-6">
                      {call.error.includes('QUOTA') ? 'Quota exceeded' : 'Error'}
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-slate-400">{call.tokens} tokens</div>
                  <div className="text-xs text-slate-500">
                    {new Date(call.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Cost Optimization Tips */}
      <div className="bg-blue-900/20 border border-blue-600/30 rounded-lg p-4">
        <h4 className="text-sm font-medium text-blue-200 mb-2">
          Cost Optimization Active
        </h4>
        <ul className="text-xs text-blue-300/80 space-y-1">
          <li>• Intelligent caching for similar patterns</li>
          <li>• Daily token budgets per service (50k tokens)</li>
          <li>• Automatic fallback to rule-based logic when quota reached</li>
          <li>• Priority filtering for high-value pattern interpretations</li>
          <li>• Rate limiting to prevent rapid quota depletion</li>
        </ul>
      </div>
    </div>
  );
}

function ServiceStatusRow({ name, active }: { name: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between bg-slate-900/30 rounded px-3 py-2">
      <span className="text-sm text-slate-300">{name}</span>
      <div className="flex items-center gap-2">
        <div
          className={`w-2 h-2 rounded-full ${
            active ? 'bg-green-500' : 'bg-red-500'
          }`}
        />
        <span className={`text-xs ${active ? 'text-green-400' : 'text-red-400'}`}>
          {active ? 'Active' : 'Disabled'}
        </span>
      </div>
    </div>
  );
}
