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
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
        <TrendingUp className="h-5 w-5 text-blue-400" />
        <span>AI Strategy Recommendations</span>
        {isExecuting && <Loader className="h-4 w-4 text-blue-400 animate-spin" />}
      </h3>
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {options.map((option) => (
          <div
            key={option.id}
            className={`bg-slate-800 border-2 rounded-xl p-4 sm:p-6 transition-all hover:scale-105 cursor-pointer ${getRiskColor(option.risk)} ${
              option.feasible && !isExecuting ? 'hover:shadow-lg' : 'opacity-60 cursor-not-allowed'
            }`}
            onClick={() => option.feasible && !isExecuting && onSelect(option)}
          >
            <div className="flex items-center justify-between mb-3 sm:mb-4">
              <div className="flex items-center space-x-2">
                {getRiskIcon(option.risk)}
                <span className="font-semibold text-white capitalize text-sm sm:text-base">{option.risk} Risk</span>
              </div>
              {!option.feasible && <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />}
            </div>

            <div className="space-y-2 sm:space-y-3">
              <div>
                <p className="text-xs sm:text-sm text-slate-400">Trade Type</p>
                <p className="text-white font-medium text-sm sm:text-base">{option.tradeType}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <p className="text-xs text-slate-400">Entry</p>
                  <p className="text-xs sm:text-sm text-white font-mono">{option.entry}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Lot Size</p>
                  <p className="text-xs sm:text-sm text-white font-mono">{option.lotSize}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:gap-3">
                <div>
                  <p className="text-xs text-slate-400">Stop Loss</p>
                  <p className="text-xs sm:text-sm text-red-400 font-mono">{option.stopLoss}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400">Take Profit</p>
                  <p className="text-xs sm:text-sm text-green-400 font-mono">{option.takeProfit}</p>
                </div>
              </div>

              <div className="pt-2 sm:pt-3 border-t border-slate-700">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm text-slate-400">Est. Gain</span>
                  <div className="flex items-center space-x-1">
                    <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 text-green-400" />
                    <span className="text-green-400 font-semibold text-sm sm:text-base">{option.estimatedGain}</span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">{option.reasoning}</p>

              {option.feasible ? (
                <button 
                  className={`w-full py-2 px-3 sm:px-4 rounded-lg font-medium text-sm sm:text-base transition-colors ${
                    isExecuting 
                      ? 'bg-slate-600 text-slate-400 cursor-not-allowed' 
                      : 'bg-blue-500 text-white hover:bg-blue-600'
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
                <div className="text-center py-2 text-red-400 text-xs sm:text-sm font-medium">
                  Insufficient Balance
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {isExecuting && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center space-x-3">
            <Loader className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-blue-300 font-medium">Executing Trade via Backend API</p>
              <p className="text-blue-200 text-sm mt-1">
                Sending trade request to MT5 connector... This may take a few seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};