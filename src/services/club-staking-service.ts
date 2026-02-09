import { supabase } from '@/lib/supabase';
import { TOKENOMICS } from '@/config/tokenomics-constants';

export interface StakingPosition {
  id: string;
  amountStaked: number;
  stakedAt: string;
  unlockAt: string;
  durationDays: number;
  status: 'active' | 'unstake_requested' | 'unlocked' | 'cancelled';
  tierWeight: number;
  rewardsEarned: number;
  lastRewardAt: string | null;
  unstakeRequestedAt?: string | null;
  isMatured: boolean;
  canUnstake: boolean;
  canExecuteUnstake: boolean;
}

export interface StakeResult {
  success: boolean;
  positionId?: string;
  amount?: number;
  unlockAt?: string;
  tierWeight?: number;
  error?: string;
}

export interface UnstakeResult {
  success: boolean;
  amountReturned?: number;
  rewardsEarned?: number;
  newAvailable?: number;
  error?: string;
}

export interface RequestUnstakeResult {
  success: boolean;
  positionId?: string;
  status?: string;
  unlockAt?: string;
  rewardsEarned?: number;
  error?: string;
}

export interface ClaimRewardsResult {
  success: boolean;
  rewardsClaimed?: number;
  totalClaimedLifetime?: number;
  error?: string;
}

export interface StakingSummary {
  activePositions: StakingPosition[];
  rewardState: {
    stakedPip: number;
    pendingRewardsPip: number;
    claimedTotalPip: number;
    lastAccrualTs: string | null;
    lastClaimTs: string | null;
  } | null;
  lifetimeStats: {
    totalStakedEvents: number;
    totalUnstakedEvents: number;
    totalRewardsClaimed: number;
  };
}

class ClubStakingService {
  async getPositions(userId: string): Promise<StakingPosition[]> {
    const { data, error } = await supabase.rpc('get_user_staking_summary', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[ClubStakingService] Error fetching positions:', error);
      return [];
    }

    const positions = data?.active_positions || [];
    return positions.map((pos: any) => ({
      id: pos.position_id,
      amountStaked: parseFloat(pos.amount_staked || 0),
      stakedAt: pos.staked_at,
      unlockAt: pos.unlock_at,
      durationDays: 0,
      status: pos.status,
      tierWeight: parseFloat(pos.tier_weight || 1.0),
      rewardsEarned: parseFloat(pos.rewards_earned || 0),
      lastRewardAt: null,
      unstakeRequestedAt: pos.unstake_requested_at,
      isMatured: pos.status === 'unlocked',
      canUnstake: pos.can_unstake || false,
      canExecuteUnstake: pos.status === 'unstake_requested' && pos.can_unstake,
    }));
  }

  async getStakingSummary(userId: string): Promise<StakingSummary | null> {
    const { data, error } = await supabase.rpc('get_user_staking_summary', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[ClubStakingService] Error fetching staking summary:', error);
      return null;
    }

    const positions = (data?.active_positions || []).map((pos: any) => ({
      id: pos.position_id,
      amountStaked: parseFloat(pos.amount_staked || 0),
      stakedAt: pos.staked_at,
      unlockAt: pos.unlock_at,
      durationDays: 0,
      status: pos.status,
      tierWeight: parseFloat(pos.tier_weight || 1.0),
      rewardsEarned: parseFloat(pos.rewards_earned || 0),
      lastRewardAt: null,
      unstakeRequestedAt: pos.unstake_requested_at,
      isMatured: pos.status === 'unlocked',
      canUnstake: pos.can_unstake || false,
      canExecuteUnstake: pos.status === 'unstake_requested' && pos.can_unstake,
    }));

    const rewardState = data?.reward_state ? {
      stakedPip: parseFloat(data.reward_state.staked_pip || 0),
      pendingRewardsPip: parseFloat(data.reward_state.pending_rewards_pip || 0),
      claimedTotalPip: parseFloat(data.reward_state.claimed_total_pip || 0),
      lastAccrualTs: data.reward_state.last_accrual_ts,
      lastClaimTs: data.reward_state.last_claim_ts,
    } : null;

    const lifetimeStats = {
      totalStakedEvents: data?.lifetime_stats?.total_staked_events || 0,
      totalUnstakedEvents: data?.lifetime_stats?.total_unstaked_events || 0,
      totalRewardsClaimed: parseFloat(data?.lifetime_stats?.total_rewards_claimed || 0),
    };

    return {
      activePositions: positions,
      rewardState,
      lifetimeStats,
    };
  }

  async stake(
    userId: string,
    amount: number,
    durationDays: number = 30
  ): Promise<StakeResult> {
    try {
      if (amount < TOKENOMICS.STAKING.MIN_STAKE_AMOUNT) {
        return {
          success: false,
          error: `Minimum stake amount is ${TOKENOMICS.STAKING.MIN_STAKE_AMOUNT} PIP`,
        };
      }

      const { data, error } = await supabase.rpc('stake_tokens', {
        p_amount: amount,
        p_duration_days: durationDays,
      });

      if (error) {
        console.error('[ClubStakingService] RPC error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Unknown error' };
      }

      return {
        success: true,
        positionId: data.position_id,
        amount: parseFloat(data.amount_staked || 0),
        unlockAt: data.unlock_at,
        tierWeight: parseFloat(data.tier_multiplier || 1.0),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception staking:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }

  async requestUnstake(positionId: string): Promise<RequestUnstakeResult> {
    try {
      const { data, error } = await supabase.rpc('request_unstake', {
        p_position_id: positionId,
      });

      if (error) {
        console.error('[ClubStakingService] RPC error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Unknown error' };
      }

      return {
        success: true,
        positionId: data.position_id,
        status: data.status,
        unlockAt: data.unlock_at,
        rewardsEarned: parseFloat(data.rewards_earned || 0),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception requesting unstake:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }

  async executeUnstake(positionId: string): Promise<UnstakeResult> {
    try {
      const { data, error } = await supabase.rpc('execute_unstake', {
        p_position_id: positionId,
      });

      if (error) {
        console.error('[ClubStakingService] RPC error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Unknown error' };
      }

      return {
        success: true,
        amountReturned: parseFloat(data.total_returned || 0),
        rewardsEarned: parseFloat(data.rewards_returned || 0),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception executing unstake:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }

  async claimRewards(): Promise<ClaimRewardsResult> {
    try {
      const { data, error } = await supabase.rpc('claim_staking_rewards');

      if (error) {
        console.error('[ClubStakingService] RPC error:', error);
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Unknown error' };
      }

      return {
        success: true,
        rewardsClaimed: parseFloat(data.rewards_claimed || 0),
        totalClaimedLifetime: parseFloat(data.total_claimed_lifetime || 0),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception claiming rewards:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }


  getStakingConstants() {
    return {
      minStakeAmount: TOKENOMICS.STAKING.MIN_STAKE_AMOUNT,
      minLockDays: 7,
      cooldownHours: 24,
      monthlyEmissionBudget: TOKENOMICS.STAKING.MONTHLY_EMISSION_BUDGET,
      tierMultipliers: {
        builder: 1.0,
        pro: 1.1,
        elite: 1.2,
        founder: 1.3,
      },
    };
  }

  subscribeToPositions(
    userId: string,
    callback: (positions: StakingPosition[]) => void
  ) {
    const channel = supabase
      .channel(`club-staking-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_staking_positions',
          filter: `user_id=eq.${userId}`,
        },
        async () => {
          const positions = await this.getPositions(userId);
          callback(positions);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }
}

export const clubStakingService = new ClubStakingService();
