/**
 * Token Lifecycle Coordinator - SSOT for user token operations
 *
 * Responsibility:
 * - Manage all user token movements (grant, burn, stake, rewards)
 * - Enforce non-transferability (no user-to-user transfers)
 * - Coordinate with token-pool-authority for pool-to-user grants
 * - Maintain event-sourced audit trail for user operations
 *
 * SSOT Compliance:
 * - Single authority for all user token mutations
 * - All operations are atomic and event-sourced
 * - Integrates with Phase 3A staking system
 *
 * @module services/token-lifecycle-coordinator
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { tokenPoolAuthority, PoolId } from './token-pool-authority';

export type TokenEventType =
  | 'GRANT'
  | 'BURN'
  | 'STAKE_LOCK'
  | 'STAKE_UNLOCK'
  | 'REWARD_ACCRUE'
  | 'REWARD_CLAIM'
  | 'VEST_LOCK'
  | 'VEST_RELEASE'
  | 'ADMIN_ADJUST';

export type TokenBucket = 'liquid' | 'staked' | 'rewards_pending' | 'vested' | 'burned' | 'external';

export interface TokenBalance {
  user_id: string;
  pip_liquid: number;
  pip_staked: number;
  pip_rewards_pending: number;
  pip_vested: number;
  pip_burned_total: number;
  updated_at: string;
}

export interface TokenEvent {
  event_id: string;
  ts: string;
  user_id: string;
  event_type: TokenEventType;
  amount_pip: number;
  bucket_from?: TokenBucket;
  bucket_to?: TokenBucket;
  ref_type?: string;
  ref_id?: string;
  metadata?: Record<string, any>;
}

/**
 * Token Lifecycle Coordinator
 * SSOT for all user token operations
 */
class TokenLifecycleCoordinator {
  /**
   * Get user token balance
   */
  async getUserBalance(userId: string): Promise<TokenBalance | null> {
    const { data, error } = await supabase
      .from('token_balances')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      logger.error('Failed to fetch user token balance', { userId, error });
      throw new Error(`Failed to fetch user token balance: ${error.message}`);
    }

