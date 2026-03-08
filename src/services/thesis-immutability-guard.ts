/**
 * Thesis Immutability Guard Service
 *
 * SSOT ENFORCEMENT: Market theses are structural truths that must remain unchanged
 *
 * Responsibilities:
 * - Freeze thesis objects to prevent runtime mutation
 * - Validate thesis integrity via content hashing
 * - Detect and alert on SSOT violations
 * - Ensure thesis remains pure market truth (no execution data)
 */

import { AlphaMarketThesis, THESIS_TTL_MS } from '../types/alpha-thesis';
import { logger } from '../lib/logger';
import { generateThesisHash } from './alpha-thesis-parser';

/**
 * Stable JSON stringification with sorted keys (SSOT for hashing)
 * Ensures consistent hash generation regardless of object property order
 *
 * CRITICAL: Must match the implementation in alpha-thesis-parser.ts
 */
function stableStringify(obj: any): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }

  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }

  if (Array.isArray(obj)) {
    return '[' + obj.map(item => stableStringify(item)).join(',') + ']';
  }

  // Sort object keys for deterministic ordering
  const sortedKeys = Object.keys(obj).sort();
  const pairs = sortedKeys.map(key => {
    const value = stableStringify(obj[key]);
    return `"${key}":${value}`;
  });

  return '{' + pairs.join(',') + '}';
}

/**
 * Normalize thesis content for hash comparison
 *
 * SSOT CRITICAL FIX: Must use IDENTICAL fields AND identical value treatment as
 * createImmutableThesis. Every field must be passed through without coercion so
 * that the serialised string is byte-for-byte identical to the one used at
 * creation time.
 *
 * CCIP-CACHE-HASH-FIX-2026-03-08:
 * Root cause of persistent "DB cache integrity failed" errors:
 *   normalizeThesisForHashing coerced `regimeSignature` with `?? null`, producing
 *   `"regimeSignature":null` in the serialised string.
 *   createImmutableThesis passes the raw value — when it is `undefined`,
 *   stableStringify calls JSON.stringify(undefined) which returns JS `undefined`
 *   (not the string), causing the key to be DROPPED from the serialised object.
 *   The two hash inputs were therefore structurally different for every thesis
 *   whose regimeSignature was undefined, guaranteeing a permanent mismatch.
 *
 * Fix: remove the `?? null` coercion so both creation and validation use the
 * same raw value. stableStringify drops undefined-valued keys in both paths,
 * producing identical serialisation.
 *
 * Mirror the exact field set used in createImmutableThesis:
 *   - symbol, timeframe, directionBias, narrative, regime
 *   - liquidityContext, invalidationLogic, confidenceBand, thesisSummary
 *   - regimeSignature (raw, no coercion — undefined keys are dropped by stableStringify)
 */
export function normalizeThesisForHashing(thesis: AlphaMarketThesis): string {
  const stableThesis = {
    symbol: thesis.symbol,
    timeframe: thesis.timeframe,
    directionBias: thesis.directionBias,
    narrative: thesis.narrative,
    regime: thesis.regime,
    liquidityContext: thesis.liquidityContext,
    invalidationLogic: thesis.invalidationLogic,
    confidenceBand: thesis.confidenceBand,
    thesisSummary: thesis.thesisSummary,
    regimeSignature: thesis.regimeSignature
  };

  return stableStringify(stableThesis);
}

/**
 * Freeze thesis object to prevent mutation
 * Uses Object.freeze() for runtime immutability
 */
export function freezeThesis(thesis: AlphaMarketThesis): Readonly<AlphaMarketThesis> {
  // Deep freeze - freeze nested objects too
  if (thesis.regimeSignature) {
    Object.freeze(thesis.regimeSignature);
  }

  Object.freeze(thesis);

  logger.debug('[ThesisImmutabilityGuard] Thesis frozen', {
    symbol: thesis.symbol,
    thesisHash: thesis.thesisHash,
    fromCache: thesis.fromCache
  });

  return thesis;
}

/**
 * Validate thesis hash integrity
 * Ensures thesis content hasn't been modified since caching
 *
 * NOTE: Hash mismatches from cached data are EXPECTED when regime conditions change.
 * The system automatically regenerates fresh theses on mismatch - this is normal behavior,
 * not an error. We log at WARN level to track frequency without alarming in production.
 *
 * TIER7 FIX: Now uses normalized content for consistent hash comparison
 */
export function validateThesisHash(
  thesis: AlphaMarketThesis,
  currentContent?: string
): boolean {
  // TIER7 FIX: If no content provided, generate normalized content from thesis object
  // This ensures consistent hashing even when regime signature property order changes
  const contentToHash = currentContent || normalizeThesisForHashing(thesis);
  const computedHash = generateThesisHash(contentToHash);

  if (computedHash !== thesis.thesisHash) {
    logger.warn('[ThesisImmutabilityGuard] Thesis hash mismatch - regenerating fresh thesis', {
      symbol: thesis.symbol,
      expectedHash: thesis.thesisHash,
      computedHash,
      fromCache: thesis.fromCache,
      cacheAgeSeconds: thesis.cacheAgeSeconds,
      note: 'This is expected when market regime changes. Fresh thesis will be generated.',
      usedNormalizedContent: !currentContent
    });

    return false;
  }

  logger.debug('[ThesisImmutabilityGuard] Thesis hash valid', {
    symbol: thesis.symbol,
    thesisHash: thesis.thesisHash
  });

  return true;
}

