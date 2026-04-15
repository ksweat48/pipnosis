/**
 * Currency Helpers (TIER 3 FIX - Dynamic JPY Pip Calculations)
 *
 * Utility functions for handling currency-specific calculations
 * Particularly important for JPY pairs which use different pip values
 *
 * TIER 3 Enhancement: Now supports dynamic pip value calculation for JPY pairs
 * using live USDJPY exchange rates with intelligent fallback to static values.
 */

import { supabase } from '../lib/supabase';
import { getRiskPercentage } from '../config/risk-levels';
import { getRiskStrategyProfile } from '../config/risk-strategy-profiles';
import { getSymbolConfig, getScaledMaxLotSize } from '../config/symbol-registry';
import { getAssetClassRiskProfile } from '../config/asset-class-risk-profiles';
import { validateStopLossDistance } from '../config/trade-parameter-constraints';
import { TRADING_CONSTANTS } from '../config/trading-constants';
import { calculateDynamicJPYPipValue } from '../services/dynamic-pip-calculator';

export interface CurrencyPipInfo {
  pipValue: number;
  pipMultiplier: number;
  decimalPlaces: number;
  contractSize: number;
  dollarPerPipPerLot: number;
  symbolType: 'forex' | 'metal' | 'index' | 'crypto';
  source?: 'dynamic' | 'static' | 'static_fallback'; // TIER 3: Track value source
  usdjpyRate?: number; // TIER 3: Include rate used for dynamic calculation
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
 *
 * CRITICAL - Position Sizing SSOT:
 *
 * This function is the SINGLE SOURCE OF TRUTH for position sizing calculations.
 * It uses "reasoning pips" that allow the LLM to think naturally about distances.
 *
 * For market data tick sizes, see symbol-registry.ts (different pip values).
 *
 * Example - XAUUSD:
 * - symbol-registry.ts: pipValue = 0.01 (tick size for prices)
 * - currencyHelpers.ts: pipValue = 1.0 (reasoning pip for position sizing)
 *
 * This maintains correct dollar-per-pip values while simplifying LLM reasoning.
 */
export function getCurrencyPipInfo(symbol: string): CurrencyPipInfo {
  const normalized = safeNormalizeSymbol(symbol);

  // XAUUSD (Gold) - CRITICAL: Fixed pip calculation for position sizing
  //
  // IMPORTANT: In this system, 1 pip = 1.0 point for XAUUSD (not 0.01)
  // This allows Alpha to reason naturally: "20 pip stop" = 20 points (e.g., 4357 to 4377)
  //
  // Dollar values remain correct:
  // - 1 standard lot (100 oz) = $100 per pip
  // - 0.01 lot (1 oz) = $1 per pip
  // - 0.03 lot (3 oz) = $3 per pip
  //
  // Example with fix:
  // - Entry: 4357.00, Stop: 4377.00 (20 points)
  // - Stop distance: 20 / 1.0 = 20 pips (CORRECT)
  // - Position: 0.03 lots = $3/pip
  // - Risk: 20 pips × $3/pip = $60 (CORRECT) ✅
  //
  // Before fix (BROKEN):
  // - Stop distance: 20 / 0.01 = 2000 pips (WRONG)
  // - Risk: 2000 pips × $3/pip = $6,000 (WRONG) ❌
  if (isXAUUSD(symbol)) {
    return {
      pipValue: 1.0,            // 1 pip = 1 point (e.g., 4357 to 4358 = 1 pip)
      pipMultiplier: 1,
      decimalPlaces: 2,
      contractSize: 100,        // 100 troy ounces per lot
      dollarPerPipPerLot: 100,  // $100 per full lot ($1 per 0.01 lot)
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
      dollarPerPipPerLot: 100,  // $100 per pip per 1 lot (industry standard)
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
        pipValue: 1.0,  // Fixed: Was 0.1, causing zone tolerance to be 10x too small
        pipMultiplier: 1,
        decimalPlaces: 2,
        contractSize: 1,
        dollarPerPipPerLot: 1.0,  // Fixed: Match BTCUSD behavior
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
      dollarPerPipPerLot: 10,   // $10 per pip per 0.1 lot (static fallback)
      symbolType: 'forex',
      source: 'static' as const
    };
  }

  // Standard forex pairs (EURUSD, GBPUSD, etc.)
  return {
    pipValue: 0.0001,           // Standard pairs use 0.0001 as pip
    pipMultiplier: 1,
    decimalPlaces: 5,           // Most brokers use 5 decimals now
    contractSize: 100000,       // Standard lot = 100,000 units
    dollarPerPipPerLot: 10,     // $10 per pip per 0.1 lot
    symbolType: 'forex',
    source: 'static' as const
  };
}

/**
 * TIER 3 FIX: Get currency pip info with dynamic JPY calculation
 *
 * Async version that fetches live USDJPY rate for accurate pip values.
 * Falls back to static values if rate unavailable (intelligent degradation).
 *
 * Use this in Alpha execution planning for maximum accuracy.
 * Use getCurrencyPipInfo() for non-critical paths or when async not possible.
 *
 * @param symbol Currency pair
 * @returns Promise<CurrencyPipInfo> with source tracking
 */
export async function getCurrencyPipInfoAsync(symbol: string): Promise<CurrencyPipInfo> {
  // Get base info (synchronous)
  const baseInfo = getCurrencyPipInfo(symbol);

  // Only enhance JPY pairs with dynamic calculation
  if (!isJPYPair(symbol)) {
    return baseInfo;
  }

  // Fetch dynamic pip value
  const dynamicResult = await calculateDynamicJPYPipValue(symbol);

  return {
    ...baseInfo,
    dollarPerPipPerLot: dynamicResult.dollarPerPipPerLot,
    source: dynamicResult.source,
    usdjpyRate: dynamicResult.usdjpyRate
  };
}

/**
 * Round lot size to broker standard precision (0.01 lots)
 * Always rounds DOWN (floor) to never exceed the intended risk.
 * Using Math.round could round up and make the position slightly larger than the risk budget.
 */
export function roundLotSize(lotSize: number): number {
  return Math.floor(lotSize * 100) / 100;
}

/**
 * Convert lot size to position_size for database storage (SSOT)
 *
 * CRITICAL: This is the SINGLE SOURCE OF TRUTH for lot → position_size conversion.
 * Different asset classes have different position size formats:
 *
 * - Forex: position_size = lotSize × contractSize (e.g., 0.01 lot × 100,000 = 1,000)
 * - Crypto: position_size = lotSize × 100 (e.g., 2.4 ETH → 240 for database storage)
 * - Indices: position_size = lotSize × 100 (e.g., 0.5 contract → 50)
 * - Metals: position_size = lotSize × 100 (e.g., 0.03 oz × 100 = 3)
 *
 * Database constraint: position_size must be ≤ 1000
 *
 * @param symbol Currency pair, crypto, index, or metal
 * @param lotSize Lot size in standard lots (0.01, 0.1, 1.0, etc.)
 * @returns Position size for database storage (integer)
 */
export function convertLotToPositionSize(symbol: string, lotSize: number): number {
  const pipInfo = getCurrencyPipInfo(symbol);

  let positionSize: number;

  if (pipInfo.symbolType === 'forex') {
    // Forex: Use contract size (100,000 for standard lot)
    // But scale down to fit database constraint
    // 0.01 lot = 1,000 units (instead of 1,000 base units)
    positionSize = Math.round(lotSize * 100);
  } else {
    // Crypto, Indices, Metals: Direct scaling
    // 2.4 ETH → 240
    // 0.5 contracts → 50
    // 0.03 oz → 3
    positionSize = Math.round(lotSize * 100);
  }

  // Defensive validation: Ensure within database constraint
  if (positionSize > 1000) {
    console.warn(
      `[Position Size] WARNING: Calculated position_size ${positionSize} exceeds database limit (1000).\n` +
      `  Symbol: ${symbol}, Lot Size: ${lotSize}, Type: ${pipInfo.symbolType}\n` +
      `  Capping to 1000 to prevent insertion failure.`
    );
    positionSize = 1000;
  }

  return positionSize;
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
 * Format price to correct decimal places for currency.
 * DEFENSIVE: Handles invalid inputs gracefully to prevent crashes.
 *
 * GOVERNANCE (CCIP): When isMobile=true, returns 2 decimal places for ALL
 * symbol types — this is the enforced mobile display standard across the platform.
 * Desktop retains full symbol-specific precision from pip config.
 */
export function formatCurrencyPrice(
  symbol: string,
  price: number,
  isMobile: boolean = false
): string {
  // Defensive guard: Validate symbol parameter
  if (!symbol || typeof symbol !== 'string') {
    console.error('[formatCurrencyPrice] Invalid symbol parameter:', symbol);
    return typeof price === 'number' && !isNaN(price) ? price.toFixed(2) : 'N/A';
  }

  // Defensive guard: Validate price parameter
  if (typeof price !== 'number' || isNaN(price) || price === null || price === undefined) {
    console.error(`[formatCurrencyPrice] Invalid price parameter for ${symbol}:`, price);
    return 'N/A';
  }

  // MOBILE STANDARD: 2 decimal places for all symbols on mobile
  if (isMobile) {
    return price.toFixed(2);
  }

  try {
    const pipInfo = getCurrencyPipInfo(symbol);
    return price.toFixed(pipInfo.decimalPlaces);
  } catch (error) {
    console.error(`[formatCurrencyPrice] Error formatting price for ${symbol}:`, error);
    return price.toFixed(2);
  }
}

/**
 * Calculate dollar value per pip for a position
 * This is the CRITICAL function for risk calculation
 *
 * IMPORTANT: position size is in LOTS (0.01, 0.1, 1.0, etc.)
 *
 * SINGLE SOURCE OF TRUTH: Uses ONLY pipInfo.dollarPerPipPerLot
 * NO hardcoded multipliers allowed
 */
export function calculateDollarPerPip(
  symbol: string,
  positionSize: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);
  return positionSize * pipInfo.dollarPerPipPerLot;
}

/**
 * Validate that entry price matches expected range for symbol
 * Catches dummy price contamination bugs early
 *
 * Returns an error message string if mismatch detected, null if valid.
 * Callers decide whether to throw or warn based on context.
 *
 * SSOT: Price ranges reflect 2026 market reality with conservative buffers.
 * Ranges are intentionally wide to avoid false positives from volatile markets.
 */
export function checkPriceSymbolMismatch(symbol: string, entryPrice: number): string | null {
  const normalized = symbol.toUpperCase();

  // Guard against invalid price values before range check
  if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
    return (
      `🚨 INVALID PRICE DETECTED!\n` +
      `  Symbol: ${symbol}\n` +
      `  Entry Price: ${entryPrice} (must be a positive finite number)\n` +
      `  This indicates a missing or malformed price in trade execution.`
    );
  }

