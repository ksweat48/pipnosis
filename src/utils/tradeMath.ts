/**
 * TradeMath - Unified Trade Mathematics Layer
 *
 * SSOT ENFORCEMENT LAYER
 *
 * This is the ONLY layer allowed to perform pip/lot/$ calculations outside of currencyHelpers.ts.
 * All trading components MUST call through this layer.
 *
 * This layer is a thin, strongly-typed wrapper around SSOT (currencyHelpers.ts).
 * It provides:
 * 1. Explicit function names for each calculation type
 * 2. Runtime validation and error messages
 * 3. Centralized enforcement point for SSOT compliance
 * 4. Clear audit trail for all math operations
 *
 * FORBIDDEN PATTERNS - DO NOT USE ANYWHERE IN TRADE FLOW:
 * ❌ Math.abs(price1 - price2) / 0.0001
 * ❌ Math.abs(price1 - price2) * 10000
 * ❌ lotSize * 10
 * ❌ price.toFixed(5)
 * ❌ if (symbol.includes('JPY')) { pipValue = 0.01 }
 *
 * ✅ ALWAYS USE:
 * ✅ tradeMath.calculatePips(symbol, price1, price2)
 * ✅ tradeMath.calculateDollarsPerPip(symbol, lotSize)
 * ✅ tradeMath.formatPrice(symbol, price)
 * ✅ tradeMath.getSymbolProfile(symbol).pipValue
 */

import {
  getCurrencyPipInfo,
  calculatePipDistance,
  calculateDollarPerPip,
  calculatePositionSize,
  calculateLotSizeFromDollarRisk,
  calculateGoalAwareLotSize,
  adjustSLTPForCurrency,
  formatCurrencyPrice,
  calculateAndValidateRR,
  type CurrencyPipInfo
} from './currencyHelpers';
import { getSymbolConfig } from '../config/symbol-registry';
import type { TradeContext, TradeContextResult } from '../types/trade-context';
import { createProfileHash, createConverters, isContextStale } from '../types/trade-context';
import { unwrapPrice } from '../types/trading-units';

// ============================================================================
// TRADECONTEXT FACTORY - SSOT ENTRY POINT
// ============================================================================

/**
 * Create TradeContext - THE ONLY LEGAL WAY TO OBTAIN SSOT PARAMETERS
 *
 * This is the MANDATORY entry point for all trade-related mathematics.
 * All Alpha/Omega/Execution functions MUST accept TradeContext.
 *
 * ARCHITECTURE PRINCIPLE:
 * TradeContext can ONLY be created here. Business logic layers MUST NOT
 * compute pip values, lot sizes, or dollar conversions directly.
 *
 * @example
 * const result = tradeMath.createTradeContext('EURUSD');
 * if (!result.success) {
 *   return { action: 'NO_TRADE', error: result.error };
 * }
 * const ctx = result.context!;
 * const dollarsPerPip = ctx.calculateDollarsPerPip(lots(0.1));
 */
export function createTradeContext(symbol: string): TradeContextResult {
  try {
    // Validate symbol input
    if (!symbol || typeof symbol !== 'string') {
      return {
        success: false,
        error: `Invalid symbol: ${symbol}`,
        errorCode: 'INVALID_SYMBOL'
      };
    }

    const normalizedSymbol = symbol.toUpperCase().trim();

    // Load symbol config from SSOT (symbol-registry.ts)
    const config = getSymbolConfig(normalizedSymbol);
    if (!config) {
      return {
        success: false,
        error: `Symbol not found in registry: ${normalizedSymbol}`,
        errorCode: 'SYMBOL_NOT_FOUND'
      };
    }

    // Create integrity hash
    const profileHash = createProfileHash(config);

    // Create timestamp
    const createdAt = new Date();
    const createdTimestamp = createdAt.getTime();

    // Create bound converter functions
    const converters = createConverters(config);

    // Assemble immutable context object
    const context: TradeContext = {
      symbol: config.symbol,
      category: config.category,
      displayName: config.displayName,

      // Core math parameters
      pipValue: config.pipValue,
      pipMultiplier: config.pipMultiplier,
      decimalPlaces: config.decimalPlaces,
      contractSize: config.contractSize,
      dollarPerPipPerLot: config.dollarPerPipPerLot,

      // Broker constraints
      minLotSize: config.minLotSize,
      maxLotSize: config.maxLotSize,
      lotStepSize: config.minLotSize, // Step size equals min lot size

      // Volatility characteristics
      typicalDailyRangePoints: config.typicalDailyRangePoints,
      typicalSessionMovePoints: config.typicalSessionMovePoints,
      atrMultiplierForStop: config.atrMultiplierForStop,

      // Integrity validation
      profileHash,
      createdAt,
      createdTimestamp,

      // Bound converter methods
      ...converters,
    };

    return {
      success: true,
      context,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating TradeContext',
      errorCode: 'CONTEXT_CREATION_FAILED'
    };
  }
}

