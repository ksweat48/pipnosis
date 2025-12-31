import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * useUserBalance Hook
 *
 * SINGLE SOURCE OF TRUTH: Uses database functions to calculate balance and P&L
 * - Never calculates locally
 * - Database guarantees consistency
 * - All logic in one place (database functions)
 */
export function useUserBalance(userId: string | null) {
  const [balance, setBalance] = useState(10000);
  const [totalPnL, setTotalPnL] = useState(0);
  const [totalBalance, setTotalBalance] = useState(10000);
  const [openPositionsCount, setOpenPositionsCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);

      // SINGLE SOURCE OF TRUTH: Call database function
      const { data, error } = await supabase
        .rpc('get_total_balance', { p_user_id: userId });

      if (error) {
        console.error('[useUserBalance] Failed to fetch balance:', error);
        return;
      }

      if (data) {
        // Database returns all calculated values
        setBalance(data.balance || 10000);
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
    if (!userId) return;

    try {
      // SINGLE SOURCE OF TRUTH: Call database function
      const { data, error } = await supabase
        .rpc('get_total_balance', { p_user_id: userId });

      if (error) {
        console.error('[useUserBalance] Failed to refresh positions:', error);
        return;
      }

      if (data) {
        setTotalPnL(data.unrealized_pnl || 0);
        setTotalBalance(data.total_balance || 10000);
        setOpenPositionsCount(data.open_positions_count || 0);
      }
    } catch (error) {
      console.error('[useUserBalance] Failed to refresh positions:', error);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      refreshBalance();

      // Refresh positions more frequently (every 5 seconds)
      const interval = setInterval(() => {
        refreshPositions();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [userId, refreshBalance, refreshPositions]);

  return {
    balance,           // Realized balance
    totalPnL,          // Unrealized P&L from open positions
    totalBalance,      // balance + totalPnL
    openPositionsCount,
    loading,
    refreshBalance,
    refreshPositions
  };
}
