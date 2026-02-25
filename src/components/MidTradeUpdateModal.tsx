import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, AlertTriangle, Clock, Target, Shield } from 'lucide-react';
import { midTradeNotificationQueue, MidTradeNotification } from '@/services/mid-trade-notification-queue';
import { audioAlertService } from '@/services/audio-alert-service';

interface MidTradeUpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function MidTradeUpdateModal({ isOpen, onClose }: MidTradeUpdateModalProps) {
  const [notification, setNotification] = useState<MidTradeNotification | null>(null);
  const [position, setPosition] = useState<number>(1);
  const [total, setTotal] = useState<number>(1);
  const [countdown, setCountdown] = useState<number>(20);
  const [isHovering, setIsHovering] = useState<boolean>(false);

  const handleDismiss = () => {
    midTradeNotificationQueue.dismissCurrent();
  };

  useEffect(() => {
    let audioPlayed = false;

    const handleShow = (data: { notification: MidTradeNotification; position: number; total: number }) => {
      setNotification(data.notification);
      setPosition(data.position);
      setTotal(data.total);
      setCountdown(20);

      // Play audio only once per notification
      if (!audioPlayed) {
        audioPlayed = true;
        audioAlertService.playMidTradeAlert();
      }
    };

    const handleHide = () => {
      setNotification(null);
      audioPlayed = false; // Reset for next notification
      onClose();
    };

    midTradeNotificationQueue.on('show-notification', handleShow);
    midTradeNotificationQueue.on('hide-notification', handleHide);

    return () => {
      midTradeNotificationQueue.off('show-notification', handleShow);
      midTradeNotificationQueue.off('hide-notification', handleHide);
    };
  }, [onClose]);

