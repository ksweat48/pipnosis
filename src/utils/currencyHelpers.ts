/**
 * Currency Helpers
 *
 * Utility functions for handling currency-specific calculations
 * Particularly important for JPY pairs which use different pip values
 */

import { getRiskPercentage } from '../config/risk-levels';
import { getRiskStrategyProfile } from '../config/risk-strategy-profiles';

export interface CurrencyPipInfo {
  pipValue: number;
  pipMultiplier: number;
  decimalPlaces: number;
  contractSize: number;
  dollarPerPipPerLot: number;
  symbolType: 'forex' | 'metal' | 'index' | 'crypto';
}

/**
 * Safely normalize symbol to uppercase, handling undefined/null
 */
function safeNormalizeSymbol(symbol: string | undefined | null): string {
  if (!symbol || typeof symbol !== 'string') {
    console.warn('[Currency Helpers] Invalid symbol provided:', symbol);
    return '';
  }
  return symbol.toUpperCase();
}

/**
 * Check if a symbol is a JPY pair
 */
export function isJPYPair(symbol: string): boolean {
  const normalized = safeNormalizeSymbol(symbol);
  return normalized.includes('JPY');
}

/**
 * Check if a symbol is XAUUSD (Gold)
 */
export function isXAUUSD(symbol: string): boolean {
  const normalized = safeNormalizeSymbol(symbol);
  return normalized.includes('XAU') || normalized === 'GOLD';
}

/**
 * Check if a symbol is an index (US30, NAS100, SPX500, etc.)
 */
export function isIndex(symbol: string): boolean {
  const normalized = safeNormalizeSymbol(symbol);
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
  const normalized = safeNormalizeSymbol(symbol);
  return normalized === 'BTCUSD' ||
         normalized === 'ETHUSD' ||
         normalized.includes('BTC') ||
         normalized.includes('ETH');
}

/**
 * Get pip information for a currency pair, metal, index, or crypto
 */
