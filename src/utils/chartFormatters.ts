/**
 * Chart formatting utilities for prices and spreads
 */

/**
 * Format prices based on symbol type and screen size
 */
export function formatPrice(price: number, symbol: string, isMobile: boolean = false): string {
  const isCrypto = ['BTCUSD', 'ETHUSD'].includes(symbol);
  const isGold = symbol === 'XAUUSD';

  if (isMobile) {
    // Mobile: Use compact formatting
    if (isCrypto) {
      // BTC/ETH: Show 2 decimals with K suffix if over 1000
      if (price >= 10000) {
        return `${(price / 1000).toFixed(2)}K`;
      }
      return price.toFixed(2);
    } else if (isGold) {
      // Gold: Show 2 decimals
      return price.toFixed(2);
    } else {
      // Forex: Show 4-5 decimals with comma separators
      return price.toLocaleString('en-US', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 5
      });
    }
  } else {
    // Desktop: Use full precision
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
