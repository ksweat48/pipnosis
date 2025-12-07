import React, { useState, useEffect, useCallback } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { useToast } from '@/hooks/useToast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { supabase } from '@/lib/supabase';
import { simulatedTradingService } from '@/services/simulated-trading';
import { pollingConfigService } from '@/services/polling-config-service';
import { notificationManager } from '@/services/notification-manager';
import { pageContext } from '@/services/page-context';
import {
  TrendingUp,
  TrendingDown,
  X,
  Clock,
  AlertCircle,
  Filter,
  DollarSign,
  Target,
  Activity,
  Zap,
  CheckCircle,
  XCircle,
  Percent,
  History,
  ArrowUpDown
} from 'lucide-react';

interface Position {
  id: string;
  symbol: string;
  position_type: 'buy' | 'sell';
  order_type: 'market' | 'limit';
  lot_size: number;
  entry_price: number | null;
  limit_price: number | null;
  stop_loss: number;
  take_profit: number;
  status: 'pending' | 'open' | 'closed';
  current_price: number | null;
  current_pnl: number;
  opened_at: string;
}

interface RecentTrade {
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
}

type FilterType = 'all' | 'winning' | 'losing' | 'breakeven';
type SortType = 'pnl' | 'duration' | 'symbol' | 'size';

