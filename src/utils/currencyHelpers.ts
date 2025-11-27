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
  contractSize: number;
  dollarPerPipPerLot: number;
  symbolType: 'forex' | 'metal' | 'index' | 'crypto';
}

/**
 * Check if a symbol is a JPY pair
 */
export function isJPYPair(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.includes('JPY');
}

/**
 * Check if a symbol is XAUUSD (Gold)
 */
export function isXAUUSD(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.includes('XAU') || normalized === 'GOLD';
}

/**
 * Check if a symbol is an index (US30, NAS100, SPX500, etc.)
 */
export function isIndex(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.includes('US30') ||
         normalized.includes('NAS') ||
         normalized.includes('SPX') ||
         normalized.includes('DJI') ||
         normalized.includes('DAX') ||
         normalized.includes('FTSE');
}

/**
 * Check if symbol is a crypto pair
 */
export function isCrypto(symbol: string): boolean {
  const normalized = symbol.toUpperCase();
  return normalized.includes('BTC') ||
         normalized.includes('ETH') ||
         normalized.includes('USDT');
}

/**
 * Get pip information for a currency pair, metal, index, or crypto
 */
export function getCurrencyPipInfo(symbol: string): CurrencyPipInfo {
  const normalized = symbol.toUpperCase();

  // XAUUSD (Gold) - Most critical for proper calculation
  if (isXAUUSD(symbol)) {
    return {
      pipValue: 0.01,           // 1 pip = $0.01 movement
      pipMultiplier: 1,
      decimalPlaces: 2,
      contractSize: 100,        // 100 troy ounces per lot
      dollarPerPipPerLot: 1.0,  // $1 per pip per 0.01 lot ($100 per full lot)
      symbolType: 'metal'
    };
  }

  // Indices (US30, NAS100, SPX500, etc.)
  if (isIndex(symbol)) {
    return {
      pipValue: 1.0,            // 1 point = 1.0
      pipMultiplier: 1,
      decimalPlaces: 2,
      contractSize: 1,          // 1 contract
      dollarPerPipPerLot: 1.0,  // Varies by broker, typically $1-10 per point
      symbolType: 'index'
    };
  }

  // Crypto pairs (BTC, ETH, etc.)
  if (isCrypto(symbol)) {
    return {
      pipValue: 1.0,
      pipMultiplier: 1,
      decimalPlaces: 2,
      contractSize: 1,
      dollarPerPipPerLot: 1.0,
      symbolType: 'crypto'
    };
  }

  // JPY pairs (USDJPY, EURJPY, etc.)
  if (isJPYPair(symbol)) {
    return {
      pipValue: 0.01,           // JPY pairs use 0.01 as pip
      pipMultiplier: 100,
      decimalPlaces: 2,
      contractSize: 100000,     // Standard lot = 100,000 units
      dollarPerPipPerLot: 10,   // $10 per pip per 0.1 lot
      symbolType: 'forex'
    };
  }

  // Standard forex pairs (EURUSD, GBPUSD, etc.)
  return {
    pipValue: 0.0001,           // Standard pairs use 0.0001 as pip
    pipMultiplier: 1,
    decimalPlaces: 5,           // Most brokers use 5 decimals now
    contractSize: 100000,       // Standard lot = 100,000 units
    dollarPerPipPerLot: 10,     // $10 per pip per 0.1 lot
    symbolType: 'forex'
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
 * This is the CRITICAL function for risk calculation
 *
 * IMPORTANT: position size is in LOTS (0.01, 0.1, 1.0, etc.)
 */
export function calculateDollarPerPip(
  symbol: string,
  positionSize: number
): number {
  if (isXAUUSD(symbol)) {
    // XAUUSD: 0.01 lot = $1/pip, 1.0 lot = $100/pip
    return positionSize * 100;
  }

  if (isIndex(symbol)) {
    // Indices: 0.01 lot = $1/point, 1.0 lot = $100/point (typical)
    return positionSize * 100;
  }

  // Standard Forex: 0.01 lot = $0.10/pip, 0.1 lot = $1/pip, 1.0 lot = $10/pip
  return positionSize * 10;
}

/**
 * Calculate position size based on risk amount and stop loss distance
 * THIS IS THE CORRECT FORMULA - USE THIS EVERYWHERE
 *
 * Formula: Position Size = Risk Amount / (Stop Distance in Pips × Dollar Per Pip at 0.01 lot)
 */
export function calculatePositionSize(
  symbol: string,
  accountBalance: number,
  riskPercentage: number,
  entryPrice: number,
  stopLoss: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);
  const riskAmount = accountBalance * (riskPercentage / 100);

  // Calculate stop distance in pips
  const stopDistancePips = calculatePipDistance(symbol, entryPrice, stopLoss);

  if (stopDistancePips <= 0) {
    console.error(`[Position Sizing] Invalid stop distance: ${stopDistancePips} pips`);
    return 0.01; // Minimum position
  }

  // Calculate position size using correct formulas
  let positionSize: number;

  if (isXAUUSD(symbol)) {
    // XAUUSD: 0.01 lot = $1/pip
    // Formula: Risk / (Pips × $100 per full lot) = lot size
    positionSize = riskAmount / (stopDistancePips * 100);
  } else if (isIndex(symbol)) {
    // Indices: 0.01 lot = $1/point
    positionSize = riskAmount / (stopDistancePips * 100);
  } else {
    // Forex: 0.01 lot = $0.10/pip, full lot = $10/pip
    // Formula: Risk / (Pips × $10 per full lot) = lot size
    positionSize = riskAmount / (stopDistancePips * 10);
  }

  // Clamp to reasonable ranges
  const minSize = 0.01;
  const maxSize = pipInfo.symbolType === 'metal' ? 10.0 :
                  pipInfo.symbolType === 'index' ? 1.0 :
                  5.0; // forex

  positionSize = Math.max(minSize, Math.min(maxSize, positionSize));

  // Log calculation for verification
  console.log(`[Position Sizing] ${symbol}:`);
  console.log(`  Account: $${accountBalance.toFixed(2)}`);
  console.log(`  Risk: ${riskPercentage}% = $${riskAmount.toFixed(2)}`);
  console.log(`  Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
  console.log(`  Dollar/Pip/Lot: $${pipInfo.dollarPerPipPerLot.toFixed(2)}`);
  console.log(`  Position Size: ${positionSize.toFixed(3)} lots`);
  console.log(`  Actual Risk: $${(stopDistancePips * calculateDollarPerPip(symbol, positionSize)).toFixed(2)}`);

  return positionSize;
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
