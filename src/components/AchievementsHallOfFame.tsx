import React, { useState, useEffect, useRef } from 'react';
import { Trophy, Award, Medal, Gem, Shield, TrendingUp, Clock, Target, Share2, Download, Sparkles, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

interface Achievement {
  achievement_id: string;
  session_id: string;
  achievement_number: number;
  goal_type: string;
  target_value: number;
  timeframe: string;
  final_profit: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  session_duration_hours: number;
  achieved_at: string;
  medal_rank: string;
  medal_color: string;
  best_trade_symbol: string;
  best_trade_profit: number;
  risk_mode: string;
}

interface AchievementSummary {
  total_goals_achieved: number;
  total_profit: number;
  best_goal_amount: number;
  average_trades_per_goal: number;
  total_session_hours: number;
  current_rank: string;
  current_rank_color: string;
  goals_to_next_rank: number;
}

export const AchievementsHallOfFame: React.FC = () => {
  const { user } = useAuth();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [summary, setSummary] = useState<AchievementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const plaqueRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user) {
      loadAchievements();
    }
  }, [user]);

  const loadAchievements = async () => {
    if (!user) return;

    try {
      setLoading(true);

      const [achievementsRes, summaryRes] = await Promise.all([
        supabase.rpc('get_user_achievements', { p_user_id: user.id }),
        supabase.rpc('get_achievement_summary', { p_user_id: user.id })
      ]);

      if (achievementsRes.error) throw achievementsRes.error;
      if (summaryRes.error) throw summaryRes.error;

      setAchievements(achievementsRes.data || []);
      setSummary(summaryRes.data?.[0] || null);
    } catch (error) {
      console.error('Error loading achievements:', error);
    } finally {
      setLoading(false);
    }
  };

  const getMedalIcon = (rank: string) => {
    switch (rank) {
      case 'Platinum': return Trophy;
      case 'Diamond': return Gem;
      case 'Gold': return Medal;
      case 'Silver': return Award;
      default: return Shield;
    }
  };

  const formatDuration = (hours: number) => {
    if (hours < 1) {
      return `${Math.round(hours * 60)}m`;
    } else if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return `${days}d ${remainingHours}h`;
    }
  };

  const handleShare = async (achievement: Achievement) => {
    setSelectedAchievement(achievement);
    setShareModalOpen(true);
  };

  const downloadAchievementImage = async () => {
    if (!plaqueRef.current || !selectedAchievement) return;

    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(plaqueRef.current, {
        backgroundColor: null,
        scale: 2
      });

      const link = document.createElement('a');
      link.download = `achievement-${selectedAchievement.achievement_number}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (error) {
      console.error('Error downloading achievement:', error);
    }
  };

  const shareToClipboard = async () => {
    if (!selectedAchievement) return;

    const text = `🏆 Achievement Unlocked! I just completed Goal #${selectedAchievement.achievement_number} with Pipnosis AI Trading!\n\n💰 Target: $${selectedAchievement.target_value}\n📈 Profit: $${selectedAchievement.final_profit.toFixed(2)}\n🎯 Trades: ${selectedAchievement.total_trades}\n⭐ Win Rate: ${selectedAchievement.win_rate.toFixed(1)}%\n\n${selectedAchievement.medal_rank} Medal Tier! 🎖️`;

    try {
      await navigator.clipboard.writeText(text);
      alert('Achievement copied to clipboard!');
    } catch (error) {
      console.error('Error copying to clipboard:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-400" />
      </div>
    );
  }

  if (!achievements.length) {
    return (
      <div className="max-w-2xl mx-auto py-20">
        <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-2xl p-12 border border-gray-700/50 text-center backdrop-blur-sm">
          <div className="mb-6">
            <div className="inline-flex items-center justify-center w-24 h-24 bg-gradient-to-br from-gray-700 to-gray-800 rounded-full mb-4">
              <Trophy className="w-12 h-12 text-gray-500" />
            </div>
          </div>
          <h3 className="text-2xl font-bold text-white mb-3">No Achievements Yet</h3>
          <p className="text-gray-400 text-lg mb-8">
            Complete your first goal to start building your hall of fame!
          </p>
          <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
            <h4 className="text-white font-semibold mb-4">Medal Progression</h4>
            <div className="space-y-3 text-left">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5" style={{ color: '#CD7F32' }} />
                <span className="text-gray-300">Bronze: 1-10 goals</span>
              </div>
              <div className="flex items-center gap-3">
                <Award className="w-5 h-5" style={{ color: '#C0C0C0' }} />
                <span className="text-gray-300">Silver: 11-25 goals</span>
              </div>
              <div className="flex items-center gap-3">
                <Medal className="w-5 h-5" style={{ color: '#FFD700' }} />
                <span className="text-gray-300">Gold: 26-100 goals</span>
              </div>
              <div className="flex items-center gap-3">
                <Gem className="w-5 h-5" style={{ color: '#B9F2FF' }} />
                <span className="text-gray-300">Diamond: 101-250 goals</span>
              </div>
              <div className="flex items-center gap-3">
                <Trophy className="w-5 h-5" style={{ color: '#E5E4E2' }} />
                <span className="text-gray-300">Platinum: 256-1000 goals</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const MedalIcon = getMedalIcon(summary?.current_rank || 'Bronze');

  return (
    <div className="max-w-7xl mx-auto">
      {summary && (
        <div className="mb-8">
          <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-2xl p-6 border border-gray-700/50 backdrop-blur-sm">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="absolute -inset-1 bg-gradient-to-r opacity-50 blur-lg rounded-full" style={{ background: summary.current_rank_color }} />
                  <div className="relative w-16 h-16 rounded-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${summary.current_rank_color}20, ${summary.current_rank_color}40)`, border: `2px solid ${summary.current_rank_color}` }}>
                    <MedalIcon className="w-8 h-8" style={{ color: summary.current_rank_color }} />
                  </div>
                </div>
                <div>
                  <h2 className="text-3xl font-bold text-white mb-1">{summary.current_rank} Trader</h2>
                  <p className="text-gray-400">
                    {summary.total_goals_achieved} {summary.total_goals_achieved === 1 ? 'Goal' : 'Goals'} Achieved
                    {summary.goals_to_next_rank > 0 && (
                      <span className="ml-2 text-emerald-400">
                        • {summary.goals_to_next_rank} to next rank
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <Sparkles className="w-6 h-6 text-yellow-400 animate-pulse" />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-gray-400 text-sm mb-1">Total Profit</div>
                <div className="text-2xl font-bold text-emerald-400">
                  ${summary.total_profit.toFixed(2)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-gray-400 text-sm mb-1">Best Goal</div>
                <div className="text-2xl font-bold text-blue-400">
                  ${summary.best_goal_amount.toFixed(0)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-gray-400 text-sm mb-1">Avg Trades</div>
                <div className="text-2xl font-bold text-purple-400">
                  {summary.average_trades_per_goal.toFixed(1)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 border border-gray-700/50">
                <div className="text-gray-400 text-sm mb-1">Total Time</div>
                <div className="text-2xl font-bold text-orange-400">
                  {formatDuration(summary.total_session_hours)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {achievements.map((achievement, index) => {
          const MedalIcon = getMedalIcon(achievement.medal_rank);
          return (
            <div
              key={achievement.achievement_id}
              className="group relative animate-in fade-in slide-in-from-bottom-4 duration-500"
              style={{ animationDelay: `${index * 50}ms` }}
            >
              <div className="absolute -inset-0.5 bg-gradient-to-r opacity-30 blur-lg rounded-2xl group-hover:opacity-50 transition duration-300" style={{ background: `linear-gradient(135deg, ${achievement.medal_color}40, ${achievement.medal_color}20)` }} />

              <div className="relative bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-6 border border-gray-700 hover:border-gray-600 transition-all duration-300 hover:scale-[1.02]">
                <div className="absolute top-4 right-4">
                  <button
                    onClick={() => handleShare(achievement)}
                    className="p-2 bg-gray-700/50 hover:bg-gray-700 rounded-lg transition-colors"
                  >
                    <Share2 className="w-4 h-4 text-gray-400" />
                  </button>
                </div>

                <div className="flex items-center gap-4 mb-4">
                  <div className="relative">
                    <div className="absolute -inset-1 blur-md rounded-full" style={{ background: achievement.medal_color, opacity: 0.4 }} />
                    <div className="relative w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${achievement.medal_color}30, ${achievement.medal_color}60)`, border: `2px solid ${achievement.medal_color}` }}>
                      <MedalIcon className="w-7 h-7" style={{ color: achievement.medal_color }} />
                    </div>
                  </div>
                  <div>
                    <div className="text-sm text-gray-400">Goal #{achievement.achievement_number}</div>
                    <div className="text-xs px-2 py-1 rounded-full inline-block mt-1" style={{ background: `${achievement.medal_color}20`, color: achievement.medal_color }}>
                      {achievement.medal_rank}
                    </div>
                  </div>
                </div>

                <div className="space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Target</span>
                    <span className="text-white font-bold text-lg">${achievement.target_value.toFixed(0)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Profit</span>
                    <span className="text-emerald-400 font-bold text-lg">${achievement.final_profit.toFixed(2)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Trades</span>
                    <span className="text-blue-400 font-semibold">{achievement.total_trades}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Win Rate</span>
                    <span className="text-purple-400 font-semibold">{achievement.win_rate.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400 text-sm">Duration</span>
                    <span className="text-orange-400 font-semibold">{formatDuration(achievement.session_duration_hours)}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-gray-700">
                  <div className="text-xs text-gray-500">
                    {new Date(achievement.achieved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {shareModalOpen && selectedAchievement && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-gray-900 rounded-2xl p-6 max-w-md w-full border border-gray-700">
            <h3 className="text-xl font-bold text-white mb-4">Share Achievement</h3>

            <div ref={plaqueRef} className="mb-6 p-6 bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border-2" style={{ borderColor: selectedAchievement.medal_color }}>
              <div className="flex items-center gap-4 mb-4">
                {React.createElement(getMedalIcon(selectedAchievement.medal_rank), {
                  className: 'w-12 h-12',
                  style: { color: selectedAchievement.medal_color }
                })}
                <div>
                  <div className="text-2xl font-bold text-white">Goal #{selectedAchievement.achievement_number}</div>
                  <div className="text-sm" style={{ color: selectedAchievement.medal_color }}>{selectedAchievement.medal_rank} Achievement</div>
                </div>
              </div>
              <div className="space-y-2 text-white">
                <div>Target: ${selectedAchievement.target_value}</div>
                <div className="text-emerald-400 font-bold">Profit: ${selectedAchievement.final_profit.toFixed(2)}</div>
                <div>Trades: {selectedAchievement.total_trades} • Win Rate: {selectedAchievement.win_rate.toFixed(1)}%</div>
              </div>
            </div>

            <div className="space-y-3">
              <button
                onClick={shareToClipboard}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-semibold transition-colors"
              >
                <Share2 className="w-5 h-5" />
                Copy to Clipboard
              </button>
              <button
                onClick={downloadAchievementImage}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg text-white font-semibold transition-colors"
              >
                <Download className="w-5 h-5" />
                Download Image
              </button>
              <button
                onClick={() => setShareModalOpen(false)}
                className="w-full px-4 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-semibold transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
