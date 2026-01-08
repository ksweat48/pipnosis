export type TradeStyle = 'scalp' | 'micro_intraday' | 'intraday';

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
  scalp: {
    name: 'scalp',
    displayName: 'Scalp',
    icon: 'Zap',
    description: 'Fast trades, 20min-2hr duration',
    durationMin: 20,
    durationMax: 120,
    suggestedMultipliers: [0.01, 0.02, 0.05],
    minDollarAmount: 50,
    maxDollarAmount: 1000,
  },
  micro_intraday: {
    name: 'micro_intraday',
    displayName: 'Micro Intraday',
    icon: 'Clock',
    description: 'Medium duration, 1hr-6hr trades',
    durationMin: 60,
    durationMax: 360,
    suggestedMultipliers: [0.02, 0.04, 0.06],
    minDollarAmount: 100,
    maxDollarAmount: 2000,
  },
  intraday: {
    name: 'intraday',
    displayName: 'Intraday',
    icon: 'TrendingUp',
    description: 'Longer duration, 2hr-10hr trades',
    durationMin: 120,
    durationMax: 600,
    suggestedMultipliers: [0.03, 0.05, 0.09],
    minDollarAmount: 150,
    maxDollarAmount: 3000,
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
  if (percentOfAccount > 3) {
    return {
      valid: false,
      error: 'Risk amount cannot exceed 3% of account balance',
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
      return 'scalp';
    case 'medium':
      return 'micro_intraday';
    case 'low':
      return 'intraday';
    default:
      return 'micro_intraday';
  }
}

export function getStyleFromDuration(durationMinutes: number): TradeStyle {
  if (durationMinutes <= 120) {
    return 'scalp';
  } else if (durationMinutes <= 360) {
    return 'micro_intraday';
  } else {
    return 'intraday';
  }
}

export const SINGLE_TRADE_RISK_RANGE = {
  min: 0.01, // 1%
  max: 0.03, // 3%
} as const;

export const MAX_TOTAL_EXPOSURE = 0.1; // 10% hard cap for multi-trade mode
