/**
 * CLUB MEMBERSHIP SERVICE
 *
 * SSOT for all Club membership operations including:
 * - Membership validation and status checks
 * - Membership purchase processing
 * - Access control logic
 * - Tier management
 * - Credit discount resolution (delegates to DB)
 *
 * CRITICAL: This service is the ONLY authority for membership state.
 * All membership queries and mutations MUST go through this service.
 */

import { supabase } from '@/lib/supabase';

export interface MembershipPackage {
  id: string;
  name: string;
  description: string;
  tierLevel: number;
  priceUsd: number;
  initialTokenAllocation: number;
  requiredTokenBalance: number;
  benefits: string[];
  badgeColor: string;
  badgeIcon: string;
  stripePriceId: string | null;
  stripeProductId: string | null;
  isActive: boolean;
  discountPct: number;
  stakingEnabled: boolean;
  votingEnabled: boolean;
  votingWeight: number;
  referralBonusPct: number;
  stakingBoostMultiplier: number;
}

export interface UserMembership {
  id: string;
  userId: string;
  packageId: string;
  tierLevel: number;
  tierName: string;
  status: 'active' | 'suspended' | 'expired' | 'cancelled';
  purchasedAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  amountPaidUsd: number;
  tokensLocked: number;
  canAccessClub: boolean;
}

export interface MembershipAccessCheck {
  hasMembership: boolean;
  membershipActive: boolean;
  hasSufficientTokens: boolean;
  canAccess: boolean;
  tokensRequired: number;
  tokensAvailable: number;
  tokensTotal: number;
}

export interface UserCreditDiscount {
  discountPct: number;
  tierLevel: number;
  tierName: string;
  stakingEnabled: boolean;
}

export interface AdminGrantResult {
  success: boolean;
  actionType?: 'grant' | 'upgrade';
  membershipId?: string;
  tierName?: string;
  tierLevel?: number;
  tokensAwarded?: number;
  isUpgrade?: boolean;
  previousTier?: number | null;
  auditId?: string;
  error?: string;
}

export interface AdminMembershipAction {
  id: string;
  adminUserId: string;
  adminEmail: string;
  actionType: 'grant' | 'upgrade';
  previousTierLevel: number | null;
  newTierLevel: number;
  packageName: string;
  reason: string;
  tokensAwarded: number;
  membershipId: string | null;
  createdAt: string;
}

class ClubMembershipService {
  /**
   * Get all active membership packages for purchase
   */
  async getActivePackages(): Promise<MembershipPackage[]> {
    const { data, error } = await supabase
      .from('club_membership_packages')
      .select('*')
      .eq('is_active', true)
      .order('display_order', { ascending: true });

    if (error) {
      console.error('[ClubMembershipService] Error fetching packages:', error);
      throw new Error('Failed to load membership packages');
    }

    return (data || []).map(this.mapPackageFromDb);
  }

  /**
   * Get a specific membership package by ID
   */
  async getPackageById(packageId: string): Promise<MembershipPackage | null> {
    const { data, error } = await supabase
      .from('club_membership_packages')
      .select('*')
      .eq('id', packageId)
      .maybeSingle();

    if (error) {
      console.error('[ClubMembershipService] Error fetching package:', error);
      return null;
    }

    return data ? this.mapPackageFromDb(data) : null;
  }

  /**
   * Get user's current membership (SSOT)
   */
  async getUserMembership(userId: string): Promise<UserMembership | null> {
    const { data, error } = await supabase
      .from('club_memberships')
      .select(`
        *,
        club_membership_packages!inner(name)
      `)
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      console.error('[ClubMembershipService] Error fetching membership:', error);
      return null;
    }