/**
 * Detect thesis mutation (frozen-state violation)
 *
 * CCIP-IMMUTABILITY-FIX: Previously used a runtime write-and-read-back test to detect
 * mutation. That approach has a critical false-negative in non-strict (sloppy) mode:
 * Object.freeze() silently ignores assignments there, so the write silently fails,
 * wasModified stays false, and the function incorrectly reports "no mutation" for every
 * frozen object. The catch block also masked any unrelated exceptions as "freeze working".
 *
 * Correct approach: use Object.isFrozen() directly — returns false if the object was
 * never frozen (mutation is possible) or if freeze was bypassed (e.g. via Proxy).
 * Returns true when the object is properly immutable.
 *
 * Semantics: returns true if a mutation violation is detected (object NOT frozen).
 */
export function detectThesisMutation(thesis: AlphaMarketThesis): boolean {
  const isFrozen = Object.isFrozen(thesis);

  if (!isFrozen) {
    logger.error('[ThesisImmutabilityGuard] SSOT VIOLATION: Thesis is not frozen — mutation possible', {
      symbol: thesis.symbol,
      thesisHash: thesis.thesisHash,
      fromCache: thesis.fromCache
    });
    return true;
  }

  return false;
}

/**
 * Validate thesis contains no execution data
 * Ensures SSOT separation (thesis vs execution)
 */
export function validateNoExecutionData(thesis: AlphaMarketThesis): boolean {
  const violations: string[] = [];

  // Check narrative for price levels
  const narrative = thesis.narrative.toLowerCase();
  const priceLevelPatterns = [
    'entry at',
    'stop loss',
    'take profit',
    'buy at',
    'sell at'
  ];

  for (const pattern of priceLevelPatterns) {
    if (narrative.includes(pattern)) {
      violations.push(`Narrative contains execution term: "${pattern}"`);
    }
  }

  // Check for numeric price patterns (4-5 digit prices with decimals)
  const pricePattern = /\d{1,5}\.\d{2,5}/g;
  const priceMatches = narrative.match(pricePattern);
  if (priceMatches && priceMatches.length > 3) {
    violations.push(`Narrative contains ${priceMatches.length} potential price levels`);
  }

  if (violations.length > 0) {
    logger.warn('[ThesisImmutabilityGuard] Execution data detected in thesis', {
      symbol: thesis.symbol,
      violations
    });

    return false;
  }

  return true;
}

/**
 * Create immutable thesis from parsed content
 * Generates hash, freezes object, validates purity
 */
export function createImmutableThesis(
  thesis: Omit<AlphaMarketThesis, 'thesisHash'>
): Readonly<AlphaMarketThesis> {
  // Generate thesis content hash with stable stringification (SSOT compliance)
  // Using stableStringify ensures consistent hashing regardless of property order
  const thesisContent = stableStringify({
    symbol: thesis.symbol,
    timeframe: thesis.timeframe,
    directionBias: thesis.directionBias,
    narrative: thesis.narrative,
    regime: thesis.regime,
    liquidityContext: thesis.liquidityContext,
    invalidationLogic: thesis.invalidationLogic,
    confidenceBand: thesis.confidenceBand,
    thesisSummary: thesis.thesisSummary,
    regimeSignature: thesis.regimeSignature
  });

  const thesisHash = generateThesisHash(thesisContent);

  const immutableThesis: AlphaMarketThesis = {
    ...thesis,
    thesisHash
  };

  // Validate no execution data
  if (!validateNoExecutionData(immutableThesis)) {
    logger.warn('[ThesisImmutabilityGuard] Thesis contains execution data (soft violation)', {
      symbol: thesis.symbol
    });
  }

  // Freeze and return
  return freezeThesis(immutableThesis);
}

/**
 * Verify cached thesis integrity on retrieval
 * Full integrity check before serving from cache
 *
 * SSOT COMPLIANCE: Uses thesis.regimeSignature directly (already properly structured from DB storage)
 * No reconstruction needed - hash validation against stored representation
 *
 * CCIP-POST-AUDIT-2026-03-03: Delegates freeze check to detectThesisMutation() so that
 * function is the single authority for freeze-state detection + error logging.
 */
export function verifyCachedThesisIntegrity(
  thesis: AlphaMarketThesis
): { valid: boolean; reason?: string } {
  // Delegate to detectThesisMutation — single authority for frozen-state check + logging
  if (detectThesisMutation(thesis)) {
    return {
      valid: false,
      reason: 'Thesis not frozen (SSOT violation)'
    };
  }

  // TIER7 FIX: Use normalized content for consistent hash comparison
  // This prevents false cache invalidations due to property ordering differences
  const normalizedContent = normalizeThesisForHashing(thesis);

  if (!validateThesisHash(thesis, normalizedContent)) {
    return {
      valid: false,
      reason: 'Hash mismatch (thesis modified or regime changed)'
    };
  }

  // Check no execution data
  if (!validateNoExecutionData(thesis)) {
    return {
      valid: false,
      reason: 'Contains execution data (SSOT violation)'
    };
  }

  // Check age against canonical TTL (SSOT: THESIS_TTL_MS from alpha-thesis.ts -> time-constants.ts)
  const MAX_AGE_SECONDS = THESIS_TTL_MS / 1000;
  if (thesis.cacheAgeSeconds > MAX_AGE_SECONDS) {
    return {
      valid: false,
      reason: 'Thesis expired (TTL exceeded)'
    };
  }

  return { valid: true };
}
