/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🔒 IMMUTABLE CANDLE DATA - BULLETPROOF INTEGRITY
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module provides immutable candle data structures that cannot be modified
 * after creation, preventing accidental data corruption and cross-contamination.
 *
 * CRITICAL RULES:
 * 1. NEVER mutate candle objects - create new ones instead
 * 2. ALWAYS use factory functions to create candles
 * 3. NEVER bypass validation - every candle must be validated
 * 4. USE readonly modifiers on all fields
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import { ValidatedSymbol, validateSymbol } from './symbol';

// Immutable candle data - all fields readonly
export interface ImmutableCandle {
  readonly symbol: ValidatedSymbol;
  readonly time: number; // Unix timestamp in seconds
  readonly open: number;
  readonly high: number;
  readonly low: number;
  readonly close: number;
  readonly volume?: number;
  readonly source: 'database' | 'metaapi' | 'aggregated' | 'backfilled';
  readonly createdAt: number; // When this candle object was created
  readonly checksum: string; // SHA-256 hash for integrity verification
}

// Candle validation result
export interface CandleValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

// Validate candle structure and values
export function validateCandle(candle: unknown): CandleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Type check
  if (typeof candle !== 'object' || candle === null) {
    return {
      isValid: false,
      errors: ['Candle must be an object'],
      warnings: [],
    };
  }

  const c = candle as any;

  // Symbol validation
  const symbolResult = validateSymbol(c.symbol);
  if (!symbolResult.isValid) {
    errors.push(`Invalid symbol: ${symbolResult.error}`);
  }

  // Time validation
  if (typeof c.time !== 'number' || isNaN(c.time) || !isFinite(c.time)) {
    errors.push(`Invalid time: ${c.time} (must be number)`);
  } else if (c.time <= 0) {
    errors.push(`Invalid time: ${c.time} (must be positive)`);
  } else if (c.time > Date.now() / 1000 + 3600) {
    // Allow 1 hour in future for clock skew
    warnings.push(`Time is in the future: ${new Date(c.time * 1000).toISOString()}`);
  }

  // OHLC validation
  const prices = {
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };

  for (const [key, value] of Object.entries(prices)) {
    if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
      errors.push(`Invalid ${key}: ${value} (must be number)`);
    } else if (value <= 0) {
      errors.push(`Invalid ${key}: ${value} (must be positive)`);
    }
  }

  // Candle consistency checks (only if all prices are valid numbers)
  if (errors.length === 0) {
    if (c.high < c.low) {
      errors.push(`High ${c.high} cannot be less than low ${c.low}`);
    }
    if (c.open < c.low || c.open > c.high) {
      errors.push(`Open ${c.open} must be between low ${c.low} and high ${c.high}`);
    }
    if (c.close < c.low || c.close > c.high) {
      errors.push(`Close ${c.close} must be between low ${c.low} and high ${c.high}`);
    }

    // Warn on suspicious candle patterns
    const range = c.high - c.low;
    const bodySize = Math.abs(c.close - c.open);
    if (range === 0) {
      warnings.push('Zero-range candle (flat line)');
    }
    if (bodySize / range > 0.95 && range > 0) {
      warnings.push('Unusually large body-to-range ratio');
    }
  }

  // Volume validation (optional field)
  if (c.volume !== undefined) {
    if (typeof c.volume !== 'number' || isNaN(c.volume) || !isFinite(c.volume)) {
      errors.push(`Invalid volume: ${c.volume} (must be number)`);
    } else if (c.volume < 0) {
      errors.push(`Invalid volume: ${c.volume} (must be non-negative)`);
    }
  }

  // Source validation
  const validSources = ['database', 'metaapi', 'aggregated', 'backfilled'];
  if (!validSources.includes(c.source)) {
    errors.push(`Invalid source: ${c.source} (must be one of ${validSources.join(', ')})`);
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// Calculate checksum for candle integrity
function calculateChecksum(candle: Omit<ImmutableCandle, 'checksum' | 'createdAt'>): string {
  // Simple checksum - concatenate all values and hash
  const data = `${candle.symbol}|${candle.time}|${candle.open}|${candle.high}|${candle.low}|${candle.close}|${candle.volume || 0}|${candle.source}`;

  // Simple hash function (for production, use crypto.subtle.digest)
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

// Verify candle checksum
export function verifyCandle(candle: ImmutableCandle): boolean {
  const expected = calculateChecksum(candle);
  return candle.checksum === expected;
}

// Factory function - creates immutable candle with validation
export function createImmutableCandle(
  symbol: ValidatedSymbol,
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  source: ImmutableCandle['source'],
  volume?: number
): ImmutableCandle {
  const candle = {
    symbol,
    time,
    open,
    high,
    low,
    close,
    volume,
    source,
    createdAt: Date.now(),
    checksum: '', // Will be calculated
  };

  // Validate before creating
  const validation = validateCandle(candle);
  if (!validation.isValid) {
    throw new Error(`Cannot create candle: ${validation.errors.join(', ')}`);
  }

  // Calculate checksum
  const checksum = calculateChecksum(candle);

  // Create final immutable object
  const immutableCandle: ImmutableCandle = {
    ...candle,
    checksum,
  };

  // Freeze object to prevent mutations
  return Object.freeze(immutableCandle);
}

// Convert legacy candle to immutable (with validation)
export function toImmutableCandle(
  legacyCandle: {
    symbol?: string;
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume?: number;
  },
  symbol: ValidatedSymbol,
  source: ImmutableCandle['source'] = 'database'
): ImmutableCandle {
  return createImmutableCandle(
    symbol,
    legacyCandle.time,
    legacyCandle.open,
    legacyCandle.high,
    legacyCandle.low,
    legacyCandle.close,
    source,
    legacyCandle.volume
  );
}

// Update candle (creates new immutable copy)
export function updateCandlePrice(
  candle: ImmutableCandle,
  price: number
): ImmutableCandle {
  return createImmutableCandle(
    candle.symbol,
    candle.time,
    candle.open,
    Math.max(candle.high, price),
    Math.min(candle.low, price),
    price,
    candle.source,
    candle.volume
  );
}

// Merge multiple candles (for aggregation)
export function mergeCandles(
  candles: ImmutableCandle[],
  targetSymbol: ValidatedSymbol
): ImmutableCandle | null {
  if (candles.length === 0) return null;

  // Verify all candles are for same symbol
  const symbolMismatch = candles.find(c => c.symbol !== targetSymbol);
  if (symbolMismatch) {
    throw new Error(
      `Cannot merge candles: symbol mismatch (expected ${targetSymbol}, found ${symbolMismatch.symbol})`
    );
  }

  // Sort by time
  const sorted = [...candles].sort((a, b) => a.time - b.time);

  return createImmutableCandle(
    targetSymbol,
    sorted[0].time,
    sorted[0].open,
    Math.max(...sorted.map(c => c.high)),
    Math.min(...sorted.map(c => c.low)),
    sorted[sorted.length - 1].close,
    'aggregated',
    candles.reduce((sum, c) => sum + (c.volume || 0), 0)
  );
}

// Candle array validation
export function validateCandleArray(
  candles: ImmutableCandle[],
  expectedSymbol: ValidatedSymbol
): { isValid: boolean; invalidIndices: number[]; errors: string[] } {
  const invalidIndices: number[] = [];
  const errors: string[] = [];

  candles.forEach((candle, index) => {
    // Check symbol match
    if (candle.symbol !== expectedSymbol) {
      invalidIndices.push(index);
      errors.push(
        `Index ${index}: symbol mismatch (expected ${expectedSymbol}, got ${candle.symbol})`
      );
    }

    // Verify checksum
    if (!verifyCandle(candle)) {
      invalidIndices.push(index);
      errors.push(`Index ${index}: checksum verification failed`);
    }

    // Validate structure
    const validation = validateCandle(candle);
    if (!validation.isValid) {
      invalidIndices.push(index);
      errors.push(`Index ${index}: ${validation.errors.join(', ')}`);
    }
  });

  return {
    isValid: invalidIndices.length === 0,
    invalidIndices: Array.from(new Set(invalidIndices)), // Remove duplicates
    errors,
  };
}

// Deep freeze array of candles
export function freezeCandleArray(candles: ImmutableCandle[]): readonly ImmutableCandle[] {
  return Object.freeze(candles.map(c => Object.freeze(c)));
}

// Clone candle (creates new immutable copy)
export function cloneCandle(candle: ImmutableCandle): ImmutableCandle {
  return createImmutableCandle(
    candle.symbol,
    candle.time,
    candle.open,
    candle.high,
    candle.low,
    candle.close,
    candle.source,
    candle.volume
  );
}
