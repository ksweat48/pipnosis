import React, { useState, useEffect } from 'react';
import { NavigationMenu } from '@/components/NavigationMenu';
import { BottomNavigation } from '@/components/BottomNavigation';
import { PullToRefreshIndicator } from '@/components/PullToRefreshIndicator';
import { TradeClosedActionDialog } from '@/components/TradeClosedActionDialog';
import { useAuth } from '@/hooks/useAuth';
import { useUserBalance } from '@/hooks/useUserBalance';
import { useToast } from '@/hooks/useToast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { positionService } from '@/services/position-service';
import { calculatePnL } from '@/types/position';
import { pollingConfigService } from '@/services/polling-config-service';
import { notificationManager } from '@/services/notification-manager';
import { pageContext } from '@/services/page-context';
import { smartGoalSessionManager } from '@/services/smart-goal-session-manager';
import {
  detectTrueCloseReason,
  getCloseReasonText
} from '@/utils/close-reason-detector';
import {
  TrendingUp,
  TrendingDown,
  X,
  Clock,
  AlertCircle,
  DollarSign,
  Target,
  Activity,
  Zap,
  CheckCircle,
  XCircle,
  Percent,
  History,
  Sparkles,
  ArrowDown,
  ArrowUp,
  BarChart3
} from 'lucide-react';

interface Position {
  id: string;
  symbol: string;
  positionType: 'buy' | 'sell';
  orderType: 'market' | 'limit';
  lotSize: number;
  entryPrice: number | null;
  limitPrice: number | null;
  stopLoss: number;
  takeProfit: number;
  status: 'pending' | 'open' | 'closed';
  currentPrice: number | null;
  currentPnl: number;
  openedAt: string;
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
  stop_loss: number;
  take_profit: number;
  max_drawdown?: number;
  max_profit?: number;
  total_pips?: number;
}

