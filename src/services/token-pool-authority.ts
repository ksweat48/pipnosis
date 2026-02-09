/**
 * Token Pool Authority - SSOT for token pool operations
 *
 * Responsibility:
 * - Manage all token pool movements (debit, credit, transfer)
 * - Enforce pool balance constraints (no negative balances)
 * - Maintain event-sourced audit trail
 * - Verify supply integrity (sum of pools + burned = 100M PIP)
 *
 * SSOT Compliance:
 * - Single authority for all pool mutations
 * - All operations are atomic and event-sourced
 * - Integrates with token-lifecycle-coordinator for pool-to-user grants
 *
 * @module services/token-pool-authority
 */

import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

const TOTAL_SUPPLY = 100000000; // 100M PIP

export type PoolId =
  | 'COMMUNITY_INCENTIVES'
  | 'MARKETING_PARTNERS'
  | 'PUBLIC_LIQUIDITY_FUTURE'
  | 'FOUNDERS_TEAM'
  | 'OPERATIONS_RESERVE'
  | 'BURNED';

export type PoolEventType =
  | 'POOL_INIT'
  | 'POOL_DEBIT'
  | 'POOL_CREDIT'
  | 'POOL_TRANSFER'
  | 'POOL_BURN_SINK';

export interface TokenPool {
  pool_id: PoolId;
  pool_name: string;
  initial_allocation_pip: number;
  current_balance_pip: number;
  created_at: string;
  updated_at: string;
}

export interface PoolEvent {
  event_id: string;
  ts: string;
  pool_id: PoolId;
  event_type: PoolEventType;
  amount_pip: number;
  ref_type?: string;
  ref_id?: string;
  metadata?: Record<string, any>;
}

export interface SupplyIntegrityCheck {
  check_name: string;
  passed: boolean;
  expected_value: number;
  actual_value: number;
  details: string;
}

/**
 * Token Pool Authority
 * SSOT for all token pool operations
 */
