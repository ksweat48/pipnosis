import React, { useEffect, useState } from 'react';
import {
  Globe, TrendingUp, Target, Activity, Users, Zap, Award, BarChart3,
  TrendingDown, Brain, Package
} from 'lucide-react';
import {
  platformIntelligenceService,
  PlatformStats,
  SymbolIntelligence,
  UserContribution
} from '../services/platform-intelligence-service';

interface PlatformIntelligenceDashboardProps {
  userId: string;
}

export function PlatformIntelligenceDashboard({ userId }: PlatformIntelligenceDashboardProps) {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [topSymbols, setTopSymbols] = useState<SymbolIntelligence[]>([]);
  const [userContribution, setUserContribution] = useState<UserContribution | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPlatformData();
  }, [userId]);

  const loadPlatformData = async () => {
    try {
      const [platformStats, symbols, contribution] = await Promise.all([
        platformIntelligenceService.fetchPlatformStats(),
        platformIntelligenceService.fetchTopSymbols(6),
        platformIntelligenceService.fetchUserContribution(userId)
      ]);

      setStats(platformStats);
      setTopSymbols(symbols);
      setUserContribution(contribution);
    } catch (error) {
      console.error('[Platform Intelligence] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-4 bg-gray-700 rounded"></div>
            <div className="h-4 bg-gray-700 rounded w-5/6"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <div className="text-center">
          <Globe className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">Platform Intelligence Initializing</h3>
          <p className="text-gray-400 text-sm">
            Platform-wide learning data is being collected from all users
          </p>
        </div>
      </div>
    );
  }

  const getQualityColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 60) return 'text-blue-400';
    if (score >= 40) return 'text-yellow-400';
    return 'text-orange-400';
  };

  return (
    <div className="space-y-4">
      {/* Hero Section - Platform Stats */}
      <div className="bg-gradient-to-br from-emerald-900/30 to-blue-900/30 backdrop-blur-sm border-2 border-emerald-500/30 rounded-lg p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <Globe className="w-8 h-8 text-emerald-400" />
              <h2 className="text-2xl font-bold text-white">Platform Intelligence</h2>
            </div>
            <p className="text-gray-400 text-sm">
              Collective learning from {stats.uniqueUsersContributing} traders analyzing {stats.totalSymbolsTracked} symbols
            </p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-5 h-5 text-emerald-400" />
              <span className={`text-3xl font-bold ${getQualityColor(stats.intelligenceGrowthRate)}`}>
                {stats.intelligenceGrowthRate.toFixed(1)}%
              </span>
            </div>
            <div className="text-xs text-gray-400">Growth Rate</div>
          </div>
        </div>

        {/* Main Metrics Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            icon={Activity}
            label="Trades Analyzed"
            value={stats.totalTradesAnalyzed.toLocaleString()}
            subValue={`+${stats.tradesAnalyzedToday} today`}
            iconColor="text-blue-400"
          />
          <MetricCard
            icon={Package}
            label="Patterns Discovered"
            value={stats.totalPatternsDiscovered.toLocaleString()}
            subValue={`+${stats.patternsDiscoveredToday} today`}
            iconColor="text-purple-400"
          />
          <MetricCard
            icon={Target}
            label="Platform Win Rate"
            value={`${stats.platformWinRate.toFixed(1)}%`}
            subValue="Collective accuracy"
            iconColor="text-emerald-400"
          />
          <MetricCard
            icon={Award}
            label="Profit Factor"
            value={stats.platformProfitFactor.toFixed(2)}
            subValue="Platform average"
            iconColor="text-yellow-400"
          />
        </div>
      </div>

      {/* Your Contribution Card */}
      {userContribution && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-5 h-5 text-blue-400" />
            <h3 className="text-lg font-semibold text-white">Your Platform Impact</h3>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <div className="text-2xl font-bold text-white">
                {userContribution.totalTradesContributed}
              </div>
              <div className="text-xs text-gray-400">Trades Contributed</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">
                {userContribution.patternsDiscovered}
              </div>
              <div className="text-xs text-gray-400">Patterns Discovered</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-blue-400">
                {userContribution.contributionPercentage.toFixed(2)}%
              </div>
              <div className="text-xs text-gray-400">Contribution</div>
            </div>
          </div>
        </div>
      )}

      {/* Top Performing Symbols */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-white">Top Performing Symbols</h3>
          <BarChart3 className="w-5 h-5 text-gray-400" />
        </div>

        {topSymbols.length === 0 ? (
          <div className="text-center text-gray-400 py-6">
            <Brain className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">Symbol intelligence is being collected</p>
          </div>
        ) : (
          <div className="space-y-3">
            {topSymbols.map((symbolData) => (
              <div
                key={symbolData.symbol}
                className="bg-gray-900/50 rounded-lg p-3 border border-gray-700 hover:border-emerald-500/30 transition-colors"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">{symbolData.symbol}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Quality: {symbolData.intelligence_quality_score.toFixed(0)}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-400 font-semibold">
                      {symbolData.platform_win_rate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-400">Win Rate</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <div className="text-gray-400">Trades</div>
                    <div className="text-white font-medium">
                      {symbolData.total_trades_platform_wide.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Profit Factor</div>
                    <div className="text-white font-medium">
                      {symbolData.platform_profit_factor.toFixed(2)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-400">Best TF</div>
                    <div className="text-white font-medium">
                      {symbolData.best_timeframes?.[0] || 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Today's Highlights */}
      {(stats.bestSymbolToday || stats.bestPatternToday) && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-yellow-400" />
            <h3 className="text-lg font-semibold text-white">Today's Highlights</h3>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {stats.bestSymbolToday && (
              <div className="bg-gray-900/50 rounded-lg p-3 border border-yellow-500/20">
                <div className="text-xs text-gray-400 mb-1">Best Symbol</div>
                <div className="text-xl font-bold text-yellow-400">
                  {stats.bestSymbolToday}
                </div>
              </div>
            )}
            {stats.bestPatternToday && (
              <div className="bg-gray-900/50 rounded-lg p-3 border border-emerald-500/20">
                <div className="text-xs text-gray-400 mb-1">Best Pattern</div>
                <div className="text-sm font-semibold text-emerald-400">
                  {stats.bestPatternToday}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Platform Activity Indicator */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-sm text-gray-400">Platform is actively learning</span>
          </div>
          <div className="text-sm text-gray-400">
            {stats.uniqueUsersContributing} active contributors
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  subValue,
  iconColor
}: {
  icon: any;
  label: string;
  value: string;
  subValue: string;
  iconColor: string;
}) {
  return (
    <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <div className="text-xs text-gray-400">{label}</div>
      </div>
      <div className="text-2xl font-bold text-white mb-1">{value}</div>
      <div className="text-xs text-gray-500">{subValue}</div>
    </div>
  );
}
