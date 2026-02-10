/**
 * CLUB ACCESS GATE SERVICE
 *
 * Centralized service for validating Club access requirements.
 * This service is the SSOT gatekeeper for all Club entry points.
 *
 * ACCESS LOGIC:
 * 1. Check platform_settings.token_gate_enabled (SSOT toggle)
 *    - If OFF: all users can enter freely (canAccess = true)
 *    - If ON: proceed with membership + token validation
 * 2. User must have an active membership
 * 3. User must have sufficient total tokens (>= locked tokens requirement)
 *
 * GOVERNANCE:
 * - Token gate state is managed exclusively via admin_toggle_token_gate RPC
 * - is_token_gate_enabled() is the SSOT for gate state (SECURITY DEFINER)
 * - No admin bypass -- gate toggle controls access for everyone
 *
 * This service coordinates with:
 * - platform_settings (token gate toggle)
 * - clubMembershipService (membership status)
 * - clubTokenLedgerService (token balances)
 */

import { supabase } from '@/lib/supabase';
import { clubMembershipService, type MembershipAccessCheck } from './club-membership-service';
import { clubTokenLedgerService } from './club-token-ledger-service';

export type AccessStatus = 'unlocked' | 'insufficient_tokens' | 'no_membership';

export interface ClubAccessResult {
  canAccess: boolean;
  status: AccessStatus;
  membership: {
    hasMembership: boolean;
    isActive: boolean;
    tierLevel: number;
    tierName: string;
  } | null;
  tokens: {
    total: number;
    required: number;
    available: number;
    deficit: number;
  };
  message: string;
}

class ClubAccessGateService {
  private async isTokenGateEnabled(): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc('is_token_gate_enabled');
      if (error) {
        console.error('[ClubAccessGate] Error checking token gate:', error);
        return true;
      }
      return data === true;
    } catch (error) {
      console.error('[ClubAccessGate] Error in isTokenGateEnabled:', error);
      return true;
    }
  }

  /**
   * Comprehensive access check (SSOT)
   * This is the single source of truth for Club access decisions.
   * Respects platform_settings.token_gate_enabled toggle.
   */
  async validateAccess(userId: string, _isAdmin: boolean = false): Promise<ClubAccessResult> {
    const gateEnabled = await this.isTokenGateEnabled();

    const accessCheck = await clubMembershipService.checkAccess(userId);

    let membershipDetails = null;
    if (accessCheck.hasMembership) {
      const membership = await clubMembershipService.getUserMembership(userId);
      if (membership) {
        const pkg = await clubMembershipService.getPackageById(membership.packageId);
        membershipDetails = {
          hasMembership: true,
          isActive: membership.status === 'active',
          tierLevel: membership.tierLevel,
          tierName: pkg?.name || 'Member'
        };
      }
    }

    if (!gateEnabled) {
      return {
        canAccess: true,
        status: 'unlocked',
        membership: membershipDetails,
        tokens: {
          total: accessCheck.tokensTotal,
          required: accessCheck.tokensRequired,
          available: accessCheck.tokensAvailable,
          deficit: Math.max(0, accessCheck.tokensRequired - accessCheck.tokensTotal)
        },
        message: 'Club access is open to all members'
      };
    }

    let status: AccessStatus;
    let message: string;

    if (!accessCheck.hasMembership) {
      status = 'no_membership';
      message = 'Purchase a membership to access Pipnosis Club';
    } else if (!accessCheck.hasSufficientTokens) {
      status = 'insufficient_tokens';
      const deficit = accessCheck.tokensRequired - accessCheck.tokensTotal;
      message = `You need ${deficit} more token${deficit > 1 ? 's' : ''} to access the Club`;
    } else {
      status = 'unlocked';
      message = 'Welcome to Pipnosis Club!';
    }

    return {
      canAccess: accessCheck.canAccess,
      status,
      membership: membershipDetails,
      tokens: {
        total: accessCheck.tokensTotal,
        required: accessCheck.tokensRequired,
        available: accessCheck.tokensAvailable,
        deficit: Math.max(0, accessCheck.tokensRequired - accessCheck.tokensTotal)
      },
      message
    };
  }

  /**
   * Quick access check (boolean only)
   * Use this for route guards. Respects token gate toggle.
   */
  async canUserAccessClub(userId: string, _isAdmin: boolean = false): Promise<boolean> {
    const gateEnabled = await this.isTokenGateEnabled();
    if (!gateEnabled) return true;

    const accessCheck = await clubMembershipService.checkAccess(userId);
    return accessCheck.canAccess;
  }

  /**
   * Get access check result for UI display
   * Returns formatted data for entry gate page
   */
  async getAccessInfo(userId: string, isAdmin: boolean = false): Promise<ClubAccessResult> {
    return this.validateAccess(userId, isAdmin);
  }

  /**
   * Subscribe to access changes (membership or token balance updates)
   */
  subscribeToAccessChanges(
    userId: string,
    isAdmin: boolean,
    callback: (result: ClubAccessResult) => void
  ) {
    // Subscribe to both membership and token balance changes
    const unsubMembership = clubMembershipService.subscribeToMembership(userId, async () => {
      const result = await this.validateAccess(userId, isAdmin);
      callback(result);
    });

    const unsubTokens = clubTokenLedgerService.subscribeToBalance(userId, async () => {
      const result = await this.validateAccess(userId, isAdmin);
      callback(result);
    });

    // Return combined unsubscribe function
    return () => {
      unsubMembership();
      unsubTokens();
    };
  }
}

// Export singleton instance
export const clubAccessGateService = new ClubAccessGateService();
