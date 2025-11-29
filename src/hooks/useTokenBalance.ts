import { useState, useEffect } from 'react';
import { tokenMeterService, type TokenBalance } from '@/services/token-meter-service';

export function useTokenBalance(userId: string | null) {
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setBalance(null);
      setIsLoading(false);
      return;
    }

    let unsubscribe: (() => void) | undefined;

    const loadBalance = async () => {
      setIsLoading(true);
      const data = await tokenMeterService.getBalance(userId);
      setBalance(data);
      setIsLoading(false);
    };

    loadBalance();

    unsubscribe = tokenMeterService.subscribeToBalance(userId, (newBalance) => {
      setBalance(newBalance);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userId]);

  return { balance, isLoading };
}