    return data;
  }

  /**
   * Grant tokens to user from pool
   * Debits pool and credits user's liquid balance
   */
  async grantTokens(
    userId: string,
    amount: number,
    sourcePool: PoolId,
    source: string,
    refId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Grant amount must be positive');
    }

    if (sourcePool === 'BURNED') {
      throw new Error('Cannot grant from BURNED pool');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'grant_tokens_to_user',
      {
        p_user_id: userId,
        p_amount: amount,
        p_source_pool: sourcePool,
        p_source: source,
        p_ref_id: refId,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to grant tokens', { userId, amount, sourcePool, error: rpcError });
      throw new Error(`Failed to grant tokens: ${rpcError.message}`);
    }

    logger.info('Tokens granted to user', { userId, amount, sourcePool, source });
  }

  /**
   * Burn tokens from user's liquid balance
   * Moves tokens from liquid → burned_total
   * Credits BURNED pool
   */
  async burnTokens(
    userId: string,
    amount: number,
    reason: string,
    refId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Burn amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'burn_user_tokens',
      {
        p_user_id: userId,
        p_amount: amount,
        p_reason: reason,
        p_ref_id: refId,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to burn tokens', { userId, amount, error: rpcError });
      throw new Error(`Failed to burn tokens: ${rpcError.message}`);
    }

    logger.info('User tokens burned', { userId, amount, reason });
  }

  /**
   * Stake tokens (liquid → staked)
   * Integrates with Phase 3A staking system
   */
  async stakeTokens(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Stake amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'stake_user_tokens',
      {
        p_user_id: userId,
        p_amount: amount,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to stake tokens', { userId, amount, error: rpcError });
      throw new Error(`Failed to stake tokens: ${rpcError.message}`);
    }

    logger.info('User tokens staked', { userId, amount });
  }

  /**
   * Unstake tokens (staked → liquid)
   */
  async unstakeTokens(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Unstake amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'unstake_user_tokens',
      {
        p_user_id: userId,
        p_amount: amount,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to unstake tokens', { userId, amount, error: rpcError });
      throw new Error(`Failed to unstake tokens: ${rpcError.message}`);
    }

    logger.info('User tokens unstaked', { userId, amount });
  }

  /**
   * Accrue reward to user (→ rewards_pending)
   * Used by staking system
   */
  async accrueReward(
    userId: string,
    amount: number,
    source: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Reward amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'accrue_user_reward',
      {
        p_user_id: userId,
        p_amount: amount,
        p_source: source,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to accrue reward', { userId, amount, error: rpcError });
      throw new Error(`Failed to accrue reward: ${rpcError.message}`);
    }

    logger.info('Reward accrued to user', { userId, amount, source });
  }

  /**
   * Claim rewards (rewards_pending → liquid)
   */
  async claimRewards(userId: string): Promise<number> {
    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'claim_user_rewards',
      {
        p_user_id: userId
      }
    );

    if (rpcError) {
      logger.error('Failed to claim rewards', { userId, error: rpcError });
      throw new Error(`Failed to claim rewards: ${rpcError.message}`);
    }

    const claimedAmount = Number(rpcData || 0);
    logger.info('Rewards claimed by user', { userId, amount: claimedAmount });
    return claimedAmount;
  }

  /**
   * Lock tokens for vesting (liquid → vested)
   */
  async lockForVesting(
    userId: string,
    amount: number,
    vestingSchedule: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Vesting amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'lock_tokens_for_vesting',
      {
        p_user_id: userId,
        p_amount: amount,
        p_vesting_schedule: vestingSchedule
      }
    );

    if (rpcError) {
      logger.error('Failed to lock tokens for vesting', { userId, amount, error: rpcError });
      throw new Error(`Failed to lock tokens for vesting: ${rpcError.message}`);
    }

    logger.info('Tokens locked for vesting', { userId, amount });
  }

  /**
   * Release vested tokens (vested → liquid)
   */
  async releaseVested(
    userId: string,
    amount: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Release amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'release_vested_tokens',
      {
        p_user_id: userId,
        p_amount: amount,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to release vested tokens', { userId, amount, error: rpcError });
      throw new Error(`Failed to release vested tokens: ${rpcError.message}`);
    }

    logger.info('Vested tokens released', { userId, amount });
  }

  /**
   * Admin adjustment (emergency use only)
   */
  async adminAdjustBalance(
    userId: string,
    bucket: TokenBucket,
    amount: number,
    reason: string,
    adminUserId: string
  ): Promise<void> {
    if (amount === 0) {
      throw new Error('Adjustment amount cannot be zero');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'admin_adjust_token_balance',
      {
        p_user_id: userId,
        p_bucket: bucket,
        p_amount: amount,
        p_reason: reason,
        p_admin_user_id: adminUserId
      }
    );

    if (rpcError) {
      logger.error('Failed to adjust balance', { userId, bucket, amount, error: rpcError });
      throw new Error(`Failed to adjust balance: ${rpcError.message}`);
    }

    logger.info('Admin balance adjustment', { userId, bucket, amount, reason, adminUserId });
  }

  /**
   * Get user token events history
   */
  async getUserEvents(
    userId: string,
    limit: number = 100
  ): Promise<TokenEvent[]> {
    const { data, error } = await supabase
      .from('token_events')
      .select('*')
      .eq('user_id', userId)
      .order('ts', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch user token events', { userId, error });
      throw new Error(`Failed to fetch user token events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get total tokens by event type (for analytics)
   */
  async getTotalByEventType(eventType: TokenEventType): Promise<number> {
    const { data, error } = await supabase
      .from('token_events')
      .select('amount_pip')
      .eq('event_type', eventType);

    if (error) {
      logger.error('Failed to get total by event type', { eventType, error });
      throw new Error(`Failed to get total by event type: ${error.message}`);
    }

    return (data || []).reduce((sum, e) => sum + Number(e.amount_pip), 0);
  }

  /**
   * Get lifecycle flow metrics (last N days)
   */
  async getLifecycleFlowMetrics(days: number): Promise<{
    tokens_granted: number;
    tokens_burned: number;
    tokens_staked: number;
    tokens_unstaked: number;
    rewards_accrued: number;
    rewards_claimed: number;
  }> {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);

    const { data, error } = await supabase
      .from('token_events')
      .select('event_type, amount_pip')
      .gte('ts', sinceDate.toISOString());

    if (error) {
      logger.error('Failed to get lifecycle flow metrics', { days, error });
      throw new Error(`Failed to get lifecycle flow metrics: ${error.message}`);
    }

    const events = data || [];
    return {
      tokens_granted: events
        .filter(e => e.event_type === 'GRANT')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0),
      tokens_burned: events
        .filter(e => e.event_type === 'BURN')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0),
      tokens_staked: events
        .filter(e => e.event_type === 'STAKE_LOCK')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0),
      tokens_unstaked: events
        .filter(e => e.event_type === 'STAKE_UNLOCK')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0),
      rewards_accrued: events
        .filter(e => e.event_type === 'REWARD_ACCRUE')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0),
      rewards_claimed: events
        .filter(e => e.event_type === 'REWARD_CLAIM')
        .reduce((sum, e) => sum + Number(e.amount_pip), 0)
    };
  }
}

export const tokenLifecycleCoordinator = new TokenLifecycleCoordinator();
