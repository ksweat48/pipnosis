import React, { useState, useEffect, useRef } from 'react';
import { useLLMTokenUsage } from '@/hooks/useLLMTokenUsage';
import {
  DollarSign,
  Brain,
  TrendingUp,
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Zap
} from 'lucide-react';

const DAILY_BUDGET_USD = 5.00;

export function LLMTokenUsageDashboard() {
  const {
    todayCost,
    weekCost,
    monthCost,
    allTimeCost,
    todayCallCount,
    costByBrain,
    dailyTrend,
    loading,
    error
  } = useLLMTokenUsage();

  const [sortBy, setSortBy] = useState<'cost' | 'calls' | 'tokens'>('cost');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollPosition = useRef<number>(0);

  // Preserve scroll position during background refreshes
  useEffect(() => {
    if (scrollContainerRef.current && !loading) {
      scrollContainerRef.current.scrollTop = lastScrollPosition.current;
    }
  }, [costByBrain, loading]);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollContainerRef.current) {
        lastScrollPosition.current = scrollContainerRef.current.scrollTop;
      }
    };

    const container = scrollContainerRef.current;
    container?.addEventListener('scroll', handleScroll);
    return () => container?.removeEventListener('scroll', handleScroll);
  }, []);

  if (loading) {
    return (
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-8">
        <div className="flex items-center justify-center">
          <div className="text-gray-400">Loading LLM token usage data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-6">
        <div className="flex items-center gap-3">
          <AlertTriangle className="text-red-400" size={20} />
          <div>
            <div className="text-red-200 font-medium">Error Loading Token Usage</div>
            <div className="text-red-300/70 text-sm mt-1">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  const budgetExceeded = todayCost > DAILY_BUDGET_USD;
  const budgetPercentage = (todayCost / DAILY_BUDGET_USD) * 100;

  // Sort brain data
  const sortedBrains = [...costByBrain].sort((a, b) => {
    if (sortBy === 'cost') return b.totalCost - a.totalCost;
    if (sortBy === 'calls') return b.totalCalls - a.totalCalls;
    if (sortBy === 'tokens') return b.avgTokens - a.avgTokens;
    return 0;
  });

  // Get yesterday's cost for trend comparison
  const yesterdayCost = dailyTrend[dailyTrend.length - 2]?.totalCost || 0;
  const costTrendUp = todayCost > yesterdayCost;
  const costChange = yesterdayCost > 0 ? ((todayCost - yesterdayCost) / yesterdayCost) * 100 : 0;

  return (
    <div className="space-y-6" ref={scrollContainerRef}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Brain className="text-blue-400" size={28} />
            LLM Token Usage Dashboard (Platform-Wide)
          </h2>
          <p className="text-gray-400 text-sm mt-1">
            Real-time cost tracking for all Alpha & Omega brains across all users
          </p>
        </div>
      </div>

      {/* Budget Alert Banner */}
      {budgetExceeded && (
        <div className="bg-red-900/30 border-2 border-red-500/50 rounded-xl p-4 animate-pulse">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-red-400" size={24} />
            <div className="flex-1">
              <div className="text-red-200 font-bold text-lg">Daily Budget Exceeded</div>
              <div className="text-red-300 text-sm mt-1">
                Today's cost: ${todayCost.toFixed(2)} / ${DAILY_BUDGET_USD.toFixed(2)} ({budgetPercentage.toFixed(0)}% of budget)
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          title="Today's Cost"
          value={`$${todayCost.toFixed(2)}`}
          subtitle={`${todayCallCount} API calls`}
          icon={DollarSign}
          color="blue"
          trend={costChange > 0 ? `+${costChange.toFixed(1)}%` : costChange < 0 ? `${costChange.toFixed(1)}%` : '0%'}
          trendUp={costTrendUp}
        />
        <SummaryCard
          title="This Week"
          value={`$${weekCost.toFixed(2)}`}
          subtitle="Last 7 days"
          icon={TrendingUp}
          color="green"
        />
        <SummaryCard
          title="This Month"
          value={`$${monthCost.toFixed(2)}`}
          subtitle="Last 30 days"
          icon={Activity}
          color="purple"
        />
        <SummaryCard
          title="All Time"
          value={`$${allTimeCost.toFixed(2)}`}
          subtitle="Total spent"
          icon={Zap}
          color="amber"
        />
      </div>

      {/* Brain Performance Table */}
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold text-white">Brain Performance (Last 30 Days)</h3>
          <div className="flex gap-2">
            <button
              onClick={() => setSortBy('cost')}
              className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                sortBy === 'cost'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              By Cost
            </button>
            <button
              onClick={() => setSortBy('calls')}
              className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                sortBy === 'calls'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              By Calls
            </button>
            <button
              onClick={() => setSortBy('tokens')}
              className={`px-3 py-1 rounded text-sm font-medium transition-all ${
                sortBy === 'tokens'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              By Tokens
            </button>
          </div>
        </div>

        {costByBrain.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No token usage data yet. Start trading to see brain activity!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-800 text-left">
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm">Brain Name</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm text-right">Total Calls</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm text-right">Avg Tokens</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm text-right">Total Cost</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm text-right">% of Total</th>
                  <th className="pb-3 px-4 text-gray-400 font-medium text-sm">Usage</th>
                </tr>
              </thead>
              <tbody>
                {sortedBrains.map((brain, index) => (
                  <tr
                    key={brain.brainName}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
                  >
                    <td className="py-4 px-4">
                      <div className="flex items-center gap-2">
                        <Brain className={getBrainColor(brain.brainName)} size={16} />
                        <span className="text-white font-medium">{brain.brainName}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 text-right text-gray-300">
                      {brain.totalCalls.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right text-gray-300">
                      {brain.avgTokens.toLocaleString()}
                    </td>
                    <td className="py-4 px-4 text-right text-white font-medium">
                      ${brain.totalCost.toFixed(3)}
                    </td>
                    <td className="py-4 px-4 text-right">
                      <span className="text-gray-300">{brain.percentage.toFixed(1)}%</span>
                    </td>
                    <td className="py-4 px-4">
                      <div className="w-full bg-gray-800 rounded-full h-2">
                        <div
                          className={`h-2 rounded-full ${getPercentageBarColor(brain.percentage)}`}
                          style={{ width: `${Math.min(brain.percentage, 100)}%` }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Daily Trend Chart */}
      {dailyTrend.length > 0 && (
        <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
          <h3 className="text-xl font-bold text-white mb-6">Daily Cost Trend (Last 30 Days)</h3>
          <div className="h-64 flex items-end gap-2">
            {dailyTrend.map((day, index) => {
              const maxCost = Math.max(...dailyTrend.map(d => d.totalCost));
              const heightPercent = maxCost > 0 ? (day.totalCost / maxCost) * 100 : 0;

              return (
                <div key={index} className="flex-1 flex flex-col items-center group">
                  <div className="relative w-full">
                    <div
                      className="w-full bg-blue-600 hover:bg-blue-500 rounded-t transition-all cursor-pointer"
                      style={{ height: `${Math.max(heightPercent * 2.4, 4)}px` }}
                      title={`${day.date}: $${day.totalCost.toFixed(2)} (${day.totalCalls} calls)`}
                    />
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-10 shadow-lg">
                      <div className="font-bold">${day.totalCost.toFixed(2)}</div>
                      <div className="text-gray-400">{day.totalCalls} calls</div>
                      <div className="text-gray-500">{new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                  </div>
                  <div className="text-xs text-gray-500 mt-2 rotate-45 origin-left">
                    {index % 5 === 0 ? new Date(day.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Budget Meter */}
      <div className="bg-gray-900/50 backdrop-blur-sm border border-gray-800 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xl font-bold text-white">Daily Budget</h3>
          <span className={`text-2xl font-bold ${budgetExceeded ? 'text-red-400' : 'text-green-400'}`}>
            ${todayCost.toFixed(2)} / ${DAILY_BUDGET_USD.toFixed(2)}
          </span>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-4">
          <div
            className={`h-4 rounded-full transition-all ${
              budgetPercentage >= 100 ? 'bg-red-500' :
              budgetPercentage >= 80 ? 'bg-orange-500' :
              budgetPercentage >= 60 ? 'bg-yellow-500' :
              'bg-green-500'
            }`}
            style={{ width: `${Math.min(budgetPercentage, 100)}%` }}
          />
        </div>
        <div className="flex justify-between mt-2 text-sm">
          <span className="text-gray-400">{budgetPercentage.toFixed(1)}% of daily budget</span>
          <span className="text-gray-400">${(DAILY_BUDGET_USD - todayCost).toFixed(2)} remaining</span>
        </div>
      </div>
    </div>
  );
}

// Helper components
interface SummaryCardProps {
  title: string;
  value: string;
  subtitle: string;
  icon: React.ElementType;
  color: string;
  trend?: string;
  trendUp?: boolean;
}

function SummaryCard({ title, value, subtitle, icon: Icon, color, trend, trendUp }: SummaryCardProps) {
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
    <div className={`bg-gradient-to-br ${colorClasses[color]} backdrop-blur-sm border-2 rounded-xl p-5 hover:scale-105 transition-transform`}>
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-gray-900/50 rounded-lg">
          <Icon className={iconColorClasses[color]} size={20} />
        </div>
        {trend && (
          <div className={`flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded ${
            trendUp ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
          }`}>
            {trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {trend}
          </div>
        )}
      </div>
      <div className="text-gray-300 text-sm mb-1">{title}</div>
      <div className="text-white text-2xl font-bold mb-2">{value}</div>
      <div className="text-gray-400 text-xs">{subtitle}</div>
    </div>
  );
}

function getBrainColor(brainName: string): string {
  const colors: Record<string, string> = {
    'Alpha': 'text-blue-400',           // Leader - Blue
    'Omega-1': 'text-cyan-400',         // Trend
    'Omega-2': 'text-teal-400',         // Reversal
    'Omega-3': 'text-emerald-400',      // Scalper
    'Omega-4': 'text-lime-400',         // Volatility
    'Omega-5': 'text-amber-400',        // Risk
    'Omega-6': 'text-orange-400',       // OrderFlow
    'Omega-7': 'text-purple-400',       // Sentiment
    'Omega-8': 'text-green-400',        // Hybrid OrderFlow
    'Omega-9': 'text-pink-400',         // Hallucination Detector
    'Omega-10': 'text-yellow-400',      // Meta-Reasoning
    'MidTrade-Monitor': 'text-red-400',
    'MidTrade-Periodic': 'text-red-300'
  };
  return colors[brainName] || 'text-gray-400';
}

function getPercentageBarColor(percentage: number): string {
  if (percentage >= 40) return 'bg-gradient-to-r from-red-600 to-red-400';
  if (percentage >= 25) return 'bg-gradient-to-r from-orange-600 to-orange-400';
  if (percentage >= 15) return 'bg-gradient-to-r from-yellow-600 to-yellow-400';
  if (percentage >= 10) return 'bg-gradient-to-r from-blue-600 to-blue-400';
  return 'bg-gradient-to-r from-green-600 to-green-400';
}