export function PositionsPage() {
  const { user } = useAuth();
  const { balance, totalPnL, openPositionsCount, refreshBalance, refreshPositions } = useUserBalance(user?.id || null);
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();

  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Position[]>([]);
  const [recentTrades, setRecentTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const [showTradeClosedDialog, setShowTradeClosedDialog] = useState(false);
  const [tradeClosedDialogData, setTradeClosedDialogData] = useState<any>(null);

  const pullToRefresh = usePullToRefresh({
    onRefresh: async () => {
      window.location.reload();
    },
    enabled: true
  });

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

  const isValidPosition = (position: Position): boolean => {
    return !!(
      position.symbol &&
      position.entryPrice !== null &&
      position.entryPrice > 0 &&
      position.lotSize > 0 &&
      !isNaN(position.lotSize) &&
      position.stopLoss > 0 &&
      position.takeProfit > 0
    );
  };

  const fetchAllData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [open, pending, recent] = await Promise.all([
        positionService.getOpenPositions(user.id),
        positionService.getPendingOrders(user.id),
        fetchRecentTrades(user.id)
      ]);

      // Filter out corrupted/invalid positions
      const validOpenPositions = open.filter(isValidPosition);
      const invalidCount = open.length - validOpenPositions.length;

      if (invalidCount > 0) {
        console.warn(`Filtered out ${invalidCount} corrupted position(s) with missing data`);
        // Optionally auto-close corrupted positions
        for (const invalid of open.filter(p => !isValidPosition(p))) {
          console.warn('Corrupted position:', invalid.id, {
            symbol: invalid.symbol,
            entry: invalid.entryPrice,
            lots: invalid.lotSize,
            sl: invalid.stopLoss,
            tp: invalid.takeProfit
          });
        }
      }

      setOpenPositions(validOpenPositions);
      setPendingOrders(pending);
      setRecentTrades(recent);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch positions data:', error);
      setLoading(false);
    }
  };

  const fetchRecentTrades = async (userId: string): Promise<RecentTrade[]> => {
    // Fetch ONLY from goal_session_trades (single source of truth)
    const { data: goalTradesData, error } = await supabase
      .from('goal_session_trades')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(10);

    if (error) {
      console.error('[PositionsPage] Error fetching recent trades:', error);
      return [];
    }

    // Map goal_session_trades to RecentTrade format
    const mappedTrades = (goalTradesData || []).map((trade: any) => {
      let profitLoss = parseFloat(trade.profit_loss) || 0;

      // Defensive fallback: If profit_loss is 0 but entry/exit prices differ, calculate it
      if (profitLoss === 0 && trade.entry_price && trade.exit_price && trade.entry_price !== trade.exit_price && trade.position_size > 0) {
        const entryPrice = parseFloat(trade.entry_price);
        const exitPrice = parseFloat(trade.exit_price);
        const positionSize = parseFloat(trade.position_size);

        // Calculate pip distance
        const pipValue = trade.symbol === 'XAUUSD' ? 0.01 : (trade.symbol.includes('JPY') ? 0.01 : 0.0001);
        const pipDistance = (exitPrice - entryPrice) / pipValue;

        // Calculate dollar per pip
        const dollarPerPip = trade.symbol === 'XAUUSD' ? positionSize * 100 : positionSize * 10;

        // Calculate PnL based on direction
        profitLoss = trade.direction === 'buy' ? pipDistance * dollarPerPip : -pipDistance * dollarPerPip;

        console.warn(`Fallback PnL calculation for trade ${trade.id}: $${profitLoss.toFixed(2)}`);
      }

      return {
        id: trade.id,
        symbol: trade.symbol,
        position_type: trade.direction, // direction -> position_type
        lot_size: parseFloat(trade.position_size) || 0, // position_size -> lot_size
        entry_price: parseFloat(trade.entry_price) || 0,
        exit_price: parseFloat(trade.exit_price) || 0,
        profit_loss: profitLoss,
        opened_at: trade.opened_at,
        closed_at: trade.closed_at,
        close_reason: trade.close_reason || 'unknown',
        stop_loss: parseFloat(trade.stop_loss) || 0,
        take_profit: parseFloat(trade.take_profit) || 0,
        max_drawdown: trade.max_drawdown !== null && trade.max_drawdown !== undefined ? parseFloat(trade.max_drawdown) : undefined,
        max_profit: trade.max_profit !== null && trade.max_profit !== undefined ? parseFloat(trade.max_profit) : undefined,
        total_pips: trade.total_pips !== null && trade.total_pips !== undefined ? parseFloat(trade.total_pips) : undefined
      };
    });

    return mappedTrades;
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
    if (!livePrices[position.symbol] || !position.entryPrice) {
      return position.currentPnl || 0;
    }

    const currentPrice = position.positionType === 'buy'
      ? livePrices[position.symbol].bid
      : livePrices[position.symbol].ask;

    return calculatePnL(
      position.positionType,
      position.entryPrice,
      currentPrice,
      position.lotSize,
      position.symbol
    ) || 0;
  };

  const handleClosePosition = async (position: Position) => {
    let currentPrice: number;
    let pnl = calculateCurrentPnL(position);

    if (livePrices[position.symbol]) {
      currentPrice = position.positionType === 'buy'
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

      currentPrice = data ? parseFloat(data.close) : (position.currentPrice || position.entryPrice || 0);
    }

    const confirmed = await confirm({
      title: 'Close Position',
      message: `Close ${(position.positionType || 'buy').toUpperCase()} ${position.symbol} ${position.lotSize} lots?\nCurrent P&L: $${pnl.toFixed(2)}`,
      confirmText: 'Close',
      cancelText: 'Cancel',
      variant: pnl >= 0 ? 'info' : 'warning'
    });

    if (!confirmed) return;

    setClosingPosition(position.id);

    try {
      const result = await positionService.closePosition(
        position.id,
        currentPrice,
        'manual',
        user?.id
      );

      if (result.success) {
        notificationManager.playSound('trade_exit');
        toast.success('Position Closed', result.message || 'Position closed successfully');

        // Refresh data
        await fetchAllData();
        await refreshBalance();
        await refreshPositions();

        // Fetch the closed trade to get goal_session_id
        const { data: closedTrade, error: tradeError } = await supabase
          .from('goal_session_trades')
          .select('*')
          .eq('id', position.id)
          .single();

        if (!tradeError && closedTrade && closedTrade.goal_session_id) {
          console.log('[PositionsPage] Trade closed, fetching session data for dialog');

          // Fetch goal session data
          const { data: sessionData, error: sessionError } = await supabase
            .from('goal_sessions')
            .select('id, target_value, current_progress, status, config')
            .eq('id', closedTrade.goal_session_id)
            .single();

          if (!sessionError && sessionData) {
            // Count trades in this session
            const { data: sessionTrades, error: tradesError } = await supabase
              .from('goal_session_trades')
              .select('id', { count: 'exact' })
              .eq('goal_session_id', closedTrade.goal_session_id);

            const tradesCount = tradesError ? 0 : (sessionTrades?.length || 0);
            const isGoalAchieved = (sessionData.current_progress || 0) >= (sessionData.target_value || 100);

            // Prepare dialog data
            setTradeClosedDialogData({
              symbol: closedTrade.symbol,
              direction: closedTrade.direction,
              entryPrice: closedTrade.entry_price,
              exitPrice: closedTrade.exit_price || currentPrice,
              profitLoss: closedTrade.profit_loss || 0,
              stopLoss: closedTrade.stop_loss,
              takeProfit: closedTrade.take_profit,
              closeReason: closedTrade.close_reason || 'manual',
              currentProgress: sessionData.current_progress || 0,
              targetValue: sessionData.target_value || 100,
              tradesInSession: tradesCount,
              isGoalAchieved,
              sessionId: closedTrade.goal_session_id,
              sessionStatus: sessionData.status
            });

            // Show the dialog
            setShowTradeClosedDialog(true);
            console.log('[PositionsPage] TradeClosedActionDialog shown');
          } else {
            console.log('[PositionsPage] Could not fetch session data:', sessionError);
          }
        } else {
          console.log('[PositionsPage] No goal_session_id found or trade fetch failed');
        }
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

  const handleContinueSession = async () => {
    if (!user || !tradeClosedDialogData) return;

    try {
      // Record user's choice
      await supabase.from('goal_trade_actions').insert({
        user_id: user.id,
        goal_session_id: tradeClosedDialogData.sessionId,
        action_type: 'continue_current',
        trade_close_reason: tradeClosedDialogData.closeReason,
        profit_loss: tradeClosedDialogData.profitLoss,
        cumulative_progress: tradeClosedDialogData.currentProgress,
        target_value: tradeClosedDialogData.targetValue
      });

      setShowTradeClosedDialog(false);
      toast.success('Session Continued', 'Keep trading to reach your goal!');
      await fetchAllData();
    } catch (error) {
      console.error('[PositionsPage] Error continuing session:', error);
      setShowTradeClosedDialog(false);
    }
  };

  const handleStartNewSession = async () => {
    if (!user || !tradeClosedDialogData) return;

    try {
      // Stop current session
      if (tradeClosedDialogData.sessionId) {
        await smartGoalSessionManager.stopSession(tradeClosedDialogData.sessionId, user.id);
      }

      setShowTradeClosedDialog(false);
      toast.success('Session Stopped', 'Navigate to SmartGoal Mode to start a new session');

      // Navigate to SmartGoal Mode page
      navigate('/smart-goal-mode');
    } catch (error) {
      console.error('[PositionsPage] Error starting new session:', error);
      setShowTradeClosedDialog(false);
    }
  };

  const handleCloseForNow = async () => {
    if (!user || !tradeClosedDialogData) return;

    try {
      // Record user's choice
      await supabase.from('goal_trade_actions').insert({
        user_id: user.id,
        goal_session_id: tradeClosedDialogData.sessionId,
        action_type: 'close_for_now',
        trade_close_reason: tradeClosedDialogData.closeReason,
        profit_loss: tradeClosedDialogData.profitLoss,
        cumulative_progress: tradeClosedDialogData.currentProgress,
        target_value: tradeClosedDialogData.targetValue
      });

      // Stop the session
      if (tradeClosedDialogData.sessionId) {
        await smartGoalSessionManager.stopSession(tradeClosedDialogData.sessionId, user.id);
      }

      setShowTradeClosedDialog(false);
      toast.success('Session Closed', 'Take a break and come back when ready!');
      await fetchAllData();
    } catch (error) {
      console.error('[PositionsPage] Error closing session:', error);
      setShowTradeClosedDialog(false);
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
          ? (position.positionType === 'buy'
              ? livePrices[position.symbol].bid
              : livePrices[position.symbol].ask)
          : (position.currentPrice || position.entryPrice || 0);

        const result = await positionService.closePosition(
          position.id,
          currentPrice,
          'manual',
          user?.id,
          position.goal_session_id
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
        ? (position.positionType === 'buy'
            ? livePrices[position.symbol].bid
            : livePrices[position.symbol].ask)
        : (position.currentPrice || position.entryPrice || 0);

      await positionService.closePosition(
        position.id,
        currentPrice,
        'manual',
        user?.id,
        position.goal_session_id
      );
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
      const { error } = await supabase
        .from('goal_session_trades')
        .update({ status: 'closed', close_reason: 'manual' })
        .eq('id', orderId)
        .eq('user_id', user!.id);

      if (!error) {
        notificationManager.playSound('trade_exit');
        toast.success('Order Cancelled', 'Pending order cancelled successfully');
        await fetchAllData();
      } else {
        toast.error('Failed to Cancel', 'Could not cancel order');
      }
    } catch (error) {
      console.error('Failed to cancel order:', error);
      toast.error('Error', 'Failed to cancel order. Please try again.');
    }
  };

  const formatPrice = (price: number | null, symbol: string): string => {
    if (price === null || price === undefined) return 'N/A';
    if (!symbol) return price.toFixed(5);
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
      <div ref={pullToRefresh.containerRef} className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950">
        <PullToRefreshIndicator
          isPulling={pullToRefresh.isPulling}
          isRefreshing={pullToRefresh.isRefreshing}
          pullDistance={pullToRefresh.pullDistance}
          threshold={pullToRefresh.threshold}
        />
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
    <div ref={pullToRefresh.containerRef} className="app-viewport bg-gradient-to-br from-gray-950 via-slate-900 to-gray-950 relative">
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/5 via-transparent to-blue-500/5 pointer-events-none" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />

      <PullToRefreshIndicator
        isPulling={pullToRefresh.isPulling}
        isRefreshing={pullToRefresh.isRefreshing}
        pullDistance={pullToRefresh.pullDistance}
        threshold={pullToRefresh.threshold}
      />
      <NavigationMenu />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-12 relative z-10">
        {openPositions.length > 0 && (
          <div className="relative group mb-6">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-purple-500 to-blue-500 rounded-xl opacity-10 group-hover:opacity-20 transition duration-300 blur" />
            <div className="relative bg-gradient-to-br from-gray-800/90 to-gray-900/90 backdrop-blur-xl border border-gray-700/50 rounded-xl p-3 sm:p-4 shadow-xl">
              <div className="flex gap-2">
                <button
                  onClick={handleCloseWinningPositions}
                  disabled={openPositions.filter(p => calculateCurrentPnL(p) > 0).length === 0}
                  className="flex-1 px-3 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-green-500/25 hover:scale-105 active:scale-95 disabled:scale-100"
                >
                  Close Winners
                </button>
                <button
                  onClick={handleCloseAllPositions}
                  disabled={openPositions.length === 0}
                  className="flex-1 px-3 py-2 bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-500 hover:to-pink-500 disabled:from-gray-600 disabled:to-gray-600 disabled:cursor-not-allowed text-white text-xs sm:text-sm font-medium rounded-lg transition-all shadow-lg hover:shadow-red-500/25 hover:scale-105 active:scale-95 disabled:scale-100"
                >
                  Close All
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="space-y-6">
          {openPositions.length === 0 && pendingOrders.length === 0 ? (
            <div className="bg-gray-900 border border-gray-700 rounded-lg p-12 text-center">
              <AlertCircle className="w-16 h-16 mx-auto mb-4 text-gray-600" />
              <h3 className="text-xl font-semibold text-white mb-2">No Active Positions</h3>
              <p className="text-gray-400">You don't have any open positions or pending orders at the moment.</p>
            </div>
          ) : (
            <>
              {openPositions.length > 0 && (
                <div className="bg-gray-900 border border-gray-700 rounded-lg">
                  <div className="p-3 sm:p-4 border-b border-gray-700">
                    <h3 className="text-base sm:text-lg font-bold text-white">Open Positions ({openPositions.length})</h3>
                  </div>
                  <div className="p-3 sm:p-4 space-y-3">
                    {openPositions.map((position) => {
                      const currentPnL = calculateCurrentPnL(position);
                      const currentPrice = livePrices[position.symbol]
                        ? (position.positionType === 'buy'
                            ? livePrices[position.symbol].bid
                            : livePrices[position.symbol].ask)
                        : position.currentPrice;

                      const pnlPercent = position.entryPrice
                        ? ((currentPnL / (position.entryPrice * position.lotSize * 100000)) * 100)
                        : 0;

                      const distanceToSL = position.entryPrice && currentPrice && position.symbol
                        ? Math.abs(currentPrice - position.stopLoss) * (position.symbol.includes('JPY') ? 100 : 10000)
                        : 0;

                      const distanceToTP = position.entryPrice && currentPrice && position.symbol
                        ? Math.abs(currentPrice - position.takeProfit) * (position.symbol.includes('JPY') ? 100 : 10000)
                        : 0;

                      return (
                        <div
                          key={position.id}
                          className="bg-gray-800 border border-gray-700 rounded-lg p-3 sm:p-5 hover:border-gray-600 transition-all"
                        >
                          <div className="flex items-start justify-between mb-3 sm:mb-4">
                            <div className="flex items-center gap-2 sm:gap-3">
                              {position.positionType === 'buy' ? (
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
                                    position.positionType === 'buy'
                                      ? 'bg-green-900/30 text-green-400'
                                      : 'bg-red-900/30 text-red-400'
                                  }`}>
                                    {(position.positionType || 'buy').toUpperCase()}
                                  </span>
                                </div>
                                <div className="text-xs sm:text-sm text-gray-400 mt-1">
                                  {position.lotSize} lots • {getDuration(position.openedAt)}
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

                          <button
                            onClick={() => navigate(`/trade?symbol=${position.symbol}`)}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-lg text-xs font-semibold text-white transition-all duration-200 shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95 mb-3"
                          >
                            <BarChart3 className="w-3.5 h-3.5" />
                            View Chart
                          </button>

                          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 sm:gap-4 mb-3 sm:mb-4">
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Entry</div>
                              <div className="text-white font-medium text-xs sm:text-sm truncate">{formatPrice(position.entryPrice, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Current</div>
                              <div className="text-white font-medium text-xs sm:text-sm truncate">{formatPrice(currentPrice, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Stop Loss</div>
                              <div className="text-yellow-400 font-medium text-xs sm:text-sm truncate">{formatPrice(position.stopLoss, position.symbol)}</div>
                              <div className="text-xs text-gray-600">{distanceToSL.toFixed(1)}p</div>
                            </div>
                            <div>
                              <div className="text-xs text-gray-500 mb-1">Take Profit</div>
                              <div className="text-green-400 font-medium text-xs sm:text-sm truncate">{formatPrice(position.takeProfit, position.symbol)}</div>
                              <div className="text-xs text-gray-600">{distanceToTP.toFixed(1)}p</div>
                            </div>
                            <div className="hidden md:block">
                              <div className="text-xs text-gray-500 mb-1">Opened</div>
                              <div className="text-white font-medium text-sm">{formatDateTime(position.openedAt)}</div>
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
                      const distanceToPips = currentPrice && order.limitPrice && order.symbol
                        ? Math.abs(
                            (order.positionType === 'buy'
                              ? currentPrice.ask - order.limitPrice
                              : order.limitPrice - currentPrice.bid) *
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
                                    order.positionType === 'buy'
                                      ? 'bg-green-900/20 text-green-400'
                                      : 'bg-red-900/20 text-red-400'
                                  }`}>
                                    {(order.positionType || 'buy').toUpperCase()} LIMIT
                                  </span>
                                </div>
                                <div className="text-sm text-gray-400 mt-1">
                                  {order.lotSize} lots
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
                              <div className="text-yellow-400 font-medium">{formatPrice(order.limitPrice, order.symbol)}</div>
                            </div>
                            {currentPrice && (
                              <div>
                                <div className="text-xs text-gray-500 mb-1">Current Price</div>
                                <div className="text-white font-medium">
                                  {formatPrice(
                                    order.positionType === 'buy' ? currentPrice.ask : currentPrice.bid,
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
                              <div className="text-yellow-400 font-medium">{formatPrice(order.stopLoss, order.symbol)}</div>
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
                      className="p-3 sm:p-4 bg-gray-800 rounded-lg border border-gray-700 hover:border-gray-600 transition-all"
                    >
                      <div className="flex items-start justify-between mb-3">
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
                                {(trade.position_type || 'buy').toUpperCase()}
                              </span>
                              <span className="text-xs text-gray-500">{trade.lot_size} lots</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Closed {formatDateTime(trade.closed_at)} • {(() => {
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
                        <div className="text-right">
                          <div className={`text-lg font-bold ${trade.profit_loss >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {trade.profit_loss >= 0 ? '+' : ''}${trade.profit_loss.toFixed(2)}
                          </div>
                          <div className="text-xs text-gray-500">
                            Final P&L
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 pt-3 border-t border-gray-700/50">
                        <div>
                          <div className="text-xs text-gray-500 mb-1">Entry → Exit</div>
                          <div className="text-xs text-white font-medium">
                            {formatPrice(trade.entry_price, trade.symbol)} → {formatPrice(trade.exit_price, trade.symbol)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                            <ArrowDown className="w-3 h-3" />
                            Max Drawdown
                          </div>
                          <div className="text-xs font-semibold text-red-400">
                            {trade.max_drawdown !== undefined && trade.max_drawdown !== null
                              ? `${trade.max_drawdown < 0 ? '' : '-'}$${Math.abs(trade.max_drawdown).toFixed(2)}`
                              : 'N/A'}
                          </div>
                        </div>
                        {(trade.max_profit || 0) > 0 && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1 flex items-center gap-1">
                              <ArrowUp className="w-3 h-3" />
                              Peak Profit
                            </div>
                            <div className="text-xs font-semibold text-emerald-400">
                              +${trade.max_profit?.toFixed(2)}
                            </div>
                          </div>
                        )}
                        {trade.total_pips !== undefined && trade.total_pips !== 0 && (
                          <div>
                            <div className="text-xs text-gray-500 mb-1">Pips</div>
                            <div className={`text-xs font-semibold ${(trade.total_pips || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {(trade.total_pips || 0) >= 0 ? '+' : ''}{trade.total_pips?.toFixed(1)}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Trade Closed Action Dialog */}
      {tradeClosedDialogData && (
        <TradeClosedActionDialog
          isOpen={showTradeClosedDialog}
          symbol={tradeClosedDialogData.symbol}
          direction={tradeClosedDialogData.direction}
          entryPrice={tradeClosedDialogData.entryPrice}
          exitPrice={tradeClosedDialogData.exitPrice}
          profitLoss={tradeClosedDialogData.profitLoss}
          closeReason={tradeClosedDialogData.closeReason}
          stopLoss={tradeClosedDialogData.stopLoss}
          takeProfit={tradeClosedDialogData.takeProfit}
          currentProgress={tradeClosedDialogData.currentProgress}
          targetValue={tradeClosedDialogData.targetValue}
          tradesInSession={tradeClosedDialogData.tradesInSession}
          isGoalAchieved={tradeClosedDialogData.isGoalAchieved}
          onStartNewSession={handleStartNewSession}
          onContinueSession={handleContinueSession}
          onCloseForNow={handleCloseForNow}
        />
      )}

      <BottomNavigation />
    </div>
  );
}
