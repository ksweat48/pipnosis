/**
 * Club Token Ledger Coordinator - SSOT for Club PIP token operations
 *
 * Responsibility:
 * - Single authority for all club token ledger queries and analytics
 * - Provides lifecycle flow metrics for admin dashboard
 * - Maps transaction types to business categories
 * - Maintains integrity between club_token_ledger (SSOT) and club_token_balances (derived state)
 *
 * SSOT Compliance:
 * - club_token_ledger is the immutable source of truth for all club token transactions
 * - club_token_balances is automatically synchronized via database trigger
 * - All analytics queries read from club_token_ledger
 *
 * @module services/club-token-ledger-coordinator
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface ClubTokenBalance {
  user_id: string;
  total_tokens: number;
  locked_tokens: number;
  available_tokens: number;
  lifetime_earned: number;
  lifetime_spent: number;
  updated_at: string;
}

export interface ClubTokenTransaction {
  id: string;
  user_id: string;
  transaction_type: string;
  amount: number;
  description: string;
  reference_type?: string;
  reference_id?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface LifecycleFlowMetrics {
  tokens_granted: number;
  tokens_burned: number;
  tokens_staked: number;
  tokens_unstaked: number;
  rewards_accrued: number;
  rewards_claimed: number;
}

/**
 * Club Token Ledger Coordinator
 * SSOT authority for all club token operations
 */
class ClubTokenLedgerCoordinator {
  /**
   * Get user's current token balance
   */
  async getUserBalance(userId: string): Promise<ClubTokenBalance | null> {
    const { data, error } = await supabase
      .from('club_token_balances')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to fetch club token balance', { userId, error });
      throw new Error(`Failed to fetch club token balance: ${error.message}`);
    }

    if (!data) {
      return null;
    }

