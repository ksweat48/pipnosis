/**
 * Market Phase Deriver — SSOT for unified market phase state
 *
 * CCIP-2026-03-15: Introduced to resolve Alpha session continuity gap.
 *
 * PROBLEM: Alpha received scattered signals (micro-regime type, ATR compression flag,
 * regime structure string) but no unified phase label. He was expected to synthesise
 * these into a phase label himself each cycle, producing inconsistent output.
 *
 * SOLUTION: Pre-compute the phase label from existing data sources and deliver it
 * as a verified fact in the briefing. Alpha receives the phase as data, not a task.
 *
 * OWNERSHIP CONTRACT:
 * - This file is the sole authority for MarketPhase type and deriveMarketPhase().
 * - Inputs are read-only references to data owned by: micro-regime-classifier,
 *   regime-oracle, and market-briefing-builder.
 * - No confidence penalties, no trading advice — raw phase state only.
 *
 * SSOT references:
 * - MicroRegime type: src/services/micro-regime-classifier.ts
 * - RegimeSnapshot.structure: src/services/regime-oracle.ts
 * - ATR expansion/compression booleans: src/services/regime-oracle.ts
 */

import type { MicroRegime } from '../services/micro-regime-classifier';

export type MarketPhase =
  | 'COMPRESSION'        // Range tightening, low ATR, pre-breakout energy
  | 'EXPANSION'          // ATR expanding, directional momentum, trend in motion
  | 'EXHAUSTION'         // Extended move, momentum fading, reversal risk elevated
  | 'ACCUMULATION'       // Institutional building, range with absorption
  | 'DISTRIBUTION'       // Institutional offloading, range with rejection
  | 'POST_BREAK_RETEST'  // Return to broken level — continuation or trap
  | 'STOP_HUNT'          // Liquidity sweep event in progress
  | 'RANGING'            // No directional bias, balanced supply/demand
  | 'UNKNOWN';           // Insufficient data to classify

export interface MarketPhaseResult {
  phase: MarketPhase;
  confidence: number;
  sources: string[];
}

/**
 * Derives unified market phase from existing computed signals.
 *
 * Priority order (highest to lowest):
 * 1. Micro-regime if available (most granular, freshest signal)
 * 2. Regime oracle structure + ATR flags
 * 3. Fallback to UNKNOWN
 *
 * Confidence is derived from signal agreement count — not a new computation.
 */
export function deriveMarketPhase(params: {
  microRegime?: MicroRegime | null;
  microRegimeConfidence?: number;
  regimeStructure?: string;
  atrCompression?: boolean;
  atrExpansion?: boolean;
}): MarketPhaseResult {
  const { microRegime, microRegimeConfidence, regimeStructure, atrCompression, atrExpansion } = params;
  const sources: string[] = [];

  if (microRegime) {
    sources.push(`micro-regime:${microRegime}`);

    const microPhaseMap: Record<MicroRegime, MarketPhase> = {
      trend_acceleration:    'EXPANSION',
      trend_exhaustion:      'EXHAUSTION',
      mean_reversion_pocket: 'EXHAUSTION',
      liquidity_vacuum:      'COMPRESSION',
      stop_hunt_expansion:   'STOP_HUNT',
      pre_break_compression: 'COMPRESSION',
      post_break_retest:     'POST_BREAK_RETEST',
      neutral_ranging:       'RANGING',
    };

    const phaseFromMicro = microPhaseMap[microRegime];

    if (regimeStructure) {
      sources.push(`regime:${regimeStructure}`);
    }
    if (atrExpansion !== undefined) {
      sources.push(`atr:${atrExpansion ? 'expanding' : atrCompression ? 'compressed' : 'normal'}`);
    }

    const confidence = microRegimeConfidence !== undefined
      ? Math.min(100, Math.round(microRegimeConfidence * 0.85 + (sources.length > 1 ? 10 : 0)))
      : 65;

    return { phase: phaseFromMicro, confidence, sources };
  }

  if (regimeStructure) {
    sources.push(`regime:${regimeStructure}`);

    if (atrExpansion !== undefined) {
      sources.push(`atr:${atrExpansion ? 'expanding' : atrCompression ? 'compressed' : 'normal'}`);
    }

    if (regimeStructure === 'accumulation') {
      return { phase: 'ACCUMULATION', confidence: 60, sources };
    }

    if (regimeStructure === 'distribution') {
      if (atrExpansion) {
        return { phase: 'EXPANSION', confidence: 65, sources };
      }
      return { phase: 'DISTRIBUTION', confidence: 60, sources };
    }

    if (regimeStructure === 'trend') {
      if (atrExpansion) {
        return { phase: 'EXPANSION', confidence: 70, sources };
      }
      if (atrCompression) {
        return { phase: 'COMPRESSION', confidence: 65, sources };
      }
      return { phase: 'EXPANSION', confidence: 55, sources };
    }

    if (regimeStructure === 'range') {
      if (atrCompression) {
        return { phase: 'COMPRESSION', confidence: 65, sources };
      }
      return { phase: 'RANGING', confidence: 55, sources };
    }
  }

  return { phase: 'UNKNOWN', confidence: 0, sources: [] };
}
