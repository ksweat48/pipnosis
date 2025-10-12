import React, { useState } from 'react';
import { TrendingUp, TrendingDown, Target, Shield, DollarSign, BarChart3, CheckCircle, Clock, Info } from 'lucide-react';
import { strategyService } from '../strategies';
import { useAuth } from '../hooks/useAuth';

interface StrategySignalCardProps {
  signal: any;
  onExecute?: (signalId: string) => void;
  onApprove?: (signalId: string) => void;
  showActions?: boolean;
}

export function StrategySignalCard({ signal, onExecute, onApprove, showActions = true }: StrategySignalCardProps) {
  const { user } = useAuth();
  const [isExecuting, setIsExecuting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const entryPrice = parseFloat(signal.entry_price);
  const stopLoss = parseFloat(signal.stop_loss);
  const takeProfit = parseFloat(signal.take_profit);
  const riskReward = parseFloat(signal.risk_reward);

  const pipDistance = (price1: number, price2: number) => {
    return Math.abs(price1 - price2) * 10000;
  };

  const stopLossPips = pipDistance(entryPrice, stopLoss);
  const takeProfitPips = pipDistance(entryPrice, takeProfit);

  const handleApprove = async () => {
    if (!user || !onApprove) return;
    setIsApproving(true);
    try {
      await strategyService.approveSignal(user.id, signal.id);
      onApprove(signal.id);
    } catch (error) {
      console.error('Error approving signal:', error);
    } finally {
      setIsApproving(false);
    }
  };

  const handleExecute = async () => {
    if (!user || !onExecute) return;
    setIsExecuting(true);
    try {
      await strategyService.executeSignal(user.id, signal.id);
      onExecute(signal.id);
    } catch (error) {
      console.error('Error executing signal:', error);
    } finally {
      setIsExecuting(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 80) return 'text-green-600 bg-green-50 border-green-200';
    if (confidence >= 60) return 'text-blue-600 bg-blue-50 border-blue-200';
    return 'text-yellow-600 bg-yellow-50 border-yellow-200';
  };

  const getDirectionColor = (direction: string) => {
    return direction === 'BUY' ? 'text-green-600 bg-green-50' : 'text-red-600 bg-red-50';
  };

  return (
    <div className="bg-white rounded-lg shadow-md border-2 border-gray-200 overflow-hidden">
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            {signal.direction === 'BUY' ? (
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingUp className="w-6 h-6 text-green-600" />
              </div>
            ) : (
              <div className="p-2 bg-red-100 rounded-lg">
                <TrendingDown className="w-6 h-6 text-red-600" />
              </div>
            )}
            <div>
              <h3 className="text-xl font-bold text-gray-900">{signal.symbol}</h3>
              <p className="text-sm text-gray-500">Fx Flow Scalper v2.0</p>
            </div>
          </div>
          <div className={`px-4 py-2 rounded-lg border-2 font-bold ${getConfidenceColor(signal.confidence)}`}>
            {signal.confidence}%
          </div>
        </div>

        <div className={`inline-block px-3 py-1 rounded-full text-sm font-semibold mb-4 ${getDirectionColor(signal.direction)}`}>
          {signal.direction}
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-blue-600" />
              <p className="text-xs font-medium text-blue-900">Entry Price</p>
            </div>
            <p className="text-lg font-bold text-blue-900">{entryPrice.toFixed(5)}</p>
          </div>

          <div className="p-3 bg-purple-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-purple-600" />
              <p className="text-xs font-medium text-purple-900">Risk:Reward</p>
            </div>
            <p className="text-lg font-bold text-purple-900">1:{riskReward.toFixed(1)}</p>
          </div>

          <div className="p-3 bg-red-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Shield className="w-4 h-4 text-red-600" />
              <p className="text-xs font-medium text-red-900">Stop Loss</p>
            </div>
            <p className="text-lg font-bold text-red-900">{stopLoss.toFixed(5)}</p>
            <p className="text-xs text-red-700">{stopLossPips.toFixed(1)} pips</p>
          </div>

          <div className="p-3 bg-green-50 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <DollarSign className="w-4 h-4 text-green-600" />
              <p className="text-xs font-medium text-green-900">Take Profit</p>
            </div>
            <p className="text-lg font-bold text-green-900">{takeProfit.toFixed(5)}</p>
            <p className="text-xs text-green-700">{takeProfitPips.toFixed(1)} pips</p>
          </div>
        </div>

        <div className="mb-4">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <Info className="w-4 h-4" />
            {showDetails ? 'Hide' : 'Show'} Phase Details
          </button>
        </div>

        {showDetails && (
          <div className="mb-4 space-y-2">
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className={`w-4 h-4 ${signal.phase1_passed ? 'text-green-600' : 'text-red-600'}`} />
                <p className="text-sm font-semibold text-gray-900">Phase 1: {signal.phase1_bias}</p>
              </div>
              <p className="text-xs text-gray-600 ml-6">{signal.phase1_reason}</p>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className={`w-4 h-4 ${signal.phase2_passed ? 'text-green-600' : 'text-red-600'}`} />
                <p className="text-sm font-semibold text-gray-900">Phase 2: Tactical Setup</p>
              </div>
              <p className="text-xs text-gray-600 ml-6">{signal.phase2_reason}</p>
            </div>

            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className={`w-4 h-4 ${signal.phase3_passed ? 'text-green-600' : 'text-red-600'}`} />
                <p className="text-sm font-semibold text-gray-900">Phase 3: Precision Entry</p>
              </div>
              <p className="text-xs text-gray-600 ml-6">{signal.phase3_reason}</p>
            </div>
          </div>
        )}

        {signal.notes && (
          <div className="p-3 bg-blue-50 rounded-lg mb-4 border border-blue-200">
            <p className="text-sm text-blue-900">{signal.notes}</p>
          </div>
        )}

        {showActions && !signal.executed && (
          <div className="flex gap-3">
            {!signal.approved ? (
              <button
                onClick={handleApprove}
                disabled={isApproving}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isApproving ? (
                  <>
                    <Clock className="w-5 h-5 animate-spin" />
                    Approving...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-5 h-5" />
                    Approve Signal
                  </>
                )}
              </button>
            ) : (
              <button
                onClick={handleExecute}
                disabled={isExecuting}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                {isExecuting ? (
                  <>
                    <Clock className="w-5 h-5 animate-spin" />
                    Executing...
                  </>
                ) : (
                  <>
                    <TrendingUp className="w-5 h-5" />
                    Execute Trade
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {signal.executed && (
          <div className="p-3 bg-green-50 border-2 border-green-200 rounded-lg">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              <p className="text-sm font-semibold text-green-900">Trade Executed</p>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 py-3 bg-gray-50 border-t border-gray-200">
        <p className="text-xs text-gray-500">
          Generated: {new Date(signal.created_at).toLocaleString()}
          {signal.expires_at && ` • Expires: ${new Date(signal.expires_at).toLocaleTimeString()}`}
        </p>
      </div>
    </div>
  );
}
