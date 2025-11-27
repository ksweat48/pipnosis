import React, { useEffect, useState } from 'react';
import { Trophy, TrendingUp, Target, Award, Activity } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TraderScore {
  current_score: number;
  confidence_level: string;
  risk_appetite: number;
  trading_style: string;
  total_trades: number;
  total_wins: number;
  total_losses: number;
  win_rate: number;
  profit_factor: number;
  streak_wins: number;
  streak_losses: number;
  best_win_streak: number;
  lifetime_profit: number;
  lifetime_loss: number;
}

interface TraderScoreDashboardProps {
  userId: string;
}

export function TraderScoreDashboard({ userId }: TraderScoreDashboardProps) {
  const [score, setScore] = useState<TraderScore | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadScore();
  }, [userId]);

  const loadScore = async () => {
    try {
      const { data, error } = await supabase
        .from('ai_trader_score')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          console.log('[TraderScore] No score found, initializing...');
          setScore(null);
        } else {
          throw error;
        }
      } else {
        setScore(data);
      }
    } catch (error) {
      console.error('[TraderScore] Error loading score:', error);
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

  if (!score) {
    return (
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-6">
        <div className="text-center">
          <Trophy className="w-12 h-12 text-gray-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">No Trader Score Yet</h3>
          <p className="text-gray-400 text-sm">
            Start your first autonomous trading session to begin building your trader score
          </p>
        </div>
      </div>
    );
  }

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 70) return 'text-blue-400';
    if (score >= 50) return 'text-yellow-400';
    return 'text-orange-400';
  };

  const getPersonalityColor = (level: string) => {
    if (level === 'confident') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
    if (level === 'balanced') return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
    if (level === 'cautious') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
    return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  };

  const netPnL = (score.lifetime_profit || 0) - (Math.abs(score.lifetime_loss || 0));

  return (
    <div className="space-y-4">
      {/* Main Score Card */}
      <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 backdrop-blur-sm border-2 border-gray-700 rounded-lg p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Trophy className="w-6 h-6 text-yellow-400" />
              <h2 className="text-xl font-bold text-white">Trader Score</h2>
            </div>
            <p className="text-gray-400 text-sm">Autonomous AI Performance Rating</p>
          </div>
          <div className="text-right">
            <div className={`text-5xl font-bold ${getScoreColor(score.current_score)}`}>
              {score.current_score}
            </div>
            <div className="text-gray-500 text-sm">/ 100</div>
          </div>
        </div>

        {/* Personality Badge */}
        <div className="flex items-center gap-3 mb-4">
          <span className="text-gray-400 text-sm">Personality:</span>
          <span className={`px-3 py-1 rounded-full text-sm font-semibold border uppercase ${getPersonalityColor(score.confidence_level)}`}>
            {score.confidence_level}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="relative h-3 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="absolute top-0 left-0 h-full bg-gradient-to-r from-emerald-500 to-blue-500 transition-all duration-500"
            style={{ width: `${score.current_score}%` }}
          ></div>
        </div>

        {/* Score Ranges */}
        <div className="grid grid-cols-4 gap-2 mt-4 text-xs">
          <div className="text-center">
            <div className="text-orange-400">0-49</div>
            <div className="text-gray-500">Defensive</div>
          </div>
          <div className="text-center">
            <div className="text-yellow-400">50-69</div>
            <div className="text-gray-500">Cautious</div>
          </div>
          <div className="text-center">
            <div className="text-blue-400">70-89</div>
            <div className="text-gray-500">Balanced</div>
          </div>
          <div className="text-center">
            <div className="text-emerald-400">90-100</div>
            <div className="text-gray-500">Confident</div>
          </div>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Risk Appetite */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Target className="w-5 h-5 text-blue-400" />
            <div className="text-xs text-gray-400">Risk Appetite</div>
          </div>
          <div className="text-2xl font-bold text-white">{score.risk_appetite}%</div>
        </div>

        {/* Win Rate */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <div className="text-xs text-gray-400">Win Rate</div>
          </div>
          <div className="text-2xl font-bold text-white">
            {score.win_rate ? `${score.win_rate.toFixed(1)}%` : '0%'}
          </div>
        </div>

        {/* Current Streak */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="w-5 h-5 text-yellow-400" />
            <div className="text-xs text-gray-400">Current Streak</div>
          </div>
          <div className="text-2xl font-bold text-white">
            {score.streak_wins > 0 ? (
              <span className="text-emerald-400">+{score.streak_wins}</span>
            ) : score.streak_losses > 0 ? (
              <span className="text-red-400">-{score.streak_losses}</span>
            ) : (
              <span className="text-gray-500">0</span>
            )}
          </div>
        </div>

        {/* Profit Factor */}
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-2">
            <Award className="w-5 h-5 text-purple-400" />
            <div className="text-xs text-gray-400">Profit Factor</div>
          </div>
          <div className="text-2xl font-bold text-white">
            {score.profit_factor ? score.profit_factor.toFixed(2) : '0.00'}
          </div>
        </div>
      </div>

      {/* Performance Summary */}
      <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Performance Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-gray-400 mb-1">Total Trades</div>
            <div className="text-lg font-semibold text-white">{score.total_trades || 0}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">W/L Ratio</div>
            <div className="text-lg font-semibold text-white">
              {score.total_wins || 0}/{score.total_losses || 0}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Best Streak</div>
            <div className="text-lg font-semibold text-emerald-400">
              {score.best_win_streak || 0} wins
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">Net P&L</div>
            <div className={`text-lg font-semibold ${netPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${netPnL.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Trading Style */}
      {score.trading_style && (
        <div className="bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-lg p-4">
          <div className="text-xs text-gray-400 mb-1">Trading Style</div>
          <div className="text-sm text-white font-medium capitalize">{score.trading_style}</div>
        </div>
      )}
    </div>
  );
}