/**
 * Validate TradeContext integrity
 *
 * Checks:
 * - Context exists and is valid
 * - Profile hash matches current symbol registry
 * - Context is not stale (< 5 minutes old)
 *
 * @param ctx The context to validate
 * @param maxAgeMs Maximum allowed age in milliseconds (default 5 minutes)
 */
export function validateTradeContext(
  ctx: TradeContext | undefined,
  maxAgeMs: number = 5 * 60 * 1000
): { valid: boolean; error?: string; violationType?: string } {
  if (!ctx) {
    return {
      valid: false,
      error: 'TradeContext is missing or undefined',
      violationType: 'MISSING_CONTEXT'
    };
  }

  // Check staleness
  if (isContextStale(ctx, maxAgeMs)) {
    const ageSeconds = Math.floor((Date.now() - ctx.createdTimestamp) / 1000);
    return {
      valid: false,
      error: `TradeContext is stale (${ageSeconds}s old, max ${maxAgeMs / 1000}s)`,
      violationType: 'STALE_CONTEXT'
    };
  }

  // Validate hash matches current config
  const currentConfig = getSymbolConfig(ctx.symbol);
  if (!currentConfig) {
    return {
      valid: false,
      error: `Symbol ${ctx.symbol} no longer in registry`,
      violationType: 'PROFILE_MISMATCH'
    };
  }

  const currentHash = createProfileHash(currentConfig);
  if (currentHash !== ctx.profileHash) {
    return {
      valid: false,
      error: `TradeContext hash mismatch for ${ctx.symbol} (symbol config may have changed)`,
      violationType: 'HASH_MISMATCH'
    };
  }

  return { valid: true };
}

/**
 * Re-create TradeContext for same symbol (refreshes timestamp and hash)
 *
 * Use when context has become stale but symbol hasn't changed
 */
export function refreshTradeContext(oldContext: TradeContext): TradeContextResult {
  return createTradeContext(oldContext.symbol);
}

// ============================================================================
// LEGACY FUNCTIONS - DEPRECATED (Use TradeContext instead)
// ============================================================================

/**
 * Get complete symbol profile (pip value, lot sizing, etc.)
 * This is the ENTRY POINT for all symbol-specific data.
 *
 * @deprecated Use createTradeContext() instead for new code
 *
 * @example
 * const profile = tradeMath.getSymbolProfile('EURUSD');
 * console.log(profile.pipValue); // 0.0001
 * console.log(profile.dollarPerPipPerLot); // 10
 */
export function getSymbolProfile(symbol: string): CurrencyPipInfo {
  if (!symbol || typeof symbol !== 'string') {
    throw new Error(`[TradeMath] Invalid symbol: ${symbol}`);
  }
  return getCurrencyPipInfo(symbol);
}

/**
 * Calculate pip distance between two prices
 *
 * USE THIS instead of:
 * ❌ Math.abs(price1 - price2) / 0.0001
 * ❌ Math.abs(price1 - price2) * 10000
 *
 * @example
 * const pips = tradeMath.calculatePips('EURUSD', 1.1000, 1.1010); // 100 pips
 * const pips = tradeMath.calculatePips('XAUUSD', 2000, 2010); // 10 pips
 * const pips = tradeMath.calculatePips('USDJPY', 110.00, 110.10); // 10 pips
 */
export function calculatePips(symbol: string, price1: number, price2: number): number {
  validatePrices(price1, price2);
  return calculatePipDistance(symbol, price1, price2);
}

/**
 * Calculate dollar value per pip for a position
 *
 * USE THIS instead of:
 * ❌ lotSize * 10
 * ❌ lotSize * dollarPerPipPerLot (unless you got dollarPerPipPerLot from SSOT)
 *
 * @example
 * const dollarPerPip = tradeMath.calculateDollarsPerPip('EURUSD', 0.1); // $1.00
 * const dollarPerPip = tradeMath.calculateDollarsPerPip('XAUUSD', 0.01); // $1.00
 * const dollarPerPip = tradeMath.calculateDollarsPerPip('US30', 0.01); // $1.00
 */