  useEffect(() => {
    if (!notification) return;

    // Reset countdown when notification changes
    setCountdown(20);
    let isMounted = true;

    const interval = setInterval(() => {
      if (!isMounted) return;

      setCountdown((prev) => {
        const newCount = prev - 1;
        if (newCount <= 0) {
          // Auto-dismiss after countdown ends
          if (isMounted) {
            handleDismiss();
          }
          return 0;
        }
        return newCount;
      });
    }, 1000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [notification]);

  if (!isOpen || !notification) return null;

  const { trade_context, recommendation_data, priority } = notification;

  const distanceToSL = Math.abs(
    ((trade_context.current_price - trade_context.stop_loss) / trade_context.current_price) * 100
  );
  const distanceToTP = Math.abs(
    ((trade_context.take_profit - trade_context.current_price) / trade_context.current_price) * 100
  );

  const slProgress = (distanceToSL / (distanceToSL + distanceToTP)) * 100;
  const tpProgress = (distanceToTP / (distanceToSL + distanceToTP)) * 100;

  const priorityColors = {
    urgent: 'border-red-500 bg-red-950/50',
    high: 'border-orange-500 bg-orange-950/50',
    medium: 'border-yellow-500 bg-yellow-950/50',
    low: 'border-blue-500 bg-blue-950/50'
  };

  const priorityGlow = {
    urgent: 'shadow-[0_0_30px_rgba(239,68,68,0.5)]',
    high: 'shadow-[0_0_30px_rgba(249,115,22,0.5)]',
    medium: 'shadow-[0_0_30px_rgba(234,179,8,0.5)]',
    low: 'shadow-[0_0_30px_rgba(59,130,246,0.5)]'
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-300">
      <div
        className={`
          relative w-full max-w-3xl rounded-2xl border-4 p-4 sm:p-8 max-h-[90dvh] overflow-y-auto
          ${priorityColors[priority]}
          ${priorityGlow[priority]}
          animate-in zoom-in duration-300
        `}
        style={{ WebkitOverflowScrolling: 'touch' }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {/* Queue indicator */}
        {total > 1 && (
          <div className="absolute top-4 right-4 bg-slate-800 px-3 py-1 rounded-full text-xs font-semibold text-slate-300">
            {position} of {total}
          </div>
        )}

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 left-4 p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X size={24} className="text-white" />
        </button>

        {/* Header */}
        <div className="text-center mb-6 mt-8">
          <div className="inline-flex items-center gap-2 bg-slate-800 px-4 py-2 rounded-full mb-3">
            <AlertTriangle className="text-yellow-400" size={20} />
            <span className="font-bold text-white uppercase tracking-wide">Mid-Trade Update</span>
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">{recommendation_data.trigger_type}</h2>
          <p className="text-slate-300 text-lg">{recommendation_data.trigger_reason}</p>
        </div>

        {/* Trade info */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-slate-800/50 p-4 rounded-xl">
            <div className="text-slate-400 text-sm mb-1">Symbol</div>
            <div className="text-white text-xl font-bold flex items-center gap-2">
              {trade_context.symbol}
              {trade_context.direction === 'buy' ? (
                <TrendingUp className="text-green-400" size={24} />
              ) : (
                <TrendingDown className="text-red-400" size={24} />
              )}
            </div>
          </div>

          <div className="bg-slate-800/50 p-4 rounded-xl">
            <div className="text-slate-400 text-sm mb-1">Current P&L</div>
            <div
              className={`text-xl font-bold ${
                trade_context.pnl >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              ${trade_context.pnl.toFixed(2)} ({trade_context.pnl_percentage.toFixed(2)}%)
            </div>
          </div>

          <div className="bg-slate-800/50 p-4 rounded-xl">
            <div className="text-slate-400 text-sm mb-1">R Multiple</div>
            <div
              className={`text-xl font-bold ${
                trade_context.r_multiple >= 0 ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {trade_context.r_multiple >= 0 ? '+' : ''}
              {trade_context.r_multiple.toFixed(2)}R
            </div>
          </div>

          <div className="bg-slate-800/50 p-4 rounded-xl">
            <div className="text-slate-400 text-sm mb-1 flex items-center gap-1">
              <Clock size={14} />
              Time in Trade
            </div>
            <div className="text-white text-xl font-bold">
              {Math.floor(trade_context.time_in_trade_minutes / 60)}h {trade_context.time_in_trade_minutes % 60}m
            </div>
          </div>
        </div>

        {/* Price levels */}
        <div className="mb-6 bg-slate-800/50 p-4 rounded-xl">
          <div className="grid grid-cols-3 gap-4 text-center mb-3">
            <div>
              <div className="text-slate-400 text-xs mb-1">Entry</div>
              <div className="text-white font-semibold">{trade_context.entry_price.toFixed(5)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Current</div>
              <div className="text-yellow-400 font-bold text-lg">{trade_context.current_price.toFixed(5)}</div>
            </div>
            <div>
              <div className="text-slate-400 text-xs mb-1">Distance</div>
              <div className="text-white font-semibold">
                {Math.abs(trade_context.current_price - trade_context.entry_price).toFixed(5)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1 text-red-400">
                  <Shield size={12} />
                  Stop Loss: {trade_context.stop_loss.toFixed(5)}
                </div>
                <div className="text-slate-400">{distanceToSL.toFixed(2)}% away</div>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-red-500 transition-all duration-500"
                  style={{ width: `${slProgress}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1">
                <div className="flex items-center gap-1 text-green-400">
                  <Target size={12} />
                  Take Profit: {trade_context.take_profit.toFixed(5)}
                </div>
                <div className="text-slate-400">{distanceToTP.toFixed(2)}% away</div>
              </div>
              <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-500"
                  style={{ width: `${tpProgress}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* LLM Recommendation */}
        <div className="bg-gradient-to-br from-blue-950/50 to-purple-950/50 p-6 rounded-xl mb-6 border border-blue-500/30">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
            <div className="font-bold text-white">AI Recommendation</div>
            <div className="ml-auto text-xs bg-blue-500/30 px-2 py-1 rounded text-blue-300">
              {(recommendation_data.confidence * 100).toFixed(0)}% confidence
            </div>
          </div>
          <p className="text-white text-lg font-semibold mb-3">{recommendation_data.llm_recommendation}</p>
          <p className="text-slate-300 text-sm leading-relaxed">{recommendation_data.llm_reasoning}</p>
        </div>

        {/* Action taken */}
        <div className="bg-slate-800/50 p-4 rounded-xl mb-6 text-center">
          <div className="text-slate-400 text-sm mb-1">Action Taken</div>
          <div className="text-white text-xl font-bold">{recommendation_data.action_taken}</div>
        </div>

        {/* Auto-dismiss countdown */}
        <div className="text-center">
          <div className="text-slate-400 text-sm mb-2">Auto-dismissing in {countdown}s</div>
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden max-w-xs mx-auto">
            <div
              className="h-full bg-blue-500 transition-all duration-1000 ease-linear"
              style={{ width: `${(countdown / 20) * 100}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
