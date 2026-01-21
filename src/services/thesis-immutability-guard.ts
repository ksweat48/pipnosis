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

import { AlphaMarketThesis } from '../types/alpha-thesis';
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
 */
export function validateThesisHash(
  thesis: AlphaMarketThesis,
  currentContent: string
): boolean {
  const computedHash = generateThesisHash(currentContent);

  if (computedHash !== thesis.thesisHash) {
    logger.error('[ThesisImmutabilityGuard] SSOT VIOLATION: Thesis hash mismatch', {
      symbol: thesis.symbol,
      expectedHash: thesis.thesisHash,
      computedHash,
      fromCache: thesis.fromCache,
      cacheAgeSeconds: thesis.cacheAgeSeconds
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
 * Detect thesis mutation attempts
 * Checks if thesis object has been modified after freezing
 */
export function detectThesisMutation(thesis: AlphaMarketThesis): boolean {
  try {
    // Attempt to mutate a property
    // If frozen, this will throw in strict mode or fail silently
    const testMutation = () => {
      const mutableThesis = thesis as { narrative: string };
      const originalValue = mutableThesis.narrative;
      mutableThesis.narrative = 'MUTATION_TEST';
      const wasModified = mutableThesis.narrative !== originalValue;
      // Restore original value
      mutableThesis.narrative = originalValue;
      return wasModified;
    };

    const wasMutated = testMutation();

    if (wasMutated) {
      logger.error('[ThesisImmutabilityGuard] SSOT VIOLATION: Thesis mutation detected', {
        symbol: thesis.symbol,
        thesisHash: thesis.thesisHash,
        fromCache: thesis.fromCache
      });

      return true;
    }

    return false;
  } catch (error) {
    // Freeze is working correctly (mutation threw error)
    return false;
  }
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
 */
export function verifyCachedThesisIntegrity(
  thesis: AlphaMarketThesis
): { valid: boolean; reason?: string } {
  // Check if frozen
  if (!Object.isFrozen(thesis)) {
    return {
      valid: false,
      reason: 'Thesis not frozen (SSOT violation)'
    };
  }

  // Check hash integrity with stable stringification (SSOT compliance)
  // CRITICAL: Must use same stringification as createImmutableThesis for consistent hashing
  const thesisContent = stableStringify({
    symbol: thesis.symbol,
    timeframe: thesis.timeframe,
    directionBias: thesis.directionBias,
    narrative: thesis.narrative,
    regime: thesis.regime,
    liquidityContext: thesis.liquidityContext,
    invalidationLogic: thesis.invalidationLogic,
    confidenceBand: thesis.confidenceBand,
    regimeSignature: thesis.regimeSignature
  });

  if (!validateThesisHash(thesis, thesisContent)) {
    return {
      valid: false,
      reason: 'Hash mismatch (thesis modified)'
    };
  }

  // Check no execution data
  if (!validateNoExecutionData(thesis)) {
    return {
      valid: false,
      reason: 'Contains execution data (SSOT violation)'
    };
  }

  // Check age (shouldn't be too old based on TTL)
  const MAX_AGE_SECONDS = 900; // 15 minutes
  if (thesis.cacheAgeSeconds > MAX_AGE_SECONDS) {
    return {
      valid: false,
      reason: 'Thesis expired (TTL exceeded)'
    };
  }

  return { valid: true };
}
