import { supabase } from '@/lib/supabase';
import { realtimeConnectionManager } from './realtime-connection-manager';

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
  private adminCache: Map<string, { isAdmin: boolean; fetchedAt: number }> = new Map();
  private readonly ADMIN_CACHE_TTL = 5 * 60 * 1000;

  private async checkIsAdmin(userId: string): Promise<boolean> {
    const cached = this.adminCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < this.ADMIN_CACHE_TTL) {
      return cached.isAdmin;
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

      const isAdmin = !error && data?.is_admin === true;
      this.adminCache.set(userId, { isAdmin, fetchedAt: Date.now() });
      return isAdmin;
    } catch {
      return false;
    }
  }

  async getBalance(userId: string): Promise<CreditBalance | null> {
    try {
      const { data, error } = await supabase
        .rpc('get_user_token_balance', { p_user_id: userId });

      if (error) throw error;
      if (!data || !data.success) return null;

      const isAdmin = data.is_admin === true || await this.checkIsAdmin(userId);

      return {
        balance: isAdmin ? Infinity : (data.balance || 50.0),
        lifetimeEarned: 0,
        lifetimeSpent: 0,
        isAdmin
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
      const isAdmin = await this.checkIsAdmin(userId);
      if (isAdmin) return true;

      const { data, error } = await supabase
        .rpc('deduct_tokens', {
          p_user_id: userId,
          p_amount: amount,
          p_transaction_type: transactionType,
          p_metadata: metadata
        });

      if (error) throw error;

      return data && data.success === true;
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

      // RPC returns JSONB: {success, new_balance, amount_added, ...}
      return data && data.success === true;
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
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let destroyed = false;

    const createChannel = () => {
      if (destroyed) return;

      const channel = supabase
        .channel(`credit-balance-${userId}-${Date.now()}`)
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
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR') {
            realtimeConnectionManager.logChannelError('CreditMeter');
          }
        });

      currentChannel = channel;
    };

    createChannel();

    const unsubscribeFromStatus = realtimeConnectionManager.onStatusChange((status) => {
      if (status === 'connected' && currentChannel) {
        supabase.removeChannel(currentChannel);
        currentChannel = null;
        createChannel();
      }
    });

    return () => {
      destroyed = true;
      unsubscribeFromStatus();
      if (currentChannel) {
        supabase.removeChannel(currentChannel);
        currentChannel = null;
      }
    };
  }
}

export const creditMeterService = new CreditMeterService();
