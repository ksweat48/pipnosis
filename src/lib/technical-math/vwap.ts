/**
 * VWAP (Volume Weighted Average Price) Utilities
 *
 * Pure mathematical functions for VWAP-based analysis.
 */

export type VWAPZone = 'EXTENDED_ABOVE' | 'ABOVE' | 'NEAR' | 'BELOW' | 'EXTENDED_BELOW';

export interface VWAPAnalysis {
  zone: VWAPZone;
  distancePct: number;
  distanceATR: number;
  favorableForBuy: boolean;
  favorableForSell: boolean;
}

export function analyzeVWAP(
  price: number,
  vwap: number,
  atr: number
): VWAPAnalysis {
  const distance = price - vwap;
  const distancePct = vwap > 0 ? (distance / vwap) * 100 : 0;
  const distanceATR = atr > 0 ? Math.abs(distance) / atr : 0;

  let zone: VWAPZone;
  if (distancePct > 1.5) {
    zone = 'EXTENDED_ABOVE';
  } else if (distancePct > 0.3) {
    zone = 'ABOVE';
  } else if (distancePct >= -0.3) {
    zone = 'NEAR';
  } else if (distancePct >= -1.5) {
    zone = 'BELOW';
  } else {
    zone = 'EXTENDED_BELOW';
  }

  const favorableForBuy = zone === 'BELOW' || zone === 'EXTENDED_BELOW' || zone === 'NEAR';
  const favorableForSell = zone === 'ABOVE' || zone === 'EXTENDED_ABOVE' || zone === 'NEAR';

  return {
    zone,
    distancePct,
    distanceATR,
    favorableForBuy,
    favorableForSell
  };
}

export function calculateEntryQualityFromVWAP(
  vwapAnalysis: VWAPAnalysis,
  direction: 'BUY' | 'SELL'
): number {
  let quality = 50;

  if (direction === 'BUY') {
    switch (vwapAnalysis.zone) {
      case 'BELOW':
        quality = 80;
        break;
      case 'EXTENDED_BELOW':
        quality = 70;
        break;
      case 'NEAR':
        quality = 65;
        break;
      case 'ABOVE':
        quality = 40;
        break;
      case 'EXTENDED_ABOVE':
        quality = 25;
        break;
    }
  } else {
    switch (vwapAnalysis.zone) {
      case 'ABOVE':
        quality = 80;
        break;
      case 'EXTENDED_ABOVE':
        quality = 70;
        break;
      case 'NEAR':
        quality = 65;
        break;
      case 'BELOW':
        quality = 40;
        break;
      case 'EXTENDED_BELOW':
        quality = 25;
        break;
    }
  }

  return quality;
}

export function formatVWAPEvidence(analysis: VWAPAnalysis): string {
  return `VWAP_ZONE=${analysis.zone}|DIST_ATR=${analysis.distanceATR.toFixed(2)}|DIST_PCT=${analysis.distancePct.toFixed(2)}%`;
}
