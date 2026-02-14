import { useState, useEffect } from 'react';
import { TrendingUp, TrendingDown, X, Eye, Clock, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface TradeSignalData {
  symbol: string;
  direction: 'BUY' | 'SELL';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  setupType: string;
  reasoning: string;
  priority: 'low' | 'medium' | 'high';
  executionUrgency?: number;
  expectedProfit?: number;
  riskReward?: number;
  // Dual TP system
  tp1?: number;
  tp2?: number;
  tp1Confidence?: number;
}

interface TradeSignalNotificationBarProps {
  signal: TradeSignalData;
  onDismiss: () => void;
  position?: 'top' | 'bottom';
}

export function TradeSignalNotificationBar({
  signal,
  onDismiss,
  position = 'top'
}: TradeSignalNotificationBarProps) {
  const navigate = useNavigate();
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);

    if (signal.executionUrgency) {
      const interval = setInterval(() => {
        const now = Date.now();
        const diff = signal.executionUrgency! - now;

        if (diff <= 0) {
          setTimeRemaining('Execute now!');
          clearInterval(interval);
        } else {
          const seconds = Math.floor(diff / 1000);
          const minutes = Math.floor(seconds / 60);

          if (minutes > 0) {
            setTimeRemaining(`Execute within ${minutes}m ${seconds % 60}s`);
          } else {
            setTimeRemaining(`Execute within ${seconds}s`);
          }
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [signal.executionUrgency]);

  // SSOT FIX (2026-02-14): Audio is handled by useGlobalDialog hook
  // DO NOT play audio here - it creates double sound with the hook's audio
  // The hook is the SSOT for all dialog audio triggers
  // Component responsibility: UI rendering only

  useEffect(() => {
    if (signal.priority === 'low') {
      const timer = setTimeout(() => {
        handleDismiss();
      }, 30000);

      return () => clearTimeout(timer);
    }
  }, [signal.priority]);

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  const handleViewTrade = () => {
    navigate('/ai-trade');
    handleDismiss();
  };

  const priorityConfig = {
    high: {
      bg: 'bg-red-600',
      border: 'border-red-500',
      text: 'text-red-100',
      glow: 'shadow-red-500/50',
      badge: 'bg-red-500 text-white',
      urgency: 'Market Execution',
      pulse: true
    },
    medium: {
      bg: 'bg-yellow-600',
      border: 'border-yellow-500',
      text: 'text-yellow-100',
      glow: 'shadow-yellow-500/50',
      badge: 'bg-yellow-500 text-gray-900',
      urgency: timeRemaining || 'Execute within 1 minute',
      pulse: false
    },
    low: {
      bg: 'bg-blue-600',
      border: 'border-blue-500',
      text: 'text-blue-100',
      glow: 'shadow-blue-500/50',
      badge: 'bg-blue-500 text-white',
      urgency: timeRemaining || 'Execute within 5 minutes',
      pulse: false
    }
  };

  // ✅ Defensive check: Use fallback config if priority is not recognized
  const config = priorityConfig[signal.priority] || {
    bg: 'bg-gray-600',
    border: 'border-gray-500',
    text: 'text-gray-100',
    glow: 'shadow-gray-500/50',
    badge: 'bg-gray-500 text-white',
    urgency: timeRemaining || 'Execute when ready',
    pulse: false
  };

  // Log warning if unexpected priority value encountered
  if (!priorityConfig[signal.priority]) {
    console.warn(`[TradeSignalNotificationBar] Unexpected priority value: "${signal.priority}". Using fallback config. Expected: 'low' | 'medium' | 'high'`);
  }

  const directionIcon = signal.direction === 'BUY' ? TrendingUp : TrendingDown;
  const DirectionIcon = directionIcon;

  const positionClass = position === 'top' ? 'top-0' : 'bottom-0';
  const slideAnimation = position === 'top'
    ? 'animate-slide-in-from-top'
    : 'animate-slide-in-from-bottom';

  return (
    <div
      className={`
        fixed ${positionClass} left-0 right-0 z-[9999]
        ${isVisible ? slideAnimation : 'translate-y-[-100%]'}
        transition-transform duration-300
      `}
    >
      <div
        className={`
          ${config.bg} ${config.text} ${config.border}
          border-b-4 shadow-2xl ${config.glow}
          ${config.pulse ? 'animate-pulse-glow' : ''}
          px-4 py-3 sm:px-6
        `}
      >
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <DirectionIcon className="w-8 h-8 flex-shrink-0" />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold">
                    {signal.direction} {signal.symbol}
                  </h3>
                  <span className={`${config.badge} px-2 py-0.5 rounded text-xs font-bold`}>
                    {signal.priority.toUpperCase()}
                  </span>
                  <span className="text-sm opacity-90">
                    {signal.confidence}%
                  </span>
                  <span className="text-sm">Entry: {signal.entryPrice.toFixed(5)}</span>
                  <span className="text-sm">SL: {signal.stopLoss.toFixed(5)}</span>
                  {signal.tp1 && signal.tp2 ? (
                    <>
                      <span className="text-sm text-cyan-300 font-semibold">
                        TP1: {signal.tp1.toFixed(5)}
                        {signal.tp1Confidence && <span className="text-xs ml-1">({signal.tp1Confidence}%)</span>}
                      </span>
                      <span className="text-sm text-emerald-300 font-semibold">TP2: {signal.tp2.toFixed(5)}</span>
                    </>
                  ) : (
                    <span className="text-sm">TP: {signal.takeProfit.toFixed(5)}</span>
                  )}
                  {signal.riskReward && (
                    <span className="text-sm font-semibold">R:R 1:{signal.riskReward.toFixed(2)}</span>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={handleViewTrade}
                className="
                  bg-white text-gray-900 hover:bg-gray-100
                  px-4 py-2 rounded-lg font-semibold
                  flex items-center gap-2
                  transition-colors
                  shadow-lg
                "
              >
                <Eye className="w-4 h-4" />
                <span className="hidden sm:inline">View Trade</span>
              </button>

              <button
                onClick={handleDismiss}
                className="
                  bg-white/20 hover:bg-white/30
                  p-2 rounded-lg
                  transition-colors
                "
                aria-label="Dismiss notification"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
