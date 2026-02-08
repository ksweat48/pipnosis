import { supabase } from '@/lib/supabase';
import { TOKENOMICS } from '@/config/tokenomics-constants';

export interface StakingPosition {
  id: string;
  amountStaked: number;
  stakedAt: string;
  unlockAt: string;
  durationDays: number;
  status: 'active' | 'completed' | 'cancelled';
  tierWeight: number;
  rewardsEarned: number;
  lastRewardAt: string | null;
  isMatured: boolean;
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

class ClubStakingService {
  async getPositions(userId: string): Promise<StakingPosition[]> {
    const { data, error } = await supabase.rpc('get_user_staking_positions', {
      p_user_id: userId,
    });

    if (error) {
      console.error('[ClubStakingService] Error fetching positions:', error);
      return [];
    }

    const now = new Date();
    return (data || []).map((row: any) => ({
      id: row.id,
      amountStaked: parseFloat(row.amount_staked),
      stakedAt: row.staked_at,
      unlockAt: row.unlock_at,
      durationDays: row.duration_days,
      status: row.status,
      tierWeight: parseFloat(row.tier_weight),
      rewardsEarned: parseFloat(row.rewards_earned),
      lastRewardAt: row.last_reward_at,
      isMatured: new Date(row.unlock_at) <= now,
    }));
  }

  async stake(
    userId: string,
    amount: number,
    durationDays: number
  ): Promise<StakeResult> {
    try {
      if (amount < TOKENOMICS.STAKING.MIN_STAKE_AMOUNT) {
        return {
          success: false,
          error: `Minimum stake amount is ${TOKENOMICS.STAKING.MIN_STAKE_AMOUNT} PIP`,
        };
      }
      if (
        durationDays < TOKENOMICS.STAKING.MIN_LOCK_DAYS ||
        durationDays > TOKENOMICS.STAKING.MAX_LOCK_DAYS
      ) {
        return {
          success: false,
          error: `Lock duration must be between ${TOKENOMICS.STAKING.MIN_LOCK_DAYS} and ${TOKENOMICS.STAKING.MAX_LOCK_DAYS} days`,
        };
      }

      const { data, error } = await supabase.rpc('stake_club_tokens', {
        p_user_id: userId,
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
        amount: parseFloat(data.amount),
        unlockAt: data.unlock_at,
        tierWeight: parseFloat(data.tier_weight),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception staking:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }

  async unstake(userId: string, positionId: string): Promise<UnstakeResult> {
    try {
      const { data, error } = await supabase.rpc('unstake_club_tokens', {
        p_user_id: userId,
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
        amountReturned: parseFloat(data.amount_returned),
        rewardsEarned: parseFloat(data.rewards_earned),
        newAvailable: parseFloat(data.new_available),
      };
    } catch (error: any) {
      console.error('[ClubStakingService] Exception unstaking:', error);
      return { success: false, error: error.message || 'Internal error' };
    }
  }

  getStakingConstants() {
    return {
      minStakeAmount: TOKENOMICS.STAKING.MIN_STAKE_AMOUNT,
      minLockDays: TOKENOMICS.STAKING.MIN_LOCK_DAYS,
      maxLockDays: TOKENOMICS.STAKING.MAX_LOCK_DAYS,
      monthlyEmissionBudget: TOKENOMICS.STAKING.MONTHLY_EMISSION_BUDGET,
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
