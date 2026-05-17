import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { pricePollingCoordinator, PriceUpdate } from '../services/price-polling-coordinator';
import { calculatePnL } from '../types/position';

interface OpenPosition {
  symbol: string;
  direction: 'buy' | 'sell';
  entry_price: number;
  lot_size: number;
  current_pnl: number;
}

export function useUserBalance(userId: string | null) {
  const [balance, setBalance] = useState(10000);
  const [totalPnL, setTotalPnL] = useState(0);
  const [totalBalance, setTotalBalance] = useState(10000);
  const [openPositionsCount, setOpenPositionsCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const positionsRef = useRef<OpenPosition[]>([]);
  const balanceRef = useRef(10000);

  const fetchOpenPositions = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('goal_session_trades')
      .select('symbol, direction, entry_price, lot_size, position_size, current_pnl')
      .eq('user_id', userId)
      .eq('status', 'open');

    if (!error && data) {
      positionsRef.current = data.map(t => ({
        symbol: t.symbol,
        direction: t.direction,
        entry_price: t.entry_price,
        lot_size: t.lot_size || t.position_size || 0.01,
        current_pnl: t.current_pnl || 0,
      }));
      setOpenPositionsCount(data.length);
    }
  }, [userId]);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);

      const { data, error } = await supabase
        .rpc('get_total_balance', { p_user_id: userId });

      if (error) {
        console.error('[useUserBalance] Failed to fetch balance:', error);
        return;
      }

      if (data) {
        const realizedBalance = data.balance || 10000;
        balanceRef.current = realizedBalance;
        setBalance(realizedBalance);
        setTotalPnL(data.unrealized_pnl || 0);
        setTotalBalance(data.total_balance || 10000);
        setOpenPositionsCount(data.open_positions_count || 0);
      }
    } catch (error) {
      console.error('[useUserBalance] Failed to fetch balance:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refreshPositions = useCallback(async () => {
    await fetchOpenPositions();
  }, [fetchOpenPositions]);

  // Initial load: fetch balance + positions
  useEffect(() => {
    if (!userId) return;
    refreshBalance();
    fetchOpenPositions();
  }, [userId, refreshBalance, fetchOpenPositions]);

  // Slow cadence: re-sync realized balance from DB every 15 seconds
  useEffect(() => {
    if (!userId) return;
    const interval = setInterval(() => {
      refreshBalance();
      fetchOpenPositions();
    }, 15000);
    return () => clearInterval(interval);
  }, [userId, refreshBalance, fetchOpenPositions]);

  // Fast cadence: subscribe to pricePollingCoordinator for live P&L (2-second updates)
  useEffect(() => {
    if (!userId) return;

    const handlePriceUpdate = (update: PriceUpdate) => {
      const positions = positionsRef.current;
      if (positions.length === 0) {
        setTotalPnL(0);
        setTotalBalance(balanceRef.current);
        return;
      }

      const priceMap: Record<string, { bid: number; ask: number }> = {};
      for (const p of update.prices) {
        priceMap[p.symbol] = { bid: p.bid, ask: p.ask };
      }

      let unrealizedPnL = 0;
      for (const pos of positions) {
        const livePrice = priceMap[pos.symbol];
        if (livePrice && pos.entry_price > 0) {
          const currentPrice = pos.direction === 'buy' ? livePrice.bid : livePrice.ask;
          unrealizedPnL += calculatePnL(pos.direction, pos.entry_price, currentPrice, pos.lot_size, pos.symbol);
        } else {
          unrealizedPnL += pos.current_pnl;
        }
      }

      setTotalPnL(unrealizedPnL);
      setTotalBalance(balanceRef.current + unrealizedPnL);
    };

    const unsubscribe = pricePollingCoordinator.subscribe(handlePriceUpdate);
    return () => { unsubscribe(); };
  }, [userId]);

  return {
    balance,
    totalPnL,
    totalBalance,
    openPositionsCount,
    loading,
    refreshBalance,
    refreshPositions
  };
}
