import { supabase } from '@/lib/supabase';

export interface CreditBalance {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  isAdmin: boolean;
}

export interface CreditTransaction {
  id: string;
  userId: string;
  transactionType: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  metadata: Record<string, any>;
  createdAt: string;
}

class CreditMeterService {
  async getBalance(userId: string): Promise<CreditBalance | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_user_token_balance', { p_user_id: userId });

      if (error) throw error;

      if (!data || data.length === 0) return null;

      const row = data[0];
      return {
        balance: parseFloat(row.balance),
        lifetimeEarned: parseFloat(row.lifetime_earned),
        lifetimeSpent: parseFloat(row.lifetime_spent),
        isAdmin: row.is_admin
      };
    } catch (error) {
      console.error('[Credit Meter] Error fetching balance:', error);
      return null;
    }
  }

  async deductCredits(
    userId: string,
    amount: number,
    transactionType: string,
    metadata: Record<string, any> = {}
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('deduct_tokens', {
          p_user_id: userId,
          p_amount: amount,
          p_transaction_type: transactionType,
          p_metadata: metadata
        });

      if (error) throw error;

      return data === true;
    } catch (error) {
      console.error('[Credit Meter] Error deducting credits:', error);
      return false;
    }
  }

  async addCredits(
    userId: string,
    amount: number,
    transactionType: string,
    metadata: Record<string, any> = {}
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase
        .rpc('add_tokens', {
          p_user_id: userId,
          p_amount: amount,
          p_transaction_type: transactionType,
          p_metadata: metadata
        });

      if (error) throw error;

      return data === true;
    } catch (error) {
      console.error('[Credit Meter] Error adding credits:', error);
      return false;
    }
  }

  async getTransactionHistory(userId: string, limit: number = 50): Promise<CreditTransaction[]> {
    try {
      const { data, error } = await supabase
        .from('token_transaction_history')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      return (data || []).map(row => ({
        id: row.id,
        userId: row.user_id,
        transactionType: row.transaction_type,
        amount: parseFloat(row.amount),
        balanceBefore: parseFloat(row.balance_before),
        balanceAfter: parseFloat(row.balance_after),
        metadata: row.metadata || {},
        createdAt: row.created_at
      }));
    } catch (error) {
      console.error('[Credit Meter] Error fetching transaction history:', error);
      return [];
    }
  }

  subscribeToBalance(userId: string, callback: (balance: CreditBalance) => void) {
    const channel = supabase
      .channel(`credit-balance-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_token_balance',
          filter: `user_id=eq.${userId}`
        },
        async () => {
          const balance = await this.getBalance(userId);
          if (balance) callback(balance);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }
}

export const creditMeterService = new CreditMeterService();
