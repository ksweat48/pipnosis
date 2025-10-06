import React, { useState } from 'react';
import { AlertTriangle, TrendingUp, TrendingDown, X } from 'lucide-react';

interface TradeConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  strategy: {
    symbol: string;
    action: 'buy' | 'sell';
    lotSize: number;
    entry: string;
    stopLoss: string;
    takeProfit: string;
    estimatedGain: string;
    riskRewardRatio?: number;
    reasoning: string;
  };
  accountBalance: number;
}

export const TradeConfirmationModal: React.FC<TradeConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  strategy,
  accountBalance
}) => {
  const [acknowledged, setAcknowledged] = useState(false);

  if (!isOpen) return null;

  const entryPrice = parseFloat(strategy.entry);
  const stopLossPrice = parseFloat(strategy.stopLoss);
  const takeProfitPrice = parseFloat(strategy.takeProfit);

  const potentialLoss = Math.abs(entryPrice - stopLossPrice) * strategy.lotSize * 100000;
  const potentialGain = Math.abs(entryPrice - takeProfitPrice) * strategy.lotSize * 100000;

  const riskPercent = (potentialLoss / accountBalance) * 100;

  const handleConfirm = () => {
    if (!acknowledged) return;
    onConfirm();
    setAcknowledged(false);
  };

  const handleClose = () => {
    onClose();
    setAcknowledged(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 p-2 hover:bg-white/10 rounded-lg transition-colors z-10"
        >
          <X className="h-5 w-5 text-white/60" />
        </button>

        <div className="p-6 sm:p-8">
          <div className="flex items-center space-x-3 mb-6">
            <div className="p-3 bg-gradient-to-r from-yellow-500/20 to-orange-500/20 rounded-xl">
              <AlertTriangle className="h-6 w-6 text-yellow-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Confirm Demo Trade</h2>
              <p className="text-white/60 text-sm">Review trade details before execution</p>
            </div>
          </div>

          <div className="bg-gradient-to-r from-slate-900/50 to-slate-800/50 rounded-xl border border-white/10 p-6 mb-6">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                {strategy.action === 'buy' ? (
                  <TrendingUp className="h-8 w-8 text-green-400" />
                ) : (
                  <TrendingDown className="h-8 w-8 text-red-400" />
                )}
                <div>
                  <div className="text-2xl font-bold text-white">{strategy.symbol}</div>
                  <div className="text-emerald-400 text-sm font-medium">
                    {strategy.action.toUpperCase()} {strategy.lotSize} lots
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="text-white/60 text-sm">Est. Gain</div>
                <div className="text-green-400 text-xl font-bold">${strategy.estimatedGain}</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 mb-4">
              <div>
                <div className="text-white/50 text-xs mb-1">Entry Price</div>
                <div className="text-white font-semibold">{strategy.entry}</div>
              </div>
              <div>
                <div className="text-red-400 text-xs mb-1">Stop Loss</div>
                <div className="text-white font-semibold">{strategy.stopLoss}</div>
              </div>
              <div>
                <div className="text-green-400 text-xs mb-1">Take Profit</div>
                <div className="text-white font-semibold">{strategy.takeProfit}</div>
              </div>
            </div>

            {strategy.riskRewardRatio && (
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <span className="text-white/60 text-sm">Risk:Reward Ratio</span>
                <span className="text-emerald-400 font-bold">1:{strategy.riskRewardRatio.toFixed(1)}</span>
              </div>
            )}
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4 mb-6">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-yellow-400 font-bold mb-2">Risk Disclosure</h4>
                <ul className="space-y-2 text-white/70 text-sm">
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>This is a <strong className="text-yellow-400">DEMO trade</strong> with simulated funds (${accountBalance.toFixed(2)})</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Potential Loss: <strong className="text-red-400">${potentialLoss.toFixed(2)}</strong> ({riskPercent.toFixed(1)}% of balance)</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>No real money is at risk in demo mode</span>
                  </li>
                  <li className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>Prices are live but execution is simulated</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-xl p-4 mb-6">
            <div className="text-white/80 text-sm leading-relaxed">
              <strong className="text-white">AI Reasoning:</strong> {strategy.reasoning}
            </div>
          </div>

          <div className="flex items-start space-x-3 mb-6 p-4 bg-white/5 rounded-xl">
            <input
              type="checkbox"
              id="acknowledge"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-white/20 bg-white/10 text-emerald-500 focus:ring-emerald-500"
            />
            <label htmlFor="acknowledge" className="text-white/70 text-sm cursor-pointer">
              I understand this is a demo trade with simulated funds. I have reviewed the trade parameters
              and acknowledge the potential loss of <strong className="text-red-400">${potentialLoss.toFixed(2)}</strong> if
              the stop loss is hit.
            </label>
          </div>

          <div className="flex space-x-4">
            <button
              onClick={handleClose}
              className="flex-1 bg-white/10 hover:bg-white/20 text-white px-6 py-3 rounded-xl font-bold transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!acknowledged}
              className={`flex-1 px-6 py-3 rounded-xl font-bold transition-all ${
                acknowledged
                  ? 'bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600 text-white shadow-lg shadow-emerald-500/30'
                  : 'bg-white/5 text-white/30 cursor-not-allowed'
              }`}
            >
              Execute Demo Trade
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