  // Define expected price ranges - 2026 market reality with generous buffers
  const priceRanges: Record<string, { min: number; max: number; description: string }> = {
    'EURUSD': { min: 0.85, max: 1.50, description: 'Forex major' },
    'GBPUSD': { min: 1.05, max: 1.60, description: 'Forex major' },
    'USDJPY': { min: 100, max: 175, description: 'JPY pair' },
    'AUDUSD': { min: 0.50, max: 0.95, description: 'Forex major' },
    'NZDUSD': { min: 0.45, max: 0.85, description: 'Forex major' },
    'USDCAD': { min: 1.15, max: 1.55, description: 'Forex major' },
    'XAUUSD': { min: 1500, max: 6000, description: 'Gold' },
    'BTCUSD': { min: 15000, max: 250000, description: 'Bitcoin' },
    'ETHUSD': { min: 500, max: 15000, description: 'Ethereum' },
    'US30': { min: 20000, max: 65000, description: 'Dow Jones' },
    'NAS100': { min: 10000, max: 35000, description: 'Nasdaq' },
    'SPX500': { min: 3000, max: 9000, description: 'S&P 500' }
  };

  const range = priceRanges[normalized];

  if (range && (entryPrice < range.min || entryPrice > range.max)) {
    return (
      `🚨 PRICE/SYMBOL MISMATCH DETECTED!\n` +
      `  Symbol: ${symbol} (${range.description})\n` +
      `  Entry Price: ${entryPrice}\n` +
      `  Expected Range: ${range.min} - ${range.max}\n` +
      `  This indicates dummy test prices are contaminating real trade execution.\n` +
      `  Check goal feasibility estimation logic for leaks into trade execution.`
    );
  }

