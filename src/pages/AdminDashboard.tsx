import React, { useState, useEffect } from 'react';
import { 
  DollarSign, Users, Activity, TrendingUp, Calendar, 
  RefreshCw, BarChart3, Clock, Target, AlertCircle 
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

interface TodayActivity {
  tradesOpened: number;
  tradesClosed: number;
  activeSessions: number;
  avgDuration: number;
  avgCost: number;
  totalCostToday: number;
}

interface ActiveUsers {
  activeUsersToday: number;
  mostActiveUser: string;
  openSessions: number;
  totalUsers: number;
}

interface CostTracker {
  dailyEstimatedTotal: number;
  monthlyProjectedCost: number;
  avgCostPerTrade: number;
  totalCostLast7Days: number;
  costBreakdownPerUser: Array<{
    userId: string;
    totalCost: number;
    sessionCount: number;
    averageCost: number;
    averageDuration: number;
  }>;
}

interface UsageTrend {
  date: string;
  sessions: number;
  totalCost: number;
  avgDuration: number;
}

export const AdminDashboard: React.FC = () => {
  const { user, profile } = useAuth();
  const [todayActivity, setTodayActivity] = useState<TodayActivity | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUsers | null>(null);
  const [costTracker, setCostTracker] = useState<CostTracker | null>(null);
  const [usageTrends, setUsageTrends] = useState<UsageTrend[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  // Check if user is admin
  const isAdmin = profile?.role === 'admin' || profile?.plan_type === 'admin';

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [todayRes, usersRes, costRes, trendsRes] = await Promise.all([
        fetch('/api/admin/dashboard/today-activity'),
        fetch('/api/admin/dashboard/active-users'),
        fetch('/api/admin/dashboard/cost-tracker'),
        fetch('/api/admin/dashboard/usage-trends?days=7')
      ]);

      if (!todayRes.ok || !usersRes.ok || !costRes.ok || !trendsRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [todayData, usersData, costData, trendsData] = await Promise.all([
        todayRes.json(),
        usersRes.json(),
        costRes.json(),
        trendsRes.json()
      ]);

      setTodayActivity(todayData);
      setActiveUsers(usersData);
      setCostTracker(costData);
      setUsageTrends(trendsData);
      setLastRefresh(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchDashboardData();
      // Auto-refresh every 5 minutes
      const interval = setInterval(fetchDashboardData, 5 * 60 * 1000);
      return () => clearInterval(interval);
    }
  }, [isAdmin]);

  if (!user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Authentication Required</h2>
          <p className="text-white/60">Please sign in to access the admin dashboard</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Access Denied</h2>
          <p className="text-white/60">You don't have permission to access the admin dashboard</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      {/* Header */}
      <div className="bg-black/20 backdrop-blur-2xl border-b border-white/10 px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-gradient-to-r from-purple-500/20 to-blue-500/20 rounded-xl">
              <BarChart3 className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Pipnosis Admin Dashboard</h1>
              <p className="text-white/60">MetaApi Cost Tracker & Analytics</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <p className="text-sm text-white/60">Last Updated</p>
              <p className="text-white font-medium">{lastRefresh.toLocaleTimeString()}</p>
            </div>
            <button
              onClick={fetchDashboardData}
              disabled={isLoading}
              className="p-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {error && (
          <div className="mb-8 p-4 bg-red-500/10 border border-red-500/30 rounded-xl">
            <div className="flex items-center space-x-3">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <p className="text-red-400 font-medium">Error: {error}</p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-6 mb-8">
          {/* Today's Activity */}
          <div className="lg:col-span-2 xl:col-span-2 glass-card p-6">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-blue-500/20 rounded-xl">
                <Activity className="h-6 w-6 text-blue-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Today's Activity</h3>
            </div>
            
            {isLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded w-3/4"></div>
              </div>
            ) : todayActivity ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-400">{todayActivity.tradesOpened}</div>
                  <div className="text-sm text-white/60">Trades Opened</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-400">{todayActivity.tradesClosed}</div>
                  <div className="text-sm text-white/60">Trades Closed</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-400">{todayActivity.activeSessions}</div>
                  <div className="text-sm text-white/60">Active Sessions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-400">{todayActivity.avgDuration}min</div>
                  <div className="text-sm text-white/60">Avg Duration</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-emerald-400">${todayActivity.avgCost}</div>
                  <div className="text-sm text-white/60">Avg Cost</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-red-400">${todayActivity.totalCostToday}</div>
                  <div className="text-sm text-white/60">Total Cost Today</div>
                </div>
              </div>
            ) : (
              <p className="text-white/60">No data available</p>
            )}
          </div>

          {/* Active Users */}
          <div className="glass-card p-6">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-green-500/20 rounded-xl">
                <Users className="h-6 w-6 text-green-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Active Users</h3>
            </div>
            
            {isLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded w-2/3"></div>
              </div>
            ) : activeUsers ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-400">{activeUsers.activeUsersToday}</div>
                  <div className="text-sm text-white/60">Active Today</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-blue-400">{activeUsers.openSessions}</div>
                  <div className="text-sm text-white/60">Open Sessions</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-purple-400">{activeUsers.totalUsers}</div>
                  <div className="text-sm text-white/60">Total Users</div>
                </div>
              </div>
            ) : (
              <p className="text-white/60">No data available</p>
            )}
          </div>

          {/* MetaApi Cost Tracker */}
          <div className="glass-card p-6">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-yellow-500/20 rounded-xl">
                <DollarSign className="h-6 w-6 text-yellow-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Cost Tracker</h3>
            </div>
            
            {isLoading ? (
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-white/10 rounded"></div>
                <div className="h-4 bg-white/10 rounded w-3/4"></div>
              </div>
            ) : costTracker ? (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-yellow-400">${costTracker.dailyEstimatedTotal}</div>
                  <div className="text-sm text-white/60">Daily Total</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-400">${costTracker.monthlyProjectedCost}</div>
                  <div className="text-sm text-white/60">Monthly Projection</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-emerald-400">${costTracker.avgCostPerTrade}</div>
                  <div className="text-sm text-white/60">Avg Per Trade</div>
                </div>
              </div>
            ) : (
              <p className="text-white/60">No data available</p>
            )}
          </div>
        </div>

        {/* Usage Trends Chart */}
        <div className="glass-card p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center space-x-3">
              <div className="p-3 bg-purple-500/20 rounded-xl">
                <TrendingUp className="h-6 w-6 text-purple-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Usage Trends (Last 7 Days)</h3>
            </div>
          </div>
          
          {isLoading ? (
            <div className="h-64 bg-white/5 rounded-xl animate-pulse"></div>
          ) : usageTrends.length > 0 ? (
            <div className="h-64 bg-white/5 rounded-xl p-4 flex items-end justify-between space-x-2">
              {usageTrends.map((trend, index) => (
                <div key={trend.date} className="flex-1 flex flex-col items-center">
                  <div 
                    className="w-full bg-gradient-to-t from-purple-500 to-blue-500 rounded-t"
                    style={{ 
                      height: `${Math.max((trend.sessions / Math.max(...usageTrends.map(t => t.sessions))) * 200, 10)}px` 
                    }}
                  ></div>
                  <div className="mt-2 text-xs text-white/60 text-center">
                    <div>{new Date(trend.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    <div className="text-purple-400">{trend.sessions}</div>
                    <div className="text-yellow-400">${trend.totalCost}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-64 bg-white/5 rounded-xl flex items-center justify-center">
              <p className="text-white/60">No usage data available</p>
            </div>
          )}
        </div>

        {/* Cost Breakdown Per User */}
        {costTracker && costTracker.costBreakdownPerUser.length > 0 && (
          <div className="glass-card p-6">
            <div className="flex items-center space-x-3 mb-6">
              <div className="p-3 bg-emerald-500/20 rounded-xl">
                <Target className="h-6 w-6 text-emerald-400" />
              </div>
              <h3 className="text-xl font-bold text-white">Cost Breakdown Per User</h3>
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-white/60 text-sm border-b border-white/10">
                    <th className="text-left p-3">User ID</th>
                    <th className="text-left p-3">Sessions</th>
                    <th className="text-left p-3">Total Cost</th>
                    <th className="text-left p-3">Avg Cost</th>
                    <th className="text-left p-3">Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {costTracker.costBreakdownPerUser
                    .sort((a, b) => b.totalCost - a.totalCost)
                    .map((user) => (
                    <tr key={user.userId} className="border-b border-white/5 hover:bg-white/5">
                      <td className="p-3 text-white font-mono text-sm">{user.userId.substring(0, 8)}...</td>
                      <td className="p-3 text-blue-400 font-medium">{user.sessionCount}</td>
                      <td className="p-3 text-yellow-400 font-medium">${user.totalCost.toFixed(4)}</td>
                      <td className="p-3 text-emerald-400 font-medium">${user.averageCost.toFixed(4)}</td>
                      <td className="p-3 text-purple-400 font-medium">{user.averageDuration}min</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* MetaApi Info */}
        <div className="glass-card p-6 mt-8">
          <div className="flex items-center space-x-3 mb-4">
            <div className="p-3 bg-blue-500/20 rounded-xl">
              <Clock className="h-6 w-6 text-blue-400" />
            </div>
            <h3 className="text-xl font-bold text-white">MetaApi Pricing Reference</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-white/60 mb-1">Base Account Slot</div>
              <div className="text-white font-bold">$0.0015/hr</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-white/60 mb-1">MetaStats API</div>
              <div className="text-white font-bold">$0.0015/hr</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-white/60 mb-1">Frontend Server</div>
              <div className="text-white font-bold">$0.0015/hr</div>
            </div>
            <div className="bg-white/5 rounded-lg p-4">
              <div className="text-white/60 mb-1">Resource Slot</div>
              <div className="text-white font-bold">$0.0015/hr</div>
            </div>
          </div>
          
          <div className="mt-4 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-emerald-300 font-medium">Total Rate per Session:</span>
              <span className="text-emerald-400 font-bold text-lg">$0.006/hour</span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="text-emerald-300 font-medium">Average Trade Cost (2 hours):</span>
              <span className="text-emerald-400 font-bold text-lg">$0.012</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};