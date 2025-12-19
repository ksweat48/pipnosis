import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { TrendingUp, TrendingDown, Calendar, DollarSign, BarChart3, Award, AlertCircle, Download, ChevronDown, ChevronUp } from 'lucide-react';
import {
  detectTrueCloseReason,
  getCloseReasonText,
  getCloseReasonBadgeColor
} from '@/utils/close-reason-detector';

interface Trade {
  id: string;
  symbol: string;
  position_type: 'buy' | 'sell';
  lot_size: number;
  entry_price: number;
  exit_price: number;
  profit_loss: number;
  opened_at: string;
  closed_at: string;
  close_reason: string;
  stop_loss: number;
  take_profit: number;
  trade_source: 'manual' | 'demo' | 'goal_mode';
  goal_session_id?: string;
  max_drawdown?: number;
  max_profit?: number;
  total_pips?: number;
}

interface TradeStatistics {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_profit: number;
  total_loss: number;
  net_profit: number;
  average_win: number;
  average_loss: number;
  best_trade: number;
  worst_trade: number;
  profit_factor: number;
  average_max_drawdown: number;
  average_max_profit: number;
  average_pips: number;
  best_pips: number;
  worst_pips: number;
}

export function TradeHistory() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [statistics, setStatistics] = useState<TradeStatistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterSymbol, setFilterSymbol] = useState<string>('all');
  const [filterOutcome, setFilterOutcome] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'date' | 'profit'>('date');
  const [availableSymbols, setAvailableSymbols] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState(true); // Default collapsed

  useEffect(() => {
    fetchTradeHistory();
    fetchStatistics();
    fetchAvailableSymbols();
  }, []);

  const fetchTradeHistory = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // IMPORTANT: All trades are now goal-based only
      // Single source of truth: goal_session_trades
      const { data: trades, error } = await supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false });

      if (error) throw error;

      // Normalize trades
      const normalizedTrades: Trade[] = (trades || []).map((trade: any) => ({
        id: trade.id,
        symbol: trade.symbol,
        position_type: trade.direction,
        lot_size: parseFloat(trade.position_size),
        entry_price: parseFloat(trade.entry_price),
        exit_price: parseFloat(trade.exit_price || trade.current_price),
        profit_loss: parseFloat(trade.profit_loss),
        opened_at: trade.opened_at,
        closed_at: trade.closed_at,
        close_reason: trade.close_reason || 'manual',
        stop_loss: parseFloat(trade.stop_loss) || 0,
        take_profit: parseFloat(trade.take_profit) || 0,
        trade_source: 'goal_mode' as const,
        goal_session_id: trade.goal_session_id,
        max_drawdown: trade.max_drawdown !== null && trade.max_drawdown !== undefined ? parseFloat(trade.max_drawdown) : undefined,
        max_profit: trade.max_profit !== null && trade.max_profit !== undefined ? parseFloat(trade.max_profit) : undefined,
        total_pips: trade.total_pips !== null && trade.total_pips !== undefined ? parseFloat(trade.total_pips) : undefined
      }));

      setTrades(normalizedTrades);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch trade history:', error);
      setLoading(false);
    }
  };

  const fetchStatistics = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .rpc('get_trade_statistics', { p_user_id: user.id });

      if (error) throw error;
      if (data && data.length > 0) {
        setStatistics(data[0]);
      }
    } catch (error) {
      console.error('Failed to fetch statistics:', error);
    }
  };

  const fetchAvailableSymbols = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch symbols from open goal mode positions
      const { data: openGoalTrades, error: openError } = await supabase
        .from('goal_session_trades')
        .select('symbol, goal_sessions!inner(user_id)')
        .eq('goal_sessions.user_id', user.id)
        .eq('status', 'open');

      // Fetch symbols from closed goal mode positions
      const { data: closedGoalTrades, error: closedError } = await supabase
        .from('goal_session_trades')
        .select('symbol, goal_sessions!inner(user_id)')
        .eq('goal_sessions.user_id', user.id)
        .eq('status', 'closed');

      const symbols = new Set<string>();

      if (!openError && openGoalTrades) {
        openGoalTrades.forEach((trade: any) => symbols.add(trade.symbol));
      }

      if (!closedError && closedGoalTrades) {
        closedGoalTrades.forEach((trade: any) => symbols.add(trade.symbol));
      }

      setAvailableSymbols(Array.from(symbols).sort());
    } catch (error) {
      console.error('Failed to fetch available symbols:', error);
    }
  };

  const exportToCSV = () => {
    if (trades.length === 0) return;

    const headers = [
      'Symbol',
      'Type',
      'Lot Size',
      'Entry Price',
      'Exit Price',
      'P&L',
      'Max Drawdown',
      'Max Profit (MFE)',
      'Total Pips',
      'Opened At',
      'Closed At',
      'Duration',
      'Close Reason'
    ];

    const rows = filteredTrades.map(trade => {
      const duration = new Date(trade.closed_at).getTime() - new Date(trade.opened_at).getTime();
      const durationMinutes = Math.floor(duration / 60000);

      return [
        trade.symbol,
        trade.position_type.toUpperCase(),
        trade.lot_size,
        trade.entry_price,
        trade.exit_price,
        trade.profit_loss,
        trade.max_drawdown !== undefined && trade.max_drawdown !== null ? trade.max_drawdown : 'N/A',
        trade.max_profit !== undefined && trade.max_profit !== null ? trade.max_profit : 'N/A',
        trade.total_pips !== undefined && trade.total_pips !== null ? trade.total_pips : 'N/A',
        new Date(trade.opened_at).toLocaleString(),
        new Date(trade.closed_at).toLocaleString(),
        `${durationMinutes}m`,
        trade.close_reason
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-history-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Use availableSymbols from state, fallback to trades if empty
  const uniqueSymbols = availableSymbols.length > 0
    ? availableSymbols
    : Array.from(new Set(trades.map(t => t.symbol)));

  const filteredTrades = trades
    .filter(trade => {
      if (filterSymbol !== 'all' && trade.symbol !== filterSymbol) return false;
      if (filterOutcome === 'winning' && trade.profit_loss <= 0) return false;
      if (filterOutcome === 'losing' && trade.profit_loss >= 0) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'date') {
        return new Date(b.closed_at).getTime() - new Date(a.closed_at).getTime();
      } else {
        return b.profit_loss - a.profit_loss;
      }
    });

  const formatPrice = (price: number, symbol: string): string => {
    return symbol.includes('JPY') ? price.toFixed(3) : price.toFixed(5);
  };

  const formatDateTime = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const calculateDuration = (openedAt: string, closedAt: string): string => {
    const duration = new Date(closedAt).getTime() - new Date(openedAt).getTime();
    const minutes = Math.floor(duration / 60000);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    return `${minutes}m`;
  };

  const getSourceLabel = (source: string): { label: string; color: string } => {
    switch (source) {
      case 'manual':
        return { label: 'Manual', color: 'bg-blue-900/30 text-blue-400' };
      case 'demo':
        return { label: 'Demo', color: 'bg-gray-700/50 text-gray-300' };
      case 'goal_mode':
        return { label: 'Goal Mode', color: 'bg-purple-900/30 text-purple-400' };
      default:
        return { label: 'Unknown', color: 'bg-gray-700/50 text-gray-400' };
    }
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg p-6">
        <h3 className="text-lg font-bold text-white mb-4">Trade History</h3>
        <div className="text-center text-gray-400 py-8">Loading trade history...</div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-500" />
            Trade History
          </h3>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-gray-400 hover:text-white transition-colors p-1"
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? (
              <ChevronDown className="w-5 h-5" />
            ) : (
              <ChevronUp className="w-5 h-5" />
            )}
          </button>
        </div>

        {!collapsed && statistics && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Total Trades</div>
                <div className="text-white text-xl font-bold">{statistics.total_trades}</div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Win Rate</div>
                <div className={`text-xl font-bold ${statistics.win_rate >= 50 ? 'text-green-400' : 'text-red-400'}`}>
                  {statistics.win_rate.toFixed(1)}%
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Net P&L</div>
                <div className={`text-xl font-bold ${statistics.net_profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  ${statistics.net_profit.toFixed(2)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Best Trade</div>
                <div className="text-green-400 text-xl font-bold flex items-center gap-1">
                  <Award className="w-4 h-4" />
                  ${statistics.best_trade.toFixed(2)}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Avg Drawdown</div>
                <div className={`text-lg font-bold ${statistics.average_max_drawdown >= 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                  ${Math.abs(statistics.average_max_drawdown).toFixed(2)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Avg Max Profit</div>
                <div className="text-emerald-400 text-lg font-bold">
                  ${statistics.average_max_profit.toFixed(2)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Avg Pips</div>
                <div className={`text-lg font-bold ${statistics.average_pips >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {statistics.average_pips >= 0 ? '+' : ''}{statistics.average_pips.toFixed(1)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Best Pips</div>
                <div className="text-green-400 text-lg font-bold">
                  +{statistics.best_pips.toFixed(1)}
                </div>
              </div>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <div className="text-gray-400 text-xs mb-1">Worst Pips</div>
                <div className="text-red-400 text-lg font-bold">
                  {statistics.worst_pips.toFixed(1)}
                </div>
              </div>
            </div>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <select
            value={filterSymbol}
            onChange={(e) => setFilterSymbol(e.target.value)}
            className="bg-gray-800 text-white text-sm px-3 py-1 rounded border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Symbols</option>
            {uniqueSymbols.map(symbol => (
              <option key={symbol} value={symbol}>{symbol}</option>
            ))}
          </select>

          <select
            value={filterOutcome}
            onChange={(e) => setFilterOutcome(e.target.value)}
            className="bg-gray-800 text-white text-sm px-3 py-1 rounded border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Outcomes</option>
            <option value="winning">Winning Trades</option>
            <option value="losing">Losing Trades</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'date' | 'profit')}
            className="bg-gray-800 text-white text-sm px-3 py-1 rounded border border-gray-700 hover:border-gray-600 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="date">Sort by Date</option>
            <option value="profit">Sort by P&L</option>
          </select>

          {trades.length > 0 && (
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm rounded transition-colors"
            >
              <Download className="w-4 h-4" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {filteredTrades.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No trade history found</p>
            <p className="text-sm mt-2">Start trading to see your history here</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {filteredTrades.map((trade) => (
              <div
                key={trade.id}
                className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-3">
                    {trade.position_type === 'buy' ? (
                      <TrendingUp className="w-5 h-5 text-green-400" />
                    ) : (
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    )}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white font-bold">{trade.symbol}</span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          trade.position_type === 'buy'
                            ? 'bg-green-900/30 text-green-400'
                            : 'bg-red-900/30 text-red-400'
                        }`}>
                          {trade.position_type.toUpperCase()}
                        </span>
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${getSourceLabel(trade.trade_source).color}`}>
                          {getSourceLabel(trade.trade_source).label}
                        </span>
                        <span className="text-gray-400 text-sm">{trade.lot_size} lots</span>
                      </div>
                      <div className="text-xs text-gray-500 flex items-center gap-2 mt-1">
                        <Calendar className="w-3 h-3" />
                        {formatDateTime(trade.closed_at)} • {calculateDuration(trade.opened_at, trade.closed_at)}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xl font-bold ${trade.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {trade.profit_loss >= 0 ? '+' : ''}${trade.profit_loss.toFixed(2)}
                    </div>
                    <div className="text-xs text-gray-500 capitalize">
                      {(() => {
                        const smartResult = detectTrueCloseReason({
                          exitPrice: trade.exit_price,
                          stopLoss: trade.stop_loss,
                          takeProfit: trade.take_profit,
                          symbol: trade.symbol,
                          databaseCloseReason: trade.close_reason
                        });
                        return getCloseReasonText(smartResult.displayReason);
                      })()}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm mt-3 pt-3 border-t border-gray-700">
                  <div>
                    <div className="text-gray-500 text-xs">Entry</div>
                    <div className="text-white">{formatPrice(trade.entry_price, trade.symbol)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Exit</div>
                    <div className="text-white">{formatPrice(trade.exit_price, trade.symbol)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Stop Loss</div>
                    <div className="text-yellow-400">{formatPrice(trade.stop_loss, trade.symbol)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Take Profit</div>
                    <div className="text-green-400">{formatPrice(trade.take_profit, trade.symbol)}</div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Max Drawdown</div>
                    <div className="text-red-400 font-semibold">
                      {trade.max_drawdown !== undefined && trade.max_drawdown !== null
                        ? `$${Math.abs(trade.max_drawdown).toFixed(2)}`
                        : 'N/A'}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 text-xs">Pips</div>
                    <div className={`font-semibold ${(trade.total_pips || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {(trade.total_pips || 0) >= 0 ? '+' : ''}{(trade.total_pips || 0).toFixed(1)}
                    </div>
                  </div>
                </div>
                {(trade.max_profit || 0) > 0 && (
                  <div className="text-xs text-emerald-400 mt-2 flex items-center gap-2">
                    <span className="text-gray-500">Peak Profit (MFE):</span>
                    <span className="font-semibold">${(trade.max_profit || 0).toFixed(2)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
