import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, Activity, Shield, Target, BarChart3 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface RiskMetrics {
  kelly: {
    optimalFraction: number;
    edgeStrength: string;
    recommendedLotSize: number;
  } | null;
  evGate: {
    expectedValue: number;
    confidenceLevel: string;
    approved: boolean;
  } | null;
  drawdown: {
    currentDrawdown: number;
    breachedLevel: string;
    tradingAllowed: boolean;
    riskReduction: number;
  } | null;
  volatility: {
    volatilityState: string;
    riskMultiplier: number;
    currentATR: number;
  } | null;
  correlation: {
    totalCorrelationRisk: number;
    effectiveExposure: number;
  } | null;
  riskScaling: {
    performanceStreak: string;
    streakLength: number;
    scalingMultiplier: number;
  } | null;
  marketCondition: {
    sessionQuality: string;
    liquidityScore: number;
    riskMultiplier: number;
  } | null;
  winRateRR: {
    profitabilityScore: number;
    currentRR: number;
  } | null;
}

export function ProfessionalRiskDashboard() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<RiskMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fetchLatestMetrics = async () => {
      try {
        // Fetch latest log entries from each table
        const [kelly, evGate, drawdown, volatility, correlation, scaling, market, winrate] = await Promise.all([
          supabase.from('kelly_sizing_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('ev_gate_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('drawdown_protection_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('volatility_risk_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('correlation_risk_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('risk_scaling_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('market_condition_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
          supabase.from('winrate_rr_optimization_log').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).single(),
        ]);

        setMetrics({
          kelly: kelly.data ? {
            optimalFraction: kelly.data.fractional_kelly_fraction,
            edgeStrength: kelly.data.edge_strength,
            recommendedLotSize: kelly.data.recommended_lot_size
          } : null,
          evGate: evGate.data ? {
            expectedValue: evGate.data.expected_value_pips,
            confidenceLevel: evGate.data.confidence_level,
            approved: evGate.data.approved
          } : null,
          drawdown: drawdown.data ? {
            currentDrawdown: drawdown.data.current_drawdown * 100,
            breachedLevel: drawdown.data.breached_level,
            tradingAllowed: drawdown.data.trading_allowed,
            riskReduction: drawdown.data.risk_reduction
          } : null,
          volatility: volatility.data ? {
            volatilityState: volatility.data.volatility_state,
            riskMultiplier: volatility.data.risk_multiplier,
            currentATR: volatility.data.current_atr
          } : null,
          correlation: correlation.data ? {
            totalCorrelationRisk: correlation.data.total_correlation_risk * 100,
            effectiveExposure: correlation.data.effective_exposure
          } : null,
          riskScaling: scaling.data ? {
            performanceStreak: scaling.data.performance_streak,
            streakLength: scaling.data.streak_length,
            scalingMultiplier: scaling.data.scaling_multiplier
          } : null,
          marketCondition: market.data ? {
            sessionQuality: market.data.session_quality,
            liquidityScore: market.data.liquidity_score * 100,
            riskMultiplier: market.data.risk_multiplier
          } : null,
          winRateRR: winrate.data ? {
            profitabilityScore: winrate.data.profitability_score,
            currentRR: winrate.data.current_rr
          } : null
        });
      } catch (error) {
        console.error('Error fetching risk metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchLatestMetrics();

    // Refresh every 30 seconds
    const interval = setInterval(fetchLatestMetrics, 30000);
    return () => clearInterval(interval);
  }, [user]);

  if (loading) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Shield className="text-blue-400" size={24} />
          <h2 className="text-xl font-bold text-white">Professional Risk Management</h2>
        </div>
        <p className="text-gray-400">Loading risk metrics...</p>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="bg-gray-800 rounded-lg p-6">
        <div className="flex items-center space-x-2 mb-4">
          <Shield className="text-blue-400" size={24} />
          <h2 className="text-xl font-bold text-white">Professional Risk Management</h2>
        </div>
        <p className="text-gray-400">No risk data available yet. Start trading to see metrics.</p>
      </div>
    );
  }

  const getStatusColor = (level: string) => {
    switch (level) {
      case 'high':
      case 'strong':
      case 'excellent':
        return 'text-green-400';
      case 'medium':
      case 'moderate':
      case 'good':
        return 'text-yellow-400';
      case 'low':
      case 'weak':
      case 'warning':
        return 'text-orange-400';
      case 'very-low':
      case 'negative':
      case 'hard-stop':
        return 'text-red-400';
      default:
        return 'text-gray-400';
    }
  };

  return (
    <div className="bg-gray-800 rounded-lg p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2">
          <Shield className="text-blue-400" size={24} />
          <h2 className="text-xl font-bold text-white">Professional Risk Management</h2>
        </div>
        <div className="text-sm text-gray-400">Live Metrics</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Kelly Criterion */}
        {metrics.kelly && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Target className="text-blue-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Kelly Criterion</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Edge</span>
                <span className={`text-sm font-bold ${getStatusColor(metrics.kelly.edgeStrength)}`}>
                  {metrics.kelly.edgeStrength.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Recommended</span>
                <span className="text-sm font-bold text-white">{metrics.kelly.recommendedLotSize.toFixed(2)} lots</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Optimal Risk</span>
                <span className="text-sm font-bold text-white">{(metrics.kelly.optimalFraction * 100).toFixed(2)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Expected Value */}
        {metrics.evGate && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <TrendingUp className="text-green-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Expected Value</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">EV</span>
                <span className={`text-sm font-bold ${metrics.evGate.expectedValue > 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {metrics.evGate.expectedValue > 0 ? '+' : ''}{metrics.evGate.expectedValue.toFixed(1)} pips
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Confidence</span>
                <span className={`text-sm font-bold ${getStatusColor(metrics.evGate.confidenceLevel)}`}>
                  {metrics.evGate.confidenceLevel.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Status</span>
                <span className={`text-sm font-bold ${metrics.evGate.approved ? 'text-green-400' : 'text-red-400'}`}>
                  {metrics.evGate.approved ? 'APPROVED' : 'REJECTED'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Drawdown Protection */}
        {metrics.drawdown && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <AlertTriangle className="text-orange-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Drawdown</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Current DD</span>
                <span className={`text-sm font-bold ${metrics.drawdown.currentDrawdown > 10 ? 'text-red-400' : 'text-yellow-400'}`}>
                  {metrics.drawdown.currentDrawdown.toFixed(2)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Level</span>
                <span className={`text-sm font-bold ${getStatusColor(metrics.drawdown.breachedLevel)}`}>
                  {metrics.drawdown.breachedLevel.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Trading</span>
                <span className={`text-sm font-bold ${metrics.drawdown.tradingAllowed ? 'text-green-400' : 'text-red-400'}`}>
                  {metrics.drawdown.tradingAllowed ? 'ALLOWED' : 'BLOCKED'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Volatility */}
        {metrics.volatility && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Activity className="text-purple-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Volatility</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">State</span>
                <span className={`text-sm font-bold ${getStatusColor(metrics.volatility.volatilityState)}`}>
                  {metrics.volatility.volatilityState.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">ATR</span>
                <span className="text-sm font-bold text-white">{metrics.volatility.currentATR.toFixed(1)} pips</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Risk Mult</span>
                <span className="text-sm font-bold text-white">{(metrics.volatility.riskMultiplier * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Correlation Risk */}
        {metrics.correlation && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <BarChart3 className="text-cyan-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Correlation</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Risk</span>
                <span className={`text-sm font-bold ${metrics.correlation.totalCorrelationRisk > 70 ? 'text-red-400' : metrics.correlation.totalCorrelationRisk > 50 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {metrics.correlation.totalCorrelationRisk.toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Exposure</span>
                <span className="text-sm font-bold text-white">{metrics.correlation.effectiveExposure.toFixed(2)} lots</span>
              </div>
            </div>
          </div>
        )}

        {/* Risk Scaling */}
        {metrics.riskScaling && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              {metrics.riskScaling.performanceStreak === 'winning' ? (
                <TrendingUp className="text-green-400" size={18} />
              ) : (
                <TrendingDown className="text-red-400" size={18} />
              )}
              <h3 className="text-sm font-semibold text-white">Performance</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Streak</span>
                <span className={`text-sm font-bold ${metrics.riskScaling.performanceStreak === 'winning' ? 'text-green-400' : 'text-red-400'}`}>
                  {metrics.riskScaling.streakLength} {metrics.riskScaling.performanceStreak.toUpperCase()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Scaling</span>
                <span className="text-sm font-bold text-white">{(metrics.riskScaling.scalingMultiplier * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Market Condition */}
        {metrics.marketCondition && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Activity className="text-indigo-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Market Session</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Session</span>
                <span className="text-sm font-bold text-white">{metrics.marketCondition.sessionQuality.toUpperCase()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Liquidity</span>
                <span className={`text-sm font-bold ${metrics.marketCondition.liquidityScore > 80 ? 'text-green-400' : metrics.marketCondition.liquidityScore > 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {metrics.marketCondition.liquidityScore.toFixed(0)}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Risk Mult</span>
                <span className="text-sm font-bold text-white">{(metrics.marketCondition.riskMultiplier * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>
        )}

        {/* Win Rate & RR */}
        {metrics.winRateRR && (
          <div className="bg-gray-700/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Target className="text-pink-400" size={18} />
              <h3 className="text-sm font-semibold text-white">Strategy Quality</h3>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">Score</span>
                <span className={`text-sm font-bold ${metrics.winRateRR.profitabilityScore > 80 ? 'text-green-400' : metrics.winRateRR.profitabilityScore > 60 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {metrics.winRateRR.profitabilityScore.toFixed(0)}/100
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-xs text-gray-400">RR Ratio</span>
                <span className="text-sm font-bold text-white">{metrics.winRateRR.currentRR.toFixed(2)}:1</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
