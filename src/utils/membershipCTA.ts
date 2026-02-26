import type { UserMembership } from '@/services/club-membership-service';

export interface MembershipCTA {
  label: string;
  isFounder: boolean;
  isNonMember: boolean;
  color: MembershipColor;
}

export interface MembershipColor {
  pill: string;
  pillBorder: string;
  pillText: string;
  bannerBorder: string;
  bannerBg: string;
  iconBg: string;
  iconText: string;
  btnBg: string;
  btnHover: string;
  headingText: string;
}

const TIER_COLORS: Record<number, MembershipColor> = {
  0: {
    pill: 'bg-blue-500/20',
    pillBorder: 'border-blue-400/60',
    pillText: 'text-blue-300',
    bannerBorder: 'border-blue-500/40',
    bannerBg: 'bg-gradient-to-br from-blue-900/50 via-blue-800/30 to-gray-900/60',
    iconBg: 'bg-blue-500/20',
    iconText: 'text-blue-300',
    btnBg: 'bg-blue-600/80',
    btnHover: 'hover:bg-blue-500/90',
    headingText: 'text-blue-300',
  },
  1: {
    pill: 'bg-slate-500/20',
    pillBorder: 'border-slate-400/60',
    pillText: 'text-slate-300',
    bannerBorder: 'border-slate-500/40',
    bannerBg: 'bg-gradient-to-br from-slate-900/50 via-slate-800/30 to-gray-900/60',
    iconBg: 'bg-slate-500/20',
    iconText: 'text-slate-300',
    btnBg: 'bg-slate-600/80',
    btnHover: 'hover:bg-slate-500/90',
    headingText: 'text-slate-300',
  },
  2: {
    pill: 'bg-cyan-500/20',
    pillBorder: 'border-cyan-400/60',
    pillText: 'text-cyan-300',
    bannerBorder: 'border-cyan-500/40',
    bannerBg: 'bg-gradient-to-br from-cyan-900/50 via-cyan-800/30 to-gray-900/60',
    iconBg: 'bg-cyan-500/20',
    iconText: 'text-cyan-300',
    btnBg: 'bg-cyan-600/80',
    btnHover: 'hover:bg-cyan-500/90',
    headingText: 'text-cyan-300',
  },
  3: {
    pill: 'bg-emerald-500/20',
    pillBorder: 'border-emerald-400/60',
    pillText: 'text-emerald-300',
    bannerBorder: 'border-emerald-500/40',
    bannerBg: 'bg-gradient-to-br from-emerald-900/50 via-emerald-800/30 to-gray-900/60',
    iconBg: 'bg-emerald-500/20',
    iconText: 'text-emerald-300',
    btnBg: 'bg-emerald-600/80',
    btnHover: 'hover:bg-emerald-500/90',
    headingText: 'text-emerald-300',
  },
  4: {
    pill: 'bg-sky-500/20',
    pillBorder: 'border-sky-400/60',
    pillText: 'text-sky-300',
    bannerBorder: 'border-sky-500/40',
    bannerBg: 'bg-gradient-to-br from-sky-900/50 via-sky-800/30 to-gray-900/60',
    iconBg: 'bg-sky-500/20',
    iconText: 'text-sky-300',
    btnBg: 'bg-sky-600/80',
    btnHover: 'hover:bg-sky-500/90',
    headingText: 'text-sky-300',
  },
  5: {
    pill: 'bg-orange-500/20',
    pillBorder: 'border-orange-400/60',
    pillText: 'text-orange-300',
    bannerBorder: 'border-orange-500/40',
    bannerBg: 'bg-gradient-to-br from-orange-900/50 via-orange-800/30 to-gray-900/60',
    iconBg: 'bg-orange-500/20',
    iconText: 'text-orange-300',
    btnBg: 'bg-orange-600/80',
    btnHover: 'hover:bg-orange-500/90',
    headingText: 'text-orange-300',
  },
  6: {
    pill: 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20',
    pillBorder: 'border-amber-500/40',
    pillText: 'text-amber-300',
    bannerBorder: 'border-amber-500/40',
    bannerBg: 'bg-gradient-to-br from-amber-900/40 via-yellow-900/30 to-gray-900/60',
    iconBg: 'bg-amber-500/20',
    iconText: 'text-amber-400',
    btnBg: 'bg-amber-500/20',
    btnHover: 'hover:bg-amber-500/30',
    headingText: 'text-amber-300',
  },
};

const TIER_UPGRADE_LABELS: Record<number, string> = {
  1: 'Upgrade to Builder',
  2: 'Upgrade to Pro',
  3: 'Upgrade to Elite',
  4: 'Upgrade to Premium',
  5: 'Upgrade to Founder',
  6: 'Edge 100%',
};

export function getMembershipCTA(membership: UserMembership | null | undefined): MembershipCTA {
  if (!membership || membership.status !== 'active') {
    return { label: 'Join Club', isFounder: false, isNonMember: true, color: TIER_COLORS[0] };
  }

  const tierLevel = membership.tierLevel;
  const label = TIER_UPGRADE_LABELS[tierLevel] ?? 'Upgrade';
  const isFounder = tierLevel >= 6;
  const color = TIER_COLORS[Math.min(tierLevel, 6)] ?? TIER_COLORS[0];

  return { label, isFounder, isNonMember: false, color };
}