export function PositionsPage() {
  const { user } = useAuth();
  const { balance, totalPnL, openPositionsCount, refreshBalance, refreshPositions } = useUserBalance(user?.id || null);
  const toast = useToast();
  const { confirm } = useConfirmDialog();

  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Position[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});

  const [filterType, setFilterType] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('pnl');
  const [selectedSymbol, setSelectedSymbol] = useState<string>('all');

  useEffect(() => {
    pageContext.setPage('positions');
    return () => pageContext.setPage('other');
  }, []);

  useEffect(() => {
    if (user) {
      fetchAllData();
      const interval = setInterval(fetchAllData, 3000);
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    const symbols = Array.from(new Set([
      ...openPositions.map(p => p.symbol),
      ...pendingOrders.map(p => p.symbol)
    ]));

    if (symbols.length > 0) {
      fetchLivePrices(symbols);
      const strategy = pollingConfigService.getStrategy();
      const interval = strategy.highInterval;
      const priceInterval = setInterval(() => fetchLivePrices(symbols), interval);
      return () => clearInterval(priceInterval);
    }
  }, [openPositions, pendingOrders]);

  const fetchAllData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [open, pending, recent] = await Promise.all([
        simulatedTradingService.getOpenPositions(user.id),
        simulatedTradingService.getPendingOrders(user.id),
        fetchRecentTrades(user.id)
      ]);

      setOpenPositions(open);
      setPendingOrders(pending);
      setRecentTrades(recent);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch positions data:', error);
      setLoading(false);
    }
  };

  const fetchRecentTrades = async (userId: string): Promise<RecentTrade[]> => {
    const { data, error } = await supabase
      .from('trade_history')
      .select('*')
      .eq('user_id', userId)
      .order('closed_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('Failed to fetch recent trades:', error);
      return [];
    }

    return data || [];
  };

  const fetchLivePrices = async (symbols: string[]) => {
    const prices: Record<string, { bid: number; ask: number }> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const { data, error } = await supabase
            .from('realtime_prices')
            .select('bid, ask')
            .eq('symbol', symbol)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error || !data) return;

          prices[symbol] = {
            bid: parseFloat(data.bid),
            ask: parseFloat(data.ask)
          };
        } catch (error) {
          console.error(`Failed to fetch price for ${symbol}:`, error);
        }
      })
    );

    setLivePrices(prices);
  };

  const calculateCurrentPnL = (position: Position): number => {
    if (!livePrices[position.symbol] || !position.entry_price) return position.current_pnl;

    const currentPrice = position.position_type === 'buy'
      ? livePrices[position.symbol].bid
      : livePrices[position.symbol].ask;

    return simulatedTradingService.calculatePnL(
      position.position_type,
      position.entry_price,
      currentPrice,
      position.lot_size,
      position.symbol
    );
  };

  const handleClosePosition = async (position: Position) => {
    let currentPrice: number;
    let pnl = calculateCurrentPnL(position);

    if (livePrices[position.symbol]) {
      currentPrice = position.position_type === 'buy'
        ? livePrices[position.symbol].bid
        : livePrices[position.symbol].ask;
    } else {
      const { data } = await supabase
        .from('forex_candles')
        .select('close')
        .eq('symbol', position.symbol)
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      currentPrice = data ? parseFloat(data.close) : (position.current_price || position.entry_price || 0);
    }

    const confirmed = await confirm({
      title: 'Close Position',
      message: `Close ${position.position_type.toUpperCase()} ${position.symbol} ${position.lot_size} lots?\nCurrent P&L: $${pnl.toFixed(2)}`,
      confirmText: 'Close',
      cancelText: 'Cancel',
      variant: pnl >= 0 ? 'info' : 'warning'
    });

    if (!confirmed) return;

    setClosingPosition(position.id);

    try {
      const result = await simulatedTradingService.closePosition(
        position.id,
        currentPrice,
        user!.id
      );

      if (result.success) {
        notificationManager.playSound('trade_exit');
        toast.success('Position Closed', result.message || 'Position closed successfully');
        await fetchAllData();
        await refreshBalance();
        await refreshPositions();
      } else {
        toast.error('Failed to Close', result.message || 'Could not close position');
      }
    } catch (error) {
      console.error('Failed to close position:', error);
      toast.error('Error', 'Failed to close position. Please try again.');
    } finally {
      setClosingPosition(null);
    }
  };

  const handleCloseAllPositions = async () => {
    const confirmed = await confirm({
      title: 'Close All Positions',
      message: `Are you sure you want to close all ${openPositions.length} open positions?\nTotal P&L: $${totalPnL.toFixed(2)}`,
      confirmText: 'Close All',
      cancelText: 'Cancel',
      variant: 'warning'
    });

    if (!confirmed) return;

    let successCount = 0;
    let failCount = 0;

    for (const position of openPositions) {
      try {
        const currentPrice = livePrices[position.symbol]
          ? (position.position_type === 'buy'
              ? livePrices[position.symbol].bid
              : livePrices[position.symbol].ask)
          : (position.current_price || position.entry_price || 0);

        const result = await simulatedTradingService.closePosition(
          position.id,
          currentPrice,
          user!.id
        );

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        failCount++;
      }
    }

    if (successCount > 0) {
      notificationManager.playSound('trade_exit');
      toast.success('Positions Closed', `Successfully closed ${successCount} position(s)`);
    }
    if (failCount > 0) {
      toast.error('Some Failed', `Failed to close ${failCount} position(s)`);
    }

    await fetchAllData();
    await refreshBalance();
    await refreshPositions();
  };

  const handleCloseWinningPositions = async () => {
    const winningPositions = openPositions.filter(p => calculateCurrentPnL(p) > 0);

    if (winningPositions.length === 0) {
      toast.info('No Winning Positions', 'There are no positions with positive P&L');
      return;
    }

    const totalWinningPnL = winningPositions.reduce((sum, p) => sum + calculateCurrentPnL(p), 0);

    const confirmed = await confirm({
      title: 'Close Winning Positions',
      message: `Close ${winningPositions.length} winning position(s)?\nTotal P&L: $${totalWinningPnL.toFixed(2)}`,
      confirmText: 'Close Winners',
      cancelText: 'Cancel',
      variant: 'info'
    });

    if (!confirmed) return;

    for (const position of winningPositions) {
      const currentPrice = livePrices[position.symbol]
        ? (position.position_type === 'buy'
            ? livePrices[position.symbol].bid
            : livePrices[position.symbol].ask)
        : (position.current_price || position.entry_price || 0);

      await simulatedTradingService.closePosition(position.id, currentPrice, user!.id);
    }

    notificationManager.playSound('trade_exit');
    toast.success('Winners Closed', `Closed ${winningPositions.length} winning position(s)`);
    await fetchAllData();
    await refreshBalance();
    await refreshPositions();
  };

  const handleCancelOrder = async (orderId: string) => {
    const confirmed = await confirm({
      title: 'Cancel Order',
      message: 'Are you sure you want to cancel this pending order?',
      confirmText: 'Cancel Order',
      cancelText: 'Keep Order',
      variant: 'warning'
    });

    if (!confirmed) return;

    try {
      const result = await simulatedTradingService.cancelPendingOrder(orderId, user!.id);
      if (result.success) {
        notificationManager.playSound('trade_exit');
        toast.success('Order Cancelled', result.message || 'Pending order cancelled successfully');
        await fetchAllData();
      } else {
        toast.error('Failed to Cancel', result.message || 'Could not cancel order');
      }
    } catch (error) {
      console.error('Failed to cancel order:', error);
      toast.error('Error', 'Failed to cancel order. Please try again.');
    }
  };

  const formatPrice = (price: number | null, symbol: string): string => {
    if (price === null) return 'N/A';
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

  const getDuration = (openedAt: string): string => {
    const now = new Date().getTime();
    const opened = new Date(openedAt).getTime();
    const diffMs = now - opened;
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ${diffMins % 60}m`;
    return `${Math.floor(diffMins / 1440)}d ${Math.floor((diffMins % 1440) / 60)}h`;
  };

  const getFilteredAndSortedPositions = () => {
    let filtered = [...openPositions];

    if (selectedSymbol !== 'all') {
      filtered = filtered.filter(p => p.symbol === selectedSymbol);
    }

    if (filterType === 'winning') {
      filtered = filtered.filter(p => calculateCurrentPnL(p) > 0);
    } else if (filterType === 'losing') {
      filtered = filtered.filter(p => calculateCurrentPnL(p) < 0);
    } else if (filterType === 'breakeven') {
      filtered = filtered.filter(p => Math.abs(calculateCurrentPnL(p)) < 1);
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'pnl':
          return calculateCurrentPnL(b) - calculateCurrentPnL(a);
        case 'duration':
          return new Date(a.opened_at).getTime() - new Date(b.opened_at).getTime();
        case 'symbol':
          return a.symbol.localeCompare(b.symbol);
        case 'size':
          return b.lot_size - a.lot_size;
        default:
          return 0;
      }
    });

    return filtered;
  };

  const uniqueSymbols = Array.from(new Set(openPositions.map(p => p.symbol)));
  const filteredPositions = getFilteredAndSortedPositions();
  const largestWinner = openPositions.reduce((max, p) => {
    const pnl = calculateCurrentPnL(p);
    return pnl > max ? pnl : max;
  }, 0);
  const largestLoser = openPositions.reduce((min, p) => {
    const pnl = calculateCurrentPnL(p);
    return pnl < min ? pnl : min;
  }, 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <NavigationMenu />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
          <div className="text-center text-white py-16">
            <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Loading positions...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <div className="mb-6">
          <h1 className="text-xl sm:text-3xl font-bold text-white mb-1">Active Positions</h1>
          <p className="text-gray-400 text-sm sm:text-base">Monitor and manage all your trading positions in real-time</p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <span className="text-gray-400 text-xs sm:text-sm">Open Positions</span>
              <Activity className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />
            </div>
            <div className="text-xl sm:text-3xl font-bold text-white">{openPositions.length}</div>
            <div className="text-xs text-gray-500 mt-1">{pendingOrders.length} pending</div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <span className="text-gray-400 text-xs sm:text-sm truncate">Total P&L</span>
              <DollarSign className="w-4 h-4 sm:w-5 sm:h-5 text-blue-400" />
            </div>
            <div className={`text-xl sm:text-3xl font-bold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Unrealized</div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <span className="text-gray-400 text-xs sm:text-sm truncate">Largest Winner</span>
              <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-green-400" />
            </div>
            <div className="text-xl sm:text-3xl font-bold text-green-400">
              +${largestWinner.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Current best</div>
          </div>

          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-6">
            <div className="flex items-center justify-between mb-1 sm:mb-2">
              <span className="text-gray-400 text-xs sm:text-sm truncate">Largest Loser</span>
              <TrendingDown className="w-4 h-4 sm:w-5 sm:h-5 text-red-400" />
            </div>
            <div className="text-xl sm:text-3xl font-bold text-red-400">
              ${largestLoser.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Current worst</div>
          </div>
        </div>

        {openPositions.length > 0 && (
          <div className="bg-gray-900 border border-gray-700 rounded-lg p-3 sm:p-4 mb-6">
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400 hidden sm:block" />
                  <span className="text-xs sm:text-sm text-gray-400">Filter:</span>
                  <select
                    value={filterType}
                    onChange={(e) => setFilterType(e.target.value as FilterType)}
                    className="flex-1 bg-gray-800 text-white text-xs sm:text-sm border border-gray-700 rounded px-2 sm:px-3 py-1.5 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="all">All Positions</option>
                    <option value="winning">Winning</option>
                    <option value="losing">Losing</option>
                    <option value="breakeven">Breakeven</option>
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs sm:text-sm text-gray-400">Symbol:</span>
                  <select
                    value={selectedSymbol}
                    onChange={(e) => setSelectedSymbol(e.target.value)}
                    className="flex-1 bg-gray-800 text-white text-xs sm:text-sm border border-gray-700 rounded px-2 sm:px-3 py-1.5 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="all">All Symbols</option>
                    {uniqueSymbols.map(symbol => (
                      <option key={symbol} value={symbol}>{symbol}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <ArrowUpDown className="w-4 h-4 text-gray-400 hidden sm:block" />
                  <span className="text-xs sm:text-sm text-gray-400">Sort:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as SortType)}
                    className="flex-1 bg-gray-800 text-white text-xs sm:text-sm border border-gray-700 rounded px-2 sm:px-3 py-1.5 focus:outline-none focus:border-emerald-500"
                  >
                    <option value="pnl">P&L</option>
                    <option value="duration">Duration</option>
                    <option value="symbol">Symbol</option>
                    <option value="size">Lot Size</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleCloseWinningPositions}
                  disabled={openPositions.filter(p => calculateCurrentPnL(p) > 0).length === 0}
                  className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium rounded transition-colors"
                >
                  Close Winners
                </button>
                <button
                  onClick={handleCloseAllPositions}
                  disabled={openPositions.length === 0}
                  className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium rounded transition-colors"
                >
                  Close All
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {filteredPositions.length === 0 && pendingOrders.length === 0 ? (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <h3 className="text-xl font-semibold text-white mb-2">No Active Positions</h3>
              <p className="text-gray-400">You don't have any open positions or pending orders at the moment.</p>
            </div>
          ) : (
            <>
              {filteredPositions.length > 0 && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg">
                  <div className="p-3 sm:p-4 border-b border-gray-700">
                    <h3 className="text-base sm:text-lg font-bold text-white">Open Positions ({filteredPositions.length})</h3>
                  </div>
                  <div className="p-3 sm:p-4 space-y-3">
                    {filteredPositions.map((position) => {
                      const currentPnL = calculateCurrentPnL(position);
                      const currentPrice = livePrices[position.symbol]
                        ? (position.position_type === 'buy'
                            ? livePrices[position.symbol].bid
                            : livePrices[position.symbol].ask)
                        : position.current_price;

                      const pnlPercent = position.entry_price
                        ? ((currentPnL / (position.entry_price * position.lot_size * 100000)) * 100)
                        : 0;

                      const distanceToSL = position.entry_price && currentPrice
                        ? Math.abs(currentPrice - position.stop_loss) * (position.symbol.includes('JPY') ? 100 : 10000)
                        : 0;

                      const distanceToTP = position.entry_price && currentPrice
                        ? Math.abs(currentPrice - position.take_profit) * (position.symbol.includes('JPY') ? 100 : 10000)
                        : 0;

                      return (
                        <div
                          key={position.id}
                          className="bg-gray-800 border border-gray-700 rounded-lg p-3 sm:p-5 hover:border-gray-600 transition-all"
                        >
                          <div className="flex items-start justify-between mb-3 sm:mb-4">
                            <div className="flex items-center gap-2 sm:gap-3">
                              {position.position_type === 'buy' ? (
                                <div className="p-1.5 sm:p-2 bg-green-900/30 rounded">
                                  <TrendingUp className="w-4 h-4 sm:w-6 sm:h-6 text-green-400" />
                                </div>
                              ) : (
                                <div className="p-1.5 sm:p-2 bg-red-900/30 rounded">
                                  <TrendingDown className="w-4 h-4 sm:w-6 sm:h-6 text-red-400" />
                                </div>
                              )}
                              <div>
                                <div className="flex items-center gap-1.5 sm:gap-2">
                                  <span className="text-base sm:text-xl font-bold text-white">{position.symbol}</span>
                                  <span className={`px-1.5 sm:px-2 py-0.5 rounded text-xs font-semibold ${
                                    position.position_type === 'buy'
                                      ? 'bg-green-900/30 text-green-400'
                                      : 'bg-red-900/30 text-red-400'
                                  }`}>
                                    {position.position_type.toUpperCase()}
                                  </span>
                                </div>
                                <div className="text-xs sm:text-sm text-gray-400 mt-1">
                                  {position.lot_size} lots • {getDuration(position.opened_at)}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-lg sm:text-2xl font-bold ${currentPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)}
                              </div>
                              <div className={`text-xs sm:text-sm ${pnlPercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-4 mb-3 sm:mb-4">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Entry</div>
                              <div className="text-white font-medium text-xs sm:text-sm truncate">{formatPrice(position.entry_price, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Current</div>
                              <div className="text-white font-medium text-xs sm:text-sm truncate">{formatPrice(currentPrice, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Stop Loss</div>
                              <div className="text-yellow-400 font-medium text-xs sm:text-sm truncate">{formatPrice(position.stop_loss, position.symbol)}</div>
                              <div className="text-xs text-gray-600">{distanceToSL.toFixed(1)}p</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Take Profit</div>
                              <div className="text-green-400 font-medium text-xs sm:text-sm truncate">{formatPrice(position.take_profit, position.symbol)}</div>
                              <div className="text-xs text-gray-600">{distanceToTP.toFixed(1)}p</div>
                            </div>
                            <div className="hidden md:block">
                              <div className="text-xs text-gray-500 mb-1">Opened</div>
                              <div className="text-white font-medium text-sm">{formatDateTime(position.opened_at)}</div>
                            </div>
                          </div>

                          <button
                            onClick={() => handleClosePosition(position)}
                            disabled={closingPosition === position.id}
                            className="w-full flex items-center justify-center gap-2 px-3 sm:px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium rounded transition-colors"
                          >
                            {closingPosition === position.id ? (
                              <>
                                <Clock className="w-4 h-4 animate-spin" />
                                Closing...
                              </>
                            ) : (
                              <>
                                <X className="w-4 h-4" />
                                Close Position
                              </>
                            )}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {pendingOrders.length > 0 && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg">
                  <div className="p-3 sm:p-4 border-b border-gray-700">
                    <h3 className="text-base sm:text-lg font-bold text-white">Pending Orders ({pendingOrders.length})</h3>
                  </div>
                  <div className="p-3 sm:p-4 space-y-3">
                    {pendingOrders.map((order) => {
                      const currentPrice = livePrices[order.symbol];
                      const distanceToPips = currentPrice && order.limit_price
                        ? Math.abs(
                            (order.position_type === 'buy'
                              ? currentPrice.ask - order.limit_price
                              : order.limit_price - currentPrice.bid) *
                            (order.symbol.includes('JPY') ? 100 : 10000)
                          ).toFixed(1)
                        : null;

                      return (
                        <div
                          key={order.id}
                          className="bg-gray-800/50 border border-gray-700 border-dashed rounded-lg p-5"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-yellow-900/30 rounded">
                                <Clock className="w-6 h-6 text-yellow-400" />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="text-xl font-bold text-white">{order.symbol}</span>
                                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                    order.position_type === 'buy'
                                      ? 'bg-green-900/20 text-green-400'
                                      : 'bg-red-900/20 text-red-400'
                                  }`}>
                                    {order.position_type.toUpperCase()} LIMIT
                                  </span>
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  {order.lot_size} lots
                                </div>
                              </div>
                            </div>
                            <button
                              onClick={() => handleCancelOrder(order.id)}
                              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-medium rounded transition-colors"
                            >
                              Cancel
                            </button>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Limit Price</div>
                              <div className="text-yellow-400 font-medium">{formatPrice(order.limit_price, order.symbol)}</div>
                            </div>
                            {currentPrice && (
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Current Price</div>
                                <div className="text-white font-medium">
                                  {formatPrice(
                                    order.position_type === 'buy' ? currentPrice.ask : currentPrice.bid,
                                    order.symbol
                                  )}
                                </div>
                              </div>
                            )}
                            {distanceToPips && (
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Distance</div>
                                <div className="text-gray-400 font-medium">{distanceToPips} pips</div>
                              </div>
                            )}
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Stop Loss</div>
                              <div className="text-yellow-400 font-medium">{formatPrice(order.stop_loss, order.symbol)}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {recentTrades.length > 0 && (
            <div className="bg-gray-900 border border-gray-700 rounded-lg">
              <div className="p-3 sm:p-4 border-b border-gray-700 flex items-center justify-between">
                <h3 className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <History className="w-4 h-4 sm:w-5 sm:h-5" />
                  Recent Closures
                </h3>
                <span className="text-xs sm:text-sm text-gray-400">Last 10</span>
              </div>
              <div className="p-3 sm:p-4">
                <div className="space-y-2">
                  {recentTrades.map((trade) => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between p-3 bg-gray-800 rounded border border-gray-700"
                    >
                      <div className="flex items-center gap-3">
                        {trade.profit_loss >= 0 ? (
                          <CheckCircle className="w-5 h-5 text-green-400" />
                        ) : (
                          <XCircle className="w-5 h-5 text-red-400" />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white">{trade.symbol}</span>
                            <span className={`text-xs px-2 py-0.5 rounded ${
                              trade.position_type === 'buy'
                                ? 'bg-green-900/30 text-green-400'
                                : 'bg-red-900/30 text-red-400'
                            }`}>
                              {trade.position_type.toUpperCase()}
                            </span>
                            <span className="text-xs text-gray-500">{trade.lot_size} lots</span>
                          </div>
                          <div className="text-xs text-gray-400 mt-1">
                            Closed {formatDateTime(trade.closed_at)} • {trade.close_reason}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`font-bold ${trade.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {trade.profit_loss >= 0 ? '+' : ''}${trade.profit_loss.toFixed(2)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {formatPrice(trade.entry_price, trade.symbol)} → {formatPrice(trade.exit_price, trade.symbol)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
