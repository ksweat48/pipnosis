/**
 * CLUB TOKEN LEDGER SERVICE
 *
 * SSOT for all Club token operations including:
 * - Token balance queries
 * - Token additions (purchases, rewards, admin grants)
 * - Token deductions (cashouts, admin actions)
 * - Transaction history
 * - Token locking for membership requirements
 *
 * CRITICAL DISTINCTIONS:
 * - Club Tokens: Utility tokens for Club access and rewards (this service)
 * - Trading Credits: Fixed-price currency for trade execution (separate system)
 * - These systems are SEPARATE and do NOT convert between each other
 *
 * CRITICAL: All token mutations MUST use RPC functions for atomicity
 */

import { supabase } from '@/lib/supabase';

export interface ClubTokenBalance {
  totalTokens: number;
  lockedTokens: number;
  availableTokens: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  stakedTokens?: number;
  rewardTokensPending?: number;
}

export interface TokenTransaction {
  id: string;
  userId: string;
  transactionType: string;
  amount: number;
  balanceAfter: number;
  referenceId: string | null;
  referenceType: string | null;
  description: string;
  createdAt: string;
  createdBy: string | null;
}

class ClubTokenLedgerService {
  /**
   * Get user's Club token balance (SSOT)
   * Uses RPC function for consistent computation
   */
  async getBalance(userId: string): Promise<ClubTokenBalance> {
    const { data, error } = await supabase.rpc('get_club_token_balance', {
      p_user_id: userId
    });

    if (error) {
      console.error('[ClubTokenLedgerService] Error fetching balance:', error);
      // Return zero balance on error
      return {
        totalTokens: 0,
        lockedTokens: 0,
        availableTokens: 0,
        lifetimeEarned: 0,
        lifetimeSpent: 0
      };
    }

    // RPC returns array with single row
    const result = data && data.length > 0 ? data[0] : null;

    return {
      totalTokens: result?.total_tokens || 0,
      lockedTokens: result?.locked_tokens || 0,
      availableTokens: result?.available_tokens || 0,
      lifetimeEarned: result?.lifetime_earned || 0,
      lifetimeSpent: result?.lifetime_spent || 0
    };
  }

  /**
   * Add tokens to user's balance
   * Uses RPC function for atomic operation with ledger logging
   */
  async addTokens(
    userId: string,
    amount: number,
    transactionType: 'membership_purchase' | 'referral_reward' | 'staking_reward' | 'admin_grant' | 'promotion_bonus' | 'migration_adjustment' | 'staking_unlock',
    description: string,
    referenceId: string | null = null,
    referenceType: 'membership' | 'referral' | 'cashout' | 'staking' | 'admin_action' | 'promotion' | null = null,
    createdBy: string | null = null
  ): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('add_club_tokens', {
        p_user_id: userId,
        p_amount: amount,
        p_transaction_type: transactionType,
        p_description: description,
        p_reference_id: referenceId,
        p_reference_type: referenceType,
        p_created_by: createdBy
      });

      if (error) {
        console.error('[ClubTokenLedgerService] Error adding tokens:', error);
        return false;
      }

      return data === true;
    } catch (error) {
      console.error('[ClubTokenLedgerService] Exception adding tokens:', error);
      return false;
    }
  }

  /**
   * Deduct tokens from user's balance
   * Uses RPC function for atomic operation with validation
   */
  async deductTokens(
    userId: string,
    amount: number,
    transactionType: 'cashout_deduction' | 'admin_deduct' | 'discount_burn' | 'staking_lock',
    description: string,
    referenceId: string | null = null,
    referenceType: 'membership' | 'referral' | 'cashout' | 'staking' | 'admin_action' | 'promotion' | null = null,
    createdBy: string | null = null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('deduct_club_tokens', {
        p_user_id: userId,
        p_amount: amount,
        p_transaction_type: transactionType,
        p_description: description,
        p_reference_id: referenceId,
        p_reference_type: referenceType,
        p_created_by: createdBy
      });

      if (error) {
        console.error('[ClubTokenLedgerService] Error deducting tokens:', error);
        return { success: false, error: error.message };
      }

      return { success: data === true };
    } catch (error: any) {
      console.error('[ClubTokenLedgerService] Exception deducting tokens:', error);
      return { success: false, error: error.message || 'Unknown error' };
    }
  }

  /**
   * Lock tokens for membership requirement
   * Locked tokens cannot be spent but count toward total balance
   */
  async lockTokens(userId: string, amount: number): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('club_token_balances')
        .update({ locked_tokens: amount })
        .eq('user_id', userId);

      if (error) {
        console.error('[ClubTokenLedgerService] Error locking tokens:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ClubTokenLedgerService] Exception locking tokens:', error);
      return false;
    }
  }

  /**
   * Get user's token transaction history
   */
  async getTransactionHistory(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<TokenTransaction[]> {
    const { data, error } = await supabase
      .from('club_token_ledger')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('[ClubTokenLedgerService] Error fetching transactions:', error);
      return [];
    }

    return (data || []).map(this.mapTransactionFromDb);
  }

  /**
   * Subscribe to token balance changes for realtime updates
   */
  subscribeToBalance(userId: string, callback: (balance: ClubTokenBalance) => void) {
    const channel = supabase
      .channel(`club-token-balance-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_token_balances',
          filter: `user_id=eq.${userId}`
        },
        async () => {
          const balance = await this.getBalance(userId);
          callback(balance);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  /**
   * Subscribe to new transactions for realtime updates
   */
  subscribeToTransactions(userId: string, callback: (transaction: TokenTransaction) => void) {
    const channel = supabase
      .channel(`club-token-ledger-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'club_token_ledger',
          filter: `user_id=eq.${userId}`
        },
        (payload) => {
          callback(this.mapTransactionFromDb(payload.new));
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  /**
   * Map database record to TokenTransaction interface
   */
  private mapTransactionFromDb(data: any): TokenTransaction {
    return {
      id: data.id,
      userId: data.user_id,
      transactionType: data.transaction_type,
      amount: data.amount,
      balanceAfter: data.balance_after,
      referenceId: data.reference_id,
      referenceType: data.reference_type,
      description: data.description,
      createdAt: data.created_at,
      createdBy: data.created_by
    };
  }

  /**
   * Format transaction type for display
   */
  formatTransactionType(type: string): string {
    const typeMap: Record<string, string> = {
      membership_purchase: 'Membership Purchase',
      referral_reward: 'Referral Reward',
      staking_reward: 'Staking Reward',
      admin_grant: 'Admin Grant',
      admin_deduct: 'Admin Deduction',
      cashout_deduction: 'Cashout',
      promotion_bonus: 'Promotion Bonus',
      migration_adjustment: 'System Adjustment',
      staking_unlock: 'Staking Unlock',
      discount_burn: 'Credit Discount Burn',
      staking_lock: 'Staking Lock'
    };

    return typeMap[type] || type;
  }
}

// Export singleton instance
export const clubTokenLedgerService = new ClubTokenLedgerService();
