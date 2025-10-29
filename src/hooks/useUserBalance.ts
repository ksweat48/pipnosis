import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export function useUserBalance(userId: string | null) {
  const [balance, setBalance] = useState(10000);
  const [totalPnL, setTotalPnL] = useState(0);
  const [openPositionsCount, setOpenPositionsCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshBalance = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);

      const { data: profile } = await supabase
        .from('user_profiles')
        .select('demo_balance')
        .eq('id', userId)
        .maybeSingle();

      if (profile) {
        setBalance(profile.demo_balance || 10000);
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const refreshPositions = useCallback(async () => {
    if (!userId) return;

    try {
      const { data: positions } = await supabase
        .from('simulated_positions')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'open');

      if (positions) {
        setOpenPositionsCount(positions.length);

        const pnl = positions.reduce((sum, pos) => {
          return sum + (pos.current_pnl || 0);
        }, 0);
        setTotalPnL(pnl);
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error);
    }
  }, [userId]);

  useEffect(() => {
    if (userId) {
      refreshBalance();
      refreshPositions();

      const interval = setInterval(() => {
        refreshPositions();
      }, 5000);

      return () => clearInterval(interval);
    }
  }, [userId, refreshBalance, refreshPositions]);

  return {
    balance,
    totalPnL,
    openPositionsCount,
    loading,
    refreshBalance,
    refreshPositions
  };
}
