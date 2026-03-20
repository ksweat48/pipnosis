/**
 * Regime Bucketing - Market Regime Classification
 *
 * Converts complex regime + adversarial states into simple bucket strings.
 * Used by playbook system to match strategies to market conditions.
 *
 * Example buckets:
 * - "trend_high_vol"
 * - "trend_normal"
 * - "range_normal"
 * - "compression"
 * - "trend_high_vol_adversarial"
 * - "range_normal_adversarial"
 */

import type { RegimeSnapshot } from './regime-oracle';
import type { AdversarialSignal } from './adversarial-detector';

export interface RegimeBucketInfo {
  bucket: string;
  base_structure: string;
  volatility_level: string;
  is_adversarial: boolean;
  notes: string;
}

/**
 * Get regime bucket string for playbook matching
 *
 * Returns a standardized bucket like "trend_high_vol" or "range_normal_adversarial"
 */
export function getRegimeBucket(
  regime?: RegimeSnapshot,
  adversarial?: AdversarialSignal
): string {
  // Default if no regime data
  if (!regime) {
    return 'unknown';
  }

  // Base structure classification
  let baseStructure = regime.structure || 'unknown';

  // Normalize structure names
  if (baseStructure === 'trending' || baseStructure === 'strong_trend') {
    baseStructure = 'trend';
  } else if (baseStructure === 'ranging' || baseStructure === 'consolidation') {
    baseStructure = 'range';
  } else if (baseStructure === 'choppy' || baseStructure === 'whipsaw') {
    baseStructure = 'choppy';
  }

  // Volatility classification
  let volLevel = 'normal';
  if (regime.volatility_score >= 60) {
    volLevel = 'high_vol';
  } else if (regime.volatility_score <= 30) {
    volLevel = 'low_vol';
  }

  // Handle special conditions
  if (regime.atr_compression) {
    baseStructure = 'compression';
    volLevel = ''; // Compression is self-describing
  }

  // Build base bucket
  let bucket = baseStructure;
  if (volLevel) {
    bucket = `${baseStructure}_${volLevel}`;
  }

  // Add adversarial suffix for moderate/severe manipulation
  if (adversarial && (adversarial.level === 'moderate' || adversarial.level === 'severe')) {
    bucket = `${bucket}_adversarial`;
  }

  return bucket;
}

/**
 * Get detailed regime bucket information
 *
 * Returns full breakdown for logging and analysis
 */
export function getRegimeBucketInfo(
  regime?: RegimeSnapshot,
  adversarial?: AdversarialSignal
): RegimeBucketInfo {
  const bucket = getRegimeBucket(regime, adversarial);

  // Parse bucket components
  const parts = bucket.split('_');
  const baseStructure = parts[0] || 'unknown';

  let volatilityLevel = 'normal';
  if (bucket.includes('high_vol')) {
    volatilityLevel = 'high';
  } else if (bucket.includes('low_vol')) {
    volatilityLevel = 'low';
  } else if (bucket.includes('compression')) {
    volatilityLevel = 'compressed';
  }

  const isAdversarial = bucket.includes('adversarial');

  // Generate human-readable notes
  const notes = generateBucketNotes(regime, adversarial, bucket);

  return {
    bucket,
    base_structure: baseStructure,
    volatility_level: volatilityLevel,
    is_adversarial: isAdversarial,
    notes
  };
}

/**
 * Generate human-readable notes about the bucket
 */
function generateBucketNotes(
  regime: RegimeSnapshot | undefined,
  adversarial: AdversarialSignal | undefined,
  bucket: string
): string {
  const notes: string[] = [];

  if (!regime) {
    return 'Unknown market conditions';
  }

  // Structure notes
  if (bucket.startsWith('trend')) {
    notes.push(`Trending market (strength: ${regime.trend_strength_score})`);
  } else if (bucket.startsWith('range')) {
    notes.push('Range-bound market');
  } else if (bucket.startsWith('compression')) {
    notes.push('ATR compression detected');
  } else if (bucket.startsWith('choppy')) {
    notes.push('Choppy, indecisive market');
  }

  // Volatility notes
  if (bucket.includes('high_vol')) {
    notes.push(`High volatility (${regime.volatility_score})`);
  } else if (bucket.includes('low_vol')) {
    notes.push(`Low volatility (${regime.volatility_score})`);
  }

  // Session notes
  if (regime.session) {
    notes.push(`${regime.session} session`);
  }

  // Adversarial notes
  if (adversarial && adversarial.is_adversarial) {
    notes.push(`${adversarial.level} adversarial environment`);
    if (adversarial.patterns.length > 0) {
      notes.push(`Patterns: ${adversarial.patterns.slice(0, 2).join(', ')}`);
    }
  }

  return notes.join(' | ');
}