  return null;
}

/**
 * Throws if price/symbol mismatch detected.
 * Use only in real trade execution paths where bad prices must hard-fail.
 */
function validatePriceMatchesSymbol(symbol: string, entryPrice: number): void {
  const mismatch = checkPriceSymbolMismatch(symbol, entryPrice);
  if (mismatch) {
    throw new Error(mismatch);
  }
}

/**
 * Calculate lot size from fixed dollar risk (Trade Styles System)
 *
 * @deprecated **PHASE 2: Use ProfessionalRiskManager.evaluateTrade() instead**
 *
 * This function bypasses critical risk management layers:
 * - ❌ Kelly Criterion optimization
 * - ❌ EV Gating validation
 * - ❌ Volatility adjustments
 * - ❌ Correlation risk checks
 * - ❌ Market condition risk modifiers
 * - ❌ Progressive risk scaling
 * - ❌ PCVL (Position Contract Validation Layer)
 *
 * **Migration Path:**
 * ```typescript
 * // OLD (deprecated):
 * const lotSize = calculateLotSizeFromDollarRisk(symbol, dollarRisk, entry, sl);
 *
 * // NEW (correct):
 * const riskAssessment = await professionalRiskManager.evaluateTrade({
 *   userId, symbol, direction, currentBalance,
 *   baseRiskPercent: dollarRisk / currentBalance,
 *   stopLossPips, takeProfitPips, goalSessionId, riskMode
 * });
 * const lotSize = riskAssessment.recommendedLotSize;
 * ```
 *
 * Keeping for backward compatibility only. Will be removed in Phase 3.
 *
 * Formula: Lot Size = Dollar Risk / (SL Distance in Pips × Dollar Per Pip Per Lot)
 *
 * Example - EURUSD with $97.20 risk and 3.2 pip SL:
 *   - SL Distance: 3.2 pips
 *   - Dollar per pip needed: $97.20 / 3.2 = $30.38/pip
 *   - EURUSD: $10 per pip per 1.0 lot
 *   - Lot size: $30.38 / $10 = 3.04 lots
 *   - Verification: 3.04 lots × $10/pip × 3.2 pips = $97.28 ✅
 *
 * @param symbol Currency pair
 * @param dollarRisk Fixed dollar amount to risk
 * @param entryPrice Entry price
 * @param stopLoss Stop loss price
 * @returns Lot size rounded to 0.01
 */
