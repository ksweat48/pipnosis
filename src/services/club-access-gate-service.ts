/**
 * CLUB ACCESS GATE SERVICE
 *
 * Centralized service for validating Club access requirements.
 * This service is the gatekeeper for all Club entry points.
 *
 * ACCESS LOGIC:
 * 1. User must have an active membership
 * 2. User must have sufficient available tokens (>= locked tokens requirement)
 * 3. Admin bypass: Admins always have access
 *
 * This service coordinates with:
 * - clubMembershipService (membership status)
 * - clubTokenLedgerService (token balances)
 */

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
    required: number;
    available: number;
    deficit: number;
  };
  message: string;
}

class ClubAccessGateService {
  /**
   * Comprehensive access check (SSOT)
   * This is the single source of truth for Club access decisions
   */
  async validateAccess(userId: string, isAdmin: boolean = false): Promise<ClubAccessResult> {
    // Admins bypass all requirements
    if (isAdmin) {
      return {
        canAccess: true,
        status: 'unlocked',
        membership: {
          hasMembership: true,
          isActive: true,
          tierLevel: 999,
          tierName: 'Admin'
        },
        tokens: {
          required: 0,
          available: Infinity,
          deficit: 0
        },
        message: 'Admin access granted'
      };
    }

    // Get access check from database (uses RPC function)
    const accessCheck = await clubMembershipService.checkAccess(userId);

    // Get user's membership details if they have one
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

    // Determine status and message
    let status: AccessStatus;
    let message: string;

    if (!accessCheck.hasMembership) {
      status = 'no_membership';
      message = 'Purchase a membership to access Pipnosis Club';
    } else if (!accessCheck.hasSufficientTokens) {
      status = 'insufficient_tokens';
      const deficit = accessCheck.tokensRequired - accessCheck.tokensAvailable;
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
        required: accessCheck.tokensRequired,
        available: accessCheck.tokensAvailable,
        deficit: Math.max(0, accessCheck.tokensRequired - accessCheck.tokensAvailable)
      },
      message
    };
  }

  /**
   * Quick access check (boolean only)
   * Use this for route guards
   */
  async canUserAccessClub(userId: string, isAdmin: boolean = false): Promise<boolean> {
    if (isAdmin) return true;

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
