/**
 * Intelligent Indicator Weighting System
 *
 * SSOT for indicator weight calculations based on:
 * - Time of day (session)
 * - Asset class
 * - Market regime
 *
 * Weights are multipliers applied to indicator alignment
 * Higher weight = more important for that pair/session combination
 *
 * CCIP Compliant - Single authority for all indicator weighting logic
 */

export type Session = 'London' | 'NewYork' | 'Asian' | 'Overlap';
export type AssetClass = 'forex' | 'indices' | 'commodities' | 'crypto';
export type MarketRegime = 'trending' | 'ranging' | 'volatile' | 'quiet';

export interface IndicatorWeights {
  vwap: number;
  ema20: number;
  ema50: number;
  rsi: number;
  volumePressure: number;
  candlePattern: number;
  structure: number;
  momentum: number;
}

const BASE_WEIGHTS: IndicatorWeights = {
  vwap: 1.0,
  ema20: 1.0,
  ema50: 1.0,
  rsi: 1.0,
  volumePressure: 1.0,
  candlePattern: 1.0,
  structure: 1.0,
  momentum: 1.0,
};

const SESSION_MULTIPLIERS: Record<Session, Partial<IndicatorWeights>> = {
  London: {
    vwap: 1.3,
    structure: 1.2,
    ema20: 1.1,
  },
  NewYork: {
    vwap: 1.4,
    volumePressure: 1.3,
    momentum: 1.2,
  },
  Asian: {
    ema50: 1.3,
    structure: 1.2,
    vwap: 0.9,
  },
  Overlap: {
    vwap: 1.5,
    volumePressure: 1.4,
    momentum: 1.3,
  },
};

const ASSET_MULTIPLIERS: Record<AssetClass, Partial<IndicatorWeights>> = {
  forex: {
    vwap: 1.2,
    ema20: 1.1,
    structure: 1.2,
  },
  indices: {
    volumePressure: 1.3,
    momentum: 1.2,
    ema20: 1.1,
  },
  commodities: {
    structure: 1.3,
    ema50: 1.2,
    vwap: 1.3,
  },
  crypto: {
    momentum: 1.4,
    candlePattern: 1.2,
    volumePressure: 1.1,
  },
};

const REGIME_MULTIPLIERS: Record<MarketRegime, Partial<IndicatorWeights>> = {
  trending: {
    momentum: 1.3,
    ema20: 1.2,
    structure: 1.2,
  },
  ranging: {
    vwap: 1.3,
    rsi: 1.2,
    candlePattern: 1.1,
  },
  volatile: {
    structure: 1.4,
    ema50: 1.2,
    rsi: 0.8,
  },
  quiet: {
    structure: 1.3,
    ema50: 1.2,
    momentum: 0.8,
  },
};

export function getIntelligentWeights(
  symbol: string,
  session: Session,
  regime: MarketRegime
): IndicatorWeights {
  const assetClass = getAssetClass(symbol);

  const weights = { ...BASE_WEIGHTS };

  applyMultipliers(weights, SESSION_MULTIPLIERS[session]);
  applyMultipliers(weights, ASSET_MULTIPLIERS[assetClass]);
  applyMultipliers(weights, REGIME_MULTIPLIERS[regime]);

  return weights;
}

function applyMultipliers(
  weights: IndicatorWeights,
  multipliers: Partial<IndicatorWeights>
): void {
  for (const key of Object.keys(multipliers) as Array<keyof IndicatorWeights>) {
    weights[key] *= multipliers[key] ?? 1.0;
  }
}

function getAssetClass(symbol: string): AssetClass {
  if (['BTCUSD', 'ETHUSD'].includes(symbol)) return 'crypto';
  if (['US30', 'SPX500', 'NAS100'].includes(symbol)) return 'indices';
  if (symbol === 'XAUUSD') return 'commodities';
  return 'forex';
}

export function getCurrentSession(): Session {
  const now = new Date();
  const estHour = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getHours();

  if (estHour >= 8 && estHour < 12) return 'Overlap';
  if (estHour >= 3 && estHour < 12) return 'London';
  if (estHour >= 8 && estHour < 17) return 'NewYork';

  return 'Asian';
}
