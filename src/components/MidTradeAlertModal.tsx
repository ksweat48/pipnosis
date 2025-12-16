import { useState, useEffect } from 'react';
import { X, AlertTriangle, TrendingDown, DollarSign, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface MidTradeAlertModalProps {
  notification: any;
  onClose: () => void;
  onExecuted: () => void;
}

export function MidTradeAlertModal({ notification, onClose, onExecuted }: MidTradeAlertModalProps) {
  const [secondsRemaining, setSecondsRemaining] = useState(30);
  const [isAcknowledged, setIsAcknowledged] = useState(false);

  const data = notification.data || {};
  const recommendationData = notification.recommendation_data || {};
  const tradeContext = notification.trade_context || {};

  const recommendation = recommendationData.recommendation || 'UNKNOWN';
  const reasoning = recommendationData.reasoning || 'No reasoning provided';
  const confidence = recommendationData.confidence || 0;

  const isExitImmediately = recommendation === 'EXIT_IMMEDIATELY';
  const isTakeProfitEarly = recommendation === 'TAKE_PROFIT_EARLY';

  // Countdown timer
  useEffect(() => {
    const autoExecuteAt = notification.auto_execute_at ? new Date(notification.auto_execute_at) : null;
    if (!autoExecuteAt) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((autoExecuteAt.getTime() - now) / 1000));
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        clearInterval(interval);
        onExecuted();
      }
    }, 100);

    return () => clearInterval(interval);
  }, [notification.auto_execute_at, onExecuted]);

  const handleAcknowledge = async () => {
    setIsAcknowledged(true);

    // Update notification in database
    try {
      await supabase
        .from('goal_notifications')
        .update({
          user_responded: true,
          acknowledged_at: new Date().toISOString(),
          viewed: true
        })
        .eq('id', notification.id);
    } catch (error) {
      console.error('Error acknowledging notification:', error);
    }

    // Close modal but execution continues
    onClose();
  };

  // Theme based on recommendation type
  const getTheme = () => {
    if (isExitImmediately) {
      return {
        gradient: 'from-red-600 to-red-700',
        bg: 'bg-red-600/10',
        border: 'border-red-500/30',
        text: 'text-red-400',
        icon: <AlertTriangle className="w-12 h-12 text-white" />,
        title: 'Emergency Exit Required',
        subtitle: 'Market conditions unfavorable - protecting your account'
      };
    } else if (isTakeProfitEarly) {
      return {
        gradient: 'from-yellow-600 to-orange-600',
        bg: 'bg-yellow-600/10',
        border: 'border-yellow-500/30',
        text: 'text-yellow-400',
        icon: <DollarSign className="w-12 h-12 text-white" />,
        title: 'Take Profit Early',
        subtitle: 'Momentum weakening - securing gains now'
      };
    } else {
      return {
        gradient: 'from-blue-600 to-blue-700',
        bg: 'bg-blue-600/10',
        border: 'border-blue-500/30',
        text: 'text-blue-400',
        icon: <TrendingDown className="w-12 h-12 text-white" />,
        title: 'Mid-Trade Alert',
        subtitle: 'Alpha has detected a market change'
      };
    }
  };

  const theme = getTheme();
  const progress = (secondsRemaining / 30) * 100;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div
        className={`bg-gray-900 rounded-2xl shadow-2xl border ${theme.border} max-w-2xl w-full max-h-[90vh] overflow-y-auto animate-pulse-border`}
        style={{
          animation: isExitImmediately ? 'pulse-border 1s ease-in-out infinite' : 'none'
        }}
      >
        {/* Header */}
        <div className={`relative bg-gradient-to-r ${theme.gradient} p-8 rounded-t-2xl`}>
          <button
            onClick={handleAcknowledge}
            className="absolute top-4 right-4 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-6 h-6" />
          </button>

          <div className="flex items-center gap-4">
            <div className="bg-white/20 backdrop-blur-sm p-4 rounded-full">
              {theme.icon}
            </div>
            <div>
              <h2 className="text-3xl font-bold text-white mb-1">
                {theme.title}
              </h2>
              <p className="text-white/90 text-lg">
                {theme.subtitle}
              </p>
            </div>
          </div>
        </div>

        {/* Countdown Timer */}
        <div className={`p-6 ${theme.bg} border-b ${theme.border}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Clock className={`w-8 h-8 ${theme.text}`} />
              <div>
                <div className="text-2xl font-bold text-white">
                  Alpha executing in: {secondsRemaining}s
                </div>
                <div className="text-sm text-gray-400 mt-1">
                  This action will be taken automatically to protect your account
                </div>
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-4 w-full h-3 bg-gray-800 rounded-full overflow-hidden">
            <div
              className={`h-full ${isExitImmediately ? 'bg-red-500' : 'bg-yellow-500'} transition-all duration-1000 ease-linear`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Trade Context */}
        <div className="p-6 bg-gray-800/50 border-b border-gray-700">
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Symbol</div>
              <div className="text-2xl font-bold text-white">
                {tradeContext.symbol || data.symbol}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Direction</div>
              <div className="text-2xl font-bold text-white uppercase">
                {tradeContext.direction || data.direction}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Current P&L</div>
              <div className={`text-2xl font-bold ${(tradeContext.current_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                ${(tradeContext.current_pnl || data.current_pnl || 0).toFixed(2)}
              </div>
            </div>
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="text-gray-400 text-sm mb-1">Confidence</div>
              <div className="text-2xl font-bold text-blue-400">
                {confidence}%
              </div>
            </div>
          </div>

          {/* Price Details */}
          <div className="bg-gray-800/50 rounded-lg p-4 text-sm">
            <div className="grid grid-cols-3 gap-3 text-gray-300">
              <div>
                <span className="text-gray-500">Entry:</span>{' '}
                <span className="font-mono">{(tradeContext.entry_price || data.entry_price)?.toFixed(5)}</span>
              </div>
              <div>
                <span className="text-gray-500">Current:</span>{' '}
                <span className="font-mono text-yellow-400">{(tradeContext.current_price || data.current_price)?.toFixed(5)}</span>
              </div>
              <div>
                <span className="text-gray-500">SL:</span>{' '}
                <span className="font-mono text-red-400">{(tradeContext.stop_loss || data.stop_loss)?.toFixed(5)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Alpha's Reasoning */}
        <div className="p-6 bg-gray-900">
          <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <AlertTriangle className={`w-5 h-5 ${theme.text}`} />
            Alpha's Analysis
          </h3>
          <div className="bg-gray-800/70 rounded-lg p-4 border border-gray-700">
            <p className="text-gray-200 leading-relaxed">
              {reasoning}
            </p>
          </div>

          {/* Recommendation */}
          <div className={`mt-4 ${theme.bg} border ${theme.border} rounded-lg p-4`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-400">Recommendation</div>
                <div className={`text-xl font-bold ${theme.text}`}>
                  {recommendation.replace(/_/g, ' ')}
                </div>
              </div>
              <div className={`px-4 py-2 rounded-lg ${theme.bg} border ${theme.border}`}>
                <div className="text-sm text-gray-400">Processing Time</div>
                <div className="text-lg font-bold text-white">
                  {recommendationData.processingTimeMs || 0}ms
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <div className="p-6 bg-gray-800/50 border-t border-gray-700">
          <button
            onClick={handleAcknowledge}
            disabled={isAcknowledged}
            className={`w-full py-4 rounded-lg font-bold text-lg transition-all ${
              isAcknowledged
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : `${isExitImmediately ? 'bg-red-600 hover:bg-red-700' : 'bg-yellow-600 hover:bg-yellow-700'} text-white hover:scale-105`
            }`}
          >
            {isAcknowledged ? 'Acknowledged - Alpha Executing...' : 'I Understand - Acknowledge'}
          </button>
          <p className="text-center text-gray-500 text-sm mt-3">
            Action will execute automatically. Acknowledge button only dismisses this notification.
          </p>
        </div>
      </div>
    </div>
  );
}
