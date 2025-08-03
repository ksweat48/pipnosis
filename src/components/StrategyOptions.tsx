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
        <h3 className="text-3xl sm:text-4xl font-bold text-white mb-4 flex items-center justify-center space-x-4">
          <div className="p-3 bg-gradient-to-r from-emerald-500 to-green-600 rounded-2xl">
            <TrendingUp className="h-6 w-6 text-white" />
          </div>
          <span>AI Strategy Recommendations</span>
        </h3>
        <p className="text-white/60 text-xl font-medium">Choose your preferred risk level</p>
        {isExecuting && <Loader className="h-4 w-4 text-blue-400 animate-spin" />}
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
        {options.map((option) => (
          <div
            key={option.id}
            className={`glass-card p-8 transition-all duration-300 cursor-pointer group ${getRiskColor(option.risk)} ${
              option.feasible && !isExecuting ? 'hover:scale-105 hover:shadow-2xl' : 'opacity-60 cursor-not-allowed'
            }`}
            onClick={() => option.feasible && !isExecuting && onSelect(option)}
          >
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                {getRiskIcon(option.risk)}
                <span className="font-bold text-white capitalize text-xl">{option.risk} Risk</span>
              </div>
              {!option.feasible && <AlertTriangle className="h-5 w-5 text-red-400" />}
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-white/60 font-semibold text-sm uppercase tracking-wide">Trade Setup</p>
                <p className="text-white font-bold text-2xl mt-1">
                  {option.symbol} {option.action.toUpperCase()}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-white/50 font-semibold text-xs uppercase tracking-wide">Entry</p>
                  <p className="text-white font-mono font-bold text-lg">{option.entry}</p>
                </div>
                <div>
                  <p className="text-white/50 font-semibold text-xs uppercase tracking-wide">Lot Size</p>
                  <p className="text-white font-mono font-bold text-lg">{option.lotSize}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <p className="text-white/50 font-semibold text-xs uppercase tracking-wide">Stop Loss</p>
                  <p className="text-red-400 font-mono font-bold text-lg">{option.stopLoss}</p>
                </div>
                <div>
                  <p className="text-white/50 font-semibold text-xs uppercase tracking-wide">Take Profit</p>
                  <p className="text-green-400 font-mono font-bold text-lg">{option.takeProfit}</p>
                </div>
              </div>

              {option.riskRewardRatio && (
                <div className="pt-4">
                  <div className="flex items-center justify-between">
                    <span className="text-white/50 font-semibold text-sm uppercase tracking-wide">Risk:Reward</span>
                    <span className="text-blue-400 font-bold text-lg">
                      1:{option.riskRewardRatio.toFixed(1)}
                    </span>
                  </div>
                </div>
              )}

              <div className="pt-6 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-white/60 font-semibold">Estimated Gain</span>
                  <div className="flex items-center space-x-1">
                    <DollarSign className="h-5 w-5 text-green-400" />
                    <span className="text-green-400 font-bold text-2xl">{option.estimatedGain}</span>
                  </div>
                </div>
              </div>

              <div className="bg-white/5 backdrop-blur-sm rounded-2xl p-6 border border-white/10">
                <p className="text-white/80 leading-relaxed font-medium">{option.reasoning}</p>
              </div>

              {option.feasible ? (
                <button 
                  className={`w-full py-4 px-6 rounded-2xl font-bold text-lg transition-all duration-200 ${
                    isExecuting 
                      ? 'bg-white/10 text-white/40 cursor-not-allowed' 
                      : 'bg-gradient-to-r from-emerald-500 to-green-600 text-white hover:from-emerald-600 hover:to-green-700 hover:shadow-2xl hover:scale-105 group-hover:shadow-emerald-500/25'
                  }`}
                  disabled={isExecuting}
                >
                  {isExecuting ? (
                    <div className="flex items-center justify-center space-x-2">
                      <Loader className="h-5 w-5 animate-spin" />
                      <span>Executing...</span>
                    </div>
                  ) : (
                    'Execute Trade'
                  )}
                </button>
              ) : (
                <div className="text-center py-4 text-red-400 font-bold bg-red-500/10 rounded-2xl border border-red-500/30">
                  Insufficient Balance
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isExecuting && (
        <div className="p-8 glass-card">
          <div className="flex items-center space-x-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-emerald-500/20 to-green-500/20 rounded-full blur-lg"></div>
              <Loader className="relative h-8 w-8 text-emerald-400 animate-spin flex-shrink-0" />
            </div>
            <div>
              <p className="text-white font-bold text-xl">Executing Trade via AI Assistant</p>
              <p className="text-white/70 mt-1 font-medium">
                Processing trade execution and logging to your account... This may take a few seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};