    return data ? this.mapMembershipFromDb(data) : null;
  }

  /**
   * Check if user can access Club (comprehensive validation)
   * Uses RPC function for database-side computation
   */
  async checkAccess(userId: string): Promise<MembershipAccessCheck> {
    const { data, error } = await supabase.rpc('can_user_access_club', {
      p_user_id: userId
    });

    if (error) {
      console.error('[ClubMembershipService] Error checking access:', error);
      // Return locked state on error
      return {
        hasMembership: false,
        membershipActive: false,
        hasSufficientTokens: false,
        canAccess: false,
        tokensRequired: 0,
        tokensAvailable: 0,
        tokensTotal: 0
      };
    }

    const result = data && data.length > 0 ? data[0] : null;

    return {
      hasMembership: result?.has_membership || false,
      membershipActive: result?.membership_active || false,
      hasSufficientTokens: result?.has_sufficient_tokens || false,
      canAccess: result?.can_access || false,
      tokensRequired: result?.tokens_required || 0,
      tokensAvailable: result?.tokens_available || 0,
      tokensTotal: result?.tokens_total || 0
    };
  }

  /**
   * Grant or upgrade membership after successful purchase.
   *
   * SSOT: Delegates entirely to the grant_club_membership RPC which is the single
   * authoritative function for all membership grants, upgrades, cumulative token
   * allocation, token locking, tier history, notifications, and referral commissions.
   *
   * This method must NOT duplicate any of that logic. Frontend and webhook handlers
   * also call the RPC directly; this method exists so server-side code that only has
   * access to the JS client can go through the same authority.
   */
  async grantMembership(
    userId: string,
    packageId: string,
    stripeSessionId: string,
    amountPaidUsd: number
  ): Promise<{ success: boolean; membershipId?: string; tierName?: string; tierLevel?: number; tokensAwarded?: number; isUpgrade?: boolean; error?: string }> {
    try {
      const { data: result, error: rpcError } = await supabase.rpc('grant_club_membership', {
        p_user_id: userId,
        p_package_id: packageId,
        p_stripe_session_id: stripeSessionId,
        p_amount_paid: amountPaidUsd,
      });

      if (rpcError) {
        console.error('[ClubMembershipService] grant_club_membership RPC error:', rpcError);
        return { success: false, error: rpcError.message };
      }

      const r = result as any;
      if (!r?.success) {
        console.error('[ClubMembershipService] grant_club_membership returned failure:', r?.error);
        return { success: false, error: r?.error || 'Membership grant failed' };
      }

      const pkg = await this.getPackageById(packageId);
      return {
        success: true,
        membershipId: r.membership_id,
        tierName: pkg?.name ?? `Tier ${r.tier_level}`,
        tierLevel: r.tier_level,
        tokensAwarded: r.tokens_awarded,
        isUpgrade: r.is_upgrade || false,
      };
    } catch (error) {
      console.error('[ClubMembershipService] Error in grantMembership:', error);
      return { success: false, error: 'Internal error during membership grant' };
    }
  }

  /**
   * Admin-only: grant or upgrade a user's membership without payment.
   *
   * SSOT: Delegates to the admin_grant_membership RPC which:
   *  - validates admin identity server-side
   *  - calls grant_club_membership for all token emission
   *  - writes an immutable row to admin_membership_actions
   *
   * This is the ONLY JS-layer entry point for admin membership grants.
   */
  async adminGrantMembership(
    adminUserId: string,
    targetUserId: string,
    packageId: string,
    reason: string
  ): Promise<AdminGrantResult> {
    try {
      const { data, error } = await supabase.rpc('admin_grant_membership', {
        p_admin_id: adminUserId,
        p_target_user_id: targetUserId,
        p_package_id: packageId,
        p_reason: reason,
      });

      if (error) {
        console.error('[ClubMembershipService] admin_grant_membership RPC error:', error);
        return { success: false, error: error.message };
      }

      const r = data as any;
      if (!r?.success) {
        return { success: false, error: r?.error || 'Membership grant failed' };
      }

      return {
        success: true,
        actionType: r.action_type,
        membershipId: r.membership_id,
        tierName: r.tier_name,
        tierLevel: r.tier_level,
        tokensAwarded: r.tokens_awarded,
        isUpgrade: r.is_upgrade,
        previousTier: r.previous_tier ?? null,
        auditId: r.audit_id,
      };
    } catch (err) {
      console.error('[ClubMembershipService] Error in adminGrantMembership:', err);
      return { success: false, error: 'Internal error during admin membership grant' };
    }
  }

  /**
   * Admin-only: get the admin action history for a given user.
   * Used by UserDetailsModal to display the membership audit trail.
   */
  async getAdminMembershipActions(targetUserId: string): Promise<AdminMembershipAction[]> {
    try {
      const { data, error } = await supabase.rpc('admin_get_membership_actions', {
        p_target_user_id: targetUserId,
      });

      if (error) {
        console.error('[ClubMembershipService] admin_get_membership_actions error:', error);
        return [];
      }

      return (data || []).map((row: any): AdminMembershipAction => ({
        id: row.id,
        adminUserId: row.admin_user_id,
        adminEmail: row.admin_email || 'Unknown',
        actionType: row.action_type,
        previousTierLevel: row.previous_tier_level ?? null,
        newTierLevel: row.new_tier_level,
        packageName: row.package_name || `Tier ${row.new_tier_level}`,
        reason: row.reason,
        tokensAwarded: Number(row.tokens_awarded ?? 0),
        membershipId: row.membership_id ?? null,
        createdAt: row.created_at,
      }));
    } catch (err) {
      console.error('[ClubMembershipService] Error in getAdminMembershipActions:', err);
      return [];
    }
  }

  /**
   * Subscribe to membership changes for realtime updates
   */
  subscribeToMembership(userId: string, callback: (membership: UserMembership | null) => void) {
    const channel = supabase
      .channel(`club-membership-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'club_memberships',
          filter: `user_id=eq.${userId}`
        },
        async () => {
          const membership = await this.getUserMembership(userId);
          callback(membership);
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }

  /**
   * Get user's credit discount based on active membership tier.
   * Returns 0 if no active membership or tier has no discount.
   * Uses DB RPC for single source of truth.
   */
  async getUserCreditDiscount(userId: string): Promise<UserCreditDiscount> {
    try {
      const { data, error } = await supabase.rpc('get_user_credit_discount', {
        p_user_id: userId
      });

      if (error || !data || data.length === 0) {
        return { discountPct: 0, tierLevel: 0, tierName: 'None', stakingEnabled: false };
      }

      const row = data[0];
      return {
        discountPct: Number(row.discount_pct ?? 0),
        tierLevel: row.tier_level || 0,
        tierName: row.tier_name || 'None',
        stakingEnabled: row.staking_enabled || false,
      };
    } catch (error) {
      console.error('[ClubMembershipService] Error fetching credit discount:', error);
      return { discountPct: 0, tierLevel: 0, tierName: 'None', stakingEnabled: false };
    }
  }

  private mapPackageFromDb(data: any): MembershipPackage {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      tierLevel: data.tier_level,
      priceUsd: parseFloat(data.price_usd),
      initialTokenAllocation: parseFloat(data.initial_token_allocation),
      requiredTokenBalance: parseFloat(data.required_token_balance),
      benefits: Array.isArray(data.benefits) ? data.benefits : [],
      badgeColor: data.badge_color,
      badgeIcon: data.badge_icon,
      stripePriceId: data.stripe_price_id,
      stripeProductId: data.stripe_product_id,
      isActive: data.is_active,
      discountPct: Number(data.discount_pct ?? 0),
      stakingEnabled: data.staking_enabled || false,
      votingEnabled: data.voting_enabled || false,
      votingWeight: parseFloat(data.voting_weight || '0'),
      referralBonusPct: data.referral_bonus_pct || 0,
      stakingBoostMultiplier: parseFloat(data.staking_boost_multiplier || '1'),
    };
  }

  private mapMembershipFromDb(data: any): UserMembership {
    return {
      id: data.id,
      userId: data.user_id,
      packageId: data.package_id,
      tierLevel: data.tier_level,
      tierName: data.club_membership_packages?.name || '',
      status: data.status,
      purchasedAt: data.purchased_at,
      activatedAt: data.activated_at,
      expiresAt: data.expires_at,
      amountPaidUsd: parseFloat(data.amount_paid_usd),
      tokensLocked: parseFloat(data.tokens_locked),
      canAccessClub: data.can_access_club
    };
  }
}

// Export singleton instance
export const clubMembershipService = new ClubMembershipService();
