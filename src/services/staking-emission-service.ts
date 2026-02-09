import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';

export interface EmissionState {
  currentMonth: string;
  monthlyEmissionBudgetPip: number;
  dailyEmissionBasePip: number;
  carryoverPip: number;
  lastAccrualDate: string | null;
  totalDistributedLifetime: number;
  poolRemainingPip: number;
}

export interface EmissionRun {
  id: string;
  runDate: string;
  totalDistributed: number;
  stakerCount: number;
  poolRemaining: number;
  status: 'pending' | 'completed' | 'failed';
  errorMessage?: string;
  metadata: {
    dailyEmission?: number;
    baseEmission?: number;
    carryoverIn?: number;
    totalWeightedStake?: number;
    actualDistributed?: number;
    remainderCarryover?: number;
    stakersRewarded?: number;
  };
  createdAt: string;
}

export interface DistributeResult {
  success: boolean;
  runId?: string;
  dailyEmission?: number;
  distributed?: number;
  carryoverOut?: number;
  stakerCount?: number;
  poolRemaining?: number;
  error?: string;
  reason?: string;
  newCarryover?: number;
}

export interface StakingAnalytics {
  totalActiveStaked: number;
  totalUnstakeRequested: number;
  totalPendingRewards: number;
  activeStakers: number;
  unstakePending: number;
  emissionState: EmissionState;
  lastRun: EmissionRun | null;
}

class StakingEmissionService {
  /**
   * Distribute daily staking emissions
   * Uses roll-forward carryover model
   * Idempotent - safe to call multiple times per day
   */
  async distributeEmissions(): Promise<DistributeResult> {
    try {
      const { data, error } = await supabase.rpc('distribute_staking_emissions_v2');

      if (error) {
        logger.error('[StakingEmission] Distribution error', { error });
        return {
          success: false,
          error: error.message,
        };
      }

      if (!data?.success) {
        return {
          success: false,
          error: data?.error || 'Unknown error',
          reason: data?.reason,
        };
      }

      logger.info('[StakingEmission] Distribution completed', {
        runId: data.run_id,
        distributed: data.distributed,
        stakerCount: data.staker_count,
        carryover: data.carryover_out,
      });

      return {
        success: true,
        runId: data.run_id,
        dailyEmission: parseFloat(data.daily_emission || 0),
        distributed: parseFloat(data.distributed || 0),
        carryoverOut: parseFloat(data.carryover_out || 0),
        stakerCount: data.staker_count,
        poolRemaining: parseFloat(data.pool_remaining || 0),
      };
    } catch (error: any) {
      logger.error('[StakingEmission] Exception during distribution', { error });
      return {
        success: false,
        error: error.message || 'Internal error',
      };
    }
  }

