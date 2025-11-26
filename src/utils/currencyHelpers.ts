/**
 * Currency Helpers
 *
 * Utility functions for handling currency-specific calculations
 * Particularly important for JPY pairs which use different pip values
 */

export interface CurrencyPipInfo {
  pipValue: number;
  pipMultiplier: number;
  decimalPlaces: number;
}

/**
 * Check if a symbol is a JPY pair
 */
export function isJPYPair(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.includes('JPY');
}

/**
 * Get pip information for a currency pair
 */
export function getCurrencyPipInfo(symbol: string): CurrencyPipInfo {
  if (isJPYPair(symbol)) {
    return {
      pipValue: 0.01,        // JPY pairs use 0.01 as pip
      pipMultiplier: 100,     // 100x multiplier for position sizing
      decimalPlaces: 2        // JPY quotes to 2 decimals
    };
  }

  return {
    pipValue: 0.0001,       // Standard pairs use 0.0001 as pip
    pipMultiplier: 1,        // No multiplier needed
    decimalPlaces: 4         // Standard pairs quote to 4 decimals
  };
}

/**
 * Calculate position size adjusted for currency type
 */
export function calculateAdjustedPositionSize(
  symbol: string,
  basePositionSize: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);
  return basePositionSize / pipInfo.pipMultiplier;
}

/**
 * Calculate pip distance between two prices
 */
export function calculatePipDistance(
  symbol: string,
  price1: number,
  price2: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);
  return Math.abs(price1 - price2) / pipInfo.pipValue;
}

/**
 * Format price to correct decimal places for currency
 */
export function formatCurrencyPrice(
  symbol: string,
  price: number
): string {
  const pipInfo = getCurrencyPipInfo(symbol);
  return price.toFixed(pipInfo.decimalPlaces);
}

/**
 * Calculate dollar value per pip for a position
 */
export function calculateDollarPerPip(
  symbol: string,
  positionSize: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);

  // Standard calculation: position size * pip value
  // For JPY pairs, this is automatically adjusted by pip value
  return positionSize * pipInfo.pipValue * 100000; // Assuming standard lot = 100,000 units
}

/**
 * Adjust stop loss/take profit for currency type
 */
export function adjustSLTPForCurrency(
  symbol: string,
  entryPrice: number,
  slDistance: number,
  tpDistance: number,
  direction: 'buy' | 'sell'
): { stopLoss: number; takeProfit: number } {
  const pipInfo = getCurrencyPipInfo(symbol);

  const slPriceDistance = slDistance * pipInfo.pipValue;
  const tpPriceDistance = tpDistance * pipInfo.pipValue;

  if (direction === 'buy') {
    return {
      stopLoss: entryPrice - slPriceDistance,
      takeProfit: entryPrice + tpPriceDistance
    };
  } else {
    return {
      stopLoss: entryPrice + slPriceDistance,
      takeProfit: entryPrice - tpPriceDistance
    };
  }
}

/**
 * Validate if SL/TP are reasonable distances for currency type
 */
export function validateSLTPDistances(
  symbol: string,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number
): { isValid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  const slPips = calculatePipDistance(symbol, entryPrice, stopLoss);
  const tpPips = calculatePipDistance(symbol, entryPrice, takeProfit);

  // Minimum distances
  const minPips = isJPYPair(symbol) ? 10 : 5;
  const maxPips = isJPYPair(symbol) ? 500 : 200;

  if (slPips < minPips) {
    warnings.push(`Stop loss too tight: ${slPips.toFixed(1)} pips (minimum ${minPips})`);
  }

  if (slPips > maxPips) {
    warnings.push(`Stop loss too wide: ${slPips.toFixed(1)} pips (maximum ${maxPips})`);
  }

  if (tpPips < minPips) {
    warnings.push(`Take profit too tight: ${tpPips.toFixed(1)} pips (minimum ${minPips})`);
  }

  if (tpPips > maxPips * 2) {
    warnings.push(`Take profit unrealistic: ${tpPips.toFixed(1)} pips (maximum ${maxPips * 2})`);
  }

  return {
    isValid: warnings.length === 0,
    warnings
  };
}

/**
 * Get standard lot size for currency pair
 */
export function getStandardLotSize(symbol: string): number {
  // Most pairs use 100,000 as standard lot
  // Some exotic pairs may differ, but not relevant for major pairs
  return 100000;
}
