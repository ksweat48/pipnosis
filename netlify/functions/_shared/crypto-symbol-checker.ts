/**
 * Crypto Symbol Checker - SSOT for 24/7 market identification in Netlify Functions
 *
 * Determines whether a symbol trades on a 24/7 schedule (crypto) vs forex hours.
 * Used by server-side monitors to decide which positions to auto-close at market close.
 *
 * Aligned with src/config/symbol-registry.ts (client-side SSOT).
 */

const CRYPTO_SYMBOLS = ['BTCUSD', 'ETHUSD'];

export function isCryptoSymbol(symbol: string): boolean {
  return CRYPTO_SYMBOLS.includes(symbol.toUpperCase());
}

export function is24HourMarket(symbol: string): boolean {
  return isCryptoSymbol(symbol);
}

export { CRYPTO_SYMBOLS };
