import React from 'react';
import { TrendingUp, Shield, Zap, DollarSign, Target, AlertTriangle, Loader } from 'lucide-react';

interface StrategyOption {
  id: string;
  name: string;
  risk: 'low' | 'medium' | 'high';
  tradeType: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  lotSize: number;
  estimatedGain: number;
  feasible: boolean;
  reasoning: string;
}

interface StrategyOptionsProps {
  options: StrategyOption[];
  onSelect: (option: StrategyOption) => void;
  isExecuting?: boolean;
}

export const StrategyOptions: React.FC<StrategyOptionsProps> = ({ 
  options, 
  onSelect, 
  isExecuting = false 
}) => {
  const getRiskIcon = (risk: string) => {
    switch (risk) {
      case 'low': return <Shield className="h-4 w-4 sm:h-5 sm:w-5 text-green-400" />;
      case 'medium': return <Target className="h-4 w-4 sm:h-5 sm:w-5 text-yellow-400" />;
      case 'high': return <Zap className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />;
      default: return <Shield className="h-4 w-4 sm:h-5 sm:w-5" />;
    }
  };

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'low': return 'border-green-500 bg-green-500/10';
      case 'medium': return 'border-yellow-500 bg-yellow-500/10';
      case 'high': return 'border-red-500 bg-red-500/10';
      default: return 'border-slate-500 bg-slate-500/10';
    }
  };

  if (options.length === 0) return null;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h3 className="text-2xl sm:text-3xl font-bold text-white mb-2 flex items-center justify-center space-x-3">
          <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <span>AI Strategy Recommendations</span>
        </h3>
        <p className="text-slate-400 text-lg">Choose your preferred risk level</p>
        {isExecuting && <Loader className="h-4 w-4 text-blue-400 animate-spin" />}
      </div>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
        {options.map((option) => (
          <div
            key={option.id}
            className={`bg-gradient-to-br from-slate-800 to-slate-700 border-2 rounded-2xl p-6 sm:p-8 transition-all hover:scale-105 cursor-pointer shadow-xl ${getRiskColor(option.risk)} ${
              option.feasible && !isExecuting ? 'hover:shadow-lg' : 'opacity-60 cursor-not-allowed'
            }`}
            onClick={() => option.feasible && !isExecuting && onSelect(option)}
          >
            <div className="flex items-center justify-between mb-4 sm:mb-6">
              <div className="flex items-center space-x-2">
                {getRiskIcon(option.risk)}
                <span className="font-bold text-white capitalize text-lg">{option.risk} Risk</span>
              </div>
              {!option.feasible && <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />}
            </div>

            <div className="space-y-3 sm:space-y-4">
              <div>
                <p className="text-sm text-slate-400 font-medium">Trade Setup</p>
                <p className="text-white font-bold text-lg">
                  {option.symbol} {option.action.toUpperCase()}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <p className="text-xs text-slate-400 font-medium">Entry</p>
                  <p className="text-sm text-white font-mono font-bold">{option.entry}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Lot Size</p>
                  <p className="text-sm text-white font-mono font-bold">{option.lotSize}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:gap-4">
                <div>
                  <p className="text-xs text-slate-400 font-medium">Stop Loss</p>
                  <p className="text-sm text-red-400 font-mono font-bold">{option.stopLoss}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium">Take Profit</p>
                  <p className="text-sm text-green-400 font-mono font-bold">{option.takeProfit}</p>
                </div>
              </div>

              {option.riskRewardRatio && (
                <div className="pt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">Risk:Reward</span>
                    <span className="text-blue-400 font-bold text-sm">
                      1:{option.riskRewardRatio.toFixed(1)}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-3 sm:pt-4 border-t border-slate-600">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400 font-medium">Est. Gain</span>
                  <div className="flex items-center space-x-1">
                    <DollarSign className="h-4 w-4 text-green-400" />
                    <span className="text-green-400 font-bold text-lg">{option.estimatedGain}</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-600">
                <p className="text-xs text-slate-300 leading-relaxed">{option.reasoning}</p>
              </div>

              {option.feasible ? (
                <button 
                  className={`w-full py-3 px-4 rounded-xl font-bold text-base transition-all shadow-lg ${
                    isExecuting 
                      ? 'bg-slate-600 text-slate-400 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 hover:shadow-xl'
                  }`}
                  disabled={isExecuting}
                >
                  {isExecuting ? (
                    <div className="flex items-center justify-center space-x-2">
                      <Loader className="h-4 w-4 animate-spin" />
                      <span>Executing...</span>
                    </div>
                  ) : (
                    'Execute Trade'
                  )}
                </button>
              ) : (
                <div className="text-center py-3 text-red-400 text-sm font-bold bg-red-500/10 rounded-xl border border-red-500/30">
                  Insufficient Balance
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isExecuting && (
        <div className="p-6 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-2xl backdrop-blur-sm">
          <div className="flex items-center space-x-3">
            <Loader className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-blue-300 font-bold text-lg">Executing Trade via AI Assistant</p>
              <p className="text-blue-200 text-sm mt-1">
                Processing trade execution and logging to your account... This may take a few seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};