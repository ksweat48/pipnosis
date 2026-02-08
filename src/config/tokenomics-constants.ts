/**
 * CANONICAL TOKENOMICS v1.2.1 — SSOT CONFIGURATION
 *
 * This file is the single source of truth for ALL tokenomics values.
 * Every service that touches PIP tokens, credits, discounts, staking,
 * or membership tiers MUST import from here.
 *
 * DO NOT hardcode tokenomics values elsewhere in the codebase.
 *
 * CORE PRINCIPLES (Immutable):
 * - PIP tokens are utility access units, NOT currency/equity/securities
 * - Credits are the ONLY unit used to execute trades (separate system)
 * - These two systems NEVER convert between each other
 * - 1 PIP = $0.10 perceived utility (internal reference only)
 */

export const TOKENOMICS = {
  TOKEN: {
    NAME: 'PIP',
    FULL_NAME: 'Pipnosis Utility Token',
    UTILITY_REFERENCE_VALUE_USD: 0.10,
    TOTAL_SUPPLY: 100_000_000,
    DECIMALS: 2,
  },

  SUPPLY_POOLS: {
    COMMUNITY_INCENTIVES: { percent: 30, amount: 30_000_000 },
    MARKETING_PARTNERS: { percent: 15, amount: 15_000_000 },
    PUBLIC_LIQUIDITY: { percent: 25, amount: 25_000_000 },
    FOUNDERS_TEAM: { percent: 20, amount: 20_000_000 },
    OPERATIONS_RESERVE: { percent: 10, amount: 10_000_000 },
  },

  CREDITS: {
    BASE_TRADE_COST: 10,
    MIN_BALANCE_FOR_SESSION: 10,
  },

  MEMBERSHIP_GRANT_RULE: {
    GRANT_PERCENTAGE: 0.10,
    formula: (priceUsd: number): number =>
      Math.round((priceUsd * 0.10) / 0.10),
  },

  TIERS: {
    MEMBER: {
      level: 1,
      name: 'Member',
      priceUsd: 99,
      tokenGrant: 100,
      requiredTokenBalance: 100,
      creditDiscount: 0,
      stakingEnabled: false,
      stakingMultiplier: 0,
      votingEnabled: false,
      votingWeight: 0,
      referralBonusPct: 0,
      badgeColor: '#64748b',
      badgeIcon: 'user',
      benefits: [
        'Access to Pipnosis Club',
        '100 PIP Access Tokens',
        'Community trader chat',
        'View platform growth & token metrics',
      ],
    },
    STARTER: {
      level: 2,
      name: 'Starter',
      priceUsd: 250,
      tokenGrant: 250,
      requiredTokenBalance: 250,
      creditDiscount: 0,
      stakingEnabled: false,
      stakingMultiplier: 0,
      votingEnabled: false,
      votingWeight: 0,
      referralBonusPct: 0,
      badgeColor: '#0ea5e9',
      badgeIcon: 'rocket',
      benefits: [
        'Club access',
        '250 PIP Access Tokens',
        'Market Analyzer access',
        'Community trader chat',
        'Club dashboards',
      ],
    },
    BUILDER: {
      level: 3,
      name: 'Builder',
      priceUsd: 500,
      tokenGrant: 500,
      requiredTokenBalance: 500,
      creditDiscount: 1,
      stakingEnabled: true,
      stakingMultiplier: 1.0,
      votingEnabled: false,
      votingWeight: 0,
      referralBonusPct: 0,
      badgeColor: '#f59e0b',
      badgeIcon: 'hammer',
      benefits: [
        'Club access',
        '500 PIP Access Tokens',
        'Staking rewards enabled',
        '1 credit discount per trade (9 credits/trade)',
        'Market Analyzer',
        'Community chat',
      ],
    },
    PRO: {
      level: 4,
      name: 'Pro',
      priceUsd: 1000,
      tokenGrant: 1000,
      requiredTokenBalance: 1000,
      creditDiscount: 2,
      stakingEnabled: true,
      stakingMultiplier: 1.5,
      votingEnabled: true,
      votingWeight: 1.0,
      referralBonusPct: 5,
      badgeColor: '#8b5cf6',
      badgeIcon: 'zap',
      benefits: [
        'Club access',
        '1,000 PIP Access Tokens',
        'Higher staking reward multiplier',
        '2 credit discount per trade (8 credits/trade)',
        'Advanced Market Analyzer',
        'Voting rights',
        '+5% referral bonus',
        'Community + Pro-only channels',
      ],
    },
    ELITE_PARTNER: {
      level: 5,
      name: 'Elite Partner',
      priceUsd: 5000,
      tokenGrant: 5000,
      requiredTokenBalance: 5000,
      creditDiscount: 3,
      stakingEnabled: true,
      stakingMultiplier: 2.0,
      votingEnabled: true,
      votingWeight: 2.0,
      referralBonusPct: 10,
      badgeColor: '#059669',
      badgeIcon: 'shield',
      benefits: [
        'Club access',
        '5,000 PIP Access Tokens',
        'Enhanced staking rewards',
        '3 credit discount per trade (7 credits/trade)',
        'Higher voting weight',
        '+10% referral bonus',
        'VIP access to events',
        'Early platform announcements',
        'Elite-only channels',
      ],
    },
    FOUNDER: {
      level: 6,
      name: 'Founder',
      priceUsd: 10000,
      tokenGrant: 10000,
      requiredTokenBalance: 10000,
      creditDiscount: 4,
      stakingEnabled: true,
      stakingMultiplier: 3.0,
      votingEnabled: true,
      votingWeight: 3.0,
      referralBonusPct: 15,
      badgeColor: '#dc2626',
      badgeIcon: 'crown',
      benefits: [
        'Club access',
        '10,000 PIP Access Tokens',
        'Maximum staking rewards',
        '4 credit discount per trade (6 credits/trade)',
        'Highest voting weight',
        '+15% referral bonus',
        'VIP + private Founder events',
        'Founder vacation bonus',
        'Exclusive Founders Circle access',
        'First access to roadmap + alpha features',
      ],
    },
  },

  REFERRAL: {
    BASE_CASH_COMMISSION_PCT: 20,
    BASE_PIP_BONUS: 500,
    MIN_REFERRAL_AGE_HOURS: 24,
  },

  STAKING: {
    MIN_STAKE_AMOUNT: 10,
    MIN_LOCK_DAYS: 30,
    MAX_LOCK_DAYS: 365,
    MONTHLY_EMISSION_BUDGET: 100_000,
    EMISSION_POOL_TOTAL: 30_000_000,
  },

  DISCOUNT: {
    formula: (creditDiscount: number): number => creditDiscount * 10,
    MAX_DISCOUNT_CREDITS: 4,
  },

  WHITEPAPER_DISCLAIMER:
    'PIP tokens are non-transferable utility access units used within the Pipnosis ecosystem to unlock features, apply discounts, and participate in platform governance. PIP tokens do not represent equity, ownership, profit participation, or investment contracts. Token balances and utility reference values are subject to change based on platform rules and availability.',
} as const;

export type TierKey = keyof typeof TOKENOMICS.TIERS;

export interface TierConfig {
  level: number;
  name: string;
  priceUsd: number;
  tokenGrant: number;
  requiredTokenBalance: number;
  creditDiscount: number;
  stakingEnabled: boolean;
  stakingMultiplier: number;
  votingEnabled: boolean;
  votingWeight: number;
  referralBonusPct: number;
  badgeColor: string;
  badgeIcon: string;
  benefits: string[];
}

export function getTierByLevel(level: number): TierConfig | null {
  const tiers = Object.values(TOKENOMICS.TIERS);
  return tiers.find(t => t.level === level) || null;
}

export function getAllTiers(): TierConfig[] {
  return Object.values(TOKENOMICS.TIERS).sort((a, b) => a.level - b.level);
}
