/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * 🛡️ SYMBOL TYPE SYSTEM - BULLETPROOF VALIDATION
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module provides type-safe symbol handling with branded types to prevent
 * cross-contamination at compile-time and runtime.
 *
 * CRITICAL RULES:
 * 1. NEVER use raw strings for symbols - always use ValidatedSymbol
 * 2. ALWAYS validate symbols at entry points using validateSymbol()
 * 3. NEVER bypass validation - it's the first line of defense
 * 4. USE symbol-specific types to prevent mixing (e.g., SymbolPrice<T>)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// Branded type - can't be assigned from regular string
export type ValidatedSymbol = string & { readonly __brand: 'ValidatedSymbol' };

// Known trading symbols - exhaustive list
export const KNOWN_SYMBOLS = [
  // Metals
  'XAUUSD',  // Gold
  'XAGUSD',  // Silver
  'XPTUSD',  // Platinum
  'XPDUSD',  // Palladium
  // Indices
  'US30',    // Dow Jones
  'NAS100',  // NASDAQ
  'SPX500',  // S&P 500
  'UK100',   // FTSE 100
  'GER40',   // DAX
  // Major Forex
  'EURUSD',  // Euro/USD
  'GBPUSD',  // Pound/USD
  'USDJPY',  // USD/Yen
  'AUDUSD',  // Aussie/USD
  'USDCAD',  // USD/Canadian
  'NZDUSD',  // Kiwi/USD
  'USDCHF',  // USD/Franc
  // Cross Forex
  'EURGBP',  // Euro/Pound
  'EURJPY',  // Euro/Yen
  'GBPJPY',  // Pound/Yen
  'AUDJPY',  // Aussie/Yen
  'EURAUD',  // Euro/Aussie
  // Crypto (24/7)
  'BTCUSD',  // Bitcoin
  'ETHUSD',  // Ethereum
  // Energy
  'USOIL',   // WTI Crude
  'UKOIL',   // Brent Crude
] as const;

export type KnownSymbol = typeof KNOWN_SYMBOLS[number];

// Primary trading pairs - the core 5
export const PRIMARY_SYMBOLS: readonly KnownSymbol[] = [
  'XAUUSD',
  'US30',
  'EURUSD',
  'GBPUSD',
  'USDJPY',
] as const;

export type PrimarySymbol = typeof PRIMARY_SYMBOLS[number];

// Validation result
export interface SymbolValidationResult {
  isValid: boolean;
  symbol?: ValidatedSymbol;
  error?: string;
  suggestion?: KnownSymbol;
}

// Runtime validation function
export function validateSymbol(input: unknown): SymbolValidationResult {
  // Type guard: must be a string
  if (typeof input !== 'string') {
    return {
      isValid: false,
      error: `Invalid symbol type: expected string, got ${typeof input}`,
    };
  }

  // Empty or whitespace
  if (!input || input.trim().length === 0) {
    return {
      isValid: false,
      error: 'Symbol cannot be empty',
    };
  }

  // Normalize to uppercase
  const normalized = input.trim().toUpperCase();

  // Check against known symbols
  if (!KNOWN_SYMBOLS.includes(normalized as KnownSymbol)) {
    // Try to find a similar symbol (typo detection)
    const suggestion = KNOWN_SYMBOLS.find(known =>
      known.toLowerCase().includes(normalized.toLowerCase()) ||
      normalized.toLowerCase().includes(known.toLowerCase())
    );

    return {
      isValid: false,
      error: `Unknown symbol: ${input}`,
      suggestion,
    };
  }

  // Valid - return branded type
  return {
    isValid: true,
    symbol: normalized as ValidatedSymbol,
  };
}

// Type guard
export function isValidatedSymbol(value: unknown): value is ValidatedSymbol {
  const result = validateSymbol(value);
  return result.isValid;
}

// Assertion function - throws on invalid
export function assertValidSymbol(input: unknown): asserts input is ValidatedSymbol {
  const result = validateSymbol(input);
  if (!result.isValid) {
    throw new Error(`Symbol validation failed: ${result.error}${result.suggestion ? ` (Did you mean ${result.suggestion}?)` : ''}`);
  }
}

