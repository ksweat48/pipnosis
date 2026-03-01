import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, Zap, Clock, CheckCircle, Target, AlertTriangle } from 'lucide-react';
import { formatPositionPrice } from '../utils/displayFormatters';

export interface MultiTradeSignal {
  tradeId?: string;
  symbol: string;
  direction: 'buy' | 'sell';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  tp1?: number;
  tp2?: number;
  confidence: number;
  setupType?: string;
  expectedProfit?: number;
}

interface MultiTradeExecutionModalProps {
  isOpen: boolean;
  trades: MultiTradeSignal[];
  onDismiss: () => void;
}

const AUTO_CLOSE_SECONDS = 60;

function PriceCompact({ price, symbol }: { price: number; symbol: string }) {
  const formatted = formatPositionPrice(price, symbol);
  const dot = formatted.indexOf('.');
  const int = dot >= 0 ? formatted.slice(0, dot) : formatted;
  const dec = dot >= 0 ? formatted.slice(dot) : '';
  return (
    <span className="font-mono font-bold leading-none tabular-nums text-white">
      <span className="text-sm">{int}</span>
      {dec && <span className="text-[10px] opacity-60">{dec}</span>}
    </span>
  );
}

const TradeCard: React.FC<{ trade: MultiTradeSignal; index: number }> = ({ trade, index }) => {
  const isBuy = trade.direction === 'buy';
  const hasDualTP = !!(trade.tp1 && trade.tp2);
  const gradientBuy = 'from-emerald-900/60 to-emerald-950/60';
  const gradientSell = 'from-red-900/60 to-red-950/60';
  const borderBuy = 'border-emerald-500/40';
  const borderSell = 'border-red-500/40';

  return (
    <div className={`rounded-xl border p-4 bg-gradient-to-br ${isBuy ? gradientBuy : gradientSell} ${isBuy ? borderBuy : borderSell}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            isBuy ? 'bg-emerald-500/30 text-emerald-300' : 'bg-red-500/30 text-red-300'
          }`}>
            {index + 1}
          </div>
          <span className="text-lg font-bold text-white tracking-tight">{trade.symbol}</span>
        </div>

        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${
            isBuy
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
              : 'bg-red-500/20 text-red-300 border border-red-500/30'
          }`}>
            {isBuy ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isBuy ? 'BUY' : 'SELL'}
          </div>
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold bg-gray-700/50 text-gray-300 border border-gray-600/30">
            <Zap className="w-2.5 h-2.5 text-amber-400" />
            {trade.confidence}%
          </div>
        </div>
      </div>

      <div className={`grid gap-2 ${hasDualTP ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <div className="bg-black/20 rounded-lg p-2 border border-gray-700/30">
          <p className="text-[10px] text-gray-400 mb-1">Entry</p>
          <PriceCompact price={trade.entryPrice} symbol={trade.symbol} />
        </div>
        <div className="bg-red-950/30 rounded-lg p-2 border border-red-700/30">
          <p className="text-[10px] text-red-400 mb-1 flex items-center gap-0.5">
            <AlertTriangle className="w-2.5 h-2.5" />SL
          </p>
          <PriceCompact price={trade.stopLoss} symbol={trade.symbol} />
        </div>

        {hasDualTP ? (
          <>
            <div className="bg-sky-950/30 rounded-lg p-2 border border-sky-700/30">
              <p className="text-[10px] text-sky-400 mb-1 flex items-center gap-0.5">
                <Target className="w-2.5 h-2.5" />TP1
              </p>
              <PriceCompact price={trade.tp1!} symbol={trade.symbol} />
            </div>
            <div className="bg-emerald-950/30 rounded-lg p-2 border border-emerald-700/30">
              <p className="text-[10px] text-emerald-400 mb-1 flex items-center gap-0.5">
                <Target className="w-2.5 h-2.5" />TP2
              </p>
              <PriceCompact price={trade.tp2!} symbol={trade.symbol} />
            </div>
          </>
        ) : (
          <div className="bg-emerald-950/30 rounded-lg p-2 border border-emerald-700/30">
            <p className="text-[10px] text-emerald-400 mb-1 flex items-center gap-0.5">
              <Target className="w-2.5 h-2.5" />TP
            </p>
            <PriceCompact price={trade.takeProfit} symbol={trade.symbol} />
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-2.5">
        {trade.setupType && (
          <span className="text-[10px] text-gray-400 truncate max-w-[60%]">{trade.setupType}</span>
        )}
        {trade.expectedProfit != null && trade.expectedProfit > 0 && (
          <span className="text-xs font-semibold text-emerald-400 ml-auto">
            +${trade.expectedProfit.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
};

export const MultiTradeExecutionModal: React.FC<MultiTradeExecutionModalProps> = ({
  isOpen,
  trades,
  onDismiss,
}) => {
  const [countdown, setCountdown] = useState(AUTO_CLOSE_SECONDS);

  useEffect(() => {
    if (!isOpen) {
      setCountdown(AUTO_CLOSE_SECONDS);
      return;
    }

    setCountdown(AUTO_CLOSE_SECONDS);
    let mounted = true;

    const timer = setInterval(() => {
      if (!mounted) return;
      setCountdown(prev => {
        if (prev <= 1) {
          if (mounted) onDismiss();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [isOpen]);

  if (!isOpen || trades.length === 0) return null;

  const progress = ((AUTO_CLOSE_SECONDS - countdown) / AUTO_CLOSE_SECONDS) * 100;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div className="relative w-full max-w-lg animate-in zoom-in-95 duration-300">
        <div className="absolute -inset-px bg-gradient-to-r from-emerald-500 via-blue-500 to-cyan-500 rounded-2xl opacity-50 blur-lg animate-pulse" />

        <div className="relative bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-2xl border border-gray-700/50 shadow-2xl overflow-hidden max-h-[90dvh] flex flex-col">

          <div className="relative pt-5 pb-4 px-5 border-b border-gray-700/50">
            <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/10 to-transparent" />
            <div className="relative flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-r from-emerald-600 to-blue-600 rounded-xl shadow-md shrink-0">
                <Zap className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-bold text-white leading-tight">
                  Alpha Executing {trades.length} Trade{trades.length !== 1 ? 's' : ''}
                </h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Mirror all positions on your platform simultaneously
                </p>
              </div>
              <div className="shrink-0 flex flex-col items-center">
                <div className="relative w-12 h-12">
                  <svg className="w-12 h-12 -rotate-90" viewBox="0 0 48 48">
                    <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                    <circle
                      cx="24" cy="24" r="20"
                      fill="none"
                      stroke="url(#timerGrad)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 20}`}
                      strokeDashoffset={`${2 * Math.PI * 20 * (1 - progress / 100)}`}
                      style={{ transition: 'stroke-dashoffset 1s linear' }}
                    />
                    <defs>
                      <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-sm font-bold text-white tabular-nums">{countdown}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="overflow-y-auto flex-1 overscroll-contain p-4 space-y-3" style={{ WebkitOverflowScrolling: 'touch' }}>
            {trades.map((trade, i) => (
              <TradeCard key={trade.tradeId ?? `${trade.symbol}-${i}`} trade={trade} index={i} />
            ))}
          </div>

          <div className="px-4 pb-4 pt-3 border-t border-gray-700/50 space-y-2.5">
            <div className="flex items-center justify-center gap-2 text-gray-400">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="text-xs">Auto-closing in {countdown}s — trades are already live</span>
            </div>

            <button
              onClick={onDismiss}
              className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-blue-600 hover:from-emerald-500 hover:to-blue-500 rounded-xl font-bold text-sm text-white transition-all duration-200 shadow-lg hover:shadow-emerald-500/25 active:scale-95 flex items-center justify-center gap-2"
            >
              <CheckCircle className="w-4 h-4" />
              Got It — Continue to Monitor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