class TokenPoolAuthority {
  /**
   * Get all pool balances
   */
  async getPoolBalances(): Promise<TokenPool[]> {
    const { data, error } = await supabase
      .from('token_pools')
      .select('*')
      .order('pool_id');

    if (error) {
      logger.error('Failed to fetch pool balances', { error });
      throw new Error(`Failed to fetch pool balances: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get specific pool balance
   */
  async getPoolBalance(poolId: PoolId): Promise<TokenPool> {
    const { data, error } = await supabase
      .from('token_pools')
      .select('*')
      .eq('pool_id', poolId)
      .single();

    if (error) {
      logger.error('Failed to fetch pool balance', { poolId, error });
      throw new Error(`Failed to fetch pool balance: ${error.message}`);
    }

    return data;
  }

  /**
   * Debit from pool (reduce balance)
   * Creates POOL_DEBIT event
   */
  async debitPool(
    poolId: PoolId,
    amount: number,
    refType: string,
    refId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Debit amount must be positive');
    }

    if (poolId === 'BURNED') {
      throw new Error('Cannot debit from BURNED pool');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'debit_token_pool',
      {
        p_pool_id: poolId,
        p_amount: amount,
        p_ref_type: refType,
        p_ref_id: refId,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to debit pool', { poolId, amount, error: rpcError });
      throw new Error(`Failed to debit pool: ${rpcError.message}`);
    }

    logger.info('Pool debited', { poolId, amount, refType, refId });
  }

  /**
   * Credit to pool (increase balance)
   * Creates POOL_CREDIT event
   */
  async creditPool(
    poolId: PoolId,
    amount: number,
    refType: string,
    refId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Credit amount must be positive');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'credit_token_pool',
      {
        p_pool_id: poolId,
        p_amount: amount,
        p_ref_type: refType,
        p_ref_id: refId,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to credit pool', { poolId, amount, error: rpcError });
      throw new Error(`Failed to credit pool: ${rpcError.message}`);
    }

    logger.info('Pool credited', { poolId, amount, refType, refId });
  }

  /**
   * Transfer between pools
   * Creates POOL_TRANSFER event for both pools
   */
  async transferBetweenPools(
    fromPoolId: PoolId,
    toPoolId: PoolId,
    amount: number,
    reason: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Transfer amount must be positive');
    }

    if (fromPoolId === toPoolId) {
      throw new Error('Cannot transfer to the same pool');
    }

    if (fromPoolId === 'BURNED') {
      throw new Error('Cannot transfer from BURNED pool');
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      'transfer_between_token_pools',
      {
        p_from_pool_id: fromPoolId,
        p_to_pool_id: toPoolId,
        p_amount: amount,
        p_reason: reason,
        p_metadata: metadata || {}
      }
    );

    if (rpcError) {
      logger.error('Failed to transfer between pools', {
        fromPoolId,
        toPoolId,
        amount,
        error: rpcError
      });
      throw new Error(`Failed to transfer between pools: ${rpcError.message}`);
    }

    logger.info('Pool transfer completed', { fromPoolId, toPoolId, amount, reason });
  }

  /**
   * Move tokens to burned sink
   * This is called when users burn tokens
   */
  async moveToBurnedSink(
    amount: number,
    refType: string,
    refId?: string,
    metadata?: Record<string, any>
  ): Promise<void> {
    if (amount <= 0) {
      throw new Error('Burn amount must be positive');
    }

    await this.creditPool('BURNED', amount, refType, refId, {
      ...metadata,
      note: 'User token burn'
    });

    logger.info('Tokens moved to burned sink', { amount, refType, refId });
  }

  /**
   * Get pool events history
   */
  async getPoolEvents(
    poolId?: PoolId,
    limit: number = 100
  ): Promise<PoolEvent[]> {
    let query = supabase
      .from('token_pool_events')
      .select('*')
      .order('ts', { ascending: false })
      .limit(limit);

    if (poolId) {
      query = query.eq('pool_id', poolId);
    }

    const { data, error } = await query;

    if (error) {
      logger.error('Failed to fetch pool events', { poolId, error });
      throw new Error(`Failed to fetch pool events: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Verify supply integrity
   * Checks that sum of all pools + burned = 100M PIP
   */
  async verifySupplyIntegrity(): Promise<SupplyIntegrityCheck[]> {
    const { data, error } = await supabase.rpc('verify_token_supply_integrity');

    if (error) {
      logger.error('Failed to verify supply integrity', { error });
      throw new Error(`Failed to verify supply integrity: ${error.message}`);
    }

    const checks = (data || []) as SupplyIntegrityCheck[];

    const failures = checks.filter(c => !c.passed);
    if (failures.length > 0) {
      logger.error('Supply integrity check failed', { failures });
    } else {
      logger.info('Supply integrity verified', { checks });
    }

    return checks;
  }

  /**
   * Get circulating supply breakdown
   */
  async getCirculatingSupply(): Promise<{
    total_liquid: number;
    total_staked: number;
    total_rewards_pending: number;
    total_vested: number;
    total_circulating: number;
  }> {
    const { data, error } = await supabase.rpc('get_circulating_supply');

    if (error) {
      logger.error('Failed to get circulating supply', { error });
      throw new Error(`Failed to get circulating supply: ${error.message}`);
    }

    return data || {
      total_liquid: 0,
      total_staked: 0,
      total_rewards_pending: 0,
      total_vested: 0,
      total_circulating: 0
    };
  }

  /**
   * Get pool allocation summary
   */
  async getPoolAllocationSummary(): Promise<{
    total_supply: number;
    pool_sum: number;
    burned_total: number;
    circulating_total: number;
    pools: Array<{
      pool_id: PoolId;
      pool_name: string;
      current_balance: number;
      percentage_of_supply: number;
      percentage_remaining: number;
    }>;
  }> {
    const pools = await this.getPoolBalances();
    const circulating = await this.getCirculatingSupply();

    const poolSum = pools
      .filter(p => p.pool_id !== 'BURNED')
      .reduce((sum, p) => sum + Number(p.current_balance_pip), 0);

    const burnedPool = pools.find(p => p.pool_id === 'BURNED');
    const burnedTotal = Number(burnedPool?.current_balance_pip || 0);

    return {
      total_supply: TOTAL_SUPPLY,
      pool_sum: poolSum,
      burned_total: burnedTotal,
      circulating_total: circulating.total_circulating,
      pools: pools.map(p => ({
        pool_id: p.pool_id,
        pool_name: p.pool_name,
        current_balance: Number(p.current_balance_pip),
        percentage_of_supply: (Number(p.current_balance_pip) / TOTAL_SUPPLY) * 100,
        percentage_remaining: (Number(p.current_balance_pip) / Number(p.initial_allocation_pip)) * 100
      }))
    };
  }
}

export const tokenPoolAuthority = new TokenPoolAuthority();
