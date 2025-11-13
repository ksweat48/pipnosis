import React, { useState, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Clock, AlertCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { simulatedTradingService } from '@/services/simulated-trading';
import { pollingConfigService } from '@/services/polling-config-service';
import { notificationManager } from '@/services/notification-manager';

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
}

export function ActivePositions({ refreshTrigger }: ActivePositionsProps) {
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [closingPosition, setClosingPosition] = useState<string | null>(null);
  const [livePrices, setLivePrices] = useState<Record<string, { bid: number; ask: number }>>({});

  useEffect(() => {
    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [refreshTrigger]);

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

      const [open, pending] = await Promise.all([
        simulatedTradingService.getOpenPositions(user.id),
        simulatedTradingService.getPendingOrders(user.id)
      ]);

      setOpenPositions(open);
      setPendingOrders(pending);
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
    if (!livePrices[position.symbol]) {
      alert('Unable to close position: price data not available');
      return;
    }

    const confirmed = window.confirm(
      `Close ${position.position_type.toUpperCase()} ${position.symbol} ${position.lot_size} lots?\nCurrent P&L: $${position.current_pnl.toFixed(2)}`
    );

    if (!confirmed) return;

    setClosingPosition(position.id);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const currentPrice = position.position_type === 'buy'
        ? livePrices[position.symbol].bid
        : livePrices[position.symbol].ask;

      const result = await simulatedTradingService.closePosition(
        position.id,
        currentPrice,
        user.id
      );

      if (result.success) {
        notificationManager.playSound('trade_exit');
        await fetchPositions();
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error('Failed to close position:', error);
      alert('Failed to close position');
    } finally {
      setClosingPosition(null);
    }
  };

  const handleCancelOrder = async (orderId: string) => {
    const confirmed = window.confirm('Cancel this pending order?');
    if (!confirmed) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const result = await simulatedTradingService.cancelPendingOrder(orderId, user.id);
      if (result.success) {
        notificationManager.playSound('trade_exit');
        await fetchPositions();
      } else {
        alert(result.message);
      }
    } catch (error) {
      console.error('Failed to cancel order:', error);
      alert('Failed to cancel order');
    }
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
                ${totalPnL.toFixed(2)}
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

                  return (
                    <div
                      key={position.id}
                      className="bg-gray-800 border border-gray-700 rounded-lg p-4 hover:border-gray-600 transition-colors"
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
                              {position.position_type.toUpperCase()}
                            </span>
                            <span className="text-gray-400 text-sm">{position.lot_size} lots</span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-500 text-xs">Entry</div>
                              <div className="text-white">{formatPrice(position.entry_price, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Current</div>
                              <div className="text-white">{formatPrice(currentPrice, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Stop Loss</div>
                              <div className="text-yellow-400">{formatPrice(position.stop_loss, position.symbol)}</div>
                            </div>
                            <div>
                              <div className="text-gray-500 text-xs">Take Profit</div>
                              <div className="text-green-400">{formatPrice(position.take_profit, position.symbol)}</div>
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between">
                            <div className="text-xs text-gray-500">
                              Opened: {formatDateTime(position.opened_at)}
                            </div>
                            <div className={`text-lg font-bold ${currentPnL >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {currentPnL >= 0 ? '+' : ''}${currentPnL.toFixed(2)}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleClosePosition(position)}
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
                              {order.position_type.toUpperCase()} LIMIT
                            </span>
                            <span className="text-gray-400 text-sm">{order.lot_size} lots</span>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                            <div>
                              <div className="text-gray-500 text-xs">Limit Price</div>
                              <div className="text-yellow-400 font-semibold">{formatPrice(order.limit_price, order.symbol)}</div>
                            </div>
                            {currentPrice && (
                              <div>
                                <div className="text-gray-500 text-xs">Current</div>
                                <div className="text-white">
                                  {formatPrice(
                                    order.position_type === 'buy' ? currentPrice.ask : currentPrice.bid,
                                    order.symbol
                                  )}
                                </div>
                              </div>
                            )}
                            {distanceToPips && (
                              <div>
                                <div className="text-gray-500 text-xs">Distance</div>
                                <div className="text-gray-400">{distanceToPips} pips</div>
                              </div>
                            )}
                            <div>
                              <div className="text-gray-500 text-xs">Stop Loss</div>
                              <div className="text-yellow-400">{formatPrice(order.stop_loss, order.symbol)}</div>
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