// Safe symbol creator - validates and returns branded type
export function createValidatedSymbol(input: string): ValidatedSymbol {
  const result = validateSymbol(input);
  if (!result.isValid || !result.symbol) {
    throw new Error(`Cannot create validated symbol: ${result.error}`);
  }
  return result.symbol;
}

// Symbol-tagged data type - prevents mixing symbols
export interface SymbolTagged<S extends ValidatedSymbol, T> {
  readonly symbol: S;
  readonly data: T;
  readonly timestamp: number;
  readonly __symbolTag: S; // Phantom type for type safety
}

// Create symbol-tagged data
export function tagWithSymbol<S extends ValidatedSymbol, T>(
  symbol: S,
  data: T
): SymbolTagged<S, T> {
  return {
    symbol,
    data,
    timestamp: Date.now(),
    __symbolTag: symbol,
  };
}

// Extract data from tagged structure (validates symbol matches)
export function extractSymbolData<S extends ValidatedSymbol, T>(
  tagged: SymbolTagged<S, T>,
  expectedSymbol: S
): T {
  if (tagged.symbol !== expectedSymbol) {
    throw new Error(
      `Symbol mismatch: expected ${expectedSymbol}, got ${tagged.symbol}`
    );
  }
  return tagged.data;
}

// Check if symbol is primary trading pair
export function isPrimarySymbol(symbol: ValidatedSymbol): symbol is PrimarySymbol {
  return PRIMARY_SYMBOLS.includes(symbol as PrimarySymbol);
}

// Get symbol category
export type SymbolCategory = 'forex' | 'metal' | 'index' | 'crypto' | 'energy';

export function getSymbolCategory(symbol: ValidatedSymbol): SymbolCategory {
  if (symbol.startsWith('X') && symbol.endsWith('USD')) return 'metal';
  if (['US30', 'NAS100', 'SPX500', 'UK100', 'GER40'].includes(symbol)) return 'index';
  if (['BTCUSD', 'ETHUSD'].includes(symbol)) return 'crypto';
  if (symbol.includes('OIL')) return 'energy';
  if (symbol.includes('USD') || symbol.includes('JPY') || symbol.includes('GBP') || symbol.includes('EUR') || symbol.includes('CHF') || symbol.includes('AUD') || symbol.includes('NZD') || symbol.includes('CAD')) return 'forex';
  return 'forex';
}

/**
 * @deprecated DO NOT USE - Query via assetClassifier.isCrypto() or assetClassifier.getSymbolsByCategory('crypto')
 * This constant violates SSOT principles. Use the symbol-registry as the single source of truth.
 * Hardcoded arrays lead to bugs when adding new symbols.
 */
export const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'] as const;
export type CryptoSymbol = typeof CRYPTO_SYMBOLS[number];

/**
 * @deprecated Use assetClassifier.isCrypto(symbol) instead
 * This function hardcodes crypto symbols instead of querying the registry.
 */
export function isCryptoSymbol(symbol: string): boolean {
  console.warn('[DEPRECATED] isCryptoSymbol() is deprecated - use assetClassifier.isCrypto() instead');
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase() as CryptoSymbol);
}

/**
 * @deprecated Use assetClassifier.is24HourMarket(symbol) instead
 * This function hardcodes 24/7 symbols instead of querying the registry.
 */
export function is24HourSymbol(symbol: string): boolean {
  console.warn('[DEPRECATED] is24HourSymbol() is deprecated - use assetClassifier.is24HourMarket() instead');
  return isCryptoSymbol(symbol);
}

// Symbol equality check (type-safe)
export function symbolsEqual(a: ValidatedSymbol, b: ValidatedSymbol): boolean {
  return a === b;
}

// Symbol set operations
export class SymbolSet {
  private symbols: Set<ValidatedSymbol>;

  constructor(symbols: ValidatedSymbol[] = []) {
    this.symbols = new Set(symbols);
  }

  add(symbol: ValidatedSymbol): void {
    this.symbols.add(symbol);
  }

  has(symbol: ValidatedSymbol): boolean {
    return this.symbols.has(symbol);
  }

  remove(symbol: ValidatedSymbol): void {
    this.symbols.delete(symbol);
  }

  toArray(): ValidatedSymbol[] {
    return Array.from(this.symbols);
  }

  size(): number {
    return this.symbols.size;
  }

  clear(): void {
    this.symbols.clear();
  }
}