/**
 * Check if two regime buckets are similar enough to share playbooks
 *
 * Example: "trend_high_vol" and "trend_normal" might be similar
 * But "trend_high_vol" and "range_normal" are NOT similar
 */
export function areBucketsSimilar(bucket1: string, bucket2: string): boolean {
  // Exact match
  if (bucket1 === bucket2) {
    return true;
  }

  // Extract base structures
  const base1 = bucket1.split('_')[0];
  const base2 = bucket2.split('_')[0];

  // Must have same base structure
  if (base1 !== base2) {
    return false;
  }

  // If one has adversarial and the other doesn't, they're NOT similar
  const adv1 = bucket1.includes('adversarial');
  const adv2 = bucket2.includes('adversarial');
  if (adv1 !== adv2) {
    return false;
  }

  // Same base structure and both non-adversarial or both adversarial = similar
  // (volatility differences are acceptable within same structure)
  return true;
}

/**
 * Get all possible bucket variations for a given base structure
 *
 * Used when looking for fallback playbooks
 */
export function getBucketVariations(baseStructure: string): string[] {
  const variations = [
    `${baseStructure}_high_vol`,
    `${baseStructure}_normal`,
    `${baseStructure}_low_vol`,
    baseStructure
  ];

  return variations;
}

/**
 * Get bucket priority for fallback search
 *
 * Returns buckets in order of preference for finding similar strategies
 */
export function getBucketFallbackChain(
  primaryBucket: string
): string[] {
  const chain = [primaryBucket];

  // Remove adversarial suffix for fallback
  if (primaryBucket.includes('_adversarial')) {
    const baseWithoutAdv = primaryBucket.replace('_adversarial', '');
    chain.push(baseWithoutAdv);
  }

  // Try different volatility levels with same structure
  const baseStructure = primaryBucket.split('_')[0];

  if (primaryBucket.includes('high_vol')) {
    chain.push(`${baseStructure}_normal`);
    chain.push(`${baseStructure}_low_vol`);
  } else if (primaryBucket.includes('low_vol')) {
    chain.push(`${baseStructure}_normal`);
    chain.push(`${baseStructure}_high_vol`);
  } else if (primaryBucket.includes('normal')) {
    chain.push(`${baseStructure}_high_vol`);
    chain.push(`${baseStructure}_low_vol`);
  }

  // Finally just the base structure
  chain.push(baseStructure);

  // Remove duplicates while preserving order
  return Array.from(new Set(chain));
}

/**
 * Validate regime bucket string format
 */
export function isValidRegimeBucket(bucket: string): boolean {
  if (!bucket || bucket === 'unknown') {
    return false;
  }

  const validStructures = ['trend', 'range', 'compression', 'choppy', 'breakout'];
  const baseStructure = bucket.split('_')[0];

  return validStructures.includes(baseStructure);
}

/**
 * Get strategy modes associated with a regime bucket.
 *
 * CCIP-GOVERNANCE-2026-03-20:
 * This function is for INTERNAL PLAYBOOK MATCHING ONLY.
 * Its output MUST NOT be injected into Alpha's LLM prompt as a recommendation.
 * Alpha determines which style is appropriate from raw regime data.
 * Callers: strategy-playbook-manager.ts (internal lookup), logRegimeBucket (console only).
 */
export function getRecommendedModesForBucket(bucket: string): string[] {
  const baseStructure = bucket.split('_')[0];
  const isHighVol = bucket.includes('high_vol');
  const isAdversarial = bucket.includes('adversarial');

  if (baseStructure === 'trend') {
    if (isHighVol) {
      return ['trend', 'breakout'];
    }
    return ['trend', 'pullback'];
  }

  if (baseStructure === 'range') {
    if (isAdversarial) {
      return ['reversal', 'mean_reversion'];
    }
    return ['range', 'scalp'];
  }

  if (baseStructure === 'compression') {
    return ['breakout', 'range'];
  }

  if (baseStructure === 'choppy') {
    return ['scalp', 'avoid'];
  }

  return ['trend', 'breakout', 'range'];
}

/**
 * Log regime bucket analysis
 */
export function logRegimeBucket(
  bucket: string,
  regime?: RegimeSnapshot,
  adversarial?: AdversarialSignal
): void {
  const info = getRegimeBucketInfo(regime, adversarial);

  console.log(`[Regime Bucket] ${info.bucket}`);
  console.log(`  Structure: ${info.base_structure}`);
  console.log(`  Volatility: ${info.volatility_level}`);
  console.log(`  Adversarial: ${info.is_adversarial ? 'YES' : 'NO'}`);
  console.log(`  Notes: ${info.notes}`);

  const recommendedModes = getRecommendedModesForBucket(bucket);
  console.log(`  Recommended modes: ${recommendedModes.join(', ')}`);
}
