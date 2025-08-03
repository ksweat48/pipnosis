import React from 'react';
import { Activity, DollarSign, TrendingUp, TrendingDown, Clock, BarChart3 } from 'lucide-react';
import { useActiveTrades, useTradeHistory } from '../hooks/useAPI';
import { useAuth } from '../contexts/AuthContext';

interface TradingDashboardProps {
  todayPnL: number;
  weeklyPnL: number;
  totalBalance: number;
}

export const TradingDashboard: React.FC<TradingDashboardProps> = ({
  todayPnL,
  weeklyPnL,
  totalBalance
}) => {
  const { user } = useAuth();
  const { trades: activeTrades, isLoading: tradesLoading } = useActiveTrades();
  const { trades: tradeHistory } = useTradeHistory(user?.id, 10);

  // Calculate today's P&L from trade history
  const today = new Date().toDateString();
  const todayTrades = (tradeHistory || []).filter(trade => 
    trade.closed_at && new Date(trade.closed_at).toDateString() === today
  );
  const calculatedTodayPnL = todayTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

  // Calculate weekly P&L
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weeklyTrades = (tradeHistory || []).filter(trade => 
    trade.closed_at && new Date(trade.closed_at) >= weekAgo
  );
  const calculatedWeeklyPnL = weeklyTrades.reduce((sum, trade) => sum + (trade.pnl || 0), 0);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-800 rounded-xl p-3 sm:p-6 border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="mb-2 sm:mb-0">
              <p className="text-slate-400 text-xs sm:text-sm">Today's P&L</p>
              <p className={`text-lg sm:text-2xl font-bold ${calculatedTodayPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {calculatedTodayPnL >= 0 ? '+' : ''}${calculatedTodayPnL.toFixed(2)}
              </p>
            </div>
            <div className={`p-2 sm:p-3 rounded-lg self-end sm:self-auto ${calculatedTodayPnL >= 0 ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
              {calculatedTodayPnL >= 0 ? (
                <TrendingUp className="h-4 w-4 sm:h-6 sm:w-6 text-green-400" />
              ) : (
                <TrendingDown className="h-4 w-4 sm:h-6 sm:w-6 text-red-400" />
              )}
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-3 sm:p-6 border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="mb-2 sm:mb-0">
              <p className="text-slate-400 text-xs sm:text-sm">Weekly P&L</p>
              <p className={`text-lg sm:text-2xl font-bold ${calculatedWeeklyPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {calculatedWeeklyPnL >= 0 ? '+' : ''}${calculatedWeeklyPnL.toFixed(2)}
              </p>
            </div>
            <div className="p-2 sm:p-3 bg-blue-500/20 rounded-lg self-end sm:self-auto">
              <BarChart3 className="h-4 w-4 sm:h-6 sm:w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-3 sm:p-6 border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="mb-2 sm:mb-0">
              <p className="text-slate-400 text-xs sm:text-sm">Open Trades</p>
              <p className="text-lg sm:text-2xl font-bold text-white">{activeTrades.length}</p>
            </div>
            <div className="p-2 sm:p-3 bg-blue-500/20 rounded-lg self-end sm:self-auto">
              <Activity className="h-4 w-4 sm:h-6 sm:w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="bg-slate-800 rounded-xl p-3 sm:p-6 border border-slate-700">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
            <div className="mb-2 sm:mb-0">
              <p className="text-slate-400 text-xs sm:text-sm">Balance</p>
              <p className="text-lg sm:text-2xl font-bold text-white">${(totalBalance || 0).toLocaleString()}</p>
            </div>
            <div className="p-2 sm:p-3 bg-purple-500/20 rounded-lg self-end sm:self-auto">
              <DollarSign className="h-4 w-4 sm:h-6 sm:w-6 text-purple-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Open Trades */}
      {activeTrades.length > 0 && (
        <div className="bg-slate-800 rounded-xl border border-slate-700">
          <div className="p-4 sm:p-6 border-b border-slate-700">
            <h3 className="text-lg font-semibold text-white flex items-center space-x-2">
              <Activity className="h-5 w-5 text-blue-400" />
              <span>Open Positions</span>
              {tradesLoading && <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full"></div>}
            </h3>
          </div>
          
          {/* Mobile Card View */}
          <div className="block sm:hidden">
            {activeTrades.map((trade) => (
              <div key={trade.id} className="p-4 border-b border-slate-700 last:border-b-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-white font-medium">{trade.symbol}</h4>
                    <span className={`px-2 py-1 rounded text-xs font-medium ${
                      trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {trade.trade_type.toUpperCase()}
                    </span>
                  </div>
                  <span className={`font-semibold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                  </span>
                </div>
                
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-slate-400">Lot Size:</span>
                    <span className="text-slate-300 ml-1 font-mono">{trade.lot_size}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Entry:</span>
                    <span className="text-slate-300 ml-1 font-mono">{trade.entry_price.toFixed(5)}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Current:</span>
                    <span className="text-white ml-1 font-mono">{trade.current_price.toFixed(5)}</span>
                  </div>
                  <div className="flex items-center space-x-1 text-slate-400 text-xs">
                    <Clock className="h-3 w-3" />
                    <span>{new Date(trade.opened_at).toLocaleTimeString()}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table View */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-slate-400 text-sm border-b border-slate-700">
                  <th className="text-left p-4">Symbol</th>
                  <th className="text-left p-4">Type</th>
                  <th className="text-left p-4">Lot Size</th>
                  <th className="text-left p-4">Entry</th>
                  <th className="text-left p-4">Current</th>
                  <th className="text-left p-4">P&L</th>
                  <th className="text-left p-4">Time</th>
                </tr>
              </thead>
              <tbody>
                {activeTrades.map((trade) => (
                  <tr key={trade.id} className="border-b border-slate-700 hover:bg-slate-700/50">
                    <td className="p-4 text-white font-medium">{trade.symbol}</td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        trade.trade_type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                      }`}>
                        {trade.trade_type.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-4 text-slate-300 font-mono">{trade.lot_size}</td>
                    <td className="p-4 text-slate-300 font-mono">{trade.entry_price.toFixed(5)}</td>
                    <td className="p-4 text-white font-mono">{trade.current_price.toFixed(5)}</td>
                    <td className="p-4">
                      <span className={`font-semibold ${trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {trade.pnl >= 0 ? '+' : ''}${trade.pnl.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-4 text-slate-400 text-sm flex items-center space-x-1">
                      <Clock className="h-4 w-4" />
                      <span>{new Date(trade.opened_at).toLocaleTimeString()}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* No Active Trades State */}
      {!tradesLoading && activeTrades.length === 0 && user && (
        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 text-center">
          <Activity className="h-12 w-12 text-slate-400 mx-auto mb-4 opacity-50" />
          <h3 className="text-white font-semibold mb-2">No Active Trades</h3>
          <p className="text-slate-400 text-sm">
            Use the AI Prompt Console above to generate and execute your first trade.
          </p>
          <p className="text-slate-500 text-xs mt-2">
            Remember: Maximum 2 trades per session (Immutable Law #9)
          </p>
        </div>
      )}
    </div>
  );
};