export function calculateLotSizeFromDollarRisk(
  symbol: string,
  dollarRisk: number,
  entryPrice: number,
  stopLoss: number
): number {
  const pipInfo = getCurrencyPipInfo(symbol);

  // Validate price matches symbol (catch dummy price contamination)
  validatePriceMatchesSymbol(symbol, entryPrice);

  console.log(`%c[Dollar-Risk Position Sizing] ${symbol}`, 'color: #00ffff; font-weight: bold');
  console.log(`  Dollar Risk: $${dollarRisk.toFixed(2)}`);
  console.log(`  Entry: ${entryPrice}, SL: ${stopLoss}`);

  // Validate stop loss distance
  const direction = stopLoss < entryPrice ? 'LONG' : 'SHORT';
  const validation = validateStopLossDistance(
    symbol,
    entryPrice,
    stopLoss,
    direction,
    pipInfo.pipValue
  );

  if (!validation.valid) {
    console.error('%c🚨 INVALID SL DISTANCE', 'color: #ff0000; font-weight: bold');
    console.error(`  Violations: ${validation.violations.join('; ')}`);
    throw new Error(`Invalid SL/Entry: ${validation.violations.join('; ')}`);
  }

  const slDistancePips = validation.actualDistancePips;
  console.log(`  SL Distance: ${slDistancePips.toFixed(2)} pips`);

  // 🛡️ INTELLIGENT DEGRADATION: Detect suspiciously small SL distances
  // Engines validate. Alpha decides. Trades degrade intelligently.
  if (slDistancePips < 1.0 && pipInfo.symbolType === 'forex') {
    console.warn(
      `%c⚠️ MICRO-PIP STOP DETECTED`, 'color: #ff9900; font-weight: bold',
      `\n  Symbol: ${symbol}`,
      `\n  SL Distance: ${slDistancePips.toFixed(4)} pips (< 1 pip)`,
      `\n  Entry: ${entryPrice}, SL: ${stopLoss}`,
      `\n  This will produce astronomical lot sizes. Proceeding with intelligent cap.`
    );
  }

  // Calculate lot size
  // Formula: Lot Size = Dollar Risk / (SL Pips × Dollar Per Pip Per Lot)
  const dollarPerPipPerLot = pipInfo.dollarPerPipPerLot;
  let lotSize = dollarRisk / (slDistancePips * dollarPerPipPerLot);

  console.log(`  Dollar/Pip/Lot: $${dollarPerPipPerLot.toFixed(2)}`);
  console.log(`  Calculated Lot Size: ${lotSize.toFixed(4)}`);

  // SSOT: Use account-balance-scaled ceiling (getScaledMaxLotSize).
  // dollarRisk already encodes the user's risk %, so derive riskPct for the ceiling.
  // This replaces the hardcoded ABSOLUTE_MAX_LOT_SIZE = 10 that prevented scaling.
  const symbolConfig = getSymbolConfig(symbol);
  const minSize = symbolConfig?.minLotSize || 0.01;

  // Derive implied risk % from dollar risk vs a nominal $10k account reference —
  // when we don't have the actual account balance here, we use the broker ceiling only.
  // The per-account scaling already happened upstream (caller passed dollarRisk = balance × risk%).
  const brokerCeiling = symbolConfig?.maxLotSize || 500.0;

  if (lotSize > brokerCeiling) {
    console.error(
      `[Dollar-Risk Position Sizing] EXTREME LOT SIZE DETECTED`,
      `Symbol: ${symbol}, Calculated: ${lotSize.toFixed(2)} lots, Dollar Risk: $${dollarRisk.toFixed(2)},`,
      `SL Distance: ${slDistancePips.toFixed(4)} pips. Capping to broker ceiling: ${brokerCeiling}.`
    );

    try {
      supabase.from('ssot_violations').insert({
        violation_type: 'extreme_lot_size_calculation',
        severity: 'critical',
        context: {
          symbol,
          calculated_lot_size: lotSize,
          capped_to: brokerCeiling,
          dollar_risk: dollarRisk,
          sl_distance_pips: slDistancePips,
          dollar_per_pip_per_lot: dollarPerPipPerLot,
          entry: entryPrice,
          stop_loss: stopLoss,
          direction
        },
        message: `Lot size calculation produced ${lotSize.toFixed(2)} lots (exceeds broker ceiling ${brokerCeiling}). Likely micro-pip SL or goal amount used as risk.`
      }).then(({ error }) => {
        if (error) console.error('[SSOT Violation Logging] Failed:', error);
      });
    } catch (logError) {
      console.error('[SSOT Violation Logging] Exception:', logError);
    }

    lotSize = brokerCeiling;
  }

  lotSize = Math.max(minSize, Math.min(brokerCeiling, lotSize));
  lotSize = roundLotSize(lotSize);

  console.log(`  Final Lot Size: ${formatLotSize(lotSize)} lots`);
  console.log(`  Actual Risk: $${(slDistancePips * calculateDollarPerPip(symbol, lotSize)).toFixed(2)}`);

  return lotSize;
}

