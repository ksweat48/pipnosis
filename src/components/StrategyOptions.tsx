import React, { useState } from 'react';
import { TrendingUp, Shield, Zap, DollarSign, Target, AlertTriangle, Loader, CheckCircle, RefreshCw, MessageCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

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
  symbol?: string;
  action?: string;
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
  const [executingStrategy, setExecutingStrategy] = useState<string | null>(null);
  const [executedStrategies, setExecutedStrategies] = useState<Set<string>>(new Set());
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const { user } = useAuth();

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

  const handleExecute = async (option: StrategyOption) => {
    if (!option.feasible || executingStrategy || executedStrategies.has(option.id)) return;

    setExecutingStrategy(option.id);
    setExecutionError(null);
    
    try {
      console.log('🚀 Executing strategy:', option);
      
      if (!option.symbol) {
        option.symbol = option.tradeType.split(' ')[0];
      }
      
      if (!option.action) {
        option.action = option.tradeType.includes('BUY') ? 'buy' : 'sell';
      }
      
      // Create a shorter strategy name for MT5 comment (31 char limit)
      const shortName = option.name.length > 20 ? 
        option.name.substring(0, 17) + '...' : 
        option.name;
      
      await onSelect(option);
      
      setExecutedStrategies(prev => new Set([...prev, option.id]));
      
      setTimeout(() => {
        setExecutingStrategy(null);
      }, 3000);
      
    } catch (error) {
      console.error('❌ Strategy execution failed:', error);
      setExecutingStrategy(null);
      
      setExecutionError(error instanceof Error ? error.message : 'Trade execution failed');
      
      setTimeout(() => {
        setExecutionError(null);
      }, 30000);
    }
  };

  const handleRetry = async () => {
    if (!executionError || retrying) return;
    
    setRetrying(true);
    setExecutionError(null);
    
    try {
      const failedStrategy = options.find(opt => opt.id === executingStrategy);
      if (!failedStrategy) {
        throw new Error('Could not identify the failed strategy');
      }
      
      console.log('🔄 Retrying strategy execution:', failedStrategy);
      
      await handleExecute(failedStrategy);
    } catch (error) {
      console.error('❌ Retry failed:', error);
      setExecutionError(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setRetrying(false);
    }
  };

  const handleCheckMT5Settings = () => {
    const event = new CustomEvent('openMT5Modal');
    window.dispatchEvent(event);
  };

  if (options.length === 0) {
    if (!user) {
      return (
        <div className="bg-slate-800 rounded-xl p-6 border border-slate-700 text-center">
          <TrendingUp className="h-12 w-12 text-blue-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold text-white mb-2">AI Strategy Recommendations</h3>
          <p className="text-slate-400 mb-4">Sign in to generate AI trading strategies</p>
          <p className="text-sm text-slate-500">Pipnosis AI will analyze market conditions and generate personalized trading strategies based on your goals</p>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
        <TrendingUp className="h-5 w-5 text-blue-400" />
        <span>AI Strategy Recommendations</span>
        {isExecuting && <Loader className="h-4 w-4 text-blue-400 animate-spin" />}
      </h3>
      
      {executionError && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0" />
              <div>
                <p className="text-red-300 font-medium">
                  {executionError}
                </p>
                <p className="text-red-200 text-sm mt-1">
                  Please check your MT5 connection and make sure the MT5 bridge is running.
                </p>
              </div>
            </div>
            <div className="flex space-x-2">
              <button
                onClick={handleRetry}
                disabled={retrying}
                className="px-3 py-1 bg-red-500/20 text-red-300 border border-red-500/30 rounded hover:bg-red-500/30 transition-colors flex items-center space-x-1"
              >
                {retrying ? (
                  <>
                    <Loader className="h-3 w-3 animate-spin" />
                    <span>Retrying...</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-3 w-3" />
                    <span>Retry</span>
                  </>
                )}
              </button>
              <button
                onClick={handleCheckMT5Settings}
                className="px-3 py-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded hover:bg-blue-500/30 transition-colors flex items-center space-x-1"
              >
                <MessageCircle className="h-3 w-3" />
                <span>Check MT5</span>
              </button>
            </div>
          </div>
        </div>
      )}
      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
        {options.map((option) => {
          const isExecutingThis = executingStrategy === option.id;
          const isExecuted = executedStrategies.has(option.id);
          const isDisabled = !option.feasible || executingStrategy !== null;

          return (
            <div
              key={option.id}
              className={`bg-slate-800 border-2 rounded-xl p-4 sm:p-6 transition-all ${getRiskColor(option.risk)} ${
                option.feasible && !isDisabled ? 'hover:scale-105 cursor-pointer hover:shadow-lg' : 'opacity-60 cursor-not-allowed'
              } ${isExecuted ? 'ring-2 ring-green-400' : ''}`}
            >
              <div className="flex items-center justify-between mb-3 sm:mb-4">
                <div className="flex items-center space-x-2">
                  {getRiskIcon(option.risk)}
                  <span className="font-semibold text-white capitalize text-sm sm:text-base">{option.risk} Risk</span>
                </div>
                {!option.feasible && <AlertTriangle className="h-4 w-4 sm:h-5 sm:w-5 text-red-400" />}
                {isExecuted && <CheckCircle className="h-4 w-4 sm:h-5 sm:w-5 text-green-400" />}
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
                    onClick={() => handleExecute(option)}
                    disabled={isDisabled}
                    className={`w-full py-2 px-3 sm:px-4 rounded-lg font-medium text-sm sm:text-base transition-all ${
                      isExecuted 
                        ? 'bg-green-500 text-white' 
                        : isExecutingThis 
                        ? 'bg-blue-500 text-white' 
                        : isDisabled 
                        ? 'bg-slate-600 text-slate-400 cursor-not-allowed' 
                        : 'bg-blue-500 text-white hover:bg-blue-600'
                    }`}
                  >
                    {isExecuted ? (
                      <div className="flex items-center justify-center space-x-2">
                        <CheckCircle className="h-4 w-4" />
                        <span>Trade Executed ✓</span>
                      </div>
                    ) : isExecutingThis ? (
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
          );
        })}
      </div>

      {isExecuting && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex items-center space-x-3">
            <Loader className="h-5 w-5 text-blue-400 animate-spin flex-shrink-0" />
            <div>
              <p className="text-blue-300 font-medium">
                Executing Trade via MT5 Bridge
              </p>
              <p className="text-blue-200 text-sm mt-1">
                Sending trade request to MT5 connector... This may take up to 60 seconds.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};