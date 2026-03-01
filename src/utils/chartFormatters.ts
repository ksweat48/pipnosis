/**
 * Chart formatting utilities for prices and spreads
 *
 * GOVERNANCE: Mobile price display standard = 2 decimal places for ALL symbols.
 * Desktop retains full symbol-specific precision.
 * This is the SSOT for chart-layer price string formatting.
 */

/**
 * Format prices based on symbol type and screen size.
 * Mobile standard (CCIP enforced): 2 decimal places for every symbol type.
 */
export function formatPrice(price: number, symbol: string, isMobile: boolean = false): string {
  const isCrypto = ['BTCUSD', 'ETHUSD'].includes(symbol);
  const isGold = symbol === 'XAUUSD';

  if (isMobile) {
    // MOBILE STANDARD: 2 decimal places for ALL symbol types — no exceptions.
    return price.toFixed(2);
  } else {
    // Desktop: Use full symbol-specific precision
    if (isCrypto) {
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    } else if (isGold) {
      return price.toFixed(2);
    } else {
      return price.toFixed(5);
    }
  }
}

/**
 * Format spread based on symbol type and screen size
 */
export function formatSpread(spread: number, symbol: string, isMobile: boolean = false): string {
  const isCrypto = ['BTCUSD', 'ETHUSD'].includes(symbol);

  if (isMobile && isCrypto && spread >= 10) {
    return spread.toFixed(1);
  }
  return spread.toFixed(isCrypto ? 2 : 5);
}
