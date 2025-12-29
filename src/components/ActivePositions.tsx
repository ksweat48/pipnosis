import React, { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Clock, AlertCircle, BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { positionService } from '@/services/position-service';
import { calculatePnL } from '@/types/position';
import { pollingConfigService } from '@/services/polling-config-service';
import { notificationManager } from '@/services/notification-manager';
import { useToast } from '@/hooks/useToast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useNavigate } from 'react-router-dom';
import { TradeWellnessIndicator } from './TradeWellnessIndicator';
import { format } from '@/utils/displayFormatters';
import { calculatePipDistance } from '@/utils/currencyHelpers';

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

interface ActivePositionsProps {
  refreshTrigger?: number;
  onPositionClick?: (position: Position) => void;
  currentSymbol?: string;
  goalSessionId?: string; // Optional: filter positions by goal session
}

export function ActivePositions({ refreshTrigger, onPositionClick, currentSymbol, goalSessionId }: ActivePositionsProps) {
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const navigate = useNavigate();

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [refreshTrigger, goalSessionId]);

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

  const fetchPositions = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let openQuery = supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'open')
        .order('created_at', { ascending: false });

      let pendingQuery = supabase
        .from('goal_session_trades')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      // Filter by goalSessionId if provided
      if (goalSessionId) {
        openQuery = openQuery.eq('goal_session_id', goalSessionId);
        pendingQuery = pendingQuery.eq('goal_session_id', goalSessionId);
      }

      const [openResult, pendingResult] = await Promise.all([
        openQuery,
        pendingQuery
      ]);

      if (openResult.error) throw openResult.error;
      if (pendingResult.error) throw pendingResult.error;

      // Convert database records to Position objects
      const openPositions = (openResult.data || []).map(trade => ({
        id: trade.id,
        symbol: trade.symbol,
        position_type: trade.direction || trade.position_type,
        order_type: trade.order_type || 'market',
        lot_size: trade.lot_size || trade.position_size,
        entry_price: trade.entry_price,
        limit_price: trade.limit_price,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        status: trade.status,
        current_price: trade.current_price,
        current_pnl: trade.current_pnl || 0,
        opened_at: trade.created_at
      } as Position));

      const pendingPositions = (pendingResult.data || []).map(trade => ({
        id: trade.id,
        symbol: trade.symbol,
        position_type: trade.direction || trade.position_type,
        order_type: trade.order_type || 'limit',
        lot_size: trade.lot_size || trade.position_size,
        entry_price: trade.entry_price,
        limit_price: trade.limit_price,
        stop_loss: trade.stop_loss,
        take_profit: trade.take_profit,
        status: trade.status,
        current_price: trade.current_price,
        current_pnl: trade.current_pnl || 0,
        opened_at: trade.created_at
      } as Position));

      setOpenPositions(openPositions);
      setPendingOrders(pendingPositions);
      setLoading(false);
    } catch (error) {
      console.error('Failed to fetch positions:', error);
      setLoading(false);
    }
  };

  const fetchLivePrices = async (symbols: string[]) => {
    const prices: Record<string, { bid: number; ask: number }> = {};

    await Promise.all(
      symbols.map(async (symbol) => {
        try {
          // Read from database
          const { data, error } = await supabase
            .from('realtime_prices')
            .select('bid, ask')
            .eq('symbol', symbol)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error || !data) {
            console.error(`Failed to fetch price for ${symbol}:`, error);
            return;
          }

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

  const handleClosePosition = async (position: Position) => {
    let currentPrice: number;
    let pnl = position.current_pnl;

    if (livePrices[position.symbol]) {
      currentPrice = position.position_type === 'buy'
        ? livePrices[position.symbol].bid
        : livePrices[position.symbol].ask;

      pnl = calculatePnL(
        position.position_type,
        position.entry_price || 0,
        currentPrice,
        position.lot_size,
        position.symbol
      );
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
      message: `Close ${format.direction(position.position_type, 'desktop')} ${position.symbol} ${format.lots(position.lot_size, 'desktop')} lots?\nCurrent P&L: ${format.pnl(pnl, 'desktop')}`,
      confirmText: 'Close',
      cancelText: 'Cancel',
      variant: pnl >= 0 ? 'info' : 'warning'
    });

    if (!confirmed) return;

    setClosingPosition(position.id);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const result = await positionService.closePosition(
        position.id,
        currentPrice,
        'manual',
        user.id,
        goalSessionId
      );

      if (result.success) {
        notificationManager.playSound('trade_exit');
        toast.success('Position Closed', result.message || 'Position closed successfully');
        await fetchPositions();
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { error } = await supabase
        .from('goal_session_trades')
        .update({ status: 'closed', close_reason: 'manual' })
        .eq('id', orderId)
        .eq('user_id', user.id);

      if (!error) {
        notificationManager.playSound('trade_exit');
        toast.success('Order Cancelled', 'Pending order cancelled successfully');
        await fetchPositions();
      } else {
        toast.error('Failed to Cancel', 'Could not cancel order');
      }
    } catch (error) {
      console.error('Failed to cancel order:', error);
      toast.error('Error', 'Failed to cancel order. Please try again.');
    }
  };

  const calculateCurrentPnL = (position: Position): number => {
    if (!livePrices[position.symbol] || !position.entry_price) return position.current_pnl;

    const currentPrice = position.position_type === 'buy'
      ? livePrices[position.symbol].bid
      : livePrices[position.symbol].ask;

    return calculatePnL(
      position.position_type,
      position.entry_price,
      currentPrice,
      position.lot_size,
      position.symbol
    );
  };

  const formatDateTime = (dateString: string): string => {
    return format.timestamp(dateString, 'desktop');
  };

  if (loading) {
    return (
      <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg p-6">
        <h3 className="text-lg font-bold text-white mb-4">Active Positions</h3>
        <div className="text-center text-gray-400 py-8">Loading positions...</div>
      </div>
    );
  }

  const totalPnL = openPositions.reduce((sum, pos) => sum + calculateCurrentPnL(pos), 0);

  return (
    <div className="bg-gray-900 rounded-lg border border-gray-700 shadow-lg">
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Active Positions</h3>
          <div className="flex items-center space-x-4">
            <div className="text-sm">
              <span className="text-gray-400">Open: </span>
              <span className="text-white font-semibold">{openPositions.length}</span>
            </div>
            <div className="text-sm">
              <span className="text-gray-400">Total P&L: </span>
              <span className={`font-semibold ${totalPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {format.pnl(totalPnL, 'desktop')}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {openPositions.length === 0 && pendingOrders.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <AlertCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>No active positions or pending orders</p>
          </div>
        ) : (
          <>
            {openPositions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-400 uppercase">Open Positions</h4>
                {openPositions.map((position) => {
                  const currentPnL = calculateCurrentPnL(position);
                  const currentPrice = livePrices[position.symbol]
                    ? (position.position_type === 'buy'
                        ? livePrices[position.symbol].bid
                        : livePrices[position.symbol].ask)
                    : position.current_price;

                  const isCurrentSymbol = currentSymbol === position.symbol;

                  return (
                    <div
                      key={position.id}
                      onClick={() => onPositionClick?.(position)}
                      className={`bg-gray-800 border rounded-lg p-4 transition-all cursor-pointer ${
                        isCurrentSymbol
                          ? 'border-emerald-500 shadow-lg shadow-emerald-500/20'
                          : 'border-gray-700 hover:border-gray-600'
                      }`}
                      title={isCurrentSymbol ? 'Currently displayed on chart' : 'Click to view on chart'}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            {position.position_type === 'buy' ? (
                              <TrendingUp className="w-5 h-5 text-green-400" />
                            ) : (
                              <TrendingDown className="w-5 h-5 text-red-400" />
                            )}
                            <span className="text-white font-bold">{position.symbol}</span>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              position.position_type === 'buy'
                                ? 'bg-green-900/30 text-green-400'
                                : 'bg-red-900/30 text-red-400'
                            }`}>
                              {format.direction(position.position_type, 'desktop')}
                            </span>
                            <span className="text-gray-400 text-sm">{format.lots(position.lot_size, 'desktop')} lots</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/trade?symbol=${position.symbol}`);
                              }}
                              className="flex items-center gap-1.5 px-2.5 py-1 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded text-xs font-semibold text-white transition-all duration-200 shadow-lg hover:shadow-blue-500/25 hover:scale-105 active:scale-95"
                              title="View live chart"
                            >
                              <BarChart3 className="w-3 h-3" />
                              View Chart
                            </button>
                            <div onClick={(e) => e.stopPropagation()}>
                              <TradeWellnessIndicator tradeId={position.id} compact />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-500 text-xs">Entry</div>
                              <div className="text-white">{format.price(position.entry_price, position.symbol, 'desktop')}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Current</div>
                              <div className="text-white">{format.price(currentPrice, position.symbol, 'desktop')}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Stop Loss</div>
                              <div className="text-yellow-400">{format.price(position.stop_loss, position.symbol, 'desktop')}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Take Profit</div>
                              <div className="text-green-400">{format.price(position.take_profit, position.symbol, 'desktop')}</div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between">
                            <div className="text-xs text-gray-500">
                              Opened: {formatDateTime(position.opened_at)}
                            </div>
                            <div className={`text-lg font-bold ${currentPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {format.pnl(currentPnL, 'desktop')}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClosePosition(position);
                          }}
                          disabled={closingPosition === position.id}
                          className="ml-4 p-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
                          title="Close position"
                        >
                          {closingPosition === position.id ? (
                            <Clock className="w-4 h-4 animate-spin" />
                          ) : (
                            <X className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {pendingOrders.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-400 uppercase">Pending Orders</h4>
                {pendingOrders.map((order) => {
                  const currentPrice = livePrices[order.symbol];
                  const distanceToPips = currentPrice && order.limit_price
                    ? calculatePipDistance(
                        order.symbol,
                        order.position_type === 'buy' ? currentPrice.ask : currentPrice.bid,
                        order.limit_price
                      ).toFixed(1)
                    : null;

                  return (
                    <div
                      key={order.id}
                      className="bg-gray-800/50 border border-gray-700 border-dashed rounded-lg p-4"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-3 mb-2">
                            <Clock className="w-5 h-5 text-yellow-400" />
                            <span className="text-white font-bold">{order.symbol}</span>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${
                              order.position_type === 'buy'
                                ? 'bg-green-900/20 text-green-400'
                                : 'bg-red-900/20 text-red-400'
                            }`}>
                              {format.direction(order.position_type, 'desktop')} LIMIT
                            </span>
                            <span className="text-gray-400 text-sm">{format.lots(order.lot_size, 'desktop')} lots</span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-500 text-xs">Limit Price</div>
                              <div className="text-yellow-400 font-semibold">{format.price(order.limit_price, order.symbol, 'desktop')}</div>
                            </div>
                            {currentPrice && (
                              <div>
                                <div className="text-gray-500 text-xs">Current</div>
                                <div className="text-white">
                                  {format.price(
                                    order.position_type === 'buy' ? currentPrice.ask : currentPrice.bid,
                                    order.symbol,
                                    'desktop'
                                  )}
                                </div>
                              </div>
                            )}
                            {distanceToPips && (
                              <div>
                                <div className="text-gray-500 text-xs">Distance</div>
                                <div className="text-gray-400">{format.pips(parseFloat(distanceToPips), 'desktop')}</div>
                              </div>
                            )}
                            <div>
                              <div className="text-gray-500 text-xs">Stop Loss</div>
                              <div className="text-yellow-400">{format.price(order.stop_loss, order.symbol, 'desktop')}</div>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          className="ml-4 p-2 bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors"
                          title="Cancel order"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