export function calculateDollarsPerPip(symbol: string, lotSize: number): number {
  if (lotSize <= 0 || isNaN(lotSize)) {
    throw new Error(`[TradeMath] Invalid lot size: ${lotSize}`);
  }
  return calculateDollarPerPip(symbol, lotSize);
}

/**
 * Calculate position size from risk parameters (percentage-based)
 *
 * USE THIS instead of: manual risk / (pips * dollarPerPip) calculations
 *
 * @example
 * const lotSize = tradeMath.calculateLotSize({
 *   symbol: 'EURUSD',
 *   accountBalance: 10000,
 *   riskPercentage: 2,
 *   entryPrice: 1.1000,
 *   stopLoss: 1.0980
 * }); // Returns lot size risking $200 (2% of $10k)
 */
export function calculateLotSize(params: {
  symbol: string;
  accountBalance: number;
  riskPercentage: number;
  entryPrice: number;
  stopLoss: number;
}): number {
  validatePositionSizeParams(params);
  return calculatePositionSize(
    params.symbol,
    params.accountBalance,
    params.riskPercentage,
    params.entryPrice,
    params.stopLoss,
    false // not estimation
  );
}

/**
 * Calculate position size from fixed dollar risk (Trade Styles system)
 *
 * USE THIS for fixed-dollar risk strategies (Sniper, Scalper, Day Trader)
 *
 * @example
 * const lotSize = tradeMath.calculateLotSizeFromDollars({
 *   symbol: 'EURUSD',
 *   dollarRisk: 100,
 *   entryPrice: 1.1000,
 *   stopLoss: 1.0980
 * }); // Returns lot size that risks exactly $100
 */
export function calculateLotSizeFromDollars(params: {
  symbol: string;
  dollarRisk: number;
  entryPrice: number;
  stopLoss: number;
}): number {
  if (params.dollarRisk <= 0) {
    throw new Error(`[TradeMath] Invalid dollar risk: ${params.dollarRisk}`);
  }
  validatePrices(params.entryPrice, params.stopLoss);
  return calculateLotSizeFromDollarRisk(
    params.symbol,
    params.dollarRisk,
    params.entryPrice,
    params.stopLoss
  );
}

/**
 * Calculate R:R ratio with full validation
 *
 * USE THIS instead of: manual (tp - entry) / (entry - sl) calculations
 *
 * @example
 * const result = tradeMath.calculateRiskReward({
 *   symbol: 'EURUSD',
 *   entryPrice: 1.1000,
 *   stopLoss: 1.0980,
 *   takeProfit: 1.1040,
 *   direction: 'buy'
 * });
 * console.log(result.rr); // 2.0 (40 pips reward / 20 pips risk)
 * console.log(result.isValid); // true
 */
export function calculateRiskReward(params: {
  symbol: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  direction: 'buy' | 'sell';
}): { rr: number; riskPips: number; rewardPips: number; isValid: boolean; warnings: string[] } {
  const result = calculateAndValidateRR(
    params.symbol,
    params.entryPrice,
    params.stopLoss,
    params.takeProfit,
    params.direction
  );
  return {
    rr: result.riskReward,
    riskPips: result.riskPips,
    rewardPips: result.rewardPips,
    isValid: result.validation.isValid,
    warnings: result.validation.warnings
  };
}

/**
 * Format price for display with correct decimals
 *
 * USE THIS instead of:
 * ❌ price.toFixed(2)
 * ❌ price.toFixed(5)
 *
 * @example
 * tradeMath.formatPrice('EURUSD', 1.10005); // "1.10005"
 * tradeMath.formatPrice('XAUUSD', 2000.123); // "2000.12"
 * tradeMath.formatPrice('USDJPY', 110.123); // "110.12"
 */
export function formatPrice(symbol: string, price: number): string {
  return formatCurrencyPrice(symbol, price);
}

/**
 * Calculate goal-aware position sizing (legacy system)
 *
 * USE calculateLotSizeFromDollars() for new Trade Styles system instead
 */
