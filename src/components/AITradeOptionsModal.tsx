import React, { useState } from 'react';
import { X, TrendingUp, TrendingDown, DollarSign, Shield, AlertTriangle, Target, Activity } from 'lucide-react';
import { TradeOption } from '@/services/ai-trading-engine';

interface AITradeOptionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  decision: any;
  options: TradeOption[];
  marketSummary: any;
  onExecute: (optionId: string) => void;
  isExecuting: boolean;
}

export const AITradeOptionsModal: React.FC<AITradeOptionsModalProps> = ({
  isOpen,
  onClose,
  decision,
  options,
  marketSummary,
  onExecute,
  isExecuting
}) => {
  const [selectedOption, setSelectedOption] = useState<TradeOption | null>(null);

  if (!isOpen) return null;

  const getRiskColor = (type: string) => {
    switch (type) {
      case 'low_risk':
        return 'from-green-500 to-emerald-600';
      case 'medium_risk':
        return 'from-blue-500 to-cyan-600';
      case 'high_risk':
        return 'from-orange-500 to-red-600';
      default:
        return 'from-gray-500 to-gray-600';
    }
  };

  const getRiskLabel = (type: string) => {
    switch (type) {
      case 'low_risk':
        return 'Conservative';
      case 'medium_risk':
        return 'Balanced';
      case 'high_risk':
        return 'Aggressive';
      default:
        return type;
    }
  };

  const getRiskIcon = (type: string) => {
    switch (type) {
      case 'low_risk':
        return <Shield className="h-5 w-5" />;
      case 'medium_risk':
        return <Activity className="h-5 w-5" />;
      case 'high_risk':
        return <AlertTriangle className="h-5 w-5" />;
      default:
        return <Activity className="h-5 w-5" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-3xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto border border-white/10">
        <div className="sticky top-0 bg-gradient-to-r from-slate-900 to-slate-800 border-b border-white/10 p-6 flex items-center justify-between z-10">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2">
              <Target className="h-6 w-6 text-emerald-400" />
              AI Trade Analysis Complete
            </h2>
            <p className="text-white/60 text-sm mt-1">
              Select your preferred risk level to execute the trade
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-xl transition-colors"
            disabled={isExecuting}
          >
            <X className="h-6 w-6 text-white/60" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-white mb-4">Market Analysis</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Symbol</p>
                <p className="text-white font-bold text-lg">{decision.symbol}</p>
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Sentiment</p>
                <p className={`font-bold text-lg ${
                  marketSummary.sentiment.status === 'BULLISH' ? 'text-green-400' :
                  marketSummary.sentiment.status === 'BEARISH' ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  {marketSummary.sentiment.status}
                </p>
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Confidence</p>
                <p className="text-white font-bold text-lg">{marketSummary.sentiment.confidence}%</p>
              </div>
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide mb-1">RSI</p>
                <p className="text-white font-bold text-lg">{marketSummary.rsi.value.toFixed(1)}</p>
              </div>
            </div>

            <div className="mt-4 p-4 bg-white/5 rounded-xl">
              <p className="text-white/70 text-sm font-medium">{decision.reasoning}</p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xl font-bold text-white">Choose Your Risk Level</h3>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {options.map((option) => (
                <div
                  key={option.id}
                  onClick={() => !isExecuting && setSelectedOption(option)}
                  className={`cursor-pointer transition-all duration-300 ${
                    selectedOption?.id === option.id
                      ? 'ring-4 ring-emerald-500 scale-105'
                      : 'hover:scale-102 hover:shadow-xl'
                  }`}
                >
                  <div className="glass-card p-6 h-full">
                    <div className={`bg-gradient-to-r ${getRiskColor(option.optionType)} p-4 rounded-2xl mb-4`}>
                      <div className="flex items-center justify-between text-white">
                        <div className="flex items-center gap-2">
                          {getRiskIcon(option.optionType)}
                          <span className="font-bold text-lg">{getRiskLabel(option.optionType)}</span>
                        </div>
                        <span className="text-2xl font-bold">{option.confidence}%</span>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-sm">Direction</span>
                        <span className={`font-bold ${option.direction === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>
                          {option.direction === 'BUY' ? (
                            <div className="flex items-center gap-1">
                              <TrendingUp className="h-4 w-4" />
                              BUY
                            </div>
                          ) : (
                            <div className="flex items-center gap-1">
                              <TrendingDown className="h-4 w-4" />
                              SELL
                            </div>
                          )}
                        </span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-sm">Lot Size</span>
                        <span className="text-white font-bold">{option.lotSize}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-sm">Entry</span>
                        <span className="text-white font-mono">{option.entryPrice.toFixed(5)}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-sm">Stop Loss</span>
                        <span className="text-red-400 font-mono">{option.stopLoss.toFixed(5)}</span>
                      </div>

                      <div className="flex items-center justify-between">
                        <span className="text-white/60 text-sm">Take Profit</span>
                        <span className="text-green-400 font-mono">{option.takeProfit.toFixed(5)}</span>
                      </div>

                      <div className="border-t border-white/10 pt-3 mt-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white/60 text-sm">Est. Profit</span>
                          <span className="text-green-400 font-bold">+${option.estimatedProfit.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-white/60 text-sm">Est. Loss</span>
                          <span className="text-red-400 font-bold">${option.estimatedLoss.toFixed(2)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-white/60 text-sm">Risk/Reward</span>
                          <span className="text-white font-bold">1:{option.riskRewardRatio.toFixed(1)}</span>
                        </div>
                      </div>

                      <div className="mt-4 p-3 bg-white/5 rounded-xl">
                        <p className="text-white/70 text-xs">{option.reasoning}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {selectedOption && (
            <div className="sticky bottom-0 bg-gradient-to-t from-slate-900 via-slate-900 to-transparent pt-6 pb-2">
              <button
                onClick={() => onExecute(selectedOption.id)}
                disabled={isExecuting}
                className="w-full bg-gradient-to-r from-emerald-500 to-green-600 text-white py-4 px-6 rounded-2xl font-bold text-lg hover:from-emerald-600 hover:to-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 shadow-xl hover:shadow-2xl hover:scale-105 flex items-center justify-center gap-3"
              >
                {isExecuting ? (
                  <>
                    <div className="h-6 w-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Executing Trade...
                  </>
                ) : (
                  <>
                    <DollarSign className="h-6 w-6" />
                    Execute {getRiskLabel(selectedOption.optionType)} Trade
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
