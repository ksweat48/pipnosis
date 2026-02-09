import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { clubTokenLedgerService, type ClubTokenBalance } from '@/services/club-token-ledger-service';
import { clubStakingService, type StakingSummary } from '@/services/club-staking-service';

export interface TokenBalanceState {
  balance: ClubTokenBalance | null;
  stakingSummary: StakingSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTokenBalance(): TokenBalanceState {
  const { user } = useAuth();
  const [balance, setBalance] = useState<ClubTokenBalance | null>(null);
  const [stakingSummary, setStakingSummary] = useState<StakingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!user) return;

    try {
      const [bal, summary] = await Promise.all([
        clubTokenLedgerService.getBalance(user.id),
        clubStakingService.getStakingSummary(user.id),
      ]);

      setBalance(bal);
      setStakingSummary(summary);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load token balance');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    loadData();

    const unsubBalance = clubTokenLedgerService.subscribeToBalance(user.id, (b) => {
      setBalance(b);
    });

    const stakingInterval = setInterval(() => {
      if (user) {
        clubStakingService.getStakingSummary(user.id).then(setStakingSummary);
      }
    }, 15000);

    return () => {
      unsubBalance();
      clearInterval(stakingInterval);
    };
  }, [user, loadData]);

  return {
    balance,
    stakingSummary,
    loading,
    error,
    refresh: loadData,
  };
}
