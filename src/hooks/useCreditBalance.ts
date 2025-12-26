import { useState, useEffect } from 'react';
import { creditMeterService, type CreditBalance } from '@/services/credit-meter-service';

export function useCreditBalance(userId: string | null) {
  const [balance, setBalance] = useState<CreditBalance | null>(null);
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
      const data = await creditMeterService.getBalance(userId);
      setBalance(data);
      setIsLoading(false);
    };

    loadBalance();

    unsubscribe = creditMeterService.subscribeToBalance(userId, (newBalance) => {
      setBalance(newBalance);
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [userId]);

  return { balance, isLoading };
}
