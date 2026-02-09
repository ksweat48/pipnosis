import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, AlertCircle, TrendingUp, TrendingDown, Activity, DollarSign, Users, Flame, Lock, Package } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { tokenPoolAuthority } from '@/services/token-pool-authority';
import { tokenLifecycleCoordinator } from '@/services/token-lifecycle-coordinator';
import { pipUtilityIndexEngine } from '@/services/pip-utility-index-engine';
import { logger } from '@/lib/logger';

export default function TokenTreasuryPage() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [loading, setLoading] = useState(true);

  // State for pool data
  const [poolSummary, setPoolSummary] = useState<any>(null);
  const [integrityChecks, setIntegrityChecks] = useState<any[]>([]);
  const [lifecycleMetrics, setLifecycleMetrics] = useState<any>(null);

  // State for utility index
  const [currentUtilityValue, setCurrentUtilityValue] = useState<any>(null);
  const [indexHistory, setIndexHistory] = useState<any[]>([]);
  const [indexChange30d, setIndexChange30d] = useState<any>(null);
  const [utilityPressure, setUtilityPressure] = useState<string>('Medium');

  // Redirect non-admins
  useEffect(() => {
    if (!user || !profile?.is_admin) {
      navigate('/');
    }
  }, [user, profile, navigate]);

  // Load all data
  useEffect(() => {
    if (!user || !profile?.is_admin) return;

    loadDashboardData();
    const interval = setInterval(loadDashboardData, 60000); // Refresh every minute

    return () => clearInterval(interval);
  }, [user, profile]);

  async function loadDashboardData() {
    try {
      setLoading(true);

      // Load pool data
      const [summary, integrity, lifecycle30d] = await Promise.all([
        tokenPoolAuthority.getPoolAllocationSummary(),
        tokenPoolAuthority.verifySupplyIntegrity(),
        tokenLifecycleCoordinator.getLifecycleFlowMetrics(30)
      ]);

      setPoolSummary(summary);
      setIntegrityChecks(integrity);
      setLifecycleMetrics(lifecycle30d);

      // Load utility index data
      const [currentValue, history, change, pressure] = await Promise.all([
        pipUtilityIndexEngine.getCurrentUtilityValue(),
        pipUtilityIndexEngine.getIndexHistory(90),
        pipUtilityIndexEngine.getIndexChange(30),
        pipUtilityIndexEngine.getUtilityPressure()
      ]);

      setCurrentUtilityValue(currentValue);
      setIndexHistory(history);
      setIndexChange30d(change);
      setUtilityPressure(pressure);
    } catch (error: any) {
      logger.error('Failed to load token treasury data', { error });
    } finally {
      setLoading(false);
    }
  }

  if (!user || !profile?.is_admin) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center text-gray-600 hover:text-gray-900 mb-4"
          >
            <ArrowLeft className="h-5 w-5 mr-2" />
            Back to Admin Dashboard
          </button>

          <h1 className="text-3xl font-bold text-gray-900">
            Token Treasury & Utility Index
          </h1>
          <p className="mt-2 text-gray-600">
            Phase 3B: Token pool management and dynamic PIP utility value monitoring
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Activity className="h-8 w-8 text-blue-500 animate-spin" />
            <span className="ml-3 text-gray-600">Loading treasury data...</span>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Integrity Checks */}
            <div className="bg-white rounded-lg shadow p-6">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <AlertCircle className="h-6 w-6 mr-2 text-blue-600" />
                System Integrity Checks
              </h2>
              <div className="space-y-3">
                {integrityChecks.map((check, index) => (
                  <div
                    key={index}
                    className={`flex items-center justify-between p-3 rounded-lg ${
                      check.passed ? 'bg-green-50' : 'bg-red-50'
                    }`}
                  >
                    <div className="flex-1">
                      <p className={`font-medium ${check.passed ? 'text-green-900' : 'text-red-900'}`}>
                        {check.check_name}
                      </p>
                      <p className="text-sm text-gray-600 mt-1">{check.details}</p>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl ${check.passed ? 'text-green-600' : 'text-red-600'}`}>
                        {check.passed ? '✓' : '✗'}
                      </div>
                      {!check.passed && (
                        <p className="text-xs text-red-600 mt-1">
                          Expected: {check.expected_value.toFixed(4)}
                          <br />
                          Actual: {check.actual_value.toFixed(4)}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Pool Allocation Summary */}
            {poolSummary && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                  <Package className="h-6 w-6 mr-2 text-purple-600" />
                  Token Pool Allocation
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-blue-50 p-4 rounded-lg">
                    <p className="text-sm text-blue-600 font-medium">Total Supply</p>
                    <p className="text-2xl font-bold text-blue-900">{poolSummary.total_supply.toLocaleString()} PIP</p>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg">
                    <p className="text-sm text-green-600 font-medium">Pool Balance</p>
                    <p className="text-2xl font-bold text-green-900">{poolSummary.pool_sum.toLocaleString()} PIP</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg">
                    <p className="text-sm text-red-600 font-medium">Burned</p>
                    <p className="text-2xl font-bold text-red-900">{poolSummary.burned_total.toLocaleString()} PIP</p>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg">
                    <p className="text-sm text-purple-600 font-medium">Circulating</p>
                    <p className="text-2xl font-bold text-purple-900">{poolSummary.circulating_total.toLocaleString()} PIP</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {poolSummary.pools.map((pool: any) => (
                    <div key={pool.pool_id} className="border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <p className="font-medium text-gray-900">{pool.pool_name}</p>
                          <p className="text-sm text-gray-600">{pool.pool_id}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-semibold text-gray-900">
                            {pool.current_balance.toLocaleString()} PIP
                          </p>
                          <p className="text-sm text-gray-600">
                            {pool.percentage_of_supply.toFixed(2)}% of supply
                          </p>
                          {pool.pool_id !== 'BURNED' && (
                            <p className="text-xs text-gray-500">
                              {pool.percentage_remaining.toFixed(1)}% remaining
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lifecycle Flows (30 days) */}
            {lifecycleMetrics && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                  <Activity className="h-6 w-6 mr-2 text-green-600" />
                  Token Lifecycle Flows (30 Days)
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-green-50 p-4 rounded-lg">
                    <div className="flex items-center mb-2">
                      <TrendingUp className="h-5 w-5 text-green-600 mr-2" />
                      <p className="text-sm text-green-600 font-medium">Granted</p>
                    </div>
                    <p className="text-xl font-bold text-green-900">
                      {lifecycleMetrics.tokens_granted.toLocaleString()} PIP
                    </p>
                  </div>

                  <div className="bg-red-50 p-4 rounded-lg">
                    <div className="flex items-center mb-2">
                      <Flame className="h-5 w-5 text-red-600 mr-2" />
                      <p className="text-sm text-red-600 font-medium">Burned</p>
                    </div>
                    <p className="text-xl font-bold text-red-900">
                      {lifecycleMetrics.tokens_burned.toLocaleString()} PIP
                    </p>
                  </div>

                  <div className="bg-purple-50 p-4 rounded-lg">
                    <div className="flex items-center mb-2">
                      <Lock className="h-5 w-5 text-purple-600 mr-2" />
                      <p className="text-sm text-purple-600 font-medium">Staked (Net)</p>
                    </div>
                    <p className="text-xl font-bold text-purple-900">
                      {(lifecycleMetrics.tokens_staked - lifecycleMetrics.tokens_unstaked).toLocaleString()} PIP
                    </p>
                  </div>

                  <div className="bg-blue-50 p-4 rounded-lg">
                    <div className="flex items-center mb-2">
                      <DollarSign className="h-5 w-5 text-blue-600 mr-2" />
                      <p className="text-sm text-blue-600 font-medium">Rewards Accrued</p>
                    </div>
                    <p className="text-xl font-bold text-blue-900">
                      {lifecycleMetrics.rewards_accrued.toLocaleString()} PIP
                    </p>
                  </div>

                  <div className="bg-yellow-50 p-4 rounded-lg">
                    <div className="flex items-center mb-2">
                      <DollarSign className="h-5 w-5 text-yellow-600 mr-2" />
                      <p className="text-sm text-yellow-600 font-medium">Rewards Claimed</p>
                    </div>
                    <p className="text-xl font-bold text-yellow-900">
                      {lifecycleMetrics.rewards_claimed.toLocaleString()} PIP
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* PIP Utility Index */}
            {currentUtilityValue && (
              <div className="bg-white rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold mb-4 flex items-center">
                  <TrendingUp className="h-6 w-6 mr-2 text-indigo-600" />
                  PIP Utility Index
                </h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                  <div className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-lg text-white">
                    <p className="text-sm opacity-90 mb-2">Current Utility Value</p>
                    <p className="text-4xl font-bold">
                      ${currentUtilityValue.display_value_usd.toFixed(4)}
                    </p>
                    <p className="text-xs mt-2 opacity-75">
                      Last updated: {new Date(currentUtilityValue.date).toLocaleDateString()}
                    </p>
                  </div>

                  {indexChange30d && (
                    <div className={`p-6 rounded-lg ${
                      indexChange30d.change_percentage >= 0 ? 'bg-green-50' : 'bg-red-50'
                    }`}>
                      <p className="text-sm text-gray-600 mb-2">30-Day Change</p>
                      <div className="flex items-center">
                        {indexChange30d.change_percentage >= 0 ? (
                          <TrendingUp className="h-6 w-6 text-green-600 mr-2" />
                        ) : (
                          <TrendingDown className="h-6 w-6 text-red-600 mr-2" />
                        )}
                        <p className={`text-3xl font-bold ${
                          indexChange30d.change_percentage >= 0 ? 'text-green-900' : 'text-red-900'
                        }`}>
                          {indexChange30d.change_percentage >= 0 ? '+' : ''}
                          {indexChange30d.change_percentage.toFixed(2)}%
                        </p>
                      </div>
                      <p className="text-xs text-gray-600 mt-2">
                        ${indexChange30d.change_amount.toFixed(4)} absolute change
                      </p>
                    </div>
                  )}

                  <div className="bg-yellow-50 p-6 rounded-lg">
                    <p className="text-sm text-gray-600 mb-2">Utility Pressure</p>
                    <p className="text-3xl font-bold text-yellow-900">{utilityPressure}</p>
                    <p className="text-xs text-gray-600 mt-2">
                      Based on 90-day percentile
                    </p>
                  </div>
                </div>

                {/* Simple line chart representation */}
                {indexHistory.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-3">90-Day History</p>
                    <div className="h-48 flex items-end space-x-1">
                      {indexHistory.slice(-30).map((point, index) => {
                        const maxValue = Math.max(...indexHistory.slice(-30).map(p => Number(p.display_value_usd)));
                        const height = (Number(point.display_value_usd) / maxValue) * 100;
                        return (
                          <div
                            key={index}
                            className="flex-1 bg-indigo-500 rounded-t hover:bg-indigo-600 transition-colors"
                            style={{ height: `${height}%` }}
                            title={`${new Date(point.date).toLocaleDateString()}: $${Number(point.display_value_usd).toFixed(4)}`}
                          />
                        );
                      })}
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 mt-2">
                      <span>{new Date(indexHistory[indexHistory.length - 30]?.date || indexHistory[0].date).toLocaleDateString()}</span>
                      <span>{new Date(indexHistory[indexHistory.length - 1].date).toLocaleDateString()}</span>
                    </div>
                  </div>
                )}

                <div className="mt-6 p-4 bg-blue-50 rounded-lg">
                  <p className="text-xs text-blue-800">
                    <strong>Note:</strong> The PIP Utility Value is a display-only metric that reflects platform activity and token usage.
                    This is not a cash value or redemption guarantee. The index is calculated daily using platform metrics:
                    credits spent, PIP burned, staking participation, active users, and liquid supply.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
