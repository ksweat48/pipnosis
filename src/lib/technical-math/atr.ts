/**
 * ATR (Average True Range) Utilities
 *
 * Pure mathematical functions for ATR-based analysis.
 */

export interface ATRAnalysis {
  currentATR: number;
  averageATR: number;
  expansion: number;
  regime: 'COMPRESSION' | 'NORMAL' | 'EXPANSION';
}

export interface ChaseRiskScore {
  score: number;
  level: 'LOW' | 'MEDIUM' | 'HIGH';
  distanceFromVWAP: number;
  momentum: number;
}

export function analyzeATR(
  currentATR: number,
  averageATR: number
): ATRAnalysis {
  const expansion = averageATR > 0 ? currentATR / averageATR : 1;

  let regime: 'COMPRESSION' | 'NORMAL' | 'EXPANSION';
  if (expansion < 0.7) {
    regime = 'COMPRESSION';
  } else if (expansion > 1.5) {
    regime = 'EXPANSION';
  } else {
    regime = 'NORMAL';
  }

  return {
    currentATR,
    averageATR,
    expansion,
    regime
  };
}

export function calculateChaseRiskScore(
  price: number,
  vwap: number,
  atr: number,
  recentMomentum: number
): ChaseRiskScore {
  const distanceFromVWAP = atr > 0 ? Math.abs(price - vwap) / atr : 0;
  const momentumNormalized = Math.min(Math.abs(recentMomentum), 100) / 100;

  let score = 0;
  score += distanceFromVWAP > 1.5 ? 40 : distanceFromVWAP > 1.0 ? 25 : distanceFromVWAP > 0.5 ? 10 : 0;
  score += momentumNormalized > 0.7 ? 30 : momentumNormalized > 0.4 ? 15 : 0;

  let level: 'LOW' | 'MEDIUM' | 'HIGH';
  if (score >= 50) {
    level = 'HIGH';
  } else if (score >= 25) {
    level = 'MEDIUM';
  } else {
    level = 'LOW';
  }

  return {
    score,
    level,
    distanceFromVWAP,
    momentum: recentMomentum
  };
}

export function calculateATRDistance(
  price1: number,
  price2: number,
  atr: number
): number {
  if (atr <= 0) return 0;
  return Math.abs(price1 - price2) / atr;
}

export function formatATREvidence(analysis: ATRAnalysis): string {
  return `ATR_REGIME=${analysis.regime}|EXPANSION=${analysis.expansion.toFixed(2)}`;
}
