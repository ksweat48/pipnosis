import { useState, useEffect } from 'react';
import { X, TrendingUp, Shield, Zap, DollarSign, Target } from 'lucide-react';
import { goalSessionManager } from '../services/goal-session-manager';
import { GoalRewardDisplay } from './GoalRewardDisplay';
import { supabase } from '../lib/supabase';

interface GoalAchievedModalProps {
  notification: any;
  onClose: () => void;
  onActionTaken: () => void;
}

export function GoalAchievedModal({ notification, onClose, onActionTaken }: GoalAchievedModalProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedAction, setSelectedAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rewardData, setRewardData] = useState<any | null>(null);

  const data = notification.data || {};
  const actions = notification.actions || [];

  // Fetch reward data
  useEffect(() => {
    const fetchRewardData = async () => {
      if (!data.achievement_id) return;

      try {
        const { data: rewardHistory } = await supabase
          .from('goal_reward_history')
          .select('*')
          .eq('goal_achievement_id', data.achievement_id)
          .eq('reward_type', 'goal_achieved')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (rewardHistory) {
          setRewardData(rewardHistory);
        }
      } catch (error) {
        console.error('Error fetching reward data:', error);
      }
    };

    fetchRewardData();
  }, [data.achievement_id]);

  const handleAction = async (actionId: string) => {
    setIsProcessing(true);
    setSelectedAction(actionId);
    setError(null);

    try {
      const result = await goalSessionManager.handleGoalAchievementAction(
        notification.user_id,
        notification.goal_session_id,
        actionId as 'close_now' | 'continue_breakeven' | 'continue_safety',
        notification.id
      );

      if (result.success) {
        onActionTaken();

        // Show success message briefly before closing
        setTimeout(() => {
          onClose();
        }, 2000);
      } else {
        setError(result.message);
        setIsProcessing(false);
      }
    } catch (err) {
      console.error('Error handling action:', err);
      setError('Failed to process your choice. Please try again.');
      setIsProcessing(false);
    }
  };

  const getActionIcon = (iconString: string) => {
    switch (iconString) {
      case '💰':
        return <DollarSign className="w-6 h-6" />;
      case '🛡️':
        return <Shield className="w-6 h-6" />;
      case '⚡':
        return <Zap className="w-6 h-6" />;
      default:
        return <Target className="w-6 h-6" />;
    }
  };

  const getActionColor = (actionId: string) => {
    switch (actionId) {
      case 'close_now':
        return 'bg-green-600 hover:bg-green-700 border-green-500';
      case 'continue_breakeven':
        return 'bg-blue-600 hover:bg-blue-700 border-blue-500';
      case 'continue_safety':
        return 'bg-purple-600 hover:bg-purple-700 border-purple-500';
      default:
        return 'bg-gray-600 hover:bg-gray-700 border-gray-500';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-2xl shadow-2xl border border-gray-700 max-w-2xl w-full max-h-[700px] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'auto' }}>
        {/* Header */}
        <div className="relative bg-gradient-to-r from-green-600 to-emerald-600 p-8 rounded-t-2xl">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
            disabled={isProcessing}
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-white/20 backdrop-blur-sm p-4 rounded-full">
              <Target className="w-12 h-12 text-white" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white mb-1">
                🎯 Goal Achieved!
              </h2>
              <p className="text-green-100">
                This win is now permanently logged in your records
              </p>
            </div>
          </div>
        </div>

        {/* Achievement Details */}
        <div className="p-6 bg-gray-800/50 border-b border-gray-700">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Target Amount</div>
              <div className="text-2xl font-bold text-white">
                ${data.target_amount?.toFixed(2)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Current P&L</div>
              <div className="text-2xl font-bold text-green-400">
                ${data.current_pnl?.toFixed(2)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Potential to TP</div>
              <div className="text-2xl font-bold text-blue-400">
                ${data.tp_potential?.toFixed(0)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Symbol</div>
              <div className="text-2xl font-bold text-white">
                {data.symbol}
              </div>
            </div>
          </div>

          {/* Reward Display */}
          {rewardData && (
            <div className="mt-4">
              <GoalRewardDisplay
                scoreChange={rewardData.score_change}
                newScore={rewardData.new_score}
                oldScore={rewardData.old_score}
                factors={rewardData.reward_factors || []}
                personalityChanged={rewardData.personality_changed || false}
                oldPersonality={rewardData.old_personality}
                newPersonality={rewardData.new_personality}
              />
            </div>
          )}

          {/* Trade Details */}
          <div className="mt-4 bg-gray-800/50 rounded-lg p-4 text-sm">
            <div className="grid grid-cols-3 gap-3 text-gray-300">
              <div>
                <span className="text-gray-500">Entry:</span>{' '}
                <span className="font-mono">{data.entry_price?.toFixed(5)}</span>
              </div>
              <div>
                <span className="text-gray-500">Current:</span>{' '}
                <span className="font-mono text-green-400">{data.current_price?.toFixed(5)}</span>
              </div>
              <div>
                <span className="text-gray-500">TP:</span>{' '}
                <span className="font-mono text-blue-400">{data.take_profit?.toFixed(5)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action Choices */}
        <div className="p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-400" />
            What would you like to do?
          </h3>

          {error && (
            <div className="mb-4 p-4 bg-red-900/30 border border-red-500 rounded-lg text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {actions.map((action: any) => {
              const isSelected = selectedAction === action.id;
              const isDisabled = isProcessing && !isSelected;

              return (
                <button
                  key={action.id}
                  onClick={() => handleAction(action.id)}
                  disabled={isProcessing}
                  className={`
                    w-full text-left p-5 rounded-xl border-2 transition-all
                    ${getActionColor(action.id)}
                    ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
                    ${isSelected ? 'ring-4 ring-white/30 scale-105' : ''}
                    disabled:cursor-not-allowed
                  `}
                >
                  <div className="flex items-start gap-4">
                    <div className={`
                      p-3 rounded-lg bg-white/10
                      ${isSelected ? 'animate-pulse' : ''}
                    `}>
                      {getActionIcon(action.icon)}
                    </div>
                    <div className="flex-1">
                      <div className="text-lg font-bold text-white mb-1">
                        {action.label}
                      </div>
                      <div className="text-sm text-white/80">
                        {action.description}
                      </div>
                      {isSelected && isProcessing && (
                        <div className="mt-2 text-sm text-white/90 font-medium">
                          Processing your choice...
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Important Notice */}
          <div className="mt-6 p-4 bg-blue-900/20 border border-blue-500/30 rounded-lg">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-200">
                <strong className="text-blue-100">Important:</strong> If you don't respond within 5 minutes,
                we'll automatically move your stop loss to breakeven to protect your profits.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