/**
 * Calculate position size based on risk amount and stop loss distance
 *
 * @deprecated **PHASE 2: Use ProfessionalRiskManager.evaluateTrade() instead**
 *
 * This function bypasses critical risk management layers:
 * - ❌ Kelly Criterion optimization
 * - ❌ EV Gating validation
 * - ❌ Volatility adjustments
 * - ❌ Correlation risk checks
 * - ❌ Market condition risk modifiers
 * - ❌ Progressive risk scaling
 *
 * **Exception:** OK to use with `isEstimation=true` for UI/feasibility calculations only (NOT actual trades)
 *
 * **Migration Path for Trade Execution:**
 * ```typescript
 * // OLD (deprecated for trades):
 * const lotSize = calculatePositionSize(symbol, balance, riskPercent, entry, sl);
 *
 * // NEW (correct):
 * const riskAssessment = await professionalRiskManager.evaluateTrade({
 *   userId, symbol, direction, currentBalance,
 *   baseRiskPercent: riskPercent / 100,
 *   stopLossPips, takeProfitPips, goalSessionId, riskMode
 * });
 * const lotSize = riskAssessment.recommendedLotSize;
 * ```
 *
 * Keeping for backward compatibility and estimations. Will be removed in Phase 3.
 *
 * Formula: Position Size = Risk Amount / (Stop Distance in Pips × Dollar Per Pip at 0.01 lot)
 *
 * @param isEstimation - If true, suppresses verbose logging and validation (used for goal feasibility calculations)
 */