  /**
   * Get current emission state (admin only)
   */
  async getEmissionState(): Promise<EmissionState | null> {
    try {
      const { data, error } = await supabase
        .from('staking_emission_state')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) {
        logger.error('[StakingEmission] Error fetching emission state', { error });
        return null;
      }

      return {
        currentMonth: data.current_month,
        monthlyEmissionBudgetPip: parseFloat(data.monthly_emission_budget_pip),
        dailyEmissionBasePip: parseFloat(data.daily_emission_base_pip),
        carryoverPip: parseFloat(data.carryover_pip),
        lastAccrualDate: data.last_accrual_date,
        totalDistributedLifetime: parseFloat(data.total_distributed_lifetime),
        poolRemainingPip: parseFloat(data.pool_remaining_pip),
      };
    } catch (error) {
      logger.error('[StakingEmission] Exception fetching emission state', { error });
      return null;
    }
  }

  /**
   * Get emission run history (admin only)
   */
  async getEmissionHistory(limit: number = 30): Promise<EmissionRun[]> {
    try {
      const { data, error } = await supabase
        .from('club_emission_runs')
        .select('*')
        .order('run_date', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('[StakingEmission] Error fetching emission history', { error });
        return [];
      }

      return (data || []).map(run => ({
        id: run.id,
        runDate: run.run_date,
        totalDistributed: parseFloat(run.total_distributed || 0),
        stakerCount: run.staker_count || 0,
        poolRemaining: parseFloat(run.pool_remaining || 0),
        status: run.status,
        errorMessage: run.error_message,
        metadata: run.metadata || {},
        createdAt: run.created_at,
      }));
    } catch (error) {
      logger.error('[StakingEmission] Exception fetching emission history', { error });
      return [];
    }
  }

  /**
   * Get comprehensive staking analytics (admin only)
   */
  async getStakingAnalytics(): Promise<StakingAnalytics | null> {
    try {
      const { data, error } = await supabase.rpc('get_staking_analytics');

      if (error) {
        logger.error('[StakingEmission] Error fetching analytics', { error });
        return null;
      }

      return {
        totalActiveStaked: parseFloat(data?.total_active_staked || 0),
        totalUnstakeRequested: parseFloat(data?.total_unstake_requested || 0),
        totalPendingRewards: parseFloat(data?.total_pending_rewards || 0),
        activeStakers: data?.active_stakers || 0,
        unstakePending: data?.unstake_pending || 0,
        emissionState: data?.emission_state ? {
          currentMonth: data.emission_state.current_month || '',
          monthlyEmissionBudgetPip: parseFloat(data.emission_state.monthly_emission_budget_pip || 0),
          dailyEmissionBasePip: parseFloat(data.emission_state.daily_base || 0),
          carryoverPip: parseFloat(data.emission_state.carryover || 0),
          lastAccrualDate: data.emission_state.last_accrual,
          totalDistributedLifetime: parseFloat(data.emission_state.total_distributed_lifetime || 0),
          poolRemainingPip: parseFloat(data.emission_state.pool_remaining || 0),
        } : {
          currentMonth: '',
          monthlyEmissionBudgetPip: 0,
          dailyEmissionBasePip: 0,
          carryoverPip: 0,
          lastAccrualDate: null,
          totalDistributedLifetime: 0,
          poolRemainingPip: 0,
        },
        lastRun: data?.last_run ? {
          id: '',
          runDate: data.last_run.date,
          totalDistributed: parseFloat(data.last_run.distributed || 0),
          stakerCount: data.last_run.staker_count || 0,
          poolRemaining: 0,
          status: 'completed',
          metadata: data.last_run.metadata || {},
          createdAt: data.last_run.date,
        } : null,
      };
    } catch (error) {
      logger.error('[StakingEmission] Exception fetching analytics', { error });
      return null;
    }
  }

  /**
   * Check if emissions have run today
   */
  async hasRunToday(): Promise<boolean> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('club_emission_runs')
        .select('id')
        .eq('run_date', today)
        .eq('status', 'completed')
        .single();

      return !!data && !error;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get days until pool exhaustion (estimate)
   */
  async estimatePoolExhaustion(): Promise<number | null> {
    try {
      const state = await this.getEmissionState();
      if (!state || state.poolRemainingPip <= 0) return 0;
      if (state.dailyEmissionBasePip <= 0) return null;

      return Math.floor(state.poolRemainingPip / state.dailyEmissionBasePip);
    } catch (error) {
      logger.error('[StakingEmission] Error estimating exhaustion', { error });
      return null;
    }
  }

  /**
   * Subscribe to emission state changes (admin only)
   */
  subscribeToEmissionState(callback: (state: EmissionState | null) => void) {
    const channel = supabase
      .channel('emission-state-changes')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'staking_emission_state',
        },
        async () => {
          const state = await this.getEmissionState();
          callback(state);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  /**
   * Subscribe to emission runs (admin only)
   */
  subscribeToEmissionRuns(callback: (run: EmissionRun) => void) {
    const channel = supabase
      .channel('emission-runs')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'club_emission_runs',
        },
        (payload) => {
          const run = payload.new as any;
          callback({
            id: run.id,
            runDate: run.run_date,
            totalDistributed: parseFloat(run.total_distributed || 0),
            stakerCount: run.staker_count || 0,
            poolRemaining: parseFloat(run.pool_remaining || 0),
            status: run.status,
            errorMessage: run.error_message,
            metadata: run.metadata || {},
            createdAt: run.created_at,
          });
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }
}

export const stakingEmissionService = new StakingEmissionService();
