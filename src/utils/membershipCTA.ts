import type { UserMembership } from '@/services/club-membership-service';

export interface MembershipCTA {
  label: string;
  isFounder: boolean;
  isNonMember: boolean;
}

const TIER_UPGRADE_LABELS: Record<number, string> = {
  1: 'Upgrade to Starter',
  2: 'Upgrade to Builder',
  3: 'Upgrade to Pro',
  4: 'Upgrade to Elite',
  5: 'Upgrade to Founder',
  6: 'Edge 100%',
};

export function getMembershipCTA(membership: UserMembership | null | undefined): MembershipCTA {
  if (!membership || membership.status !== 'active') {
    return { label: 'Join Club', isFounder: false, isNonMember: true };
  }

  const tierLevel = membership.tierLevel;
  const label = TIER_UPGRADE_LABELS[tierLevel] ?? 'Join Club';
  const isFounder = tierLevel >= 6;

  return { label, isFounder, isNonMember: false };
}