export function calculatePositionSize(
  symbol: string,
  accountBalance: number,
  riskPercentage: number,
  entryPrice: number,
  stopLoss: number,
  isEstimation: boolean = false
): number {
  const pipInfo = getCurrencyPipInfo(symbol);
  const riskAmount = accountBalance * (riskPercentage / 100);

  // 🛡️ DEFENSIVE GUARD: Catch price/symbol mismatches early (prevents dummy price contamination)
  // Skip validation for estimations (they use reference prices intentionally)
  if (!isEstimation) {
    validatePriceMatchesSymbol(symbol, entryPrice);
  }

  // CCIP LOGGING SEPARATION: Clearly distinguish estimation from real trade attempts
  const logPrefix = isEstimation ? '[Goal Estimation]' : '[Position Sizing PRE-CHECK]';
  const logColor = isEstimation ? '#999999' : '#ffaa00';

  if (!isEstimation || import.meta.env.DEV) {
    console.log(`%c${logPrefix} ${symbol}`, `color: ${logColor}; font-weight: bold`);
    console.log(`  Entry: ${entryPrice}, SL: ${stopLoss}`);
    console.log(`  Risk %: ${riskPercentage}%, Balance: $${accountBalance.toFixed(2)}`);
  }

  const direction = stopLoss < entryPrice ? 'LONG' : 'SHORT';
  const validation = validateStopLossDistance(
    symbol,
    entryPrice,
    stopLoss,
    direction,
    pipInfo.pipValue  // CRITICAL FIX: Pass pipValue, not pipMultiplier
  );

  if (!validation.valid) {
    // For estimations, just calculate without throwing (they use reference prices)
    if (isEstimation) {
      if (import.meta.env.DEV) {
        console.warn(`[Goal Estimation] Using reference prices for ${symbol} - validation skipped`);
      }
    } else {
      console.error('%c🚨 INVALID TRADE PARAMETERS - CANNOT SIZE POSITION', 'color: #ff0000; font-weight: bold; font-size: 14px');
      console.error(`  Symbol: ${symbol}`);
      console.error(`  Entry: ${entryPrice}`);
      console.error(`  Stop Loss: ${stopLoss}`);
      console.error(`  Direction: ${direction}`);
      console.error(`  Actual Distance: ${validation.actualDistancePips.toFixed(2)} pips`);
      console.error(`  Violations:`);
      validation.violations.forEach(v => console.error(`    - ${v}`));
      console.error(`  Constraint: ${validation.constraint.reason}`);
      console.error(`  Min Required: ${validation.constraint.minPips} pips`);

      throw new Error(`Invalid SL/Entry: ${validation.violations.join('; ')}`);
    }
  } else if (!isEstimation || import.meta.env.DEV) {
    console.log(`  ✅ SL validation passed: ${validation.actualDistancePips.toFixed(2)} pips`);
  }

  // Calculate stop distance in pips
  const stopDistancePips = validation.actualDistancePips;

  // Assertion guards (defensive programming, not business logic)
  if (stopDistancePips <= 0) {
    throw new Error(`ASSERTION FAILED: stopDistancePips must be > 0 (got ${stopDistancePips})`);
  }

  // PHASE 2: Use SSOT constant for maximum risk
  const maxRiskPercent = TRADING_CONSTANTS.RISK_PERCENTAGES.MAX_PER_TRADE * 100; // 10%

  if (riskPercentage <= 0 || riskPercentage > maxRiskPercent) {
    throw new Error(`ASSERTION FAILED: riskPercentage must be 0-${maxRiskPercent}% (got ${riskPercentage}%)`);
  }

  if (accountBalance <= 0) {
    throw new Error(`ASSERTION FAILED: accountBalance must be > 0 (got ${accountBalance})`);
  }

  // Calculate position size using SINGLE SOURCE OF TRUTH
  // Formula: Position Size = Risk Amount / (Stop Distance × Dollar Per Pip at 0.01 lot)
  const dollarPerPipAt001Lot = calculateDollarPerPip(symbol, 0.01);

  if (dollarPerPipAt001Lot <= 0) {
    throw new Error(`ASSERTION FAILED: dollarPerPipAt001Lot must be > 0 (got ${dollarPerPipAt001Lot})`);
  }

  let positionSize = riskAmount / (stopDistancePips * dollarPerPipAt001Lot);

  // SSOT: Use account-balance-scaled ceiling (getScaledMaxLotSize) instead of
  // hardcoded per-category constants. This allows lot sizes to grow correctly
  // as account balance increases, while still respecting the broker ceiling
  // defined in symbol-registry.ts.
  const minSize = pipInfo.symbolType === 'crypto'
    ? (getSymbolConfig(symbol)?.minLotSize ?? 0.001)
    : 0.01;
  const maxSize = getScaledMaxLotSize(symbol, accountBalance, riskPercentage);

  positionSize = Math.max(minSize, Math.min(maxSize, positionSize));

  // Round to broker standard precision (0.01 lots)
  positionSize = roundLotSize(positionSize);

  // Log calculation for verification (suppress for estimations in production)
  if (!isEstimation || import.meta.env.DEV) {
    console.log(`[Position Sizing] ${symbol}:`);
    console.log(`  Account: $${accountBalance.toFixed(2)}`);
    console.log(`  Risk: ${riskPercentage}% = $${riskAmount.toFixed(2)}`);
    console.log(`  Stop Distance: ${stopDistancePips.toFixed(1)} pips`);
    console.log(`  Dollar/Pip/Lot: $${pipInfo.dollarPerPipPerLot.toFixed(2)}`);
    console.log(`  Position Size: ${formatLotSize(positionSize)} lots`);
    console.log(`  Actual Risk: $${(stopDistancePips * calculateDollarPerPip(symbol, positionSize)).toFixed(2)}`);
  }

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
 * @deprecated **PHASE 2: This function appears unused. Use ProfessionalRiskManager.evaluateTrade() instead**
 *
 * The LLM determines desired risk based on:
 * - Rank (Bronze, Silver, Gold, Alpha, Omega)
 * - Win/loss streak
 * - Conviction level
 * - Pattern confidence
 *
 * User's exposure_level only sets a MAXIMUM cap, not the actual risk taken.
 *
 * **Status:** No active callers found. Candidate for removal in Phase 3.
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
 * Calculate goal-aware position size — RISK-FIRST (Institutional Model)
 *
 * SIZING PRINCIPLE:
 * Lot size is determined by the user's SL risk tolerance applied to the SL distance.
 * Formula: lot = (accountBalance × riskPct / 100) / (sl_pips × $/pip_per_lot)
 *
 * Alpha determines the TP based on market structure. The profit earned is whatever
 * that lot size delivers at Alpha's TP — we never reverse-engineer the lot from a
 * desired profit outcome (that inflates risk variance).
 *
 * The goal (targetGoal) is a session-level progress tracker used for:
 * - Estimating how many trades may be needed (informational)
 * - Triggering session completion when accumulated P&L reaches the target
 * It does NOT drive lot sizing.
 *
 * @param symbol Currency pair
 * @param direction Trade direction (kept for compatibility)
 * @param accountBalance Current account balance
 * @param entryPrice Entry price
 * @param stopLoss Stop loss price (SSOT for sizing)
 * @param currentProgress Current P&L toward goal (informational)
 * @param targetGoal Total goal amount (session progress tracker, not a sizing driver)
 * @param riskMode Risk tolerance profile
 * @param riskPercentageAllowed User's declared SL risk tolerance % (e.g. 5 = risk 5% of balance)
 * @param takeProfitPrice Alpha's TP (used for informational feasibility output only)
 * @returns Lot size sized to SL risk tolerance, plus goal progress context
 */
export function calculateGoalAwareLotSize(
  symbol: string,
  direction: 'buy' | 'sell',
  accountBalance: number,
  entryPrice: number,
  stopLoss: number,
  currentProgress: number,
  targetGoal: number,
  riskMode: 'low' | 'medium' | 'high' = 'medium',
  riskPercentageAllowed?: number,
  takeProfitPrice?: number
): {
  lotSize: number;
  expectedProfitAtCommonMove: number;
  remainingGoal: number;
  estimatedTradesNeeded: number;
  reasoning: string;
  goalFeasibility: 'single_trade' | 'multiple_trades' | 'unrealistic';
  feasible: boolean;
  infeasibilityReason?: string;
  alternatives?: string[];
} {
  const pipInfo = getCurrencyPipInfo(symbol);
  const remainingGoal = targetGoal - currentProgress;
  const symbolConfig = getSymbolConfig(symbol);
  const assetProfile = getAssetClassRiskProfile(symbol);
  const riskProfile = getRiskStrategyProfile(riskMode);

  const typicalDailyRange = symbolConfig?.typicalDailyRangePoints || 100;

  const minViablePips = assetProfile.commonMove.min;
  const maxViablePips = assetProfile.commonMove.max;
  const commonMovePips = (minViablePips + maxViablePips) / 2;

  // RISK-FIRST: riskPercent = the % of balance the user is willing to LOSE at SL
  const riskPercent = riskPercentageAllowed ?? riskProfile.baseRiskPercent;
  const riskDollars = accountBalance * (riskPercent / 100);

  // SL distance in pips — this is the sizing foundation
  const slDistancePips = Math.abs(entryPrice - stopLoss) / pipInfo.pipValue;
  const dollarPerPipAtOneLot = calculateDollarPerPip(symbol, 1.0);

  console.log(`[Goal-Aware Lot Sizing — RISK-FIRST] ${symbol}:`);
  console.log(`  Balance: $${accountBalance.toFixed(2)}`);
  console.log(`  Risk Tolerance: ${riskPercent}% = $${riskDollars.toFixed(2)} max SL loss`);
  console.log(`  SL Distance: ${slDistancePips.toFixed(2)} pips`);
  console.log(`  Goal Target: $${targetGoal.toFixed(2)} | Progress: $${currentProgress.toFixed(2)} | Remaining: $${remainingGoal.toFixed(2)}`);

  if (commonMovePips < 5) {
    throw new Error(
      `Asset profile misconfigured for ${symbol}: commonMove=${commonMovePips.toFixed(2)} ${assetProfile.commonMove.unit}. ` +
      `Fix commonMove.min/max in asset-class-risk-profiles.ts to use actual pip/point values (e.g., 30-100 for indices).`
    );
  }

  // CORE SIZING: lot = riskDollars / (sl_pips × $/pip_per_lot)
  // This is the institutional formula — risk is defined, profit is accepted
  let rawLotSize = slDistancePips > 0
    ? riskDollars / (slDistancePips * dollarPerPipAtOneLot)
    : 0.01;

  const minLotSize = symbolConfig?.minLotSize || 0.01;
  const maxLotSize = getScaledMaxLotSize(symbol, accountBalance, riskPercent);
  let actualLotSize = roundLotSize(Math.max(minLotSize, Math.min(maxLotSize, rawLotSize)));

  console.log(`  Raw Lot (risk-first): ${rawLotSize.toFixed(3)} → Final: ${formatLotSize(actualLotSize)}`);

  // INFORMATIONAL: What profit does this lot produce at common moves and at Alpha's TP?
  const dollarPerPip = calculateDollarPerPip(symbol, actualLotSize);
  const expectedProfitAtCommonMove = commonMovePips * dollarPerPip;

  const tpDistancePips = (takeProfitPrice && takeProfitPrice !== entryPrice)
    ? Math.abs(takeProfitPrice - entryPrice) / pipInfo.pipValue
    : commonMovePips;
  const expectedProfitAtTP = tpDistancePips * dollarPerPip;
  const impliedRR = slDistancePips > 0 ? tpDistancePips / slDistancePips : 0;

  // Goal feasibility: informational estimate of trades needed at this lot size
  const pipsNeededForGoal = dollarPerPip > 0 ? remainingGoal / dollarPerPip : Infinity;
  const pipFeasibilityRatio = pipsNeededForGoal / typicalDailyRange;

  let goalFeasibility: 'single_trade' | 'multiple_trades' | 'unrealistic';
  let reasoning: string;
  let estimatedTradesNeeded: number;

  if (pipsNeededForGoal <= commonMovePips && pipsNeededForGoal >= minViablePips) {
    goalFeasibility = 'single_trade';
    estimatedTradesNeeded = 1;
    reasoning = `${formatLotSize(actualLotSize)} lots (${riskPercent}% SL risk = $${riskDollars.toFixed(2)}). At common ${commonMovePips}-pip moves: ~$${expectedProfitAtCommonMove.toFixed(2)} per trade. At Alpha's TP (${tpDistancePips.toFixed(0)} pips, R:R ${impliedRR.toFixed(2)}:1): ~$${expectedProfitAtTP.toFixed(2)}. Goal reachable in 1 trade.`;
  } else if (pipsNeededForGoal > commonMovePips && pipsNeededForGoal <= typicalDailyRange) {
    goalFeasibility = 'single_trade';
    estimatedTradesNeeded = 1;
    reasoning = `${formatLotSize(actualLotSize)} lots (${riskPercent}% SL risk = $${riskDollars.toFixed(2)}). Goal needs ${pipsNeededForGoal.toFixed(0)} pips (${pipFeasibilityRatio.toFixed(1)}x common moves). At Alpha's TP: ~$${expectedProfitAtTP.toFixed(2)} (R:R ${impliedRR.toFixed(2)}:1).`;
  } else if (pipsNeededForGoal > typicalDailyRange) {
    goalFeasibility = 'multiple_trades';
    estimatedTradesNeeded = expectedProfitAtCommonMove > 0
      ? Math.ceil(remainingGoal / expectedProfitAtCommonMove)
      : 1;
    reasoning = `${formatLotSize(actualLotSize)} lots (${riskPercent}% SL risk = $${riskDollars.toFixed(2)}). Goal needs ~${estimatedTradesNeeded} trades at ~$${expectedProfitAtCommonMove.toFixed(2)} per win. Alpha sets realistic TPs based on market conditions.`;
  } else {
    goalFeasibility = 'single_trade';
    estimatedTradesNeeded = 1;
    reasoning = `${formatLotSize(actualLotSize)} lots (${riskPercent}% SL risk = $${riskDollars.toFixed(2)}). At Alpha's TP: ~$${expectedProfitAtTP.toFixed(2)}.`;
  }

  console.log(`[RISK-FIRST SIZING COMPLETE]`);
  console.log(`  Lot: ${formatLotSize(actualLotSize)} | SL Risk: $${(actualLotSize * slDistancePips * dollarPerPipAtOneLot).toFixed(2)} | TP Profit: $${expectedProfitAtTP.toFixed(2)} | R:R ${impliedRR.toFixed(2)}:1`);

  return {
    lotSize: actualLotSize,
    expectedProfitAtCommonMove,
    remainingGoal,
    estimatedTradesNeeded,
    reasoning,
    goalFeasibility,
    feasible: true
  };
}

/**
 * @deprecated Backward compatibility export. Use calculateGoalAwareLotSize() instead.
 * This alias exists only to prevent breaking existing code that references the old name.
 */
export const calculateGoalOptimalPosition = calculateGoalAwareLotSize;

/**
 * @deprecated This function is DEPRECATED and should NOT be used.
 *
 * CRITICAL DESIGN FLAW: Setting TP based on goal amount ignores market reality.
 *
 * PROBLEM:
 * - Forces TP to hit goal amount regardless of market conditions
 * - Causes trades to reverse from profit when TP is unrealistic
 * - User watches $225 profit turn into $21 because TP was set at $300 goal
 *
 * SOLUTION: Use Alpha's market-based TP directly. Let multiple realistic trades reach goal.
 *
 * @deprecated Use Alpha's TP decisions directly. Calculate lot size with calculateGoalAwareLotSize().
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
 * Calculate the SL price to set after TP1 is hit (ATR-based lock-in buffer).
 *
 * SSOT: This is the SINGLE SOURCE OF TRUTH for the post-TP1 breakeven SL price.
 * Only position-monitoring-authority may call this to produce the new SL value.
 *
 * Strategy:
 *   BUY:  newSL = entryPrice + (atr * bufferFraction)  — locks in a small profit
 *   SELL: newSL = entryPrice - (atr * bufferFraction)  — locks in a small profit
 *
 * Buffer fraction is 0.1× ATR by default.  This scales naturally per instrument:
 *   EURUSD  ATR ~0.0010 → buffer ~0.0001  (≈1 pip)
 *   XAUUSD  ATR ~8.00   → buffer ~0.80    (≈0.8 point)
 *   NAS100  ATR ~50.0   → buffer ~5.0     (≈5 points)
 *
 * @param direction 'buy' | 'sell'
 * @param entryPrice Trade entry price
 * @param atr        Current ATR value for the symbol (in price units, same scale as entryPrice)
 * @param bufferFraction Multiplier applied to ATR (default 0.10)
 */
export function calculateTP1BreakevenSL(
  direction: 'buy' | 'sell',
  entryPrice: number,
  atr: number,
  bufferFraction = 0.10
): number {
  if (!isFinite(entryPrice) || entryPrice <= 0) {
    throw new Error(`[calculateTP1BreakevenSL] Invalid entryPrice: ${entryPrice}`);
  }
  if (!isFinite(atr) || atr <= 0) {
    throw new Error(`[calculateTP1BreakevenSL] Invalid ATR: ${atr}`);
  }

  const buffer = atr * bufferFraction;

  return direction === 'buy'
    ? entryPrice + buffer
    : entryPrice - buffer;
}

/**
 * Calculate the split P&L for a dual-TP trade that went through TP1.
 *
 * SSOT: This is the SINGLE SOURCE OF TRUTH for split P&L calculation.
 * Called by post-trade-analyzer after a trade closes to populate tp1_pnl / tp2_pnl.
 *
 * @param symbol      Instrument symbol (for pip calculations)
 * @param direction   'buy' | 'sell'
 * @param entryPrice  Trade entry price
 * @param tp1Price    TP1 price (the first milestone that was hit)
 * @param exitPrice   Final exit price (could be TP2, moved SL, or manual)
 * @param lotSize     Full lot size of the position
 * @param partialClosePct Fraction of the position attributed to the TP1 leg (e.g. 0.50)
 * @returns { tp1Pnl, tp2Pnl, totalPnl }
 */
export function calculateSplitPnL(
  symbol: string,
  direction: 'buy' | 'sell',
  entryPrice: number,
  tp1Price: number,
  exitPrice: number,
  lotSize: number,
  partialClosePct: number
): { tp1Pnl: number; tp2Pnl: number; totalPnl: number } {
  if (partialClosePct <= 0 || partialClosePct >= 1) {
    throw new Error(`[calculateSplitPnL] partialClosePct must be between 0 and 1, got: ${partialClosePct}`);
  }

  const tp1LotSize = roundLotSize(lotSize * partialClosePct);
  const tp2LotSize = roundLotSize(lotSize * (1 - partialClosePct));

  const tp1Pnl = roundPnL(
    calculateDollarPerPip(symbol, tp1LotSize) *
    calculatePipDistance(symbol, entryPrice, tp1Price) *
    (direction === 'buy' ? (tp1Price > entryPrice ? 1 : -1) : (tp1Price < entryPrice ? 1 : -1))
  );

  const tp2Pnl = roundPnL(
    calculateDollarPerPip(symbol, tp2LotSize) *
    calculatePipDistance(symbol, entryPrice, exitPrice) *
    (direction === 'buy' ? (exitPrice > entryPrice ? 1 : -1) : (exitPrice < entryPrice ? 1 : -1))
  );

  return {
    tp1Pnl,
    tp2Pnl,
    totalPnl: roundPnL(tp1Pnl + tp2Pnl)
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
