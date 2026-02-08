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

  /**
   * Get or create referral code for user
   */
  async getUserReferralCode(userId: string): Promise<string> {
    // Check if code already exists
    const { data: existing } = await supabase
      .from('club_referrals')
      .select('referral_code')
      .eq('referrer_id', userId)
      .limit(1)
      .maybeSingle();

    if (existing) {
      return existing.referral_code;
    }

    // Generate new code (ensure uniqueness)
    let code = this.generateCode();
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const { data: collision } = await supabase
        .from('club_referrals')
        .select('id')
        .eq('referral_code', code)
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
      .order('referred_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[ClubReferralService] Error fetching referrals:', error);
      return [];
    }

    return (data || []).map(this.mapReferralFromDb);
  }

  /**
   * Track new referral (called when new user signs up with ref code)
   * Phase 1: Tracking only, no reward distribution
   */
  async trackReferral(
    referralCode: string,
    refereeId: string,
    ipHash: string | null = null,
    fingerprintHash: string | null = null
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Find referrer by code
      const { data: existingReferral, error: findError } = await supabase
        .from('club_referrals')
        .select('referrer_id, referral_code')
        .eq('referral_code', referralCode)
        .limit(1)
        .maybeSingle();

      if (findError || !existingReferral) {
        return { success: false, error: 'Invalid referral code' };
      }

      const referrerId = existingReferral.referrer_id;

      // Prevent self-referral
      if (referrerId === refereeId) {
        return { success: false, error: 'Cannot refer yourself' };
      }

      // Check if referee already used a referral
      const { data: existingReferee } = await supabase
        .from('club_referrals')
        .select('id')
        .eq('referee_id', refereeId)
        .maybeSingle();

      if (existingReferee) {
        return { success: false, error: 'Already referred by someone else' };
      }

      // Create referral record
      const { error: insertError } = await supabase
        .from('club_referrals')
        .insert({
          referrer_id: referrerId,
          referee_id: refereeId,
          referral_code: referralCode,
          status: 'pending',
          referred_at: new Date().toISOString(),
          referee_ip_hash: ipHash,
          referee_fingerprint_hash: fingerprintHash
        });

      if (insertError) {
        console.error('[ClubReferralService] Error creating referral:', insertError);
        return { success: false, error: 'Failed to create referral' };
      }

      return { success: true };
    } catch (error) {
      console.error('[ClubReferralService] Exception tracking referral:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Complete referral when referee purchases membership
   * Called by membership service after successful purchase
   * Phase 1: Mark as completed only, no reward distribution
   */
  async completeReferral(
    refereeId: string,
    membershipPriceUsd: number = 0
  ): Promise<boolean> {
    try {
      const pipBonus = TOKENOMICS.REFERRAL.BASE_PIP_BONUS;
      const cashCommission = membershipPriceUsd * (TOKENOMICS.REFERRAL.BASE_CASH_COMMISSION_PCT / 100);

      const { data, error } = await supabase.rpc('complete_referral_with_rewards', {
        p_referee_id: refereeId,
        p_referrer_pip_bonus: pipBonus,
        p_cash_commission: cashCommission,
      });

      if (error) {
        console.error('[ClubReferralService] Error completing referral:', error);
        return false;
      }

      return data?.success === true;
    } catch (error) {
      console.error('[ClubReferralService] Exception completing referral:', error);
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
