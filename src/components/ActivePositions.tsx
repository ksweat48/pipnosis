import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, X, CreditCard as Edit2, DollarSign } from 'lucide-react';
import { simulatedTradingService, SimulatedTrade } from '@/services/simulated-trading';
import { useAuth } from '@/hooks/useAuth';

export const ActivePositions: React.FC = () => {
  const { user } = useAuth();
  const [positions, setPositions] = useState<SimulatedTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingPosition, setEditingPosition] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ stopLoss: string; takeProfit: string }>({
    stopLoss: '',
    takeProfit: ''
  });

  useEffect(() => {
    if (user?.id) {
      loadPositions();
      const interval = setInterval(() => updatePositions(), 5000);
      return () => clearInterval(interval);
    }
  }, [user?.id]);

  const loadPositions = async () => {
    if (!user?.id) return;

    setIsLoading(true);
    try {
      const openPositions = await simulatedTradingService.getOpenPositions(user.id);
      setPositions(openPositions);
    } catch (error) {
      console.error('Failed to load positions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const updatePositions = async () => {
    if (!user?.id || positions.length === 0) return;

    try {
      const updatedPositions = await Promise.all(
        positions.map(async (pos) => {
          const update = await simulatedTradingService.updatePosition(pos.id, user.id);
          if (update) {
            return { ...pos, currentPrice: update.currentPrice, pnl: update.pnl, status: update.status };
          }
          return pos;
        })
      );

      setPositions(updatedPositions.filter(p => p.status === 'open'));
    } catch (error) {
      console.error('Failed to update positions:', error);
    }
  };

  const handleClosePosition = async (tradeId: string) => {
    if (!user?.id) return;

    try {
      const result = await simulatedTradingService.closePosition(tradeId, user.id);
      if (result.success) {
        setPositions(positions.filter(p => p.id !== tradeId));
      }
    } catch (error) {
      console.error('Failed to close position:', error);
    }
  };

  const handleStartEdit = (position: SimulatedTrade) => {
    setEditingPosition(position.id);
    setEditValues({
      stopLoss: position.stopLoss?.toString() || '',
      takeProfit: position.takeProfit?.toString() || ''
    });
  };

  const handleSaveEdit = async (tradeId: string) => {
    if (!user?.id) return;

    try {
      await simulatedTradingService.modifyPosition(tradeId, user.id, {
        stopLoss: editValues.stopLoss ? parseFloat(editValues.stopLoss) : undefined,
        takeProfit: editValues.takeProfit ? parseFloat(editValues.takeProfit) : undefined
      });

      setPositions(positions.map(p =>
        p.id === tradeId
          ? {
              ...p,
              stopLoss: editValues.stopLoss ? parseFloat(editValues.stopLoss) : p.stopLoss,
              takeProfit: editValues.takeProfit ? parseFloat(editValues.takeProfit) : p.takeProfit
            }
          : p
      ));

      setEditingPosition(null);
    } catch (error) {
      console.error('Failed to modify position:', error);
    }
  };

  const totalPnL = positions.reduce((sum, pos) => sum + pos.pnl, 0);

  if (!user) return null;

  if (isLoading) {
    return (
      <div className="glass-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-white/10 rounded w-1/3"></div>
          <div className="h-20 bg-white/10 rounded"></div>
        </div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center space-x-3 mb-4">
          <DollarSign className="h-6 w-6 text-emerald-400" />
          <h3 className="text-xl font-bold text-white">Active Positions</h3>
        </div>
        <div className="text-center py-8">
          <p className="text-white/60">No open positions</p>
          <p className="text-white/40 text-sm mt-2">Execute a strategy to open your first position</p>
        </div>
      </div>
    );
  }

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <DollarSign className="h-6 w-6 text-emerald-400" />
          <h3 className="text-xl font-bold text-white">Active Positions</h3>
          <span className="px-3 py-1 bg-emerald-500/20 text-emerald-400 text-sm font-semibold rounded-full">
            {positions.length}
          </span>
        </div>
        <div className="text-right">
          <div className="text-sm text-white/60">Total P&L</div>
          <div className={`text-xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            ${totalPnL.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {positions.map((position) => {
          const isProfit = position.pnl >= 0;
          const isEditing = editingPosition === position.id;
          const isJPY = position.symbol.includes('JPY');
          const precision = position.symbol.includes('XAU') ? 2 : isJPY ? 2 : 5;

          return (
            <div
              key={position.id}
              className="bg-gradient-to-r from-slate-900/50 to-slate-800/50 rounded-xl border border-white/10 p-4"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-3">
                  {position.tradeType === 'buy' ? (
                    <TrendingUp className="h-5 w-5 text-green-400" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-400" />
                  )}
                  <div>
                    <div className="text-white font-bold">{position.symbol}</div>
                    <div className="text-xs text-white/60">
                      {position.tradeType.toUpperCase()} {position.lotSize} lots
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {!isEditing && (
                    <button
                      onClick={() => handleStartEdit(position)}
                      className="p-2 hover:bg-white/10 rounded-lg transition-colors"
                      title="Modify SL/TP"
                    >
                      <Edit2 className="h-4 w-4 text-white/60" />
                    </button>
                  )}
                  <button
                    onClick={() => handleClosePosition(position.id)}
                    className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                    title="Close Position"
                  >
                    <X className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                <div>
                  <div className="text-xs text-white/50">Entry</div>
                  <div className="text-sm text-white/80 font-medium">
                    {position.entryPrice.toFixed(precision)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-white/50">Current</div>
                  <div className="text-sm text-white/80 font-medium">
                    {position.currentPrice?.toFixed(precision) || '--'}
                  </div>
                </div>
              </div>

              {isEditing ? (
                <div className="space-y-2 pt-3 border-t border-white/10">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-white/60 block mb-1">Stop Loss</label>
                      <input
                        type="number"
                        step={isJPY ? '0.01' : '0.00001'}
                        value={editValues.stopLoss}
                        onChange={(e) => setEditValues({ ...editValues, stopLoss: e.target.value })}
                        className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-white/60 block mb-1">Take Profit</label>
                      <input
                        type="number"
                        step={isJPY ? '0.01' : '0.00001'}
                        value={editValues.takeProfit}
                        onChange={(e) => setEditValues({ ...editValues, takeProfit: e.target.value })}
                        className="w-full bg-white/5 border border-white/20 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => handleSaveEdit(position.id)}
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingPosition(null)}
                      className="flex-1 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs text-red-400">Stop Loss</div>
                    <div className="text-sm text-white/80 font-medium">
                      {position.stopLoss?.toFixed(precision) || '--'}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-green-400">Take Profit</div>
                    <div className="text-sm text-white/80 font-medium">
                      {position.takeProfit?.toFixed(precision) || '--'}
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3 pt-3 border-t border-white/10 flex justify-between items-center">
                <div className="text-xs text-white/50">
                  Opened {new Date(position.openedAt).toLocaleString()}
                </div>
                <div className={`text-lg font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                  {isProfit ? '+' : ''}${position.pnl.toFixed(2)}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
