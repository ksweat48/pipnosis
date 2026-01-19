import { useState, useEffect } from 'react';
import { useAuth } from './useAuth';
import { useCreditBalance } from './useCreditBalance';
import { creditValidationService } from '@/services/credit-validation-service';
import { supabase } from '@/lib/supabase';

export interface CreditStatus {
  balance: number;
  isAdmin: boolean;
  isLoading: boolean;
  isCritical: boolean;
  isWarning: boolean;
  isLow: boolean;
  canStartSession: boolean;
  canAffordSignal: boolean;
  estimatedSignals: number;
  blockedSessionId: string | null;
  isSessionBlocked: boolean;
  signalCost: number;
  minBalance: number;
}

export function useCreditStatus() {
  const { user } = useAuth();
  const { balance, isLoading: isBalanceLoading } = useCreditBalance(user?.id || null);
  const [blockedSessionId, setBlockedSessionId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const signalCost = creditValidationService.getSignalCost();
  const minBalance = creditValidationService.getMinBalanceForSession();

  useEffect(() => {
    if (user?.id) {
      checkBlockedSession();

      const channel = supabase
        .channel(`credit-status-${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'goal_sessions',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            checkBlockedSession();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user?.id]);

  useEffect(() => {
    if (!isBalanceLoading) {
      setIsLoading(false);
    }
  }, [isBalanceLoading]);

  const checkBlockedSession = async () => {
    if (!user?.id) return;

    try {
      const { data } = await supabase
        .from('goal_sessions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .eq('credit_blocked', true)
        .maybeSingle();

      setBlockedSessionId(data?.id || null);
    } catch (error) {
      console.error('[useCreditStatus] Error checking blocked session:', error);
      setBlockedSessionId(null);
    }
  };

  const currentBalance = balance?.balance || 0;
  const isAdmin = balance?.isAdmin || false;

  const status: CreditStatus = {
    balance: currentBalance,
    isAdmin,
    isLoading,
    isCritical: !isAdmin && currentBalance < minBalance,
    isWarning: !isAdmin && currentBalance >= minBalance && currentBalance < 30,
    isLow: !isAdmin && currentBalance >= 30 && currentBalance < 50,
    canStartSession: isAdmin || currentBalance >= minBalance,
    canAffordSignal: isAdmin || currentBalance >= signalCost,
    estimatedSignals: isAdmin ? Infinity : Math.floor(currentBalance / signalCost),
    blockedSessionId,
    isSessionBlocked: blockedSessionId !== null,
    signalCost,
    minBalance
  };

  return status;
}