    return {
      user_id: data.user_id,
      total_tokens: parseFloat(data.total_tokens || '0'),
      locked_tokens: parseFloat(data.locked_tokens || '0'),
      available_tokens: parseFloat(data.available_tokens || '0'),
      lifetime_earned: parseFloat(data.lifetime_earned || '0'),
      lifetime_spent: parseFloat(data.lifetime_spent || '0'),
      updated_at: data.updated_at
    };
  }

  /**
   * Get user's transaction history
   */
  async getUserTransactions(
    userId: string,
    limit: number = 100
  ): Promise<ClubTokenTransaction[]> {
    const { data, error } = await supabase
      .from('club_token_ledger')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch club token transactions', { userId, error });
      throw new Error(`Failed to fetch club token transactions: ${error.message}`);
    }

    return (data || []).map(tx => ({
      id: tx.id,
      user_id: tx.user_id,
      transaction_type: tx.transaction_type,
      amount: parseFloat(tx.amount || '0'),
      description: tx.description || '',
      reference_type: tx.reference_type,
      reference_id: tx.reference_id,
      metadata: tx.metadata,
      created_at: tx.created_at
    }));
  }

  /**
   * Get lifecycle flow metrics (last N days)
   * Maps club_token_ledger transaction types to lifecycle categories
   */
  async getLifecycleFlowMetrics(days: number): Promise<LifecycleFlowMetrics> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const { data, error } = await supabase
      .from('club_token_ledger')
      .select('transaction_type, amount')
      .gte('created_at', sinceDate.toISOString());

    if (error) {
      logger.error('Failed to get lifecycle flow metrics', { days, error });
      throw new Error(`Failed to get lifecycle flow metrics: ${error.message}`);
    }

    const transactions = data || [];

    // Map transaction types to lifecycle categories
    const metrics: LifecycleFlowMetrics = {
      tokens_granted: 0,
      tokens_burned: 0,
      tokens_staked: 0,
      tokens_unstaked: 0,
      rewards_accrued: 0,
      rewards_claimed: 0
    };

    transactions.forEach(tx => {
      const amount = Math.abs(parseFloat(tx.amount || '0'));
      const type = tx.transaction_type;

      // Granted: positive grant transactions
      if (type === 'membership_purchase' ||
          type === 'admin_grant' ||
          type === 'membership_upgrade_grant' ||
          type === 'referral_bonus') {
        metrics.tokens_granted += amount;
      }

      // Burned: discount burn transactions
      if (type === 'discount_burn') {
        metrics.tokens_burned += amount;
      }

      // Staked: locking for staking (not membership lock)
      if (type === 'staking_lock' || type === 'stake') {
        metrics.tokens_staked += amount;
      }

      // Unstaked: unlocking from staking
      if (type === 'staking_unlock' || type === 'unstake') {
        metrics.tokens_unstaked += amount;
      }

      // Rewards accrued: staking rewards pending
      if (type === 'staking_reward') {
        metrics.rewards_accrued += amount;
      }

      // Rewards claimed: converting pending rewards to liquid
      if (type === 'reward_claim') {
        metrics.rewards_claimed += amount;
      }
    });

    return metrics;
  }

  /**
   * Get total tokens by transaction type
   */
  async getTotalByTransactionType(transactionType: string): Promise<number> {
    const { data, error } = await supabase
      .from('club_token_ledger')
      .select('amount')
      .eq('transaction_type', transactionType);

    if (error) {
      logger.error('Failed to get total by transaction type', { transactionType, error });
      throw new Error(`Failed to get total by transaction type: ${error.message}`);
    }

    return (data || []).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount || '0')), 0);
  }

  /**
   * Verify balance integrity
   * Checks if club_token_balances matches club_token_ledger
   */
  async verifyBalanceIntegrity(userId: string): Promise<{
    is_valid: boolean;
    balance_total: number;
    ledger_total: number;
    drift: number;
  }> {
    // Get balance from denormalized table
    const balance = await this.getUserBalance(userId);
    if (!balance) {
      throw new Error(`User balance not found: ${userId}`);
    }

    // Calculate from ledger (SSOT) - only positive amounts
    const { data, error } = await supabase
      .from('club_token_ledger')
      .select('amount')
      .eq('user_id', userId)
      .gt('amount', 0);

    if (error) {
      logger.error('Failed to verify balance integrity', { userId, error });
      throw new Error(`Failed to verify balance integrity: ${error.message}`);
    }

    const ledger_total = (data || []).reduce((sum, tx) => sum + parseFloat(tx.amount || '0'), 0);
    const drift = balance.total_tokens - ledger_total;

    return {
      is_valid: Math.abs(drift) < 0.01, // Allow tiny floating point errors
      balance_total: balance.total_tokens,
      ledger_total,
      drift
    };
  }

  /**
   * Get all user balances for admin dashboard
   */
  async getAllBalances(): Promise<ClubTokenBalance[]> {
    const { data, error } = await supabase
      .from('club_token_balances')
      .select('*')
      .order('updated_at', { ascending: false });

    if (error) {
      logger.error('Failed to fetch all club token balances', { error });
      throw new Error(`Failed to fetch all club token balances: ${error.message}`);
    }

    return (data || []).map(row => ({
      user_id: row.user_id,
      total_tokens: parseFloat(row.total_tokens || '0'),
      locked_tokens: parseFloat(row.locked_tokens || '0'),
      available_tokens: parseFloat(row.available_tokens || '0'),
      lifetime_earned: parseFloat(row.lifetime_earned || '0'),
      lifetime_spent: parseFloat(row.lifetime_spent || '0'),
      updated_at: row.updated_at
    }));
  }

  /**
   * Manually trigger balance sync from ledger (admin utility)
   */
  async syncBalanceFromLedger(userId: string): Promise<void> {
    const { error } = await supabase.rpc('sync_club_token_balance_from_ledger', {
      p_user_id: userId
    });

    if (error) {
      logger.error('Failed to sync balance from ledger', { userId, error });
      throw new Error(`Failed to sync balance from ledger: ${error.message}`);
    }

    logger.info('Balance synced from ledger', { userId });
  }

  /**
   * Verify all user balances (admin diagnostic)
   */
  async verifyAllBalances(): Promise<Array<{
    user_id: string;
    email: string;
    balance_total: number;
    ledger_total: number;
    drift: number;
    status: string;
  }>> {
    const { data, error } = await supabase.rpc('admin_verify_club_token_balances');

    if (error) {
      logger.error('Failed to verify all balances', { error });
      throw new Error(`Failed to verify all balances: ${error.message}`);
    }

    return (data || []).map(row => ({
      user_id: row.user_id,
      email: row.email,
      balance_total: parseFloat(row.balance_total || '0'),
      ledger_total: parseFloat(row.ledger_total || '0'),
      drift: parseFloat(row.drift || '0'),
      status: row.status
    }));
  }
}

export const clubTokenLedgerCoordinator = new ClubTokenLedgerCoordinator();
