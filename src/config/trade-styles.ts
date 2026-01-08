/**
 * PIPNOSIS INTRADAY-ONLY TRADE STYLES
 *
 * CRITICAL: Pipnosis is an INTRADAY platform. ALL trades MUST close before market close.
 * NO SWING TRADES. NO MULTI-DAY POSITIONS. EVER.
 */

export type TradeStyle = 'scalper' | 'micro' | 'intraday';

export interface TradeStyleConfig {
  name: string;
  displayName: string;
  icon: string;
  description: string;
  durationMin: number; // minutes
  durationMax: number; // minutes
  suggestedMultipliers: [number, number, number]; // [low, medium, high] as decimal percentages
  minDollarAmount: number; // absolute minimum
  maxDollarAmount: number; // absolute maximum
}

export const TRADE_STYLES: Record<TradeStyle, TradeStyleConfig> = {
  scalper: {
    name: 'scalper',
    displayName: 'Scalper',
    icon: 'Zap',
    description: 'Fast trades, 20min-2hr duration',
    durationMin: 20,
    durationMax: 120,
    suggestedMultipliers: [0.01, 0.02, 0.05], // 1%, 2%, 5%
    minDollarAmount: 50,
    maxDollarAmount: 5000, // Increased for 5% cap
  },
  micro: {
    name: 'micro',
    displayName: 'Micro',
    icon: 'Target',
    description: 'Medium trades, 1hr-6hr duration',
    durationMin: 60,
    durationMax: 360,
    suggestedMultipliers: [0.02, 0.05, 0.07], // 2%, 5%, 7%
    minDollarAmount: 75,
    maxDollarAmount: 7000, // Increased for 7% cap
  },
  intraday: {
    name: 'intraday',
    displayName: 'Intraday',
    icon: 'Clock',
    description: 'Longer intraday, 2hr-10hr duration',
    durationMin: 120,
    durationMax: 600,
    suggestedMultipliers: [0.03, 0.07, 0.10], // 3%, 7%, 10%
    minDollarAmount: 100,
    maxDollarAmount: 10000, // Increased for 10% cap
  },
};

export interface SuggestedDollarAmounts {
  low: number;
  medium: number;
  high: number;
}

export function calculateSuggestedAmounts(
  accountBalance: number,
  style: TradeStyle
): SuggestedDollarAmounts {
  const config = TRADE_STYLES[style];
  const [lowMult, medMult, highMult] = config.suggestedMultipliers;

  const low = Math.max(
    config.minDollarAmount,
    Math.min(Math.round(accountBalance * lowMult), config.maxDollarAmount)
  );
  const medium = Math.max(
    config.minDollarAmount,
    Math.min(Math.round(accountBalance * medMult), config.maxDollarAmount)
  );
  const high = Math.max(
    config.minDollarAmount,
    Math.min(Math.round(accountBalance * highMult), config.maxDollarAmount)
  );

  return { low, medium, high };
}

export function validateDollarAmount(
  amount: number,
  accountBalance: number
): { valid: boolean; error?: string } {
  if (amount < 50) {
    return { valid: false, error: 'Minimum risk amount is $50' };
  }

  const percentOfAccount = (amount / accountBalance) * 100;
  if (percentOfAccount > 10) {
    return {
      valid: false,
      error: 'Risk amount cannot exceed 10% of account balance',
    };
  }

  if (percentOfAccount < 1) {
    return {
      valid: false,
      error: 'Risk amount must be at least 1% of account balance',
    };
  }

  return { valid: true };
}

export function mapLegacyRiskModeToStyle(riskMode: string): TradeStyle {
  switch (riskMode.toLowerCase()) {
    case 'high':
      return 'scalper';
    case 'medium':
      return 'micro';
    case 'low':
      return 'intraday';
    default:
      return 'micro';
  }
}

export function getStyleFromDuration(durationMinutes: number): TradeStyle {
  // INTRADAY ONLY: All durations max at 10 hours (600 minutes)
  if (durationMinutes > 600) {
    throw new Error('SWING TRADES NOT ALLOWED: Pipnosis is intraday-only. Max duration is 10 hours.');
  }

  if (durationMinutes <= 120) {
    return 'scalper';
  } else if (durationMinutes <= 360) {
    return 'micro';
  } else {
    return 'intraday';
  }
}

export const SINGLE_TRADE_RISK_RANGE = {
  min: 0.01, // 1%
  max: 0.10, // 10%
} as const;

export const MAX_TOTAL_EXPOSURE = 0.2; // 20% hard cap for multi-trade mode
