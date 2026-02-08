/**
 * CLUB MEMBERSHIP SERVICE
 *
 * SSOT for all Club membership operations including:
 * - Membership validation and status checks
 * - Membership purchase processing
 * - Access control logic
 * - Tier management
 *
 * CRITICAL: This service is the ONLY authority for membership state.
 * All membership queries and mutations MUST go through this service.
 */

import { supabase } from '@/lib/supabase';
import { clubTokenLedgerService } from './club-token-ledger-service';

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
}

export interface UserMembership {
  id: string;
  userId: string;
  packageId: string;
  tierLevel: number;
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
      .select('*')
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
        tokensAvailable: 0
      };
    }

    // RPC returns array with single row
    const result = data && data.length > 0 ? data[0] : null;

    return {
      hasMembership: result?.has_membership || false,
      membershipActive: result?.membership_active || false,
      hasSufficientTokens: result?.has_sufficient_tokens || false,
      canAccess: result?.can_access || false,
      tokensRequired: result?.tokens_required || 0,
      tokensAvailable: result?.tokens_available || 0
    };
  }

  /**
   * Grant membership after successful purchase
   * Called by Stripe webhook after payment confirmation
   */
  async grantMembership(
    userId: string,
    packageId: string,
    stripeSessionId: string,
    stripePaymentIntentId: string,
    amountPaidUsd: number
  ): Promise<{ success: boolean; membershipId?: string; error?: string }> {
    try {
      // Get package details
      const pkg = await this.getPackageById(packageId);
      if (!pkg) {
        return { success: false, error: 'Package not found' };
      }

      // Check if user already has a membership
      const existingMembership = await this.getUserMembership(userId);
      if (existingMembership) {
        return { success: false, error: 'User already has a membership' };
      }

      // Create membership record
      const { data: membership, error: membershipError } = await supabase
        .from('club_memberships')
        .insert({
          user_id: userId,
          package_id: packageId,
          tier_level: pkg.tierLevel,
          status: 'active',
          purchased_at: new Date().toISOString(),
          activated_at: new Date().toISOString(),
          stripe_session_id: stripeSessionId,
          stripe_payment_intent_id: stripePaymentIntentId,
          amount_paid_usd: amountPaidUsd,
          tokens_locked: pkg.requiredTokenBalance
        })
        .select()
        .single();

      if (membershipError || !membership) {
        console.error('[ClubMembershipService] Error creating membership:', membershipError);
        return { success: false, error: 'Failed to create membership' };
      }

      // Award initial tokens
      const tokensAwarded = await clubTokenLedgerService.addTokens(
        userId,
        pkg.initialTokenAllocation,
        'membership_purchase',
        `Initial token allocation for ${pkg.name}`,
        membership.id,
        'membership'
      );

      if (!tokensAwarded) {
        // Rollback membership if token grant fails
        await supabase
          .from('club_memberships')
          .delete()
          .eq('id', membership.id);

        return { success: false, error: 'Failed to allocate tokens' };
      }

      // Lock tokens for membership requirement
      await clubTokenLedgerService.lockTokens(userId, pkg.requiredTokenBalance);

      return { success: true, membershipId: membership.id };
    } catch (error) {
      console.error('[ClubMembershipService] Error granting membership:', error);
      return { success: false, error: 'Internal error during membership grant' };
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
   * Map database record to MembershipPackage interface
   */
  private mapPackageFromDb(data: any): MembershipPackage {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      tierLevel: data.tier_level,
      priceUsd: parseFloat(data.price_usd),
      initialTokenAllocation: data.initial_token_allocation,
      requiredTokenBalance: data.required_token_balance,
      benefits: Array.isArray(data.benefits) ? data.benefits : [],
      badgeColor: data.badge_color,
      badgeIcon: data.badge_icon,
      stripePriceId: data.stripe_price_id,
      stripeProductId: data.stripe_product_id,
      isActive: data.is_active
    };
  }

  /**
   * Map database record to UserMembership interface
   */
  private mapMembershipFromDb(data: any): UserMembership {
    return {
      id: data.id,
      userId: data.user_id,
      packageId: data.package_id,
      tierLevel: data.tier_level,
      status: data.status,
      purchasedAt: data.purchased_at,
      activatedAt: data.activated_at,
      expiresAt: data.expires_at,
      amountPaidUsd: parseFloat(data.amount_paid_usd),
      tokensLocked: data.tokens_locked,
      canAccessClub: data.can_access_club
    };
  }
}

// Export singleton instance
export const clubMembershipService = new ClubMembershipService();