export function calculateGoalAwareLot(params: {
  symbol: string;
  direction: 'buy' | 'sell';
  accountBalance: number;
  entryPrice: number;
  stopLoss: number;
  currentProgress: number;
  targetGoal: number;
  riskMode: 'low' | 'medium' | 'high';
}): {
  lotSize: number;
  expectedProfitAtCommonMove: number;
  remainingGoal: number;
  estimatedTradesNeeded: number;
  reasoning: string;
  goalFeasibility: 'single_trade' | 'multiple_trades' | 'unrealistic';
  feasible: boolean;
} {
  return calculateGoalAwareLotSize(
    params.symbol,
    params.direction,
    params.accountBalance,
    params.entryPrice,
    params.stopLoss,
    params.currentProgress,
    params.targetGoal,
    params.riskMode
  );
}

/**
 * Adjust SL/TP for currency-specific pip values
 *
 * Converts pip distances to price distances for order placement
 */
export function adjustSLTP(params: {
  symbol: string;
  entryPrice: number;
  slDistance: number; // in pips
  tpDistance: number; // in pips
  direction: 'buy' | 'sell';
}): { stopLoss: number; takeProfit: number } {
  return adjustSLTPForCurrency(
    params.symbol,
    params.entryPrice,
    params.slDistance,
    params.tpDistance,
    params.direction
  );
}

// ============================================================================
// PRIVATE VALIDATION HELPERS
// ============================================================================

function validatePrices(...prices: number[]): void {
  for (const price of prices) {
    if (typeof price !== 'number' || isNaN(price) || price <= 0) {
      throw new Error(`[TradeMath] Invalid price: ${price}`);
    }
  }
}

function validatePositionSizeParams(params: any): void {
  if (params.accountBalance <= 0) {
    throw new Error(`[TradeMath] Invalid account balance: ${params.accountBalance}`);
  }
  if (params.riskPercentage <= 0 || params.riskPercentage > 15) {
    throw new Error(`[TradeMath] Invalid risk percentage: ${params.riskPercentage}% (must be 0-15%)`);
  }
  validatePrices(params.entryPrice, params.stopLoss);
}

// ============================================================================
// ALPHA DECISION PRICE ROUNDING - SSOT FOR PRECISION ENFORCEMENT
// ============================================================================

/**
 * Round all prices in an AlphaDecision to proper decimal precision
 *
 * This is the SINGLE SOURCE OF TRUTH for price precision enforcement.
 * All AlphaDecisions MUST pass through this function before execution.
 *
 * ARCHITECTURE: Price rounding happens at the boundary between Alpha's
 * decision-making (which may produce arbitrary precision) and execution
 * (which requires exchange-compliant precision).
 *
 * @param decision - The AlphaDecision from coordinator-alpha
 * @param tradeContext - TradeContext containing roundPrice function
 * @returns Modified decision with all prices rounded to correct precision
 */
export function roundAlphaDecisionPrices<T extends {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  tp1Price?: number | null;
  tp2Price?: number;
}>(decision: T, tradeContext: TradeContext): T {
  return {
    ...decision,
    entry: unwrapPrice(tradeContext.roundPrice(decision.entry)),
    stopLoss: unwrapPrice(tradeContext.roundPrice(decision.stopLoss)),
    takeProfit: unwrapPrice(tradeContext.roundPrice(decision.takeProfit)),
    tp1Price: decision.tp1Price ? unwrapPrice(tradeContext.roundPrice(decision.tp1Price)) : decision.tp1Price,
    tp2Price: decision.tp2Price ? unwrapPrice(tradeContext.roundPrice(decision.tp2Price)) : decision.tp2Price,
  };
}

// ============================================================================
// DEPRECATION WARNINGS
// ============================================================================

/**
 * @deprecated DO NOT USE - This is a marker for code scanning
 * Any direct pip calculations found in trade flow code are violations
 */
export const FORBIDDEN_PATTERNS = {
  HARDCODED_PIP_DIVISION: '/ 0.0001',
  HARDCODED_PIP_MULTIPLICATION: '* 10000',
  HARDCODED_DOLLAR_PER_PIP: 'lotSize * 10',
  SYMBOL_CONDITIONALS: 'if (symbol.includes(...)) { pipValue = ... }',
  MANUAL_TOFIXED: 'price.toFixed(5)'
} as const;

/**
 * Runtime detection of SSOT bypasses (development mode only)
 *
 * NOTE: ESLint rules provide compile-time detection. Runtime detection
 * has been removed to avoid build warnings about reassigning imports.
 * All violations should be caught by ESLint before build.
 */
