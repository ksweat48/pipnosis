import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { simulatedTradingService } from '@/services/simulated-trading';

export function useUserBalance(userId: string | null) {
  const [balance, setBalance] = useState<number>(10000);
  const [isLoading, setIsLoading] = useState(true);
  const [totalPnL, setTotalPnL] = useState<number>(0);
  const [openPositionsCount, setOpenPositionsCount] = useState<number>(0);

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    fetchBalance();
    fetchOpenPositions();

    let channel: any = null;

    try {
      channel = supabase
        .channel('balance_changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'user_profiles',
            filter: `id=eq.${userId}`
          },
          (payload) => {
            if (payload.new && 'account_balance' in payload.new) {
              setBalance(parseFloat(payload.new.account_balance as string));
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'trade_records',
            filter: `user_id=eq.${userId}`
          },
          () => {
            fetchOpenPositions();
          }
        );

      channel.subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn(`Balance realtime subscription issue: ${status}`);
        }
      });
    } catch (error) {
      console.warn('Failed to setup realtime subscription for balance:', error);
    }

    return () => {
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch (error) {
          console.warn('Error removing channel:', error);
        }
      }
    };
  }, [userId]);

  const fetchBalance = async () => {
    if (!userId) return;

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('account_balance')
        .eq('id', userId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setBalance(parseFloat(data.account_balance || '10000'));
      }
    } catch (error) {
      console.error('Failed to fetch balance:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchOpenPositions = async () => {
    if (!userId) return;

    try {
      const positions = await simulatedTradingService.getOpenPositions(userId);
      setOpenPositionsCount(positions.length);

      const total = positions.reduce((sum, pos) => sum + pos.pnl, 0);
      setTotalPnL(total);
    } catch (error) {
      console.error('Failed to fetch open positions:', error);
    }
  };

  const updateBalance = async (newBalance: number) => {
    if (!userId) return;

    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ account_balance: newBalance })
        .eq('id', userId);

      if (error) throw error;
      setBalance(newBalance);
    } catch (error) {
      console.error('Failed to update balance:', error);
    }
  };

  return {
    balance,
    isLoading,
    totalPnL,
    openPositionsCount,
    updateBalance,
    refreshBalance: fetchBalance,
    refreshPositions: fetchOpenPositions
  };
}