export function getCurrencyPipInfo(symbol: string): CurrencyPipInfo {
  const normalized = safeNormalizeSymbol(symbol);

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

  // Crypto pairs (BTC, ETH, SOL, BNB)
  if (isCrypto(symbol)) {
    if (normalized === 'BTCUSD' || normalized.includes('BTC')) {
      return {
        pipValue: 1.0,
        pipMultiplier: 1,
        decimalPlaces: 2,
        contractSize: 1,
        dollarPerPipPerLot: 1.0,
        symbolType: 'crypto'
      };
    }
    if (normalized === 'ETHUSD' || normalized.includes('ETH')) {
      return {
        pipValue: 0.1,
        pipMultiplier: 1,
        decimalPlaces: 2,
        contractSize: 1,
        dollarPerPipPerLot: 0.1,
        symbolType: 'crypto'
      };
    }
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
 * Round lot size to broker standard precision (0.01 lots)
 * Prevents ugly repeating decimals like 0.666666...
 */
export function roundLotSize(lotSize: number): number {
  return Math.round(lotSize * 100) / 100;
}

/**
 * Round PnL to cents (2 decimal places)
 * Prevents floating point precision issues in currency display
 */
export function roundPnL(pnl: number): number {
  return Math.round(pnl * 100) / 100;
}

/**
 * Format lot size for display (always 2 decimals)
 * Example: 0.01, 0.15, 1.00
 */
export function formatLotSize(lotSize: number): string {
  return roundLotSize(lotSize).toFixed(2);
}

/**
 * Format PnL for display (always 2 decimals with $ sign)
 * Example: $10.00, -$5.50, $125.75
 */
export function formatPnL(pnl: number): string {
  const rounded = roundPnL(pnl);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}$${rounded.toFixed(2)}`;
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
    return positionSize * 100;
  }

  if (isIndex(symbol)) {
    return positionSize * 100;
  }

  if (isCrypto(symbol)) {
    const pipInfo = getCurrencyPipInfo(symbol);
    return positionSize * pipInfo.dollarPerPipPerLot;
  }

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
    positionSize = riskAmount / (stopDistancePips * 100);
  } else if (isIndex(symbol)) {
    positionSize = riskAmount / (stopDistancePips * 100);
  } else if (isCrypto(symbol)) {
    const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;
    positionSize = riskAmount / (stopDistancePips * dollarPerPipPerLot);
  } else {
    positionSize = riskAmount / (stopDistancePips * 10);
  }

  // Clamp to reasonable ranges
  const minSize = 0.01;
  const maxSize = pipInfo.symbolType === 'metal' ? 10.0 :
                  pipInfo.symbolType === 'index' ? 1.0 :
                  pipInfo.symbolType === 'crypto' ? 10.0 :
                  5.0;

  positionSize = Math.max(minSize, Math.min(maxSize, positionSize));

  // Round to broker standard precision (0.01 lots)
  positionSize = roundLotSize(positionSize);

  // Log calculation for verification
  console.log(`[Position Sizing] ${symbol}:`);
  console.log(`  Account: $${accountBalance.toFixed(2)}`);
  console.log(`  Risk: ${riskPercentage}% = $${riskAmount.toFixed(2)}`);
  console.log(`  Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
  console.log(`  Dollar/Pip/Lot: $${pipInfo.dollarPerPipPerLot.toFixed(2)}`);
  console.log(`  Position Size: ${formatLotSize(positionSize)} lots`);
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

/**
 * Calculate position size with LLM autonomy + user exposure cap
 *
 * The LLM determines desired risk based on:
 * - Rank (Bronze, Silver, Gold, Alpha, Omega)
 * - Win/loss streak
 * - Conviction level
 * - Pattern confidence
 *
 * User's exposure_level only sets a MAXIMUM cap, not the actual risk taken.
 *
 * @param symbol Currency pair
 * @param accountBalance Account balance
 * @param userExposureLevel User's max exposure ('conservative' | 'moderate' | 'aggressive')
 * @param llmConviction LLM's conviction (0-100)
 * @param llmRank LLM's current rank ('bronze' | 'silver' | 'gold' | 'alpha' | 'omega')
 * @param entryPrice Entry price
 * @param stopLoss Stop loss price
 * @returns Position size in lots
 */
export function calculateAutonomousPositionSize(
  symbol: string,
  accountBalance: number,
  userExposureLevel: 'conservative' | 'moderate' | 'aggressive',
  llmConviction: number,
  llmRank: 'bronze' | 'silver' | 'gold' | 'alpha' | 'omega',
  entryPrice: number,
  stopLoss: number
): number {
  // User's maximum risk cap (financial protection only)
  const exposureCaps = {
    conservative: 0.01,  // Max 1% per trade
    moderate: 0.02,      // Max 2% per trade
    aggressive: 0.05     // Max 5% per trade
  };
  const maxRiskPercent = exposureCaps[userExposureLevel] * 100;

  // LLM's desired risk based on internal state
  const rankMultipliers = {
    bronze: 0.4,   // Cautious 40% of range
    silver: 0.6,   // Building 60% of range
    gold: 0.8,     // Confident 80% of range
    alpha: 0.95,   // Very confident 95% of range
    omega: 1.0     // Maximum confidence 100% of range
  };

  const rankMultiplier = rankMultipliers[llmRank.toLowerCase() as keyof typeof rankMultipliers] || 0.6;

  // Conviction scaling (70-100% conviction = 0.7-1.0 scaling)
  const convictionMultiplier = Math.max(0.5, Math.min(1.0, llmConviction / 100));

  // LLM's desired risk percentage
  const llmDesiredRiskPercent = maxRiskPercent * rankMultiplier * convictionMultiplier;

  // Actual risk is MINIMUM of LLM desire and user cap
  const actualRiskPercent = Math.min(llmDesiredRiskPercent, maxRiskPercent);

  console.log(`[Autonomous Position Sizing] ${symbol}:`);
  console.log(`  User Exposure Cap: ${maxRiskPercent}%`);
  console.log(`  LLM Rank: ${llmRank} (${rankMultiplier * 100}% of range)`);
  console.log(`  LLM Conviction: ${llmConviction}%`);
  console.log(`  LLM Desired Risk: ${llmDesiredRiskPercent.toFixed(2)}%`);
  console.log(`  Actual Risk: ${actualRiskPercent.toFixed(2)}%`);

  // Use standard position sizing with calculated risk (already rounded in calculatePositionSize)
  return calculatePositionSize(symbol, accountBalance, actualRiskPercent, entryPrice, stopLoss);
}

/**
 * Calculate optimal position size and TP for achieving a goal in ONE trade
 *
 * CRITICAL: This is the REVERSE CALCULATION - work backward from goal
 *
 * Strategy:
 * 1. Calculate remaining goal amount
 * 2. Find optimal lot size that reaches goal with realistic pip target
 * 3. Balance between goal achievement and market feasibility
 *
 * @param symbol Currency pair
 * @param direction Trade direction
 * @param accountBalance Current account balance
 * @param entryPrice Entry price
 * @param stopLoss Stop loss price
 * @param currentProgress Current P&L toward goal
 * @param targetGoal Total goal amount
 * @param riskMode Risk tolerance
 * @returns Optimal position size, TP, and reasoning
 */
export function calculateGoalOptimalPosition(
  symbol: string,
  direction: 'buy' | 'sell',
  accountBalance: number,
  entryPrice: number,
  stopLoss: number,
  currentProgress: number,
  targetGoal: number,
  riskMode: 'low' | 'medium' | 'high' = 'medium'
): {
  lotSize: number;
  takeProfit: number;
  pipsNeeded: number;
  reasoning: string;
  goalFeasibility: 'single_trade' | 'multiple_trades' | 'unrealistic';
} {
  const pipInfo = getCurrencyPipInfo(symbol);
  const remainingGoal = targetGoal - currentProgress;

  // Get risk profile for strategy-aware pip targets
  const riskProfile = getRiskStrategyProfile(riskMode);

  console.log(`[Goal Optimal Position] ${symbol}:`);
  console.log(`  Balance: $${accountBalance.toFixed(2)}`);
  console.log(`  Goal Target: $${targetGoal.toFixed(2)}`);
  console.log(`  Current Progress: $${currentProgress.toFixed(2)}`);
  console.log(`  Remaining: $${remainingGoal.toFixed(2)}`);
  console.log(`  Risk Mode: ${riskMode.toUpperCase()} (${riskProfile.tradingStyle})`);

  // Typical pip ranges by asset type AND risk mode strategy
  const typicalDailyRange = isXAUUSD(symbol) ? 200 : isJPYPair(symbol) ? 100 : 60;

  // Use risk profile to determine target pips
  // Aggressive = fewer pips with bigger size, Conservative = more pips with smaller size
  const minViablePips = riskProfile.typicalStopPips.min;
  const maxViablePips = riskProfile.typicalStopPips.max;
  const commonMovePips = (minViablePips + maxViablePips) / 2; // Average of risk profile range

  console.log(`  ${riskMode.toUpperCase()} Profile: ${minViablePips}-${maxViablePips} pips (avg ${commonMovePips.toFixed(0)})`);
  console.log(`  Daily Range: ${typicalDailyRange} pips`);

  // Calculate position size using risk profile base risk percent
  const riskPercent = riskProfile.baseRiskPercent;
  const maxPositionSize = calculatePositionSize(symbol, accountBalance, riskPercent, entryPrice, stopLoss);

  console.log(`  Risk Profile Base: ${riskPercent}%`);
  console.log(`  Max Position Size (risk-based): ${maxPositionSize.toFixed(3)} lots`);

  // REVERSE CALCULATION: What lot size gives us goal profit at optimal pips?
  const optimalPips = commonMovePips;
  const dollarPerPipAtOneLot = isXAUUSD(symbol) ? 100 : isIndex(symbol) ? 100 : isCrypto(symbol) ? pipInfo.dollarPerPipPerLot : 10;
  const requiredLotSizeForOptimal = remainingGoal / (optimalPips * dollarPerPipAtOneLot);

  console.log(`  Required Lot Size for ${optimalPips} pips: ${requiredLotSizeForOptimal.toFixed(3)}`);

  // Cap at max risk-based position size
  let actualLotSize = Math.min(requiredLotSizeForOptimal, maxPositionSize);

  // Apply absolute minimums and maximums
  const minLotSize = 0.01;
  const maxLotSize = isXAUUSD(symbol) ? 10.0 : isIndex(symbol) ? 1.0 : isCrypto(symbol) ? 10.0 : 5.0;
  actualLotSize = Math.max(minLotSize, Math.min(maxLotSize, actualLotSize));

  // Round to broker standard precision (0.01 lots)
  actualLotSize = roundLotSize(actualLotSize);

  console.log(`  Final Lot Size: ${formatLotSize(actualLotSize)} lots`);

  // Calculate actual pips needed with this lot size
  const dollarPerPip = calculateDollarPerPip(symbol, actualLotSize);
  const pipsNeededForGoal = remainingGoal / dollarPerPip;

  console.log(`  Dollar/Pip: $${dollarPerPip.toFixed(2)}`);
  console.log(`  Pips Needed for Goal: ${pipsNeededForGoal.toFixed(1)}`);

  // Assess goal feasibility based on market reality (educational, not restrictive)
  let goalFeasibility: 'single_trade' | 'multiple_trades' | 'unrealistic';
  let finalPips: number;
  let reasoning: string;

  const pipFeasibilityRatio = pipsNeededForGoal / typicalDailyRange;

  if (pipsNeededForGoal <= commonMovePips && pipsNeededForGoal >= minViablePips) {
    // Goal achievable in single trade - realistic pip target
    goalFeasibility = 'single_trade';
    finalPips = pipsNeededForGoal;
    reasoning = `Goal achievable in ONE trade: ${formatLotSize(actualLotSize)} lots × ${finalPips.toFixed(1)} pips = $${remainingGoal.toFixed(2)} (within common ${commonMovePips}-pip moves)`;
  } else if (pipsNeededForGoal > commonMovePips && pipsNeededForGoal <= typicalDailyRange) {
    // Goal possible but requires full daily range
    goalFeasibility = 'single_trade';
    finalPips = pipsNeededForGoal;
    reasoning = `Goal achievable if market provides full daily range: ${formatLotSize(actualLotSize)} lots × ${finalPips.toFixed(1)} pips = $${remainingGoal.toFixed(2)} (${pipFeasibilityRatio.toFixed(1)}x typical moves - needs strong trend)`;
  } else if (pipsNeededForGoal > typicalDailyRange) {
    // Goal requires multiple trades - show realistic path
    goalFeasibility = 'multiple_trades';
    finalPips = commonMovePips;
    const partialProfit = finalPips * dollarPerPip;
    const tradesNeeded = Math.ceil(remainingGoal / partialProfit);
    reasoning = `Goal requires ~${tradesNeeded} trades (${pipsNeededForGoal.toFixed(0)} pips = ${pipFeasibilityRatio.toFixed(1)}x daily range). Recommended: ${formatLotSize(actualLotSize)} lots × ${finalPips.toFixed(1)} pips/trade = $${partialProfit.toFixed(2)} per win toward $${remainingGoal.toFixed(2)}`;
  } else {
    // Pips too small - increase lot size or unrealistic
    goalFeasibility = 'unrealistic';
    finalPips = minViablePips;
    const achievableProfit = finalPips * dollarPerPip;
    reasoning = `Min viable pip target (${finalPips.toFixed(1)}) gives $${achievableProfit.toFixed(2)}. Goal may need position size adjustment or multiple trades.`;
  }

  // Calculate TP price
  const pipPriceDistance = finalPips * pipInfo.pipValue;
  const takeProfit = direction === 'buy'
    ? entryPrice + pipPriceDistance
    : entryPrice - pipPriceDistance;

  // Validate R:R
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(takeProfit - entryPrice);
  const riskReward = tpDistance / slDistance;

  console.log(`  Take Profit: ${takeProfit.toFixed(pipInfo.decimalPlaces)}`);
  console.log(`  Risk:Reward: 1:${riskReward.toFixed(2)}`);
  console.log(`  Feasibility: ${goalFeasibility}`);
  console.log(`  Reasoning: ${reasoning}`);

  // 🚨 FINAL VALIDATION: Calculate expected risk and profit
  const stopDistance = Math.abs(entryPrice - stopLoss);
  const stopPips = stopDistance / pipInfo.pipValue;
  const expectedRisk = stopPips * dollarPerPip;
  const expectedProfit = finalPips * dollarPerPip;

  console.log('%c[POSITION SIZING VALIDATION]', 'color: #00ff00; font-weight: bold');
  console.log(`  Lot Size: ${formatLotSize(actualLotSize)}`);
  console.log(`  Expected Risk (SL): $${expectedRisk.toFixed(2)}`);
  console.log(`  Expected Profit (TP): $${expectedProfit.toFixed(2)}`);
  console.log(`  Max Risk Allowed: $${(accountBalance * 0.05).toFixed(2)} (5% cap)`);

  // ABSOLUTE SAFETY: If expected risk > 5% of balance, something is VERY wrong
  const maxRiskAllowed = accountBalance * 0.05;
  if (expectedRisk > maxRiskAllowed) {
    console.error('%c🚨 RISK TOO HIGH! REJECTING POSITION!', 'color: #ff0000; font-weight: bold; font-size: 18px');
    console.error(`  Expected Risk: $${expectedRisk.toFixed(2)}`);
    console.error(`  Max Allowed: $${maxRiskAllowed.toFixed(2)}`);

    // Return minimum safe position
    return {
      lotSize: 0.01,
      takeProfit,
      pipsNeeded: finalPips,
      reasoning: `⚠️ SAFETY OVERRIDE: Original calculation too risky. Using minimum position size.`,
      goalFeasibility: 'unrealistic'
    };
  }

  return {
    lotSize: actualLotSize,
    takeProfit,
    pipsNeeded: finalPips,
    reasoning,
    goalFeasibility
  };
}

/**
 * Calculate Take Profit constrained by goal target amount
 *
 * CRITICAL: This ensures TP is set to reach the user's goal, not arbitrary technical levels
 *
 * @param symbol Currency pair
 * @param direction Trade direction ('buy' or 'sell')
 * @param entryPrice Entry price
 * @param stopLoss Stop loss price
 * @param positionSize Position size in lots
 * @param currentProgress Current P&L progress toward goal
 * @param targetGoal Total goal target amount (e.g., $200)
 * @param aiSuggestedTP AI's suggested TP based on technical analysis
 * @returns Adjusted TP price that aligns with goal
 */
export function calculateGoalBasedTakeProfit(
  symbol: string,
  direction: 'buy' | 'sell',
  entryPrice: number,
  stopLoss: number,
  positionSize: number,
  currentProgress: number,
  targetGoal: number,
  aiSuggestedTP?: number
): { takeProfit: number; reasoning: string } {
  const pipInfo = getCurrencyPipInfo(symbol);

  // Calculate remaining amount needed to reach goal
  const remainingGoal = targetGoal - currentProgress;

  console.log(`[Goal-Based TP] ${symbol}:`);
  console.log(`  Current Progress: $${currentProgress.toFixed(2)}`);
  console.log(`  Target Goal: $${targetGoal.toFixed(2)}`);
  console.log(`  Remaining: $${remainingGoal.toFixed(2)}`);
  console.log(`  Position Size: ${positionSize} lots`);

  // If goal is already reached or exceeded, use AI's TP
  if (remainingGoal <= 0) {
    console.log(`  ✅ Goal already reached! Using AI TP: ${aiSuggestedTP?.toFixed(5)}`);
    return {
      takeProfit: aiSuggestedTP || (direction === 'buy' ? entryPrice * 1.01 : entryPrice * 0.99),
      reasoning: 'Goal already reached, using technical TP'
    };
  }

  // Calculate dollar per pip for this position
  const dollarPerPip = calculateDollarPerPip(symbol, positionSize);

  // Calculate pips needed to reach goal
  const pipsNeeded = remainingGoal / dollarPerPip;

  console.log(`  Dollar/Pip: $${dollarPerPip.toFixed(2)}`);
  console.log(`  Pips Needed for Goal: ${pipsNeeded.toFixed(1)}`);

  // Calculate TP price from pips
  const pipPriceDistance = pipsNeeded * pipInfo.pipValue;
  let goalBasedTP: number;

  if (direction === 'buy') {
    goalBasedTP = entryPrice + pipPriceDistance;
  } else {
    goalBasedTP = entryPrice - pipPriceDistance;
  }

  console.log(`  Goal-Based TP: ${goalBasedTP.toFixed(5)}`);
  if (aiSuggestedTP) {
    console.log(`  AI Suggested TP: ${aiSuggestedTP.toFixed(5)}`);
  }

  // Validate against stop loss (ensure TP is in profit direction)
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(goalBasedTP - entryPrice);
  const riskReward = tpDistance / slDistance;

  console.log(`  Risk:Reward: 1:${riskReward.toFixed(2)}`);

  // Check if goal-based TP is reasonable
  const maxReasonablePips = isXAUUSD(symbol) ? 500 : isJPYPair(symbol) ? 300 : 150;

  if (pipsNeeded > maxReasonablePips) {
    console.log(`  ⚠️ Goal TP too far (${pipsNeeded.toFixed(1)} pips > ${maxReasonablePips} max)`);

    // Calculate partial goal: use reasonable TP, will need multiple trades
    const maxPipDistance = maxReasonablePips * pipInfo.pipValue;
    const partialGoalTP = direction === 'buy'
      ? entryPrice + maxPipDistance
      : entryPrice - maxPipDistance;

    const partialProfit = maxReasonablePips * dollarPerPip;
    const tradesNeeded = Math.ceil(remainingGoal / partialProfit);

    console.log(`  Using partial goal: $${partialProfit.toFixed(2)} (~${tradesNeeded} trades needed)`);

    // Compare with AI TP if provided
    if (aiSuggestedTP) {
      const aiTPPips = calculatePipDistance(symbol, entryPrice, aiSuggestedTP);
      const aiTPProfit = aiTPPips * dollarPerPip;

      console.log(`  AI TP would give: $${aiTPProfit.toFixed(2)}`);

      // Use whichever gets us closer to goal without being unrealistic
      if (aiTPPips <= maxReasonablePips && aiTPProfit >= partialProfit * 0.8) {
        console.log(`  ✅ Using AI TP (within reasonable range)`);
        return {
          takeProfit: aiSuggestedTP,
          reasoning: `AI TP provides $${aiTPProfit.toFixed(2)} progress toward $${remainingGoal.toFixed(2)} goal (~${tradesNeeded} trades needed)`
        };
      }
    }

    return {
      takeProfit: partialGoalTP,
      reasoning: `Goal requires multiple trades. This TP targets $${partialProfit.toFixed(2)} of $${remainingGoal.toFixed(2)} remaining (~${tradesNeeded} trades total)`
    };
  }

  // Check if goal TP has minimum 1:1 R:R
  if (riskReward < 1.0) {
    console.log(`  ⚠️ Goal TP has poor R:R (${riskReward.toFixed(2)})`);

    // Adjust TP to at least 1:1 R:R
    const minTPDistance = slDistance;
    const minTP = direction === 'buy'
      ? entryPrice + minTPDistance
      : entryPrice - minTPDistance;

    const minTPPips = minTPDistance / pipInfo.pipValue;
    const minTPProfit = minTPPips * dollarPerPip;

    console.log(`  Adjusted to 1:1 R:R: $${minTPProfit.toFixed(2)}`);

    return {
      takeProfit: minTP,
      reasoning: `Adjusted TP for 1:1 R:R (will reach goal in multiple trades, this one targets $${minTPProfit.toFixed(2)})`
    };
  }

  // Goal-based TP is reasonable and achievable
  console.log(`  ✅ Using goal-based TP (achievable in this trade)`);
  return {
    takeProfit: goalBasedTP,
    reasoning: `TP set to reach $${remainingGoal.toFixed(2)} goal target (${pipsNeeded.toFixed(1)} pips, R:R 1:${riskReward.toFixed(2)})`
  };
}

/**
 * Calculate and validate R:R ratio with detailed logging
 * This function provides comprehensive validation to catch any discrepancies
 * between calculated RR and what's displayed to the user
 */
export function calculateAndValidateRR(
  symbol: string,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  direction: 'buy' | 'sell'
): {
  riskReward: number;
  riskPips: number;
  rewardPips: number;
  validation: {
    isValid: boolean;
    warnings: string[];
    details: any;
  };
} {
  const pipInfo = getCurrencyPipInfo(symbol);

  console.log(`%c[RR Validation] ${symbol}`, 'color: #00ff00; font-weight: bold');
  console.log(`  Direction: ${direction}`);
  console.log(`  Entry:  ${entryPrice.toFixed(pipInfo.decimalPlaces)}`);
  console.log(`  SL:     ${stopLoss.toFixed(pipInfo.decimalPlaces)}`);
  console.log(`  TP:     ${takeProfit.toFixed(pipInfo.decimalPlaces)}`);

  // Calculate distances using price difference
  const slDistance = Math.abs(entryPrice - stopLoss);
  const tpDistance = Math.abs(entryPrice - takeProfit);

  console.log(`  SL Distance (price): ${slDistance.toFixed(pipInfo.decimalPlaces)}`);
  console.log(`  TP Distance (price): ${tpDistance.toFixed(pipInfo.decimalPlaces)}`);

  // Convert to pips
  const riskPips = calculatePipDistance(symbol, entryPrice, stopLoss);
  const rewardPips = calculatePipDistance(symbol, entryPrice, takeProfit);

  console.log(`  Risk Pips:   ${riskPips.toFixed(1)}`);
  console.log(`  Reward Pips: ${rewardPips.toFixed(1)}`);

  // Calculate RR
  const riskReward = rewardPips / riskPips;

  console.log(`  R:R Ratio: 1:${riskReward.toFixed(2)}`);

  // Validation checks
  const warnings: string[] = [];

  // Check 1: SL and TP are on correct sides of entry
  if (direction === 'buy') {
    if (stopLoss >= entryPrice) {
      warnings.push(`Buy trade has SL >= entry (SL should be below entry)`);
    }
    if (takeProfit <= entryPrice) {
      warnings.push(`Buy trade has TP <= entry (TP should be above entry)`);
    }
  } else {
    if (stopLoss <= entryPrice) {
      warnings.push(`Sell trade has SL <= entry (SL should be above entry)`);
    }
    if (takeProfit >= entryPrice) {
      warnings.push(`Sell trade has TP >= entry (TP should be below entry)`);
    }
  }

  // Check 2: RR is reasonable
  if (riskReward < 0.5) {
    warnings.push(`Extremely poor R:R (${riskReward.toFixed(2)})`);
  } else if (riskReward < 1.0) {
    warnings.push(`Poor R:R (${riskReward.toFixed(2)} - risk exceeds reward)`);
  } else if (riskReward > 10.0) {
    warnings.push(`Suspiciously high R:R (${riskReward.toFixed(2)} - may indicate calculation error)`);
  }

  // Check 3: Pip distances are reasonable
  if (riskPips < 5) {
    warnings.push(`Very tight stop loss (${riskPips.toFixed(1)} pips)`);
  }
  if (riskPips > 500) {
    warnings.push(`Extremely wide stop loss (${riskPips.toFixed(1)} pips)`);
  }

  // Check 4: Price precision validation
  const reconstructedSL = direction === 'buy'
    ? entryPrice - (riskPips * pipInfo.pipValue)
    : entryPrice + (riskPips * pipInfo.pipValue);

  const reconstructedTP = direction === 'buy'
    ? entryPrice + (rewardPips * pipInfo.pipValue)
    : entryPrice - (rewardPips * pipInfo.pipValue);

  const slPrecisionError = Math.abs(reconstructedSL - stopLoss);
  const tpPrecisionError = Math.abs(reconstructedTP - takeProfit);

  if (slPrecisionError > pipInfo.pipValue * 0.1) {
    warnings.push(`SL precision error: ${slPrecisionError.toFixed(pipInfo.decimalPlaces)} (reconstructed: ${reconstructedSL.toFixed(pipInfo.decimalPlaces)})`);
  }

  if (tpPrecisionError > pipInfo.pipValue * 0.1) {
    warnings.push(`TP precision error: ${tpPrecisionError.toFixed(pipInfo.decimalPlaces)} (reconstructed: ${reconstructedTP.toFixed(pipInfo.decimalPlaces)})`);
  }

  if (warnings.length > 0) {
    console.warn('%c[RR Validation] Warnings:', 'color: #ff9900; font-weight: bold');
    warnings.forEach(w => console.warn(`  - ${w}`));
  } else {
    console.log(`%c  ✅ All validations passed`, 'color: #00ff00');
  }

  return {
    riskReward,
    riskPips,
    rewardPips,
    validation: {
      isValid: warnings.length === 0,
      warnings,
      details: {
        slDistance,
        tpDistance,
        reconstructedSL,
        reconstructedTP,
        slPrecisionError,
        tpPrecisionError,
        pipValue: pipInfo.pipValue,
        decimalPlaces: pipInfo.decimalPlaces
      }
    }
  };
}
