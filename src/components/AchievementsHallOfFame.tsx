import React, { useState, useEffect } from 'react';
import { Trophy, Award, Medal, Gem, Shield, TrendingUp, TrendingDown, Star, Zap, Target, BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface TradeAchievement {
  achievement_id: string;
  trade_id: string | null;
  trade_number: number;
  symbol: string;
  direction: string;
  pnl: number;
  close_reason: string;
  pip_gain: number;
  lot_size: number;
  trade_style: string;
  achieved_at: string;
  medal_rank: string;
  medal_color: string;
}

interface AchievementSummary {
  total_wins: number;
  total_pnl: number;
  best_trade_pnl: number;
  best_symbol: string;
  avg_pnl: number;
  current_rank: string;
  current_rank_color: string;
  wins_to_next_rank: number;
}

const getMedalIcon = (rank: string) => {
  switch (rank) {
    case 'Platinum': return Trophy;
    case 'Diamond':  return Gem;
    case 'Gold':     return Medal;
    case 'Silver':   return Award;
    default:         return Shield;
  }
};

const formatCloseReason = (reason: string) => {
  switch (reason) {
    case 'take_profit_1': return 'TP1 Hit';
    case 'take_profit_2': return 'TP2 Hit';
    case 'take_profit':   return 'TP Hit';
    case 'manual':        return 'Manual Close';
    case 'goal_achieved': return 'Goal Hit';
    default:              return reason?.replace(/_/g, ' ') || 'Closed';
  }
};

const formatStyle = (style: string) => {
  if (!style) return null;
  return style.charAt(0).toUpperCase() + style.slice(1).toLowerCase().replace(/_/g, ' ');
};

const RANK_THRESHOLDS = [
  { rank: 'Bronze',   min: 0,   max: 9,   color: '#CD7F32' },
  { rank: 'Silver',   min: 10,  max: 24,  color: '#C0C0C0' },
  { rank: 'Gold',     min: 25,  max: 99,  color: '#FFD700' },
  { rank: 'Diamond',  min: 100, max: 499, color: '#B9F2FF' },
  { rank: 'Platinum', min: 500, max: Infinity, color: '#E5E4E2' },
];

export const AchievementsHallOfFame: React.FC = () => {
  const { user } = useAuth();
  const [achievements, setAchievements] = useState<TradeAchievement[]>([]);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'tp1' | 'tp2' | 'manual'>('all');

  useEffect(() => {
    if (user) loadAchievements();
  }, [user]);

  const loadAchievements = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const [achRes, sumRes] = await Promise.all([
        supabase.rpc('get_user_trade_achievements', { p_user_id: user.id }),
        supabase.rpc('get_trade_achievement_summary', { p_user_id: user.id }),
      ]);
      if (!achRes.error) setAchievements(achRes.data || []);
      if (!sumRes.error) setSummary(sumRes.data?.[0] || null);
    } catch (err) {
      console.error('[AchievementsHallOfFame] load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filtered = achievements.filter(a => {
    if (filter === 'all') return true;
    if (filter === 'tp1') return a.close_reason === 'take_profit_1' || a.close_reason === 'take_profit';
    if (filter === 'tp2') return a.close_reason === 'take_profit_2';
    if (filter === 'manual') return a.close_reason === 'manual';
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-400" />
      </div>
    );
  }

  if (!achievements.length) {
    return (
      <div className="max-w-lg mx-auto py-20 text-center">
        <div className="bg-gray-800/50 rounded-2xl p-12 border border-gray-700/50">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gray-700/50 rounded-full mb-5">
            <Trophy className="w-10 h-10 text-gray-500" />
          </div>
          <h3 className="text-xl font-bold text-white mb-2">No Wins Yet</h3>
          <p className="text-gray-400 mb-8">
            Every profitable trade you close gets logged here automatically.
          </p>
          <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 text-left space-y-3">
            <p className="text-gray-400 text-sm font-semibold uppercase tracking-wider mb-2">Rank Milestones</p>
            {RANK_THRESHOLDS.map(t => {
              const Icon = getMedalIcon(t.rank);
              return (
                <div key={t.rank} className="flex items-center gap-3">
                  <Icon className="w-4 h-4 flex-shrink-0" style={{ color: t.color }} />
                  <span className="text-gray-300 text-sm">
                    {t.rank} — {t.max === Infinity ? `${t.min}+` : `${t.min}–${t.max}`} winning trades
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  const RankIcon = getMedalIcon(summary?.current_rank || 'Bronze');
  const rankColor = summary?.current_rank_color || '#CD7F32';

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Summary Banner */}
      {summary && (
        <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-2xl border border-gray-700/50 overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute -inset-1.5 rounded-full blur-xl opacity-40" style={{ background: rankColor }} />
                  <div
                    className="relative w-16 h-16 rounded-full flex items-center justify-center"
                    style={{
                      background: `linear-gradient(135deg, ${rankColor}20, ${rankColor}50)`,
                      border: `2px solid ${rankColor}`,
                    }}
                  >
                    <RankIcon className="w-8 h-8" style={{ color: rankColor }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold text-white">{summary.current_rank} Trader</h2>
                    {summary.wins_to_next_rank > 0 && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        {summary.wins_to_next_rank} to next rank
                      </span>
                    )}
                  </div>
                  <p className="text-gray-400 text-sm mt-0.5">
                    {summary.total_wins} profitable {summary.total_wins === 1 ? 'trade' : 'trades'} closed
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 border-t border-gray-700/50">
            {[
              { label: 'Total Profit', value: `$${(summary.total_pnl ?? 0).toFixed(2)}`, color: 'text-emerald-400', icon: TrendingUp },
              { label: 'Best Trade', value: `$${(summary.best_trade_pnl ?? 0).toFixed(2)}`, color: 'text-yellow-400', icon: Star },
              { label: 'Avg Per Trade', value: `$${(summary.avg_pnl ?? 0).toFixed(2)}`, color: 'text-blue-400', icon: BarChart2 },
              { label: 'Best Symbol', value: summary.best_symbol || '—', color: 'text-orange-400', icon: Target },
            ].map(({ label, value, color, icon: Icon }) => (
              <div key={label} className="p-5 border-r last:border-r-0 border-gray-700/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <span className="text-gray-400 text-xs">{label}</span>
                </div>
                <div className={`text-xl font-bold ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {(['all', 'tp1', 'tp2', 'manual'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              filter === f
                ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/20'
                : 'bg-gray-800/60 text-gray-400 hover:text-white hover:bg-gray-700/60 border border-gray-700/50'
            }`}
          >
            {f === 'all' ? `All (${achievements.length})` : f === 'tp1' ? 'TP1 Hits' : f === 'tp2' ? 'TP2 Hits' : 'Manual'}
          </button>
        ))}
      </div>

      {/* Achievement Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((a, idx) => {
          const Icon = getMedalIcon(a.medal_rank);
          const isTP2 = a.close_reason === 'take_profit_2';
          return (
            <div
              key={a.achievement_id}
              className="group relative animate-in fade-in slide-in-from-bottom-4 duration-500"
              style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
            >
              {/* Glow */}
              <div
                className="absolute -inset-0.5 rounded-2xl blur-sm opacity-0 group-hover:opacity-40 transition-all duration-300"
                style={{ background: `linear-gradient(135deg, ${a.medal_color}, transparent)` }}
              />

              <div className="relative bg-gray-800/80 rounded-2xl border border-gray-700/60 hover:border-gray-600/80 p-5 transition-all duration-200 hover:scale-[1.01]">

                {/* Header row */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: `linear-gradient(135deg, ${a.medal_color}20, ${a.medal_color}40)`,
                        border: `1.5px solid ${a.medal_color}60`,
                      }}
                    >
                      <Icon className="w-5 h-5" style={{ color: a.medal_color }} />
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">Win #{a.trade_number}</div>
                      <div
                        className="text-xs font-semibold px-1.5 py-0.5 rounded inline-block"
                        style={{ background: `${a.medal_color}15`, color: a.medal_color }}
                      >
                        {a.medal_rank}
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-lg font-bold text-emerald-400">
                      +${(a.pnl ?? 0).toFixed(2)}
                    </div>
                    {isTP2 && (
                      <div className="flex items-center justify-end gap-0.5">
                        <Zap className="w-3 h-3 text-yellow-400" />
                        <span className="text-xs text-yellow-400 font-medium">Full TP</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Symbol + direction */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-white font-bold text-base">{a.symbol}</span>
                  <span className={`flex items-center gap-0.5 text-xs font-semibold px-1.5 py-0.5 rounded ${
                    a.direction === 'BUY'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : 'bg-red-500/15 text-red-400'
                  }`}>
                    {a.direction === 'BUY'
                      ? <TrendingUp className="w-3 h-3" />
                      : <TrendingDown className="w-3 h-3" />
                    }
                    {a.direction}
                  </span>
                  {a.trade_style && (
                    <span className="text-xs text-gray-500 bg-gray-700/50 px-1.5 py-0.5 rounded">
                      {formatStyle(a.trade_style)}
                    </span>
                  )}
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  <div className="bg-gray-700/30 rounded-lg p-2">
                    <div className="text-gray-500">Close</div>
                    <div className="text-gray-200 font-medium truncate">{formatCloseReason(a.close_reason)}</div>
                  </div>
                  <div className="bg-gray-700/30 rounded-lg p-2">
                    <div className="text-gray-500">Lot Size</div>
                    <div className="text-gray-200 font-medium">{a.lot_size > 0 ? a.lot_size.toFixed(2) : '—'}</div>
                  </div>
                </div>

                {/* Date */}
                <div className="text-xs text-gray-600">
                  {new Date(a.achieved_at).toLocaleDateString('en-US', {
                    month: 'short', day: 'numeric', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && achievements.length > 0 && (
        <div className="text-center py-12 text-gray-500">
          No wins matching this filter yet.
        </div>
      )}
    </div>
  );
};
