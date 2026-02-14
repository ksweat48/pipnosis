/**
 * CLUB REFERRAL SERVICE
 *
 * Manages referral code generation, tracking, and reward distribution.
 * Implements anti-fraud measures and reward calculations.
 *
 * REFERRAL FLOW:
 * 1. User gets unique referral code on first Club access
 * 2. They share referral link: pipnosis.com/club?ref=CODE
 * 3. New user signs up with code in URL
 * 4. System tracks relationship and validates legitimacy
 * 5. Rewards distributed after referee purchases membership
 *
 * PHASE 1: Tracking infrastructure only
 * PHASE 2: Automated reward payouts
 */

import { supabase } from '@/lib/supabase';
import { TOKENOMICS } from '@/config/tokenomics-constants';

export interface ReferralCode {
  userId: string;
  code: string;
  createdAt: string;
}

export interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalTokensEarned: number;
  totalCashEarnedUsd: number;
  lastReferralAt: string | null;
}

export interface ReferralRecord {
  id: string;
  referrerId: string;
  refereeId: string | null;
  referralCode: string;
  status: 'pending' | 'completed' | 'cancelled' | 'fraud';
  referredAt: string;
  completedAt: string | null;
  tokensAwarded: number;
  cashAwardedUsd: number;
  rewardPaid: boolean;
}

class ClubReferralService {
  /**
   * Generate unique referral code for user
   * Format: CLUB-[6 chars]
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Excluding ambiguous chars
    let code = 'CLUB-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  async getUserReferralCode(userId: string): Promise<string> {
    const { data: existing } = await supabase
      .from('club_referrals')
      .select('referral_code')
      .eq('referrer_id', userId)
      .is('referee_id', null)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return existing.referral_code;
    }

    let code = this.generateCode();
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const { data: collision } = await supabase
        .from('club_referrals')
        .select('id')
        .eq('referral_code', code)
        .is('referee_id', null)
        .limit(1)
        .maybeSingle();

      if (!collision) {
        break;
      }

      code = this.generateCode();
      attempts++;
    }

    await supabase.from('club_referrals').insert({
      referrer_id: userId,
      referral_code: code,
      status: 'pending',
      referred_at: new Date().toISOString(),
    });

    return code;
  }

  /**
   * Get referral stats for user dashboard
   */
  async getReferralStats(userId: string): Promise<ReferralStats> {
    const { data, error } = await supabase
      .from('club_referral_stats')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();

    if (error || !data) {
      // Return empty stats if none exist
      return {
        totalReferrals: 0,
        completedReferrals: 0,
        pendingReferrals: 0,
        totalTokensEarned: 0,
        totalCashEarnedUsd: 0,
        lastReferralAt: null
      };
    }

    return {
      totalReferrals: data.total_referrals || 0,
      completedReferrals: data.completed_referrals || 0,
      pendingReferrals: data.pending_referrals || 0,
      totalTokensEarned: data.total_tokens_earned || 0,
      totalCashEarnedUsd: parseFloat(data.total_cash_earned_usd || 0),
      lastReferralAt: data.last_referral_at
    };
  }

  /**
   * Get recent referrals for user
   */
  async getUserReferrals(userId: string, limit: number = 10): Promise<ReferralRecord[]> {
    const { data, error } = await supabase
      .from('club_referrals')
      .select('*')
      .eq('referrer_id', userId)
      .not('referee_id', 'is', null)
      .order('referred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[ClubReferralService] Error fetching referrals:', error);
      return [];
    }

    return (data || []).map(this.mapReferralFromDb);
  }

  async trackReferral(
    referralCode: string,
    refereeId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('process_signup_referral', {
        p_referee_user_id: refereeId,
        p_referral_code: referralCode
      });

      if (error) {
        console.error('[ClubReferralService] RPC error tracking referral:', error);
        return { success: false, error: error.message };
      }

      if (data && !data.success) {
        return { success: false, error: data.error };
      }

      return { success: true };
    } catch (error) {
      console.error('[ClubReferralService] Exception tracking referral:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Get detailed referral list with referee information
   * SSOT: Delegates to database view for consistent data
   */
  async getReferralDetails(
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<any[]> {
    try {
      const { data, error } = await supabase.rpc('get_user_referral_details', {
        p_user_id: userId,
        p_limit: limit,
        p_offset: offset
      });

      if (error) {
        console.error('[ClubReferralService] Error fetching referral details:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[ClubReferralService] Exception fetching referral details:', error);
      return [];
    }
  }

  /**
   * Request cash payout from referral earnings
   * SSOT: Delegates to database for validation and creation
   */
  async requestCashPayout(
    userId: string,
    requestedAmount: number
  ): Promise<{ success: boolean; payoutId?: string; error?: string }> {
    try {
      const { data, error } = await supabase.rpc('request_referral_cash_payout', {
        p_user_id: userId,
        p_requested_amount: requestedAmount
      });

      if (error) {
        console.error('[ClubReferralService] Error requesting payout:', error);
        return { success: false, error: error.message };
      }

      if (data && !data.success) {
        return { success: false, error: data.error };
      }

      return {
        success: true,
        payoutId: data?.payout_id
      };
    } catch (error) {
      console.error('[ClubReferralService] Exception requesting payout:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Get user's payout history
   */
  async getPayoutHistory(userId: string): Promise<any[]> {
    try {
      const { data, error } = await supabase
        .from('club_referral_cash_payouts')
        .select('*')
        .eq('user_id', userId)
        .order('requested_at', { ascending: false });

      if (error) {
        console.error('[ClubReferralService] Error fetching payout history:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[ClubReferralService] Exception fetching payout history:', error);
      return [];
    }
  }

  /**
   * Cancel a pending payout request
   */
  async cancelPayoutRequest(
    userId: string,
    payoutId: string,
    reason: string
  ): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('club_referral_cash_payouts')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', payoutId)
        .eq('user_id', userId)
        .eq('status', 'pending');

      if (error) {
        console.error('[ClubReferralService] Error cancelling payout:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ClubReferralService] Exception cancelling payout:', error);
      return false;
    }
  }

  /**
   * Get referral link for sharing
   */
  getReferralLink(referralCode: string): string {
    const baseUrl = window.location.origin;
    return `${baseUrl}/club?ref=${referralCode}`;
  }

  /**
   * Copy referral link to clipboard
   */
  async copyReferralLink(referralCode: string): Promise<boolean> {
    const link = this.getReferralLink(referralCode);

    try {
      await navigator.clipboard.writeText(link);
      return true;
    } catch (error) {
      console.error('[ClubReferralService] Failed to copy link:', error);
      return false;
    }
  }

  /**
   * Subscribe to referral stats updates
   */
  subscribeToStats(userId: string, callback: (stats: ReferralStats) => void) {
    const channel = supabase
      .channel(`club-referral-stats-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_referral_stats',
          filter: `user_id=eq.${userId}`
        },
        async () => {
          const stats = await this.getReferralStats(userId);
          callback(stats);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  /**
   * Map database record to ReferralRecord interface
   */
  private mapReferralFromDb(data: any): ReferralRecord {
    return {
      id: data.id,
      referrerId: data.referrer_id,
      refereeId: data.referee_id,
      referralCode: data.referral_code,
      status: data.status,
      referredAt: data.referred_at,
      completedAt: data.completed_at,
      tokensAwarded: data.tokens_awarded || 0,
      cashAwardedUsd: parseFloat(data.cash_awarded_usd || 0),
      rewardPaid: data.reward_paid || false
    };
  }
}

// Export singleton instance
export const clubReferralService = new ClubReferralService();
